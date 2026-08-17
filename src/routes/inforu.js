// InforU (official WhatsApp Business API) integration — credential config,
// live approved-template listing, and a template test-send. Mirrors
// routes/greenapi.js's shape for the credential half.
//
// deps: { requireAuth, requireAdmin }

const client = require('../services/inforu/client');

module.exports = function registerInforu(app, db, deps) {
  const { requireAuth, requireAdmin } = deps;

  const credRow = db.prepare(`SELECT * FROM inforu_credentials WHERE id = 1`);

  app.get('/api/inforu/config', requireAdmin, (req, res) => {
    const row = credRow.get();
    const settings = db.prepare(`SELECT inforu_pull_enabled FROM crm_settings WHERE id = 1`).get();
    res.json({
      configured: !!(row && row.username && row.api_token),
      username: (row && row.username) || '',
      api_token_masked: row && row.api_token ? '••••' + row.api_token.slice(-4) : '',
      base_url: (row && row.base_url) || '',
      pull_enabled: !!(settings && settings.inforu_pull_enabled),
    });
  });

  app.put('/api/inforu/config', requireAdmin, (req, res) => {
    const { username, api_token, base_url, pull_enabled } = req.body || {};
    const existing = credRow.get();
    const tokenToStore = (api_token && api_token.trim())
      ? api_token.trim()
      : (existing ? existing.api_token : null);

    db.prepare(
      `INSERT INTO inforu_credentials (id, username, api_token, base_url) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET username=excluded.username, api_token=excluded.api_token,
         base_url=excluded.base_url, updated_at=CURRENT_TIMESTAMP`
    ).run(username || null, tokenToStore, base_url || null);

    if (pull_enabled !== undefined) {
      db.prepare(`UPDATE crm_settings SET inforu_pull_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
        .run(pull_enabled ? 1 : 0);
    }

    console.log(`[PUT /api/inforu/config] username="${username || ''}"`);
    res.json({ ok: true });
  });

  // Live proxy to GetTemplateList, filtered to Meta-approved templates only —
  // no local cache/table, see CLAUDE.md CRM plan: a disabled/rejected
  // template must disappear from the composer picker immediately, not once a
  // sync job gets around to it.
  app.get('/api/inforu/templates', requireAuth, async (req, res) => {
    try {
      const list = await client.getTemplateList(db);
      res.json(list.filter(t => t.ApprovalStatus === 1));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // The only way to open a session window for a first end-to-end test —
  // POST /api/whatsapp/test only sends free-form text, which InforU will
  // correctly refuse outside an open window.
  app.post('/api/inforu/test-template', requireAdmin, async (req, res) => {
    const { to, templateId, parameters } = req.body || {};
    if (!to || !templateId) return res.status(400).json({ error: 'to and templateId required' });
    try {
      const inforu = require('../services/channels/whatsapp/inforu');
      const result = await inforu.sendTemplate(db, { toE164: to, templateId, parameters: parameters || [] });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};
