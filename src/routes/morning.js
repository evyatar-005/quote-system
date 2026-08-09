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

  // Every route below acts on one quote by id — none had an ownership check
  // before this: any authenticated agent could issue/convert/inspect the
  // Morning history of *any* quote, not just their own. This is the actual
  // enforcement point for "an agent only touches their own quotes" as far as
  // Morning is concerned (list-level scoping lives in entities.js).
  function loadOwnedQuote(req, res) {
    const quote = db.prepare(`SELECT * FROM signshop_quotes WHERE id = ?`).get(req.params.id);
    if (!quote) { res.status(404).json({ error: 'Quote not found' }); return null; }
    if (req.user.role !== 'admin' && quote.created_by !== req.user.username) {
      res.status(403).json({ error: 'forbidden' });
      return null;
    }
    return quote;
  }

  // Shared by /document (create/convert by type) and /convert (create/convert
  // by toType) — createOrConvertDocument already decides create-vs-convert
  // itself based on whether a prior morning_documents_map row exists, so both
  // routes just resolve the requested type name and delegate.
  async function handleDocumentRequest(req, res, typeFieldName) {
    const typeName = req.body && req.body[typeFieldName];
    const code = DOCUMENT_TYPE[typeName];
    if (!code) return res.status(400).json({ error: `unknown document type "${typeName}"` });

    const quote = loadOwnedQuote(req, res);
    if (!quote) return;

    // Email/VAT-ID are optional, not required — an agent generating a payment
    // link to forward manually (WhatsApp etc.) shouldn't be blocked for not
    // having them on hand. If the caller does supply them (the MyQuotes.jsx
    // inline form), persist them onto the quote so Morning's client card
    // still gets enriched whenever they ARE available — just never mandatory.
    if (typeFieldName === 'toType') {
      const email = req.body.clientEmail !== undefined ? req.body.clientEmail.toString().trim() : quote.client_email;
      const vatId = req.body.clientVatId !== undefined ? req.body.clientVatId.toString().trim() : quote.client_vat_id;
      if (email !== quote.client_email || vatId !== quote.client_vat_id) {
        db.prepare(`UPDATE signshop_quotes SET client_email = ?, client_vat_id = ? WHERE id = ?`)
          .run(email, vatId, quote.id);
        quote.client_email = email;
        quote.client_vat_id = vatId;
      }
    }

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

  // ── POST /api/morning/quotes/:id/payment-link ─────────────────────────────
  // Independent of /document and /convert — generates a standalone Morning
  // payment form (POST /payments/form) that only creates its own receipt once
  // the customer actually pays, never touching whatever order/quote document
  // already exists for this quote. See sync.createPaymentForm for why this
  // had to be separate from attaching paymentRequestData to a document.
  app.post('/api/morning/quotes/:id/payment-link', requireAuth, async (req, res) => {
    if (!loadOwnedQuote(req, res)) return;
    try {
      const url = await sync.createPaymentForm(db, req.params.id);
      res.json({ url });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── GET /api/morning/quotes/:id/history ───────────────────────────────────
  app.get('/api/morning/quotes/:id/history', requireAuth, (req, res) => {
    if (!loadOwnedQuote(req, res)) return;
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
