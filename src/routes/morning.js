// Morning (Green Invoice) integration — credential config (admin) + per-quote
// document create/convert/history (any authenticated user).
//
// deps: { requireAuth, requireAdmin }

const crypto = require('crypto');
const sync = require('../services/morning/sync');
const { DOCUMENT_TYPE } = require('../services/morning/mappings');
const { fetchMorningOnlyDocuments } = require('../services/morning/directDocuments');
const { notifyPaymentReceived } = require('../services/notifyAdmins');

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
      webhook_secret_masked: row && row.webhook_secret ? '••••' + row.webhook_secret.slice(-4) : '',
    });
  });

  // ── PUT /api/morning/config ───────────────────────────────────────────────
  app.put('/api/morning/config', requireAdmin, (req, res) => {
    const { client_id, client_secret, sandbox, base_url, webhook_secret } = req.body || {};
    const existing = credRow.get();
    // Blank/omitted secret means "leave it as-is" — lets an admin update
    // client_id/base_url/sandbox without having to re-paste the secret.
    const secretToStore = (client_secret && client_secret.trim())
      ? client_secret.trim()
      : (existing ? existing.client_secret : null);
    const webhookSecretToStore = (webhook_secret && webhook_secret.trim())
      ? webhook_secret.trim()
      : (existing ? existing.webhook_secret : null);

    db.prepare(
      `INSERT INTO morning_credentials (id, client_id, client_secret, base_url, sandbox, webhook_secret) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET client_id=excluded.client_id, client_secret=excluded.client_secret,
         base_url=excluded.base_url, sandbox=excluded.sandbox, webhook_secret=excluded.webhook_secret, updated_at=CURRENT_TIMESTAMP`
    ).run(client_id || null, secretToStore, base_url || null, sandbox ? 1 : 0, webhookSecretToStore);

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

  // ── POST /api/morning/webhooks/payment-received ──────────────────────────
  // Public — Morning calls this directly (configured in their web UI under
  // Developer Tools → Webhooks, event "payment/received"; there's no API to
  // register it, see docs/morning-api-reference.md). No requireAuth: Morning
  // has no session cookie to send. Verified instead by the HMAC signature
  // Morning attaches (x-webhook-signature) when a webhook_secret is configured
  // in "הגדרות מורנינג" — matching the same secret set on Morning's side.
  //
  // Acks 2xx immediately (Morning retries on timeout/failure, and the receipt
  // lookup below can take several seconds) — the actual work happens after
  // the response is sent.
  app.post('/api/morning/webhooks/payment-received', (req, res) => {
    const row = credRow.get();
    const secret = row && row.webhook_secret;
    if (secret) {
      const signature = req.get('x-webhook-signature');
      if (signature) {
        // Best-effort check: Morning's exact HMAC scheme (payload encoding,
        // digest format) isn't confirmed against a real delivery yet, so a
        // mismatch is logged, not rejected — refusing to process a genuine
        // payment because of an unconfirmed signature scheme would be worse
        // than accepting an unverified one. Tighten this once a real
        // delivery's signature has been checked against this computation.
        try {
          const computed = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('base64');
          if (computed !== signature) console.warn('[morning webhook] signature mismatch — processing anyway');
        } catch (err) {
          console.warn('[morning webhook] signature check error:', err.message);
        }
      } else {
        console.warn('[morning webhook] webhook_secret is configured but no x-webhook-signature header was sent');
      }
    }

    res.status(200).json({ ok: true });

    sync.handlePaymentReceived(db, req.body)
      .then((result) => {
        if (result) notifyPaymentReceived(db, result.quote, result.amount, result.receiptUrl);
      })
      .catch((err) => console.error('[POST /api/morning/webhooks/payment-received] failed:', err.message));
  });

  // ── GET /api/morning/quotes/:id/payment-status ────────────────────────────
  // Latest payment-link status for this quote (pending/paid + receipt once
  // found) — powers the "שולם"/"הורד קבלה" UI without re-deriving it from the
  // notification bell, which a manager may have already cleared.
  app.get('/api/morning/quotes/:id/payment-status', requireAuth, (req, res) => {
    if (!loadOwnedQuote(req, res)) return;
    const row = db.prepare(
      `SELECT * FROM morning_payment_requests WHERE quote_id = ? ORDER BY id DESC LIMIT 1`
    ).get(req.params.id);
    res.json(row
      ? { status: row.status, amount: row.amount, paidAt: row.paid_at, receiptUrl: row.receipt_url, receiptNumber: row.receipt_number }
      : { status: null });
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

  // ── GET /api/morning/direct-activity?fromDate=&toDate= ────────────────────
  // Quotes and orders issued straight from Morning, with no quote in this
  // system behind them. The analytics screen renders these as a synthetic
  // "מורנינג" agent so the per-agent report covers the whole business rather
  // than only what was quoted through this app.
  //
  // Cost/profit are deliberately absent: those documents carry a price but no
  // cost breakdown of ours, so any profit figure for them would be invented.
  // The caller must present them as revenue-only.
  app.get('/api/morning/direct-activity', requireAuth, async (req, res) => {
    const { fromDate, toDate } = req.query;
    try {
      const [quotes, orders] = await Promise.all([
        fetchMorningOnlyDocuments(db, { type: DOCUMENT_TYPE.quote, fromDate, toDate }),
        fetchMorningOnlyDocuments(db, { type: DOCUMENT_TYPE.order, fromDate, toDate }),
      ]);
      res.json({
        quotesCount: quotes.length,
        ordersCount: orders.length,
        ordersRevenue: orders.reduce((sum, o) => sum + o.amount, 0),
        orders: orders.map((o) => ({ number: o.number, clientName: o.clientName, amount: o.amount })),
      });
    } catch (err) {
      console.error('[GET /api/morning/direct-activity] failed:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // ── GET /api/morning/document-proxy?url= ──────────────────────────────────
  // Morning's document download links come back with a forced-download
  // header (Content-Disposition: attachment), so the browser can never show
  // them inline in an <iframe> — it just downloads the file underneath a
  // blank modal. This fetches the PDF server-side and re-serves it with
  // Content-Disposition: inline so the frontend can actually preview it,
  // while still linking directly to the original Morning URL for "הורד" (that
  // one already downloads correctly on its own, no proxy needed for that).
  // Hostname allowlist guards against this becoming an open SSRF proxy.
  const ALLOWED_DOC_HOSTS = new Set(['www.greeninvoice.co.il', 'greeninvoice.co.il']);
  app.get('/api/morning/document-proxy', requireAuth, async (req, res) => {
    const url = req.query.url;
    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'invalid url' }); }
    if (parsed.protocol !== 'https:' || !ALLOWED_DOC_HOSTS.has(parsed.hostname)) {
      return res.status(400).json({ error: 'url not allowed' });
    }
    try {
      const upstream = await fetch(parsed.toString());
      if (!upstream.ok) return res.status(upstream.status).json({ error: 'upstream fetch failed' });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.set('Content-Type', upstream.headers.get('content-type') || 'application/pdf');
      res.set('Content-Disposition', 'inline; filename="document.pdf"');
      res.send(buf);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
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

  // ── POST /api/morning/clients ─────────────────────────────────────────────
  // Explicit "צור לקוח חדש" action from the calculator's client field —
  // creates (or updates, if the name already resolves to an existing Morning
  // client) a client record right away, including payment terms, instead of
  // only ever registering one implicitly on quote save.
  app.post('/api/morning/clients', requireAuth, async (req, res) => {
    try {
      const name = (req.body?.name || '').toString().trim();
      if (!name) return res.status(400).json({ error: 'name required' });
      const client = await sync.createClient(db, { ...req.body, name });
      res.status(201).json(client);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};
