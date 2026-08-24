// CRM Phase 1 — customers + leads. Dedicated route file (not the generic
// /api/entities/:name REGISTRY) because these need joins, search, rollups
// and cursor-ish ordering that entities.js's PRAGMA-table_info-driven CRUD
// can't express. See CLAUDE.md CRM plan §3.

const { toE164 } = require('../services/crm/phone');
const { releaseClaim, releaseReason } = require('../services/crm/leadClaims');
const { DOCUMENT_TYPE } = require('../services/morning/mappings');
const { CLOSED_SQL, WON_SQL, LOST_SQL, isClosed, isWon, labelOf } = require('../services/crm/leadStatuses');

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

const { createItemForLead } = require('../services/crm/mondayCreateItem');

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
  // requireAuth, not requireAdmin: id+name of the handful of campaigns is the
  // label source for the campaign filter on the leads page, which agents use
  // too. Nothing sensitive here — spend/ROI stay on the admin endpoints below.
  app.get('/api/crm/campaigns', requireAuth, (req, res) => {
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
    const { date_from, date_to, group, campaign_id } = req.query;

    // Two groupings, one row shape — the frontend table (PROFIT_COLS) renders
    // either without knowing which. `group=agent` swaps the row key from
    // campaign to crm_leads.assigned_to; spend has no per-agent dimension, so
    // agent rows carry spend=null and every ratio derived from it renders "—".
    const byAgent = group === 'agent';
    const groups = byAgent
      // Unassigned leads get their own row rather than being dropped —
      // otherwise the agent view's totals silently disagree with the
      // campaign view's (today all but a handful of leads sit unassigned).
      ? db.prepare(`
          SELECT COALESCE(TRIM(assigned_to),'') AS id,
                 COALESCE(NULLIF(TRIM(assigned_to),''), 'לא משויך') AS name
          FROM crm_leads
          GROUP BY COALESCE(TRIM(assigned_to),'')
          ORDER BY (COALESCE(TRIM(assigned_to),'') = '') ASC, name
        `).all()
      : db.prepare(`SELECT id, name FROM crm_campaigns ORDER BY name`).all();

    const keyCol = byAgent ? "COALESCE(TRIM(l.assigned_to),'') = @id" : 'l.campaign_id = @id';
    const arrivedWhere = [keyCol];
    const quotedWhere = [keyCol, 'l.quoted_at IS NOT NULL'];
    const closedWhere = [keyCol, `l.status IN (${WON_SQL})`, 'l.closed_at IS NOT NULL'];
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
    // Agent rows can additionally be narrowed to one campaign, giving the
    // agent×campaign cut the plain agent list can't show.
    if (byAgent && campaign_id) {
      arrivedWhere.push('l.campaign_id = @campaign_id');
      quotedWhere.push('l.campaign_id = @campaign_id');
      closedWhere.push('l.campaign_id = @campaign_id');
    }
    const p = { date_from: date_from || null, date_to: date_to || null, campaign_id: campaign_id || null };

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

    const rows = groups.map((c) => {
      const params = { ...p, id: c.id };
      const leads = stmtArrived.get(params).c;
      const quotedCount = stmtQuoted.get(params).c;
      const closedLeads = stmtClosedLeads.all(params);
      const spendRow = byAgent ? { n: 0, s: 0 } : stmtSpend.get(params);
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

    res.json({ rows, group: byAgent ? 'agent' : 'campaign' });
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
  // "Actually bought from us" — a Morning ORDER document on one of this
  // customer's quotes. Identical to leadContext.js's customerHistory, the
  // 'won' auto-stamp in jobs.js and the leads page's prior_purchases, so the
  // customers list can never disagree with any of them about who is a buyer.
  const CUSTOMER_HAS_ORDER_SQL = `EXISTS (
    SELECT 1 FROM signshop_quotes q
      JOIN morning_documents_map md ON md.quote_id = q.id AND md.morning_document_type = ${DOCUMENT_TYPE.order}
     WHERE q.customer_id = c.id)`;

  // Whitelisted sort/filter expressions — the query string only ever picks a
  // key here, so nothing user-supplied reaches the SQL text.
  const CUSTOMER_SORTS = {
    updated: 'c.updated_at DESC',
    recent_quote: 'last_quote_at IS NULL, last_quote_at DESC',
    quotes: 'quote_count DESC, c.updated_at DESC',
    open_leads: 'open_leads DESC, c.updated_at DESC',
    name: 'c.display_name COLLATE NOCASE ASC',
  };

  app.get('/api/crm/customers', requireAuth, (req, res) => {
    const { q, limit, offset, sort, filter } = req.query;
    const where = ['merged_into_id IS NULL'];
    const params = [];
    if (q && q.toString().trim()) {
      const needle = `%${q.toString().trim()}%`;
      where.push('(display_name LIKE ? OR phone_e164 LIKE ? OR phone_raw LIKE ? OR email LIKE ? OR company LIKE ?)');
      params.push(needle, needle, needle, needle, needle);
    }

    // Filters repeat the subquery as EXISTS rather than reusing the SELECT
    // alias — SQLite won't resolve result aliases in WHERE, and HAVING needs a
    // GROUP BY we don't want here.
    if (filter === 'buyers') {
      where.push(CUSTOMER_HAS_ORDER_SQL);
    } else if (filter === 'open_leads') {
      where.push(`EXISTS (SELECT 1 FROM crm_leads l WHERE l.customer_id = c.id AND l.status NOT IN (${CLOSED_SQL}))`);
    } else if (filter === 'no_quotes') {
      where.push(`NOT EXISTS (SELECT 1 FROM signshop_quotes q WHERE q.customer_id = c.id)`);
    } else if (filter === 'mine') {
      where.push('c.owner_username = ?');
      params.push(req.user.username);
    }

    const orderBy = CUSTOMER_SORTS[sort] || CUSTOMER_SORTS.updated;
    const lim = Number.isInteger(+limit) ? Math.min(Math.max(parseInt(limit, 10), 1), 500) : 200;
    const off = Number.isInteger(+offset) ? Math.max(parseInt(offset, 10), 0) : 0;

    // COUNT(*) OVER() runs after WHERE but before LIMIT, so every row carries
    // the true match count — keeps the response a plain array (no shape change
    // for existing callers) while letting the UI paginate.
    const rows = db.prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM crm_leads l WHERE l.customer_id = c.id AND l.status NOT IN (${CLOSED_SQL})) AS open_leads,
              (SELECT COUNT(*) FROM signshop_quotes q WHERE q.customer_id = c.id) AS quote_count,
              (SELECT MAX(created_at) FROM signshop_quotes q WHERE q.customer_id = c.id) AS last_quote_at,
              (SELECT COUNT(DISTINCT q.id) FROM signshop_quotes q
                 JOIN morning_documents_map md ON md.quote_id = q.id AND md.morning_document_type = ${DOCUMENT_TYPE.order}
                WHERE q.customer_id = c.id) AS order_count,
              COUNT(*) OVER() AS total_count
       FROM customers c
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ${lim} OFFSET ${off}`
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
      // `existing: true` lets the caller tell "we found your customer" from
      // "we created one" without inspecting the 200-vs-201 status.
      if (existing) return res.status(200).json({ ...existing, existing: true });
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
  // Admin-only: merging tombstones the loser and re-points its leads/quotes,
  // with no un-merge path — not something any CRM user should be able to do.
  app.post('/api/crm/customers/:id/merge', requireAdmin, (req, res) => {
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

  // Opens (find-or-create) the WhatsApp thread for a customer who has no lead
  // yet. Mirrors POST /api/crm/leads/:id/conversation (leadQueue.js), which
  // only exists for a customer that already has a lead — a plain "לקוח חדש"
  // has none, so there was previously NO way to reach a composer for them at
  // all short of manually creating a throwaway lead first. The customers list's
  // WhatsApp icon used to open wa.me directly instead (bypassing the CRM
  // entirely — no message logged, no thread, nothing the next agent could see);
  // this is what it calls now.
  app.post('/api/crm/customers/:id/conversation', requireAuth, (req, res) => {
    const customer = customerById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'לקוח לא נמצא' });
    if (!customer.phone_e164) return res.status(400).json({ error: 'ללקוח אין מספר טלפון' });
    const { resolveConversation } = require('../services/channels/whatsapp/outbox');
    const conversationId = resolveConversation(db, {
      customerId: customer.id, phoneE164: customer.phone_e164,
    });
    res.json({ conversation_id: conversationId });
  });

  app.get('/api/crm/customers/:id/timeline', requireAuth, (req, res) => {
    const customer = customerById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'לקוח לא נמצא' });
    const activity = db.prepare(`SELECT id, type AS kind, summary, actor, created_at FROM crm_activity_log WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200`).all(customer.id);
    const quotes = db.prepare(`SELECT id, 'quote' AS kind, quote_number AS summary, created_by AS actor, created_at FROM signshop_quotes WHERE customer_id = ? ORDER BY created_at DESC`).all(customer.id);
    const merged = [...activity, ...quotes].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    res.json(merged);
  });

  // ── Leads (the leads page — CrmLeads.jsx, both roles) ─────────────────────
  // assigned filter accepts a username OR the literal 'unassigned' (maps to
  // IS NULL) — a core question of the screen is what's NOT being worked, and
  // assigned_to='' can't express that over a query string.
  //
  // Sorted/paginated exactly like GET /api/crm/customers above: whitelisted
  // ORDER BY expressions + COUNT(*) OVER() + LIMIT/OFFSET, so the response
  // stays a plain array and the UI can page past the old hard 500 ceiling.
  //
  // `last_activity_at` is the column the whole "which leads are stuck?"
  // question hangs on: the last time a HUMAN touched this lead, falling back
  // to when it arrived.
  //
  // Deliberately NOT updated_at — that's a row-touch stamp bumped by a monday
  // field patch, a value edit or a bulk import, so using it made every one of
  // the 3.5k imported leads look freshly worked and the "תקוע" filter return
  // zero. The fallback is source_created_at (when the lead actually came in),
  // so a month-old lead nobody ever contacted correctly reads as stale.
  //
  // Conversations attach by lead_id, or by the customer's thread — monday
  // leads arrive without one and get matched to a WhatsApp thread by phone later.
  const LEAD_ACTIVITY_SQL = `
    COALESCE(
      (SELECT MAX(COALESCE(cv.last_message_at, cv.last_inbound_at, cv.last_outbound_at))
         FROM crm_conversations cv
        WHERE cv.lead_id = l.id OR cv.customer_id = l.customer_id),
      l.first_touch_at,
      l.source_created_at,
      l.created_at
    )`;

  // "The customer wrote and nobody has answered yet" — the lead-side twin of
  // the inbox's overdue chip, but deliberately NOT the same rule.
  //
  // The inbox keys off unread_count, which resets the moment anyone OPENS the
  // thread. That's right for "an unread badge" and wrong for this: an agent
  // who reads a message, gets pulled away and never replies would silently
  // drop out of the count — exactly the lead this tile exists to catch.
  // Comparing the two timestamps instead means only an actual outbound reply
  // clears it, so the number always answers "how many people are waiting on
  // us right now".
  //
  // Same conversation attachment as LEAD_ACTIVITY_SQL (by lead, or by the
  // customer's thread — monday leads arrive with no conversation and get
  // matched by phone later).
  // Two chips share this rule and differ only by how long the wait has run:
  //   awaiting=1        → everyone waiting, even for 3 minutes ("בהמתנה")
  //   awaiting=overdue  → only past crm_settings.reply_overdue_minutes ("באיחור")
  // The threshold is the SAME setting the inbox's own overdue chip uses, so a
  // manager can never see the two screens disagree about what "late" means.
  //
  // NOT to be confused with the follow_up=overdue chip: that one is about a
  // callback WE promised, this one is about a message THEY sent.
  const awaitingReplySql = (minutes) => `
    EXISTS (
      SELECT 1 FROM crm_conversations cv
       WHERE (cv.lead_id = l.id OR cv.customer_id = l.customer_id)
         AND cv.last_inbound_at IS NOT NULL
         AND (cv.last_outbound_at IS NULL OR cv.last_inbound_at > cv.last_outbound_at)
         ${minutes ? `AND CAST((julianday('now') - julianday(cv.last_inbound_at)) * 1440 AS INTEGER) >= ${minutes}` : ''}
    )`;

  // Mirrors routes/inbox.js's overdueMinutes() — same column, same default.
  function replyOverdueMinutes() {
    const s = db.prepare(`SELECT reply_overdue_minutes FROM crm_settings WHERE id = 1`).get();
    return (s && s.reply_overdue_minutes) || 60;
  }

  // Real monday status values for one campaign's board, straight out of the
  // cached raw_json — NOT out of the board's label bank. The bank lists labels
  // that may never be used, while this returns exactly what's on the leads,
  // with counts.
  //
  // Every status/color column is offered, not just the mapped status_column_id:
  // the לוגו board alone has "סטטוס" (pipeline), "סטטוס עיסקה" (outcome — the
  // mapped one, empty on 994 leads), "שלב לקוח בצ'אט" and "דרך הגעת הליד", and
  // an agent filtering "real" leads means any of them. Label banks differ per
  // board, which is why this is campaign-scoped and why the campaign filter has
  // to be picked first.
  app.get('/api/crm/lead-filters', requireAuth, (req, res) => {
    const campaignId = parseInt(req.query.campaign_id, 10);
    if (!campaignId) return res.json({ columns: [] });
    const board = db.prepare(`SELECT board_id, columns_json, status_column_id FROM monday_board_map WHERE campaign_id = ?`).get(campaignId);
    if (!board) return res.json({ columns: [] });

    // labels !== null marks a status/color column (set by fetchBoardColumns in
    // services/crm/mondaySync.js).
    let statusCols = [];
    try {
      statusCols = (JSON.parse(board.columns_json || '[]') || []).filter(c => Array.isArray(c.labels));
    } catch { statusCols = []; }
    if (!statusCols.length) return res.json({ columns: [] });

    const counts = db.prepare(`
      SELECT json_extract(je.value, '$.id') AS column_id,
             json_extract(je.value, '$.text') AS label,
             COUNT(*) AS n
      FROM monday_item_map mim
      JOIN json_each(json_extract(mim.raw_json, '$.column_values')) je
      WHERE mim.board_id = ? AND mim.lead_id IS NOT NULL
        AND json_extract(je.value, '$.text') IS NOT NULL
        AND json_extract(je.value, '$.text') != ''
      GROUP BY column_id, label
    `).all(board.board_id);

    const byCol = new Map();
    for (const row of counts) {
      if (!byCol.has(row.column_id)) byCol.set(row.column_id, []);
      byCol.get(row.column_id).push({ label: row.label, n: row.n });
    }
    const columns = statusCols
      .map(c => ({
        column_id: c.id,
        title: c.title,
        is_mapped: c.id === board.status_column_id,
        values: (byCol.get(c.id) || []).sort((a, b) => b.n - a.n),
      }))
      .filter(c => c.values.length > 0)
      // The column the system itself treats as the lead's status leads the list.
      .sort((a, b) => (b.is_mapped ? 1 : 0) - (a.is_mapped ? 1 : 0));
    res.json({ columns });
  });

  // "מי הבא בתור" — one combined work-priority order across four buckets a
  // manager described verbally: a promised callback whose time has come first
  // (we already told this customer we'd call), then a customer who wrote in
  // on their own and is still waiting on us, then a lead nobody has touched
  // yet, then everything else open (already worked, no live urgency). This
  // is ORDERING only — it does not touch assigned_to/claims, so an owned
  // lead's owner never changes just because it sorts to the top here.
  const LEAD_PRIORITY_RANK = `
    (CASE
       WHEN l.status NOT IN (${CLOSED_SQL})
            AND l.follow_up_date IS NOT NULL
            AND datetime(l.follow_up_date) <= datetime('now', 'localtime') THEN 1
       WHEN l.status NOT IN (${CLOSED_SQL}) AND ${awaitingReplySql(null)} THEN 2
       WHEN l.status = 'new' THEN 3
       WHEN l.status NOT IN (${CLOSED_SQL}) THEN 4
       ELSE 5
     END)`;

  const LEAD_SORTS = {
    last_activity: 'last_activity_at DESC',
    created: 'COALESCE(l.source_created_at, l.created_at) DESC',
    updated: 'l.updated_at DESC',
    // NULLs last: a lead with no follow-up shouldn't head the list.
    follow_up: 'l.follow_up_date IS NULL, l.follow_up_date ASC',
    value: 'l.value_estimate IS NULL, l.value_estimate DESC',
    status: `l.status ASC, last_activity_at DESC`,
    // Tie-break per bucket: earliest-due callback first within bucket 1,
    // longest-waiting customer first within bucket 2 (oldest inbound = most
    // overdue for a reply), oldest-in first within bucket 3 (same FIFO the
    // pull-queue itself uses), stalest-touched first within bucket 4.
    priority: `
      ${LEAD_PRIORITY_RANK} ASC,
      l.follow_up_date ASC,
      awaiting_minutes DESC,
      COALESCE(l.source_created_at, l.created_at) ASC,
      last_activity_at ASC
    `,
  };

  app.get('/api/crm/leads', requireAuth, (req, res) => {
    const {
      status, assigned_to, customer_id, campaign_id, date_from, date_to, q,
      sort, limit, offset, claimed, stuck, stuck_hours, follow_up, open,
      monday_col, monday_val, awaiting,
    } = req.query;
    const me = req.user.username;
    const where = [];
    const params = [];

    // Access control lives here, not only in the client-side route guard: only
    // admin reads the whole pool. Everyone else (agent, operations, any role
    // added later) sees a lead only if they own it or hold its slot — the
    // default is closed, so a new role can't silently inherit the full list.
    if (req.user.role !== 'admin') {
      where.push(`(l.assigned_to = ? OR EXISTS (SELECT 1 FROM crm_lead_claims k WHERE k.lead_id = l.id AND k.username = ?))`);
      params.push(me, me);
    }

    if (status) { where.push('l.status = ?'); params.push(status); }
    if (open === '1') { where.push(`l.status NOT IN (${CLOSED_SQL})`); }
    if (assigned_to === 'unassigned') { where.push('l.assigned_to IS NULL'); }
    else if (assigned_to === 'me') { where.push('l.assigned_to = ?'); params.push(me); }
    else if (assigned_to) { where.push('l.assigned_to = ?'); params.push(assigned_to); }
    if (customer_id) { where.push('l.customer_id = ?'); params.push(customer_id); }
    if (campaign_id) { where.push('l.campaign_id = ?'); params.push(campaign_id); }
    if (date_from) { where.push(`date(COALESCE(l.source_created_at, l.created_at)) >= date(?)`); params.push(date_from); }
    if (date_to) { where.push(`date(COALESCE(l.source_created_at, l.created_at)) <= date(?)`); params.push(date_to); }

    // Slot state (crm_lead_claims) is deliberately separate from ownership
    // (assigned_to) — see services/crm/leadClaims.js — so it gets its own filter.
    if (claimed === 'free') { where.push(`NOT EXISTS (SELECT 1 FROM crm_lead_claims k WHERE k.lead_id = l.id)`); }
    else if (claimed === 'mine') { where.push(`EXISTS (SELECT 1 FROM crm_lead_claims k WHERE k.lead_id = l.id AND k.username = ?)`); params.push(me); }
    else if (claimed === 'any') { where.push(`EXISTS (SELECT 1 FROM crm_lead_claims k WHERE k.lead_id = l.id)`); }

    // follow_up_date is stored as Israel wall-clock (an agent types 14:30 and
    // means 14:30 here) — see the note in lib/leadPriority.js — so every
    // comparison below uses 'localtime' rather than plain now(). 'today' is a
    // whole-day window, NOT "already due": a callback set for 16:00 must show
    // up in the morning list, otherwise the filter is useless before it's too
    // late. 'overdue' is the subset whose time has already passed.
    if (follow_up === 'overdue') {
      where.push(`l.follow_up_date IS NOT NULL AND datetime(l.follow_up_date) <= datetime('now', 'localtime')`);
    } else if (follow_up === 'today') {
      where.push(`date(l.follow_up_date) = date('now', 'localtime')`);
    } else if (follow_up === 'tomorrow') {
      where.push(`date(l.follow_up_date) = date('now', 'localtime', '+1 day')`);
    } else if (follow_up === 'week') {
      // Today through the next 7 days — the "what's coming up" view. Overdue
      // ones are deliberately excluded; they have their own chip.
      where.push(`date(l.follow_up_date) BETWEEN date('now', 'localtime') AND date('now', 'localtime', '+7 days')`);
    } else if (follow_up === 'future') {
      where.push(`datetime(l.follow_up_date) > datetime('now', 'localtime')`);
    } else if (follow_up === 'none') {
      // Open leads nobody scheduled anything for — the silent backlog that no
      // reminder will ever surface.
      where.push(`l.follow_up_date IS NULL AND l.status NOT IN (${CLOSED_SQL})`);
    } else if (follow_up === 'any') {
      where.push('l.follow_up_date IS NOT NULL');
    }

    // "תקוע" = still open and nothing happened for N hours. Default matches
    // STALE_HOURS in the client's lib/leadPriority.js so both surfaces agree.
    if (stuck === '1') {
      const hours = Math.min(Math.max(parseInt(stuck_hours, 10) || 48, 1), 24 * 365);
      where.push(`l.status NOT IN (${CLOSED_SQL}) AND ${LEAD_ACTIVITY_SQL} <= datetime('now', '-${hours} hours')`);
    }

    // Waiting on us to answer. Both variants exclude closed leads — a customer
    // who wrote after we marked the deal lost isn't an open service debt, and
    // counting them would make the tile permanently non-zero.
    if (awaiting === '1' || awaiting === 'overdue') {
      where.push(`l.status NOT IN (${CLOSED_SQL}) AND ${awaitingReplySql(awaiting === 'overdue' ? replyOverdueMinutes() : null)}`);
    }

    // Filter on a monday column's real value (see /api/crm/lead-filters above).
    // Reads the cached raw_json rather than calling monday — the poller keeps
    // it current, and this stays a single local query. Measured at ~35ms over
    // the full 3.5k-lead table, so no extra index is needed yet.
    if (monday_col && monday_val) {
      where.push(`EXISTS (
        SELECT 1 FROM monday_item_map mim
        JOIN json_each(json_extract(mim.raw_json, '$.column_values')) je
        WHERE mim.lead_id = l.id
          AND json_extract(je.value, '$.id') = ?
          AND json_extract(je.value, '$.text') = ?)`);
      params.push(monday_col, monday_val);
    }

    if (q && q.toString().trim()) {
      const needle = `%${q.toString().trim()}%`;
      where.push('(c.display_name LIKE ? OR c.phone_e164 LIKE ? OR c.phone_raw LIKE ? OR c.email LIKE ? OR c.company LIKE ? OR l.title LIKE ? OR l.notes LIKE ?)');
      params.push(needle, needle, needle, needle, needle, needle, needle);
    }

    const orderBy = LEAD_SORTS[sort] || LEAD_SORTS.last_activity;
    const lim = Number.isInteger(+limit) ? Math.min(Math.max(parseInt(limit, 10), 1), 500) : 50;
    const off = Number.isInteger(+offset) ? Math.max(parseInt(offset, 10), 0) : 0;

    const rows = db.prepare(`
      SELECT l.*, c.display_name AS customer_name, c.phone_e164 AS customer_phone,
             c.email AS customer_email, c.company AS customer_company,
             cam.name AS campaign_name, u.full_name AS assigned_to_name,
             k.username AS claimed_by, k.acquired_at AS claimed_at,
             ku.full_name AS claimed_by_name,
             ${LEAD_ACTIVITY_SQL} AS last_activity_at,
             (SELECT cv.id FROM crm_conversations cv
               WHERE cv.lead_id = l.id OR cv.customer_id = l.customer_id
               ORDER BY COALESCE(cv.last_message_at, cv.created_at) DESC LIMIT 1) AS conversation_id,
             (SELECT SUM(cv.unread_count) FROM crm_conversations cv
               WHERE cv.lead_id = l.id OR cv.customer_id = l.customer_id) AS unread_count,
             -- How long the customer has been waiting for a reply, in minutes;
             -- NULL when we're not the ones holding the ball. Drives both the
             -- "בהמתנה" tile's longest-wait line and the per-row badge.
             (SELECT CAST((julianday('now') - julianday(MAX(cv.last_inbound_at))) * 1440 AS INTEGER)
                FROM crm_conversations cv
               WHERE (cv.lead_id = l.id OR cv.customer_id = l.customer_id)
                 AND cv.last_inbound_at IS NOT NULL
                 AND (cv.last_outbound_at IS NULL OR cv.last_inbound_at > cv.last_outbound_at)) AS awaiting_minutes,
             -- "Already bought from us" = a Morning ORDER document on one of
             -- this customer's OTHER quotes. Same signal as leadContext.js's
             -- customerHistory and as the 'won' auto-stamp, so the badge here,
             -- the workspace banner and the analytics always agree.
             (SELECT COUNT(DISTINCT q.id) FROM signshop_quotes q
                JOIN morning_documents_map md ON md.quote_id = q.id AND md.morning_document_type = 100
               WHERE q.customer_id = l.customer_id AND (q.lead_id IS NULL OR q.lead_id != l.id)) AS prior_purchases,
             (SELECT COUNT(*) FROM crm_leads l2 WHERE l2.customer_id = l.customer_id AND l2.id != l.id) AS prior_leads,
             COUNT(*) OVER() AS total_count
      FROM crm_leads l
      JOIN customers c ON c.id = l.customer_id
      LEFT JOIN crm_campaigns cam ON cam.id = l.campaign_id
      LEFT JOIN users u ON u.username = l.assigned_to
      LEFT JOIN crm_lead_claims k ON k.lead_id = l.id
      LEFT JOIN users ku ON ku.username = k.username
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${orderBy}
      LIMIT ${lim} OFFSET ${off}
    `).all(...params);
    res.json(rows);
  });

  // Monthly lead counts for the last 12 calendar months, split by status —
  // the report screen's trend chart. Grouped by COALESCE(source_created_at,
  // created_at) so monday-sourced leads bucket into the month they actually
  // arrived, not the month we happened to poll them.
  app.get('/api/crm/leads/stats/monthly', requireAdmin, (req, res) => {
    res.json(db.prepare(`
      SELECT strftime('%Y-%m', COALESCE(source_created_at, created_at)) AS month,
             COUNT(*) AS total,
             SUM(CASE WHEN status IN (${WON_SQL}) THEN 1 ELSE 0 END) AS won,
             SUM(CASE WHEN status IN (${LOST_SQL}) THEN 1 ELSE 0 END) AS lost,
             SUM(CASE WHEN status NOT IN (${CLOSED_SQL}) THEN 1 ELSE 0 END) AS open
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
  // Response-time buckets for the SLA panel. Ordered slowest-last; the
  // frontend renders them in this order and pairs each with its win rate.
  const SLA_BUCKETS = [
    { key: 'lt15', label: 'עד 15 דק׳', max: 15 * 60000 },
    { key: 'lt60', label: 'עד שעה', max: 60 * 60000 },
    { key: 'lt240', label: 'עד 4 שעות', max: 240 * 60000 },
    { key: 'gt240', label: 'מעל 4 שעות', max: Infinity },
    { key: 'none', label: 'ללא מענה', max: null },
  ];

  // Whole overview payload for one window. Factored out of the route so the
  // `compare=1` previous-period block can reuse it verbatim instead of
  // duplicating a dozen queries. `full` = false trims the expensive/
  // now-relative parts (series, status pie, exceptions) that a comparison
  // baseline never renders.
  function computeOverview({ campaign_id, date_from, date_to, overdueMinutes, full }) {
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
    // to), not crm_leads.status. Historically that was because the internal
    // funnel was six generic values while the board carried the granular
    // labels agents actually pick; the two are the same list now
    // (services/crm/leadStatuses.js), but the board still wins for a
    // monday-linked lead because it is the live value. Leads with no monday
    // link (manual) fall back to the internal status, rendered via labelOf.
    // Built directly (not reusing statusWhere's string) — campaign_id and
    // created_at both exist on monday_board_map too once joined, so the
    // plain column names from crm_leads-only queries are ambiguous here.
    let statusRowsWhere = campaign_id ? ' AND l.campaign_id = @campaign_id ' : '';
    if (date_from) statusRowsWhere += ' AND date(COALESCE(l.source_created_at,l.created_at)) >= date(@date_from) ';
    if (date_to) statusRowsWhere += ' AND date(COALESCE(l.source_created_at,l.created_at)) <= date(@date_to) ';
    // Skipped for the comparison baseline (full=false) — it parses raw_json
    // for every lead in the window, and nothing renders a previous-period pie.
    const buildStatusBreakdown = () => {
      const statusRows = db.prepare(`
        SELECT l.id, l.status, m.board_id, m.raw_json, bm.status_column_id
        FROM crm_leads l
        LEFT JOIN monday_item_map m ON m.lead_id = l.id
        LEFT JOIN monday_board_map bm ON bm.board_id = m.board_id
        WHERE 1=1 ${statusRowsWhere}
      `).all(statusParams);
      const counts = new Map();
      for (const r of statusRows) {
        let label = null;
        if (r.status_column_id && r.raw_json) {
          try {
            const cv = (JSON.parse(r.raw_json).column_values || []).find(c => c.id === r.status_column_id);
            if (cv?.text) label = cv.text;
          } catch (_) { /* fall through to internal label */ }
        }
        if (!label) label = labelOf(r.status);
        counts.set(label, (counts.get(label) || 0) + 1);
      }
      const n_total = statusRows.length;
      return [...counts.entries()]
        .map(([label, n]) => ({ status: label, n, pct: n_total ? Math.round((n / n_total) * 1000) / 10 : 0 }))
        .sort((a, b) => b.n - a.n);
    };

    // Funnel — a COHORT, not three independent counts. Every stage is
    // measured on the SAME set of leads (those that ARRIVED in the window),
    // so leads_won <= leads_quoted <= leads_in always holds and the
    // step-to-step percentages mean something. The previous version anchored
    // each stage on its own timestamp (quoted_at/closed_at), which could
    // report more deals than leads whenever a lead arrived before the window
    // and closed inside it. quoted_at/closed_at are still the dwell-time
    // anchors — they're set exactly once at the real transition (see the
    // PUT/convert handlers), never overwritten like updated_at would be.
    const fRow = db.prepare(`
      SELECT COUNT(*) AS leads_in,
             SUM(CASE WHEN quoted_at IS NOT NULL THEN 1 ELSE 0 END) AS leads_quoted,
             SUM(CASE WHEN status IN (${WON_SQL}) AND closed_at IS NOT NULL THEN 1 ELSE 0 END) AS leads_won,
             SUM(CASE WHEN status IN (${LOST_SQL}) THEN 1 ELSE 0 END) AS leads_dead,
             AVG(CASE WHEN quoted_at IS NOT NULL
                      THEN julianday(quoted_at) - julianday(COALESCE(source_created_at,created_at)) END) AS d_to_quote,
             AVG(CASE WHEN quoted_at IS NOT NULL AND closed_at IS NOT NULL AND status IN (${WON_SQL})
                      THEN julianday(closed_at) - julianday(quoted_at) END) AS d_quote_to_close
      FROM crm_leads WHERE 1=1 ${statusWhere}
    `).get(statusParams);
    const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
    const days = (v) => (v == null ? null : Math.round(v * 10) / 10);
    const funnel = {
      leads_in: fRow.leads_in || 0,
      leads_quoted: fRow.leads_quoted || 0,
      leads_won: fRow.leads_won || 0,
      leads_dead: fRow.leads_dead || 0,
      quote_rate: pct(fRow.leads_quoted, fRow.leads_in),
      close_rate: pct(fRow.leads_won, fRow.leads_quoted),   // step-to-step
      win_rate: pct(fRow.leads_won, fRow.leads_in),          // top-to-bottom
      avg_days_to_quote: days(fRow.d_to_quote),
      avg_days_quote_to_close: days(fRow.d_quote_to_close),
    };

    // SLA — first_response_ms is stamped once per conversation by the inbox
    // (routes/inbox.js) and until now nothing displayed it. Joined through
    // the customer so each lead in the cohort carries its thread's response
    // time; leads with no WhatsApp thread at all are excluded (they were
    // never "waiting"), leads with a thread but no reply land in 'none'.
    const slaRows = db.prepare(`
      SELECT conv.first_response_ms AS ms, l.status
      FROM crm_leads l
      JOIN crm_conversations conv ON conv.customer_id = l.customer_id
      WHERE 1=1 ${statusRowsWhere}
    `).all(statusParams);
    const bucketOf = (ms) => {
      if (ms == null) return 'none';
      return (SLA_BUCKETS.find(b => b.max != null && ms <= b.max) || SLA_BUCKETS[3]).key;
    };
    const byBucket = new Map(SLA_BUCKETS.map(b => [b.key, { key: b.key, label: b.label, n: 0, won: 0 }]));
    const answered = [];
    for (const r of slaRows) {
      const b = byBucket.get(bucketOf(r.ms));
      b.n += 1;
      if (isWon(r.status)) b.won += 1;
      if (r.ms != null) answered.push(r.ms);
    }
    answered.sort((a, b) => a - b);
    const withinMs = overdueMinutes * 60000;
    const sla = {
      threads: slaRows.length,
      answered: answered.length,
      no_response: slaRows.length - answered.length,
      avg_response_ms: answered.length ? Math.round(answered.reduce((s, v) => s + v, 0) / answered.length) : null,
      median_response_ms: answered.length ? answered[Math.floor(answered.length / 2)] : null,
      within_sla_pct: answered.length ? pct(answered.filter(m => m <= withinMs).length, answered.length) : null,
      by_bucket: [...byBucket.values()].map(b => ({ ...b, won_rate: pct(b.won, b.n) })),
    };

    // Loss reasons — free-text-ish column, so null/blank collapse into one
    // "לא צוין" row rather than disappearing (a campaign whose losses are all
    // unlabelled is itself worth seeing).
    const lost_reasons = db.prepare(`
      SELECT COALESCE(NULLIF(TRIM(lost_reason),''), 'לא צוין') AS reason, COUNT(*) AS n
      FROM crm_leads
      WHERE status IN (${LOST_SQL}) ${statusWhere}
      GROUP BY reason ORDER BY n DESC
    `).all(statusParams);

    // `total` stays the arrival-cohort size — the same number the pie sums to.
    const out = { total: funnel.leads_in, funnel, sla, lost_reasons };
    if (!full) return out;
    out.by_status = buildStatusBreakdown();
    out.series = buildSeries({ campaign_id, date_from, date_to, statusWhere, statusParams });

    const exceptions = db.prepare(`
      SELECT conv.id AS conversation_id, conv.last_inbound_at, conv.unread_count,
             c.id AS customer_id, c.display_name, c.phone_e164,
             l.id AS lead_id, l.status AS lead_status,
             CAST((julianday('now') - julianday(conv.last_inbound_at)) * 1440 AS INTEGER) AS minutes_waiting
      FROM crm_conversations conv
      JOIN customers c ON c.id = conv.customer_id
      LEFT JOIN crm_leads l ON l.customer_id = c.id AND l.status NOT IN (${CLOSED_SQL})
      WHERE conv.unread_count > 0
        AND CAST((julianday('now') - julianday(conv.last_inbound_at)) * 1440 AS INTEGER) >= @overdueMinutes
        ${campaign_id ? ' AND l.campaign_id = @campaign_id ' : ''}
      ORDER BY conv.last_inbound_at ASC
      LIMIT 200
    `).all({ ...params, overdueMinutes });

    out.reply_overdue_minutes = overdueMinutes;
    out.exceptions = exceptions;
    return out;
  }

  // Time series for the trend chart. Granularity follows the window length
  // (daily up to ~6 weeks, monthly beyond) so a year-long range doesn't emit
  // 365 unreadable bars. Buckets are gap-filled — a day with zero leads must
  // render as a zero, not vanish and make the line lie about the trend.
  const SERIES_DAY_LIMIT = 45;
  function buildSeries({ campaign_id, date_from, date_to, statusWhere, statusParams }) {
    // Bounds: explicit range if given, else the actual data extent ("הכל").
    const bounds = db.prepare(`
      SELECT MIN(date(COALESCE(source_created_at,created_at))) AS lo,
             MAX(date(COALESCE(source_created_at,created_at))) AS hi
      FROM crm_leads WHERE 1=1 ${statusWhere}
    `).get(statusParams);
    const lo = date_from || bounds.lo;
    const hi = date_to || bounds.hi;
    if (!lo || !hi) return { granularity: 'day', points: [] };

    const spanDays = Math.round((Date.parse(hi + 'T00:00:00Z') - Date.parse(lo + 'T00:00:00Z')) / 86400000) + 1;
    const granularity = spanDays <= SERIES_DAY_LIMIT ? 'day' : 'month';
    const fmt = granularity === 'day' ? '%Y-%m-%d' : '%Y-%m';

    // Lead-side buckets keyed on ARRIVAL (same anchor as the funnel cohort),
    // with quoted/won as attributes of that cohort — so a point's win count
    // is "of the leads that arrived then, how many closed", consistent with
    // the funnel above rather than a second, differently-anchored number.
    const leadRows = db.prepare(`
      SELECT strftime('${fmt}', COALESCE(source_created_at,created_at)) AS b,
             COUNT(*) AS leads,
             SUM(CASE WHEN quoted_at IS NOT NULL THEN 1 ELSE 0 END) AS quoted,
             SUM(CASE WHEN status IN (${WON_SQL}) AND closed_at IS NOT NULL THEN 1 ELSE 0 END) AS won
      FROM crm_leads WHERE 1=1 ${statusWhere} GROUP BY b
    `).all(statusParams);

    const spendWhere = [];
    const spendParams = {};
    if (campaign_id) { spendWhere.push('campaign_id = @campaign_id'); spendParams.campaign_id = campaign_id; }
    spendWhere.push('day >= date(@lo)', 'day <= date(@hi)');
    spendParams.lo = lo; spendParams.hi = hi;
    const spendRows = db.prepare(`
      SELECT strftime('${fmt}', day) AS b, SUM(amount) AS spend
      FROM crm_campaign_spend WHERE ${spendWhere.join(' AND ')} GROUP BY b
    `).all(spendParams);

    const byBucket = new Map();
    for (const r of leadRows) byBucket.set(r.b, { bucket: r.b, leads: r.leads, quoted: r.quoted, won: r.won, spend: null });
    for (const r of spendRows) {
      const e = byBucket.get(r.b) || { bucket: r.b, leads: 0, quoted: 0, won: 0, spend: null };
      e.spend = r.spend;
      byBucket.set(r.b, e);
    }

    // Gap-fill by walking the calendar rather than the data.
    const points = [];
    const cursor = new Date(lo + 'T00:00:00Z');
    const end = new Date(hi + 'T00:00:00Z');
    const keyOf = (d) => (granularity === 'day' ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 7));
    const seen = new Set();
    while (cursor <= end) {
      const k = keyOf(cursor);
      if (!seen.has(k)) {
        seen.add(k);
        points.push(byBucket.get(k) || { bucket: k, leads: 0, quoted: 0, won: 0, spend: null });
      }
      if (granularity === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
      else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    // Derived per-point ratios — null (not Infinity/NaN) when the divisor is
    // missing, matching how the profitability table renders "—".
    for (const p of points) {
      p.cpl = p.spend != null && p.leads ? Math.round((p.spend / p.leads) * 100) / 100 : null;
      p.cpa = p.spend != null && p.won ? Math.round((p.spend / p.won) * 100) / 100 : null;
    }
    return { granularity, points };
  }

  app.get('/api/crm/campaigns-overview', requireAdmin, (req, res) => {
    const { campaign_id, date_from, date_to, compare } = req.query;
    const overdueMinutes = (db.prepare(`SELECT reply_overdue_minutes FROM crm_settings WHERE id = 1`).get() || {}).reply_overdue_minutes || 60;
    const out = computeOverview({ campaign_id, date_from, date_to, overdueMinutes, full: true });

    // Previous period = the same number of days, immediately before the
    // window. Only meaningful for an explicit range — "הכל" has no "before".
    if (compare && date_from && date_to) {
      const from = Date.parse(date_from + 'T00:00:00Z');
      const to = Date.parse(date_to + 'T00:00:00Z');
      const len = Math.round((to - from) / 86400000) + 1;
      const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
      out.previous = computeOverview({
        campaign_id,
        date_from: iso(from - len * 86400000),
        date_to: iso(from - 86400000),
        overdueMinutes,
        full: false,
      });
      out.previous.date_from = iso(from - len * 86400000);
      out.previous.date_to = iso(from - 86400000);
    }
    res.json(out);
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
    // Mirror the lead onto the monday board the team actually works from.
    // Fire-and-forget: a monday outage must never fail creating the lead here,
    // and the service already refuses leads that came FROM monday.
    createItemForLead(db, lastInsertRowid)
      .catch(err => console.error(`[POST /api/crm/leads] monday item creation failed for #${lastInsertRowid}:`, err.message));
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
      if (isClosed(body.status) && !('closed_at' in row)) {
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

  // Free-text note ON THE LEAD. crm_leads.notes existed since Phase 1 but was
  // write-once at creation and rendered nowhere; notes were customer-level
  // only, which loses the "what did we agree on THIS enquiry" thread when a
  // customer has several leads. Stored twice on purpose: appended to
  // crm_leads.notes (so it's searchable by GET /api/crm/leads?q=) and logged
  // to crm_activity_log (so it lands on the lead timeline with an actor).
  app.post('/api/crm/leads/:id/notes', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lead = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });
    const text = (req.body?.text || '').toString().trim();
    if (!text) return res.status(400).json({ error: 'text required' });

    const stamp = `[${new Date().toISOString().slice(0, 16).replace('T', ' ')} ${req.user.username}] ${text}`;
    db.prepare(`UPDATE crm_leads SET notes = TRIM(COALESCE(notes || char(10), '') || ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(stamp, id);
    db.prepare(`INSERT INTO crm_activity_log (customer_id, lead_id, type, summary, actor) VALUES (?, ?, 'note', ?, ?)`)
      .run(lead.customer_id, id, text, req.user.username);
    touchLead(id, req.user.username);
    res.status(201).json(db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id));
  });

  // Lead timeline — same shape as the customer one above, but scoped to this
  // lead and merged with its linked quote. crm_activity_log has been written
  // since Phase 1 (status_change / assignment / claim / note) and was never
  // displayed anywhere.
  app.get('/api/crm/leads/:id/activity', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lead = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });
    const activity = db.prepare(
      `SELECT id, type AS kind, summary, actor, created_at FROM crm_activity_log WHERE lead_id = ? ORDER BY created_at DESC LIMIT 200`
    ).all(id);
    const quotes = db.prepare(
      `SELECT id, 'quote' AS kind, quote_number AS summary, created_by AS actor, created_at FROM signshop_quotes WHERE lead_id = ? ORDER BY created_at DESC`
    ).all(id);
    // Claim history doubles as "who worked this and for how long" — the same
    // spans LastHandledLine already reads.
    const handling = db.prepare(
      `SELECT id, 'claim' AS kind, username AS actor,
              CASE WHEN ended_at IS NULL THEN 'לקח לטיפול' ELSE 'סיים טיפול · ' || COALESCE(end_reason,'') END AS summary,
              COALESCE(ended_at, started_at) AS created_at
       FROM crm_lead_handling WHERE lead_id = ? ORDER BY id DESC LIMIT 50`
    ).all(id);
    res.json([...activity, ...quotes, ...handling].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
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
