// GreenAPI (WhatsApp) integration — credential config only. Sending itself
// is automatic (triggered from src/services/morning/sync.js after a
// document is created/converted), not exposed as its own endpoint.
//
// deps: { requireAdmin }

module.exports = function registerGreenApi(app, db, deps) {
  const { requireAdmin } = deps;

  const credRow = db.prepare(`SELECT * FROM greenapi_credentials WHERE id = 1`);

  app.get('/api/greenapi/config', requireAdmin, (req, res) => {
    const row = credRow.get();
    res.json({
      configured: !!(row && row.instance_id && row.api_token),
      instance_id: (row && row.instance_id) || '',
      api_token_masked: row && row.api_token ? '••••' + row.api_token.slice(-4) : '',
      api_url: (row && row.api_url) || '',
      media_url: (row && row.media_url) || '',
    });
  });

  app.put('/api/greenapi/config', requireAdmin, (req, res) => {
    const { instance_id, api_token, api_url, media_url } = req.body || {};
    const existing = credRow.get();
    const tokenToStore = (api_token && api_token.trim())
      ? api_token.trim()
      : (existing ? existing.api_token : null);

    db.prepare(
      `INSERT INTO greenapi_credentials (id, instance_id, api_token, api_url, media_url) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET instance_id=excluded.instance_id, api_token=excluded.api_token,
         api_url=excluded.api_url, media_url=excluded.media_url, updated_at=CURRENT_TIMESTAMP`
    ).run(instance_id || null, tokenToStore, api_url || null, media_url || null);

    console.log(`[PUT /api/greenapi/config] instance_id="${instance_id || ''}"`);
    res.json({ ok: true });
  });
};
