// CRM Phase 1 — customers + leads. Dedicated route file (not the generic
// /api/entities/:name REGISTRY) because these need joins, search, rollups
// and cursor-ish ordering that entities.js's PRAGMA-table_info-driven CRUD
// can't express. See CLAUDE.md CRM plan §3.

const { toE164 } = require('../services/crm/phone');

module.exports = function registerCrm(app, db, deps) {
  const { requireAuth, requireAdmin } = deps;

  // ── CRM settings (single row) ─────────────────────────────────────────────
  app.get('/api/crm/settings', requireAdmin, (req, res) => {
    res.json(db.prepare(`SELECT * FROM crm_settings WHERE id = 1`).get());
  });
  app.put('/api/crm/settings', requireAdmin, (req, res) => {
    const body = req.body || {};
    const editable = [
      'whatsapp_provider', 'bulk_provider', 'telephony_provider', 'monday_poll_enabled',
      'global_daily_send_cap', 'queue_min_delay_sec', 'queue_max_delay_sec', 'idle_timeout_sec',
      'lock_ttl_sec', 'auto_optout_keywords',
      // Phase 4 — bulk WhatsApp broadcasts (דיוור)
      'send_window_start', 'send_window_end', 'send_days', 'optout_footer', 'optout_reply_text',
    ];
    const row = { id: 1 };
    const setCols = [];
    for (const c of editable) {
      if (c in body) { row[c] = body[c]; setCols.push(c); }
    }
    if (setCols.length) {
      setCols.push('updated_at'); row.updated_at = new Date().toISOString();
      db.prepare(`UPDATE crm_settings SET ${setCols.map(c => `${c} = @${c}`).join(', ')} WHERE id = 1`).run(row);
    }
    res.json(db.prepare(`SELECT * FROM crm_settings WHERE id = 1`).get());
  });

  const customerCols = db.prepare(`PRAGMA table_info(customers)`).all().map(c => c.name);
  const leadCols = db.prepare(`PRAGMA table_info(crm_leads)`).all().map(c => c.name);

  function customerById(id) {
    return db.prepare(`SELECT * FROM customers WHERE id = ?`).get(id);
  }

  // Writes first_touch_at exactly once — the single source of "time to first
  // response" (CRM plan §5). Called from the lead-status-transition endpoint;
  // later phases (reply/call logging) call the same helper.
  function touchLead(leadId, username) {
    db.prepare(
      `UPDATE crm_leads SET first_touch_at = COALESCE(first_touch_at, CURRENT_TIMESTAMP), first_touch_by = COALESCE(first_touch_by, ?) WHERE id = ?`
    ).run(username, leadId);
  }

  // ── Customers ──────────────────────────────────────────────────────────
  app.get('/api/crm/customers', requireAuth, (req, res) => {
    const { q, limit } = req.query;
    const where = ['merged_into_id IS NULL'];
    const params = [];
    if (q && q.toString().trim()) {
      const needle = `%${q.toString().trim()}%`;
      where.push('(display_name LIKE ? OR phone_e164 LIKE ? OR phone_raw LIKE ? OR email LIKE ? OR company LIKE ?)');
      params.push(needle, needle, needle, needle, needle);
    }
    const lim = Number.isInteger(+limit) ? Math.min(parseInt(limit, 10), 500) : 200;
    const rows = db.prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM crm_leads l WHERE l.customer_id = c.id AND l.status NOT IN ('won','lost','disqualified')) AS open_leads,
              (SELECT COUNT(*) FROM signshop_quotes q WHERE q.customer_id = c.id) AS quote_count,
              (SELECT MAX(created_at) FROM signshop_quotes q WHERE q.customer_id = c.id) AS last_quote_at
       FROM customers c
       WHERE ${where.join(' AND ')}
       ORDER BY c.updated_at DESC
       LIMIT ${lim}`
    ).all(...params);
    res.json(rows);
  });

  app.get('/api/crm/customers/:id', requireAuth, (req, res) => {
    const customer = customerById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'לקוח לא נמצא' });
    customer.leads = db.prepare(`SELECT * FROM crm_leads WHERE customer_id = ? ORDER BY created_at DESC`).all(customer.id);
    customer.quotes = db.prepare(`SELECT id, quote_number, product_category, price_with_vat, status, created_at FROM signshop_quotes WHERE customer_id = ? ORDER BY created_at DESC`).all(customer.id);
    res.json(customer);
  });

  app.post('/api/crm/customers', requireAuth, (req, res) => {
    const body = req.body || {};
    const name = (body.display_name || '').toString().trim();
    if (!name) return res.status(400).json({ error: 'display_name required' });
    const phone = body.phone_raw ? toE164(body.phone_raw) : null;

    // Avoid creating a second row for a phone number that already exists —
    // return the existing customer instead (mirrors quoteCreate's Morning-client
    // dedupe-by-name convention).
    if (phone) {
      const existing = db.prepare(`SELECT * FROM customers WHERE phone_e164 = ? AND merged_into_id IS NULL`).get(phone);
      if (existing) return res.status(200).json(existing);
    }

    const row = {
      display_name: name,
      phone_e164: phone,
      phone_raw: body.phone_raw || null,
      email: body.email || null,
      vat_id: body.vat_id || null,
      address: body.address || null,
      company: body.company || null,
      source: body.source || 'manual',
      owner_username: body.owner_username || req.user.username,
      created_by: req.user.username,
    };
    const cols = Object.keys(row);
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO customers (${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`
    ).run(row);
    res.status(201).json(customerById(lastInsertRowid));
  });

  app.put('/api/crm/customers/:id', requireAuth, (req, res) => {
    const existing = customerById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'לקוח לא נמצא' });
    const body = req.body || {};
    const editable = customerCols.filter(c => !['id', 'created_at', 'updated_at', 'merged_into_id', 'source'].includes(c));
    const setCols = [];
    const row = { id: existing.id };
    for (const c of editable) {
      if (c in body) {
        let v = body[c];
        if (c === 'phone_raw') { row.phone_e164 = v ? toE164(v) : null; setCols.push('phone_e164'); }
        row[c] = v;
        setCols.push(c);
      }
    }
    if (setCols.length) {
      setCols.push('updated_at');
      row.updated_at = new Date().toISOString();
      db.prepare(`UPDATE customers SET ${[...new Set(setCols)].map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`).run(row);
    }
    res.json(customerById(existing.id));
  });

  // Merges `into_id` <- `req.params.id`'s data: re-points leads/quotes to the
  // surviving customer and tombstones the loser via merged_into_id.
  app.post('/api/crm/customers/:id/merge', requireAuth, (req, res) => {
    const loserId = parseInt(req.params.id, 10);
    const winnerId = parseInt((req.body || {}).into_id, 10);
    if (!winnerId || winnerId === loserId) return res.status(400).json({ error: 'into_id required and must differ' });
    const loser = customerById(loserId);
    const winner = customerById(winnerId);
    if (!loser || !winner) return res.status(404).json({ error: 'customer not found' });

    const tx = db.transaction(() => {
      db.prepare(`UPDATE crm_leads SET customer_id = ? WHERE customer_id = ?`).run(winnerId, loserId);
      db.prepare(`UPDATE signshop_quotes SET customer_id = ? WHERE customer_id = ?`).run(winnerId, loserId);
      db.prepare(`UPDATE customers SET merged_into_id = ?, status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(winnerId, loserId);
      db.prepare(`INSERT INTO crm_activity_log (customer_id, type, summary, actor) VALUES (?, 'merge', ?, ?)`)
        .run(winnerId, `מוזג מלקוח #${loserId} (${loser.display_name})`, req.user.username);
    });
    tx();
    res.json(customerById(winnerId));
  });

  app.post('/api/crm/customers/:id/notes', requireAuth, (req, res) => {
    const customer = customerById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'לקוח לא נמצא' });
    const text = (req.body?.text || '').toString().trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    db.prepare(`INSERT INTO crm_activity_log (customer_id, type, summary, actor) VALUES (?, 'note', ?, ?)`)
      .run(customer.id, text, req.user.username);
    res.status(201).json(db.prepare(`SELECT * FROM crm_activity_log WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`).all(customer.id));
  });

  app.get('/api/crm/customers/:id/timeline', requireAuth, (req, res) => {
    const customer = customerById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'לקוח לא נמצא' });
    const activity = db.prepare(`SELECT id, type AS kind, summary, actor, created_at FROM crm_activity_log WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200`).all(customer.id);
    const quotes = db.prepare(`SELECT id, 'quote' AS kind, quote_number AS summary, created_by AS actor, created_at FROM signshop_quotes WHERE customer_id = ? ORDER BY created_at DESC`).all(customer.id);
    const merged = [...activity, ...quotes].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    res.json(merged);
  });

  // ── Leads ──────────────────────────────────────────────────────────────
  app.get('/api/crm/leads', requireAuth, (req, res) => {
    const { status, assigned_to, customer_id } = req.query;
    const where = [];
    const params = [];
    if (status) { where.push('l.status = ?'); params.push(status); }
    if (assigned_to) { where.push('l.assigned_to = ?'); params.push(assigned_to); }
    if (customer_id) { where.push('l.customer_id = ?'); params.push(customer_id); }
    let sql = `SELECT l.*, c.display_name AS customer_name, c.phone_e164 AS customer_phone FROM crm_leads l JOIN customers c ON c.id = l.customer_id`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY l.updated_at DESC LIMIT 300`;
    res.json(db.prepare(sql).all(...params));
  });

  app.post('/api/crm/leads', requireAuth, (req, res) => {
    const body = req.body || {};
    const customerId = parseInt(body.customer_id, 10);
    if (!customerId || !customerById(customerId)) return res.status(400).json({ error: 'customer_id required' });
    const row = {
      customer_id: customerId,
      campaign_id: body.campaign_id || null,
      source: body.source || 'manual',
      external_ref: body.external_ref || null,
      status: body.status || 'new',
      title: body.title || null,
      notes: body.notes || null,
      assigned_to: body.assigned_to || req.user.username,
      value_estimate: body.value_estimate != null ? Number(body.value_estimate) : null,
    };
    const cols = Object.keys(row);
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO crm_leads (${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`
    ).run(row);
    touchLead(lastInsertRowid, req.user.username);
    res.status(201).json(db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(lastInsertRowid));
  });

  app.put('/api/crm/leads/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'ליד לא נמצא' });
    const body = req.body || {};
    const editable = leadCols.filter(c => !['id', 'customer_id', 'created_at'].includes(c));
    const row = { id };
    const setCols = [];
    for (const c of editable) {
      if (c in body) { row[c] = body[c]; setCols.push(c); }
    }
    if (body.status && body.status !== existing.status) {
      if (['won', 'lost', 'disqualified'].includes(body.status) && !('closed_at' in row)) {
        row.closed_at = new Date().toISOString(); setCols.push('closed_at');
      }
      db.prepare(`INSERT INTO crm_activity_log (customer_id, lead_id, type, summary, actor) VALUES (?, ?, 'status_change', ?, ?)`)
        .run(existing.customer_id, id, `${existing.status} → ${body.status}`, req.user.username);
    }
    if (setCols.length) {
      row.updated_at = new Date().toISOString(); setCols.push('updated_at');
      db.prepare(`UPDATE crm_leads SET ${[...new Set(setCols)].map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`).run(row);
    }
    touchLead(id, req.user.username);
    res.json(db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id));
  });

  // Links an existing quote to this lead/customer (used once the calculator
  // has produced a quote for a lead) — does not create a new quote itself.
  app.post('/api/crm/leads/:id/convert', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lead = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });
    const quoteId = parseInt((req.body || {}).quote_id, 10);
    if (!quoteId) return res.status(400).json({ error: 'quote_id required' });
    const quote = db.prepare(`SELECT * FROM signshop_quotes WHERE id = ?`).get(quoteId);
    if (!quote) return res.status(404).json({ error: 'הצעה לא נמצאה' });
    db.prepare(`UPDATE signshop_quotes SET customer_id = ?, lead_id = ? WHERE id = ?`).run(lead.customer_id, id, quoteId);
    db.prepare(`UPDATE crm_leads SET quote_id = ?, status = 'quoted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(quoteId, id);
    res.json(db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id));
  });
};
