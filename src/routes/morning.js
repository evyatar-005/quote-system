// Morning (Green Invoice) integration — credential config (admin) + per-quote
// document create/convert/history (any authenticated user).
//
// deps: { requireAuth, requireAdmin }

const sync = require('../services/morning/sync');
const { DOCUMENT_TYPE } = require('../services/morning/mappings');

module.exports = function registerMorning(app, db, deps) {
  const { requireAuth, requireAdmin } = deps;

  const credRow = db.prepare(`SELECT * FROM morning_credentials WHERE id = 1`);

  // ── GET /api/morning/config ───────────────────────────────────────────────
  app.get('/api/morning/config', requireAdmin, (req, res) => {
    const row = credRow.get();
    res.json({
      configured: !!(row && row.client_id),
      client_id: (row && row.client_id) || '',
      // Never return the real secret — only enough to confirm one is set.
      client_secret_masked: row && row.client_secret ? '••••' + row.client_secret.slice(-4) : '',
      sandbox: !!(row && row.sandbox),
      base_url: (row && row.base_url) || '',
    });
  });

  // ── PUT /api/morning/config ───────────────────────────────────────────────
  app.put('/api/morning/config', requireAdmin, (req, res) => {
    const { client_id, client_secret, sandbox, base_url } = req.body || {};
    const existing = credRow.get();
    // Blank/omitted secret means "leave it as-is" — lets an admin update
    // client_id/base_url/sandbox without having to re-paste the secret.
    const secretToStore = (client_secret && client_secret.trim())
      ? client_secret.trim()
      : (existing ? existing.client_secret : null);

    db.prepare(
      `INSERT INTO morning_credentials (id, client_id, client_secret, base_url, sandbox) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET client_id=excluded.client_id, client_secret=excluded.client_secret,
         base_url=excluded.base_url, sandbox=excluded.sandbox, updated_at=CURRENT_TIMESTAMP`
    ).run(client_id || null, secretToStore, base_url || null, sandbox ? 1 : 0);

    console.log(`[PUT /api/morning/config] client_id="${client_id || ''}" sandbox=${!!sandbox}`);
    res.json({ ok: true });
  });

  // Shared by /document (create/convert by type) and /convert (create/convert
  // by toType) — createOrConvertDocument already decides create-vs-convert
  // itself based on whether a prior morning_documents_map row exists, so both
  // routes just resolve the requested type name and delegate.
  async function handleDocumentRequest(req, res, typeFieldName) {
    const typeName = req.body && req.body[typeFieldName];
    const code = DOCUMENT_TYPE[typeName];
    if (!code) return res.status(400).json({ error: `unknown document type "${typeName}"` });

    try {
      const result = await sync.createOrConvertDocument(db, {
        quoteId: req.params.id,
        targetType: code,
        actorUsername: req.user.username,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  // ── POST /api/morning/quotes/:id/document ─────────────────────────────────
  app.post('/api/morning/quotes/:id/document', requireAuth, (req, res) => {
    handleDocumentRequest(req, res, 'type');
  });

  // ── POST /api/morning/quotes/:id/convert ──────────────────────────────────
  app.post('/api/morning/quotes/:id/convert', requireAuth, (req, res) => {
    handleDocumentRequest(req, res, 'toType');
  });

  // ── GET /api/morning/quotes/:id/history ───────────────────────────────────
  app.get('/api/morning/quotes/:id/history', requireAuth, (req, res) => {
    res.json(sync.getHistory(db, req.params.id));
  });

  // ── GET /api/morning/quotes/documents?ids=1,2,3 ───────────────────────────
  // Batched latest-document lookup for the QuotesHistory list — avoids one
  // request per row.
  app.get('/api/morning/quotes/documents', requireAuth, (req, res) => {
    const ids = (req.query.ids || '').split(',').map(s => parseInt(s, 10)).filter(Number.isInteger);
    res.json(sync.getLatestDocuments(db, ids));
  });

  // ── GET /api/morning/clients/search?q= ────────────────────────────────────
  // Powers the client-search autocomplete on the quote form.
  app.get('/api/morning/clients/search', requireAuth, async (req, res) => {
    try {
      const items = await sync.searchClients(db, req.query.q);
      res.json({ items });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};
