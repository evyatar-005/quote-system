// Reference file attachments (images/PDFs) an agent can attach to a quote —
// e.g. a photo of the client's wall or a spec PDF — so the sales manager
// reviewing a discount request can see what it's actually for.
//
// deps: { requireAuth }

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads/quote-attachments');

// Images + PDF only — this is reference material for a human reviewer, not a
// general file drop.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
]);
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB — generous for a phone photo or scanned PDF
const MAX_FILES = 10;

module.exports = function registerAttachments(app, db, deps) {
  const { requireAuth } = deps;
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_ROOT),
    // Random on-disk filename — the original name (agent/client-supplied,
    // untrusted) is kept only as metadata in the DB, never used as a path.
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 10);
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
    fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
  });

  const insertRow = db.prepare(
    `INSERT INTO signshop_quote_attachments (quote_id, filename, original_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const metaCols = `id, quote_id, original_name, mime_type, size, uploaded_by, created_at`;
  const listByQuote = db.prepare(`SELECT ${metaCols} FROM signshop_quote_attachments WHERE quote_id = ? ORDER BY id`);
  const metaById = db.prepare(`SELECT ${metaCols} FROM signshop_quote_attachments WHERE id = ?`);
  const rowById = db.prepare(`SELECT * FROM signshop_quote_attachments WHERE id = ? AND quote_id = ?`);
  const deleteStmt = db.prepare(`DELETE FROM signshop_quote_attachments WHERE id = ? AND quote_id = ?`);
  const quoteExists = db.prepare(`SELECT id FROM signshop_quotes WHERE id = ?`);
  const quoteOwner = db.prepare(`SELECT created_by FROM signshop_quotes WHERE id = ?`);

  // Object-level access check for a quote's attachments — admin sees
  // everything, everyone else only their own quote (same "default closed"
  // reasoning as canAccessLead in services/crm/leadClaims.js). Returns the
  // HTTP status to send (404 if the quote itself doesn't exist, 403 if it
  // exists but isn't theirs), or null if access is allowed.
  function attachmentAccessDenial(quoteId, user) {
    const quote = quoteOwner.get(quoteId);
    if (!quote) return 404;
    if (user.role === 'admin' || quote.created_by === user.username) return null;
    return 403;
  }

  // POST /api/quotes/:id/attachments — multipart, field name "files" (multiple)
  app.post('/api/quotes/:id/attachments', requireAuth, (req, res) => {
    const quoteId = parseInt(req.params.id, 10);
    if (!Number.isInteger(quoteId) || !quoteExists.get(quoteId)) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    const denial = attachmentAccessDenial(quoteId, req.user);
    if (denial) return res.status(denial).json({ error: 'אין הרשאה להצעה זו' });
    upload.array('files', MAX_FILES)(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      const files = req.files || [];
      if (!files.length) {
        return res.status(400).json({ error: 'no files uploaded (only images/PDF are accepted)' });
      }
      const rows = files.map((f) => {
        const { lastInsertRowid } = insertRow.run(quoteId, f.filename, f.originalname, f.mimetype, f.size, req.user.username);
        return metaById.get(lastInsertRowid);
      });
      console.log(`[POST /api/quotes/${quoteId}/attachments] ${rows.length} file(s) by "${req.user.username}"`);
      res.status(201).json(rows);
    });
  });

  // GET /api/quotes/:id/attachments — metadata only, no file bytes
  app.get('/api/quotes/:id/attachments', requireAuth, (req, res) => {
    const quoteId = parseInt(req.params.id, 10);
    const denial = attachmentAccessDenial(quoteId, req.user);
    if (denial) return res.status(denial).json({ error: denial === 404 ? 'Quote not found' : 'אין הרשאה להצעה זו' });
    res.json(listByQuote.all(quoteId));
  });

  // GET /api/quotes/:id/attachments/:attId/file — stream the actual bytes
  app.get('/api/quotes/:id/attachments/:attId/file', requireAuth, (req, res) => {
    const quoteId = parseInt(req.params.id, 10);
    const attId = parseInt(req.params.attId, 10);
    const denial = attachmentAccessDenial(quoteId, req.user);
    if (denial) return res.status(denial).json({ error: denial === 404 ? 'Quote not found' : 'אין הרשאה להצעה זו' });
    const row = rowById.get(attId, quoteId);
    if (!row) return res.status(404).json({ error: 'attachment not found' });
    const filePath = path.join(UPLOAD_ROOT, row.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing on disk' });
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const asciiFallback = (row.original_name || 'attachment').replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
    res.setHeader('Content-Disposition', `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(row.original_name)}`);
    fs.createReadStream(filePath).pipe(res);
  });

  // DELETE /api/quotes/:id/attachments/:attId
  app.delete('/api/quotes/:id/attachments/:attId', requireAuth, (req, res) => {
    const quoteId = parseInt(req.params.id, 10);
    const attId = parseInt(req.params.attId, 10);
    const denial = attachmentAccessDenial(quoteId, req.user);
    if (denial) return res.status(denial).json({ error: denial === 404 ? 'Quote not found' : 'אין הרשאה להצעה זו' });
    const row = rowById.get(attId, quoteId);
    if (!row) return res.status(404).json({ error: 'attachment not found' });
    deleteStmt.run(attId, quoteId);
    try { fs.unlinkSync(path.join(UPLOAD_ROOT, row.filename)); } catch (_) {}
    res.json({ ok: true, id: attId });
  });
};
