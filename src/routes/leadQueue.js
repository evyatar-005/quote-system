// CRM Phase 5 — the lead pull-queue: agent claim/release, the workspace
// context payload, and the manager's pool/workload/campaign-restriction
// views. Claim/release logic lives in services/crm/leadClaims.js; this file
// is HTTP plumbing only.
//
// deps: { requireAuth, requireAdmin }

const { claimNext, releaseClaim, slotCount, crmSettingsRow } = require('../services/crm/leadClaims');
const { buildLeadContext } = require('../services/crm/leadContext');
const { enqueue } = require('../services/channels/whatsapp/outbox');
const { updateItemColumn } = require('../services/crm/mondaySync');

module.exports = function registerLeadQueue(app, db, deps) {
  const { requireAuth, requireAdmin } = deps;

  // ── Agent ──────────────────────────────────────────────────────────────
  app.post('/api/crm/leads/claim', requireAuth, (req, res) => {
    try {
      res.json(claimNext(db, req.user.username));
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message, code: err.code });
    }
  });

  app.get('/api/crm/leads/:id/context', requireAuth, (req, res) => {
    const context = buildLeadContext(db, parseInt(req.params.id, 10));
    if (!context) return res.status(404).json({ error: 'ליד לא נמצא' });
    res.json(context);
  });

  // Lightweight sibling list for LeadSwitcher.jsx (‹ prev/next ›) — a
  // trimmed version of my-day's "my_leads" query, no other joins. A
  // separate endpoint (not router state from MyDay.jsx) so navigation
  // between leads still works after a direct page refresh on a lead's URL.
  app.get('/api/crm/my-claimed-leads', requireAuth, (req, res) => {
    res.json(db.prepare(`
      SELECT l.id, c.display_name, c.phone_e164, cl.acquired_at AS claimed_at
      FROM crm_lead_claims cl
      JOIN crm_leads l ON l.id = cl.lead_id
      JOIN customers c ON c.id = l.customer_id
      WHERE cl.username = ? AND (cl.expires_at IS NULL OR cl.expires_at > CURRENT_TIMESTAMP)
      ORDER BY cl.acquired_at ASC
    `).all(req.user.username));
  });

  // Edit a single monday.com field straight from the workspace (currently
  // used for status-type columns rendered as a dropdown — see
  // leadContext.js's `labels`). Resolves board/item ids from
  // monday_item_map so the frontend only ever deals in leadId + columnId.
  app.put('/api/crm/leads/:id/monday-field', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { columnId, value } = req.body || {};
    if (!columnId || value == null) return res.status(400).json({ error: 'columnId and value required' });
    const map = db.prepare(`SELECT board_id, monday_item_id FROM monday_item_map WHERE lead_id = ?`).get(id);
    if (!map) return res.status(404).json({ error: 'הליד לא מקושר למנדיי' });
    try {
      await updateItemColumn(db, { boardId: map.board_id, itemId: map.monday_item_id, columnId, value });
      res.json(buildLeadContext(db, id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Send a Drive marketing file straight to the lead's WhatsApp — through
  // the outbox queue (kind:'drive'), never a direct provider call, so it
  // gets the same retry/backoff/opt-out/SSE handling as every other send.
  // The customer receives a real file (sendMediaUpload), never a link.
  app.post('/api/crm/leads/:id/send-drive-file', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { fileId, filename } = req.body || {};
    if (!fileId) return res.status(400).json({ error: 'fileId required' });
    const context = buildLeadContext(db, id);
    if (!context) return res.status(404).json({ error: 'ליד לא נמצא' });
    if (!context.customer?.phone_e164) return res.status(400).json({ error: 'ללקוח אין מספר טלפון' });
    try {
      const result = enqueue(db, {
        conversationId: context.conversation_id || undefined,
        customerId: context.customer.id,
        toE164: context.customer.phone_e164,
        kind: 'drive',
        driveFileId: fileId,
        mediaFilename: filename || null,
        sentBy: req.user.username,
        priority: 10,
      });
      if (result.skipped) return res.status(400).json({ error: `השליחה נחסמה: ${result.reason}` });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  app.post('/api/crm/leads/:id/release', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const claim = db.prepare(`SELECT * FROM crm_lead_claims WHERE lead_id = ?`).get(id);
    if (claim && claim.username !== req.user.username && req.user.role !== 'admin') {
      return res.status(409).json({ error: 'הליד נמצא בטיפול סוכן אחר' });
    }
    releaseClaim(db, id, 'released');
    res.json({ ok: true });
  });

  // ── Manager ────────────────────────────────────────────────────────────
  app.get('/api/crm/lead-pool', requireAdmin, (req, res) => {
    const { campaign_id, limit } = req.query;
    const where = [`l.assigned_to IS NULL`, `cl.lead_id IS NULL`, `l.status = 'new'`];
    const params = {};
    if (campaign_id) { where.push('l.campaign_id = @campaign_id'); params.campaign_id = campaign_id; }
    const lim = Number.isInteger(+limit) ? Math.min(parseInt(limit, 10), 500) : 200;
    const rows = db.prepare(`
      SELECT l.id, l.title, l.campaign_id, cam.name AS campaign_name,
             c.display_name, c.phone_e164,
             COALESCE(l.source_created_at, l.created_at) AS oldest_at
      FROM crm_leads l
      LEFT JOIN crm_lead_claims cl ON cl.lead_id = l.id AND (cl.expires_at IS NULL OR cl.expires_at > CURRENT_TIMESTAMP)
      LEFT JOIN crm_campaigns cam ON cam.id = l.campaign_id
      JOIN customers c ON c.id = l.customer_id
      WHERE ${where.join(' AND ')}
      ORDER BY oldest_at ASC LIMIT ${lim}
    `).all(params);
    const rollup = db.prepare(`
      SELECT cam.id AS campaign_id, COALESCE(cam.name,'ללא קמפיין') AS campaign_name, COUNT(*) AS n,
             MIN(COALESCE(l.source_created_at, l.created_at)) AS oldest_at
      FROM crm_leads l
      LEFT JOIN crm_campaigns cam ON cam.id = l.campaign_id
      LEFT JOIN crm_lead_claims cl ON cl.lead_id = l.id AND (cl.expires_at IS NULL OR cl.expires_at > CURRENT_TIMESTAMP)
      WHERE l.assigned_to IS NULL AND cl.lead_id IS NULL AND l.status = 'new'
      GROUP BY cam.id ORDER BY oldest_at ASC
    `).all();
    res.json({ leads: rows, rollup });
  });

  // Manual push — bypasses the cap deliberately (a manager override), but
  // reports over_cap so the UI can warn rather than silently exceeding it.
  app.post('/api/crm/leads/:id/assign', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const username = (req.body || {}).username;
    if (!username) return res.status(400).json({ error: 'username required' });
    const lead = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });
    db.prepare(`UPDATE crm_leads SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(username, id);
    db.prepare(`INSERT INTO crm_activity_log (customer_id, lead_id, type, summary, actor) VALUES (?, ?, 'assignment', ?, ?)`)
      .run(lead.customer_id, id, `הוקצה ל-${username} ידנית`, req.user.username);
    const settings = crmSettingsRow(db);
    const overCap = slotCount(db, username) >= (settings.max_claimed_leads || 4);
    res.json({ ok: true, over_cap: overCap });
  });

  app.post('/api/crm/leads/:id/force-release', requireAdmin, (req, res) => {
    releaseClaim(db, parseInt(req.params.id, 10), 'stolen');
    res.json({ ok: true });
  });

  app.post('/api/crm/leads/:id/return-to-pool', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lead = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });
    releaseClaim(db, id, 'stolen');
    db.prepare(`UPDATE crm_leads SET assigned_to = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    db.prepare(`INSERT INTO crm_activity_log (customer_id, lead_id, type, summary, actor) VALUES (?, ?, 'assignment', 'הוחזר לבריכה', ?)`)
      .run(lead.customer_id, id, req.user.username);
    res.json({ ok: true });
  });

  app.get('/api/crm/agents/workload', requireAdmin, (req, res) => {
    res.json(db.prepare(`
      SELECT u.username, u.full_name,
        (SELECT COUNT(*) FROM crm_lead_claims c WHERE c.username = u.username AND (c.expires_at IS NULL OR c.expires_at > CURRENT_TIMESTAMP)) AS open_slots,
        (SELECT COUNT(*) FROM crm_lead_handling h WHERE h.username = u.username AND date(h.started_at,'localtime') = date('now','localtime')) AS claimed_today,
        (SELECT COUNT(*) FROM crm_lead_handling h WHERE h.username = u.username AND h.ended_at IS NOT NULL AND date(h.ended_at,'localtime') = date('now','localtime')) AS closed_today
      FROM users u WHERE u.role IN ('agent','admin') ORDER BY open_slots DESC
    `).all());
  });

  // ── Per-agent campaign restrictions ───────────────────────────────────
  app.get('/api/crm/agent-campaigns', requireAdmin, (req, res) => {
    const users = db.prepare(`SELECT username, full_name FROM users WHERE role IN ('agent','admin') ORDER BY full_name`).all();
    const rows = db.prepare(`SELECT username, campaign_id FROM crm_agent_campaigns`).all();
    const byUser = {};
    for (const r of rows) (byUser[r.username] ||= []).push(r.campaign_id);
    res.json(users.map(u => ({ ...u, campaign_ids: byUser[u.username] || [] })));
  });

  // Replace-all in one transaction — simpler than per-row POST/DELETE and
  // matches a multi-select UI. Empty array = unrestricted.
  app.put('/api/crm/agent-campaigns/:username', requireAdmin, (req, res) => {
    const username = req.params.username;
    const campaignIds = Array.isArray(req.body?.campaign_ids) ? req.body.campaign_ids : [];
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM crm_agent_campaigns WHERE username = ?`).run(username);
      const ins = db.prepare(`INSERT INTO crm_agent_campaigns (username, campaign_id, created_by) VALUES (?, ?, ?)`);
      for (const cid of campaignIds) ins.run(username, cid, req.user.username);
    });
    tx();
    res.json({ ok: true, campaign_ids: campaignIds });
  });
};
