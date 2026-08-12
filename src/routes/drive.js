// Google Drive integration — credential config (admin) + folder browsing
// (any CRM user, scoped to the configured marketing-materials root). See
// CLAUDE.md CRM plan Phase 5 §7/§8.
//
// deps: { requireAuth, requireAdmin }

const { listFolder, isAllowedFolder } = require('../services/google/driveClient');

module.exports = function registerDrive(app, db, deps) {
  const { requireAuth, requireAdmin } = deps;

  const credRow = db.prepare(`SELECT * FROM google_drive_credentials WHERE id = 1`);

  app.get('/api/drive/config', requireAdmin, (req, res) => {
    const row = credRow.get();
    res.json({
      configured: !!(row && row.api_key && row.root_folder_id),
      auth_mode: (row && row.auth_mode) || 'api_key',
      api_key_masked: row && row.api_key ? '••••' + row.api_key.slice(-4) : '',
      root_folder_id: (row && row.root_folder_id) || '',
      max_send_mb: (row && row.max_send_mb) || 16,
      cache_ttl_sec: (row && row.cache_ttl_sec) || 300,
    });
  });

  app.put('/api/drive/config', requireAdmin, (req, res) => {
    const { api_key, root_folder_id, max_send_mb, cache_ttl_sec } = req.body || {};
    const existing = credRow.get();
    // Blank-means-keep — same convention as greenapi/morning credentials.
    const keyToStore = (api_key && api_key.trim()) ? api_key.trim() : (existing ? existing.api_key : null);

    db.prepare(`
      INSERT INTO google_drive_credentials (id, auth_mode, api_key, root_folder_id, max_send_mb, cache_ttl_sec)
      VALUES (1, 'api_key', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET api_key=excluded.api_key, root_folder_id=excluded.root_folder_id,
        max_send_mb=excluded.max_send_mb, cache_ttl_sec=excluded.cache_ttl_sec, updated_at=CURRENT_TIMESTAMP
    `).run(keyToStore, root_folder_id || null, Number(max_send_mb) || 16, Number(cache_ttl_sec) || 300);

    console.log(`[PUT /api/drive/config] root_folder_id="${root_folder_id || ''}"`);
    res.json({ ok: true });
  });

  app.post('/api/drive/test', requireAdmin, async (req, res) => {
    const row = credRow.get();
    if (!row || !row.root_folder_id) return res.status(400).json({ error: 'לא מוגדר תיקיית שורש' });
    try {
      const files = await listFolder(db, row.root_folder_id);
      res.json({ ok: true, count: files.length });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Any CRM user (agents included) — browsing marketing materials from the
  // lead workspace. folderId defaults to the configured root.
  app.get('/api/drive/files', requireAuth, async (req, res) => {
    const row = credRow.get();
    if (!row || !row.root_folder_id) return res.status(400).json({ error: 'Google Drive אינו מוגדר' });
    const folderId = req.query.folderId || row.root_folder_id;
    if (!isAllowedFolder(db, folderId, row.root_folder_id)) {
      return res.status(403).json({ error: 'תיקייה לא מורשית' });
    }
    try {
      res.json(await listFolder(db, folderId));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};
