// CRM Phase 1 — customers + leads. Dedicated route file (not the generic
// /api/entities/:name REGISTRY) because these need joins, search, rollups
// and cursor-ish ordering that entities.js's PRAGMA-table_info-driven CRUD
// can't express. See CLAUDE.md CRM plan §3.

const { toE164 } = require('../services/crm/phone');
const { releaseClaim, releaseReason } = require('../services/crm/leadClaims');
const { DOCUMENT_TYPE } = require('../services/morning/mappings');

// Server-side twin of sign-smart-quote/src/lib/quoteEconomics.js's
// linesOf/economicsOf — same definition (cost = Σ line totalCostAll,
// revenue = price_before_vat), duplicated rather than imported because that
// file is an ESM frontend module (imports @/lib/quoteLabels, a React
// component file) that this CommonJS backend can't require directly. Keep
// the two in sync by hand if the frontend definition ever changes.
function quoteEconomics(quote) {
  let calc;
  try { calc = quote.calculation_data ? JSON.parse(quote.calculation_data) : null; } catch (_) { calc = null; }
  const items = calc?.items || (calc?.result ? [{ result: calc.result }] : []);
  const lines = [];
  for (const it of items) {
    if (it?.result) lines.push(it.result);
    for (const er of it?.extraRows || []) { if (er?.result) lines.push(er.result); }
  }
  if (!lines.length) return null; // no saved breakdown → cannot cost it
  const cost = lines.reduce((s, l) => s + (l.totalCostAll || 0), 0);
  const revenue = quote.price_before_vat || 0;
  return { cost, revenue, profit: revenue - cost };
}

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
      // Phase 5 — lead pull-queue
      'reply_overdue_minutes', 'max_claimed_leads', 'lead_claim_ttl_hours', 'agents_see_follow_ups',
      // Agent signature prefixed to agent-typed inbox replies
      'agent_signature_enabled', 'agent_signature_template',
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

  // Marketing/monday-board campaigns (crm_campaigns) — distinct from
  // /api/campaigns (wa_campaigns, the bulk-דיוור broadcasts). Used to
  // populate the per-agent campaign-restriction picker (Phase 5 §5).
  app.get('/api/crm/campaigns', requireAdmin, (req, res) => {
    res.json(db.prepare(`SELECT id, name FROM crm_campaigns ORDER BY name`).all());
  });

  // Manually-entered DAILY ad spend — the only cost input for campaign ROI
  // (see routes/crm.js's /analytics/campaigns). `day` optional filter
  // ('YYYY-MM-DD'); omitted returns everything (small table, fine to load whole).
  app.get('/api/crm/campaign-spend', requireAdmin, (req, res) => {
    const { day } = req.query;
    const rows = day
      ? db.prepare(`SELECT * FROM crm_campaign_spend WHERE day = ? ORDER BY campaign_id`).all(day)
      : db.prepare(`SELECT * FROM crm_campaign_spend ORDER BY day DESC, campaign_id`).all();
    res.json(rows);
  });

  // Upsert one campaign+day's spend. amount=0/blank deletes the row
  // (rather than storing a 0 — keeps "no data entered" distinct from
  // "spent nothing", both of which the analytics endpoint treats as "—").
  app.put('/api/crm/campaign-spend', requireAdmin, (req, res) => {
    const { campaign_id, day, amount, notes } = req.body || {};
    if (!campaign_id || !day) return res.status(400).json({ error: 'campaign_id and day required' });
    const amt = amount === '' || amount == null ? null : Number(amount);
    if (amt == null || amt <= 0) {
      db.prepare(`DELETE FROM crm_campaign_spend WHERE campaign_id = ? AND day = ?`).run(campaign_id, day);
      return res.json({ ok: true, deleted: true });
    }
    db.prepare(`
      INSERT INTO crm_campaign_spend (campaign_id, day, amount, notes, updated_by)
      VALUES (@campaign_id, @day, @amount, @notes, @updated_by)
      ON CONFLICT(campaign_id, day) DO UPDATE SET amount = excluded.amount, notes = excluded.notes,
        updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
    `).run({ campaign_id, day, amount: amt, notes: notes || null, updated_by: req.user.username });
    res.json(db.prepare(`SELECT * FROM crm_campaign_spend WHERE campaign_id = ? AND day = ?`).get(campaign_id, day));
  });

  // Campaign profitability table — one row per campaign. Every ratio
  // (CPL/CPA/ROAS) divides by real spend from crm_campaign_spend; a
  // campaign with no spend entered for the range renders those as null so
  // the frontend can show "—" instead of Infinity/dividing by zero.
  // "Closed" mirrors QuotesAnalytics.jsx's definition exactly (a Morning
  // ORDER document exists) via crm_leads.closed_at, which the jobs.js sweep
  // (leadOutcomeSweepTick) and leadContext.js both stamp from that same
  // signal — so this can never disagree with the quotes analytics tab.
  app.get('/api/crm/analytics/campaigns', requireAdmin, (req, res) => {
    const { date_from, date_to } = req.query;
    const campaigns = db.prepare(`SELECT id, name FROM crm_campaigns ORDER BY name`).all();

    const arrivedWhere = ['l.campaign_id = @id'];
    const quotedWhere = ['l.campaign_id = @id', 'l.quoted_at IS NOT NULL'];
    const closedWhere = ['l.campaign_id = @id', "l.status = 'won'", 'l.closed_at IS NOT NULL'];
    if (date_from) {
      arrivedWhere.push('date(COALESCE(l.source_created_at,l.created_at)) >= date(@date_from)');
      quotedWhere.push('date(l.quoted_at) >= date(@date_from)');
      closedWhere.push('date(l.closed_at) >= date(@date_from)');
    }
    if (date_to) {
      arrivedWhere.push('date(COALESCE(l.source_created_at,l.created_at)) <= date(@date_to)');
      quotedWhere.push('date(l.quoted_at) <= date(@date_to)');
      closedWhere.push('date(l.closed_at) <= date(@date_to)');
    }
    const p = { date_from: date_from || null, date_to: date_to || null };

    // Spend: sum of crm_campaign_spend rows whose day falls within the
    // range — direct date comparison now that entry is daily, so it lines
    // up exactly with any custom range instead of a monthly bucket.
    const spendWhere = ['campaign_id = @id'];
    if (date_from) spendWhere.push('day >= date(@date_from)');
    if (date_to) spendWhere.push('day <= date(@date_to)');

    const stmtArrived = db.prepare(`SELECT COUNT(*) c FROM crm_leads l WHERE ${arrivedWhere.join(' AND ')}`);
    const stmtQuoted = db.prepare(`SELECT COUNT(*) c FROM crm_leads l WHERE ${quotedWhere.join(' AND ')}`);
    const stmtClosedLeads = db.prepare(`
      SELECT l.id, l.quote_id, l.source_created_at, l.created_at, l.closed_at
      FROM crm_leads l WHERE ${closedWhere.join(' AND ')}
    `);
    const stmtSpend = db.prepare(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM crm_campaign_spend WHERE ${spendWhere.join(' AND ')}`);

    const rows = campaigns.map((c) => {
      const params = { ...p, id: c.id };
      const leads = stmtArrived.get(params).c;
      const quotedCount = stmtQuoted.get(params).c;
      const closedLeads = stmtClosedLeads.all(params);
      const spendRow = stmtSpend.get(params);
      const spend = spendRow.n > 0 ? spendRow.s : null; // null = no budget entered, not "spent nothing"

      let revenue = 0, cost = 0, missingCost = 0, daysSum = 0, daysN = 0;
      for (const lead of closedLeads) {
        const quote = lead.quote_id ? db.prepare(`SELECT price_before_vat, calculation_data FROM signshop_quotes WHERE id = ?`).get(lead.quote_id) : null;
        if (quote) {
          const econ = quoteEconomics(quote);
          if (econ) { revenue += econ.revenue; cost += econ.cost; }
          else missingCost += 1;
        }
        const arrival = lead.source_created_at || lead.created_at;
        if (arrival && lead.closed_at) {
          const days = (new Date(lead.closed_at.replace(' ', 'T') + 'Z') - new Date(arrival.replace(' ', 'T') + 'Z')) / 86400000;
          if (days >= 0) { daysSum += days; daysN += 1; }
        }
      }
      const deals = closedLeads.length;
      const profit = revenue - cost;

      return {
        campaign_id: c.id,
        campaign_name: c.name,
        leads, quoted: quotedCount, deals,
        conversion_pct: leads ? Math.round((deals / leads) * 1000) / 10 : 0,
        spend,
        cpl: spend != null && leads ? Math.round((spend / leads) * 100) / 100 : null,
        cpa: spend != null && deals ? Math.round((spend / deals) * 100) / 100 : null,
        revenue: Math.round(revenue * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        roas: spend != null && spend > 0 ? Math.round((revenue / spend) * 100) / 100 : null,
        net_profit: spend != null ? Math.round((profit - spend) * 100) / 100 : null,
        missing_cost_count: missingCost,
        avg_days_to_close: daysN ? Math.round((daysSum / daysN) * 10) / 10 : null,
      };
    });

    res.json({ rows });
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

  // ── Leads (manager reports screen — CrmLeads.jsx) ─────────────────────────
  // assigned filter accepts a username OR the literal 'unassigned' (maps to
  // IS NULL) — the report screen's whole point is to see what's NOT being
  // worked, and assigned_to='' can't express that over a query string.
  app.get('/api/crm/leads', requireAuth, (req, res) => {
    const { status, assigned_to, customer_id, campaign_id, date_from, date_to, q } = req.query;
    const where = [];
    const params = [];
    if (status) { where.push('l.status = ?'); params.push(status); }
    if (assigned_to === 'unassigned') { where.push('l.assigned_to IS NULL'); }
    else if (assigned_to) { where.push('l.assigned_to = ?'); params.push(assigned_to); }
    if (customer_id) { where.push('l.customer_id = ?'); params.push(customer_id); }
    if (campaign_id) { where.push('l.campaign_id = ?'); params.push(campaign_id); }
    if (date_from) { where.push(`date(COALESCE(l.source_created_at, l.created_at)) >= date(?)`); params.push(date_from); }
    if (date_to) { where.push(`date(COALESCE(l.source_created_at, l.created_at)) <= date(?)`); params.push(date_to); }
    if (q) {
      where.push('(c.display_name LIKE ? OR c.phone_e164 LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    let sql = `
      SELECT l.*, c.display_name AS customer_name, c.phone_e164 AS customer_phone,
             cam.name AS campaign_name, u.full_name AS assigned_to_name
      FROM crm_leads l
      JOIN customers c ON c.id = l.customer_id
      LEFT JOIN crm_campaigns cam ON cam.id = l.campaign_id
      LEFT JOIN users u ON u.username = l.assigned_to
    `;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY COALESCE(l.source_created_at, l.created_at) DESC LIMIT 500`;
    res.json(db.prepare(sql).all(...params));
  });

  // Monthly lead counts for the last 12 calendar months, split by status —
  // the report screen's trend chart. Grouped by COALESCE(source_created_at,
  // created_at) so monday-sourced leads bucket into the month they actually
  // arrived, not the month we happened to poll them.
  app.get('/api/crm/leads/stats/monthly', requireAdmin, (req, res) => {
    res.json(db.prepare(`
      SELECT strftime('%Y-%m', COALESCE(source_created_at, created_at)) AS month,
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) AS won,
             SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS lost,
             SUM(CASE WHEN status = 'disqualified' THEN 1 ELSE 0 END) AS disqualified
      FROM crm_leads
      WHERE COALESCE(source_created_at, created_at) >= date('now', '-12 months')
      GROUP BY month
      ORDER BY month ASC
    `).all());
  });

  // Manager-wide "קמפיינים" overview (CrmCampaignsOverview.jsx): status
  // breakdown, a funnel (in/quoted/won) over the selected range, and
  // "exceptional" leads — an inbound WhatsApp message that's still unread
  // past crm_settings.reply_overdue_minutes. unread_count is reset the
  // moment a thread is opened (routes/inbox.js's GET .../messages), so this
  // can never get stuck non-zero once actually read.
  app.get('/api/crm/campaigns-overview', requireAdmin, (req, res) => {
    const { campaign_id, date_from, date_to } = req.query;
    const params = campaign_id ? { campaign_id } : {};
    const leadWhere = campaign_id ? ' AND campaign_id = @campaign_id ' : '';

    // Optional date range ("יומי"/"שבועי"/"חודשי"/טווח מותאם) — applies to
    // the status pie/total AND the funnel tiles below, so both always
    // describe the same window.
    const statusParams = { ...params };
    let statusWhere = leadWhere;
    if (date_from) { statusWhere += ' AND date(COALESCE(source_created_at,created_at)) >= date(@date_from) '; statusParams.date_from = date_from; }
    if (date_to) { statusWhere += ' AND date(COALESCE(source_created_at,created_at)) <= date(@date_to) '; statusParams.date_to = date_to; }

    // Status breakdown reads the REAL deal-status label from monday
    // (board_map.status_column_id — the same field pushBoard already writes
    // to), not crm_leads.status: that internal 6-value funnel (new/
    // contacted/quoted/won/lost/disqualified) is barely used in practice —
    // real data has all 3,555 leads sitting at 'new'/'contacted', while
    // monday's own status column already carries the granular labels
    // agents actually pick (פולואפ, בתהליך מכירה, עסקה נסגרה, …). Leads
    // with no monday link (manual) fall back to the internal status.
    // Built directly (not reusing statusWhere's string) — campaign_id and
    // created_at both exist on monday_board_map too once joined, so the
    // plain column names from crm_leads-only queries are ambiguous here.
    let statusRowsWhere = campaign_id ? ' AND l.campaign_id = @campaign_id ' : '';
    if (date_from) statusRowsWhere += ' AND date(COALESCE(l.source_created_at,l.created_at)) >= date(@date_from) ';
    if (date_to) statusRowsWhere += ' AND date(COALESCE(l.source_created_at,l.created_at)) <= date(@date_to) ';
    const statusRows = db.prepare(`
      SELECT l.id, l.status, m.board_id, m.raw_json, bm.status_column_id
      FROM crm_leads l
      LEFT JOIN monday_item_map m ON m.lead_id = l.id
      LEFT JOIN monday_board_map bm ON bm.board_id = m.board_id
      WHERE 1=1 ${statusRowsWhere}
    `).all(statusParams);
    const INTERNAL_STATUS_LABELS = { new: 'חדש', contacted: 'יצרנו קשר', quoted: 'נשלחה הצעה', won: 'זכינו', lost: 'אבדנו', disqualified: 'לא רלוונטי' };
    const counts = new Map();
    for (const r of statusRows) {
      let label = null;
      if (r.status_column_id && r.raw_json) {
        try {
          const cv = (JSON.parse(r.raw_json).column_values || []).find(c => c.id === r.status_column_id);
          if (cv?.text) label = cv.text;
        } catch (_) { /* fall through to internal label */ }
      }
      if (!label) label = INTERNAL_STATUS_LABELS[r.status] || r.status;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    const total = statusRows.length;
    const by_status = [...counts.entries()]
      .map(([label, n]) => ({ status: label, n, pct: total ? Math.round((n / total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.n - a.n);

    // Funnel: leads that ARRIVED / reached a QUOTE / had a deal CLOSE within
    // the range — three different anchor timestamps, each filtered
    // independently (a lead quoted this week may have arrived last month).
    // quoted_at/closed_at are set exactly once (COALESCE) at the real
    // transition — see routes/crm.js's PUT/convert handlers — never
    // overwritten by later edits like updated_at would be.
    let quotedRange = '', closedRange = '';
    const rangeParams = { ...params };
    if (date_from) { quotedRange += ' AND date(quoted_at) >= date(@date_from) '; closedRange += ' AND date(closed_at) >= date(@date_from) '; rangeParams.date_from = date_from; }
    if (date_to) { quotedRange += ' AND date(quoted_at) <= date(@date_to) '; closedRange += ' AND date(closed_at) <= date(@date_to) '; rangeParams.date_to = date_to; }
    const funnel = {
      leads_in: total,
      leads_quoted: db.prepare(`SELECT COUNT(*) c FROM crm_leads WHERE quoted_at IS NOT NULL ${leadWhere} ${quotedRange}`).get(rangeParams).c,
      leads_won: db.prepare(`SELECT COUNT(*) c FROM crm_leads WHERE status = 'won' AND closed_at IS NOT NULL ${leadWhere} ${closedRange}`).get(rangeParams).c,
    };

    const overdueMinutes = (db.prepare(`SELECT reply_overdue_minutes FROM crm_settings WHERE id = 1`).get() || {}).reply_overdue_minutes || 60;
    const exceptions = db.prepare(`
      SELECT conv.id AS conversation_id, conv.last_inbound_at, conv.unread_count,
             c.id AS customer_id, c.display_name, c.phone_e164,
             l.id AS lead_id, l.status AS lead_status,
             CAST((julianday('now') - julianday(conv.last_inbound_at)) * 1440 AS INTEGER) AS minutes_waiting
      FROM crm_conversations conv
      JOIN customers c ON c.id = conv.customer_id
      LEFT JOIN crm_leads l ON l.customer_id = c.id AND l.status NOT IN ('won','lost','disqualified')
      WHERE conv.unread_count > 0
        AND CAST((julianday('now') - julianday(conv.last_inbound_at)) * 1440 AS INTEGER) >= @overdueMinutes
        ${campaign_id ? ' AND l.campaign_id = @campaign_id ' : ''}
      ORDER BY conv.last_inbound_at ASC
      LIMIT 200
    `).all({ ...params, overdueMinutes });

    res.json({ total, by_status, funnel, reply_overdue_minutes: overdueMinutes, exceptions });
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

  // Fields a non-admin must never write directly: assigned_to/campaign_id are
  // the queue's entire integrity guarantee (see leadClaims.js) — without this
  // lockdown any agent could `PUT {assigned_to:"me"}` on any lead and bypass
  // the pull queue, the concurrent-lead cap, and campaign restrictions
  // entirely. first_touch_*/closed_at are server-derived bookkeeping.
  const AGENT_LOCKED_FIELDS = new Set(['assigned_to', 'campaign_id', 'first_touch_at', 'first_touch_by', 'closed_at']);

  app.put('/api/crm/leads/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'ליד לא נמצא' });
    const body = req.body || {};
    const editable = leadCols.filter(c => !['id', 'customer_id', 'created_at'].includes(c)
      && (req.user.role === 'admin' || !AGENT_LOCKED_FIELDS.has(c)));
    const row = { id };
    const setCols = [];
    for (const c of editable) {
      if (c in body) { row[c] = body[c]; setCols.push(c); }
    }
    if (body.status && body.status !== existing.status) {
      if (['won', 'lost', 'disqualified'].includes(body.status) && !('closed_at' in row)) {
        row.closed_at = new Date().toISOString(); setCols.push('closed_at');
      }
      if (body.status === 'quoted' && !existing.quoted_at) {
        row.quoted_at = new Date().toISOString(); setCols.push('quoted_at');
      }
      db.prepare(`INSERT INTO crm_activity_log (customer_id, lead_id, type, summary, actor) VALUES (?, ?, 'status_change', ?, ?)`)
        .run(existing.customer_id, id, `${existing.status} → ${body.status}`, req.user.username);
    }
    if (setCols.length) {
      row.updated_at = new Date().toISOString(); setCols.push('updated_at');
      db.prepare(`UPDATE crm_leads SET ${[...new Set(setCols)].map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`).run(row);
    }
    touchLead(id, req.user.username);
    const updated = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id);
    // The ONE extension point for "when does a lead free its slot" — see
    // leadClaims.js's RELEASE_ON_STATUS map. Never wire this into pullBoard's
    // follow-up refresh: a routine monday poll would silently free every
    // agent's slots.
    const reason = releaseReason(existing, updated);
    if (reason) releaseClaim(db, id, reason);
    res.json(updated);
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
    db.prepare(`UPDATE crm_leads SET quote_id = ?, status = 'quoted', quoted_at = COALESCE(quoted_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(quoteId, id);
    releaseClaim(db, id, 'quoted');
    res.json(db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id));
  });
};
