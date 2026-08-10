// Business logic for the Morning integration — client resolution, income row
// construction, and document create/convert. Route handlers (routes/morning.js)
// should only ever call into this module, never ./client directly.

const { request } = require('./client');
const { CURRENCY, VAT_TYPE_DEFAULT, LANG } = require('./mappings');
const { sendDocumentToWhatsApp } = require('../greenapi/send');

// Shared shape for both client creation and updates — every field we've
// collected on the quote form, so the Morning-side record is always a full
// saved client, not just a bare name.
function buildClientBody(name, extra = {}) {
  const body = { name };
  if (extra.phone) body.phone = extra.phone;
  if (extra.address) body.address = extra.address;
  if (extra.vatId) body.taxId = extra.vatId;
  if (extra.email) body.emails = [extra.email];
  // Credit days (0 = מזומן/שוטף, 30/60/90 = שוטף+N) — Morning's own field on
  // the client card, confirmed via a live GET /clients/:id (numeric
  // `paymentTerms`), not documented in docs/morning-api-reference.md.
  if (extra.paymentTerms != null && extra.paymentTerms !== '') body.paymentTerms = Number(extra.paymentTerms);
  return body;
}

async function ensureMorningClient(db, clientName, extra = {}) {
  const name = (clientName || '').trim();
  if (!name) throw new Error('Quote has no client_name');

  const body = buildClientBody(name, extra);
  const cached = db.prepare(`SELECT morning_client_id FROM morning_clients_map WHERE local_client_name = ?`).get(name);
  if (cached) {
    // Client already saved in Morning — keep it up to date with whatever
    // details were entered on this quote (phone/address/vatId/email can
    // change or be filled in later) rather than only ever writing them once.
    try {
      await request(db, 'PUT', `/clients/${cached.morning_client_id}`, body);
    } catch (err) {
      console.error(`[ensureMorningClient] update failed for ${cached.morning_client_id}:`, err.message);
    }
    return cached.morning_client_id;
  }

  const found = await request(db, 'POST', '/clients/search', { name, pageSize: 1 });
  let morningClientId = null;
  const candidate = found && found.items && found.items[0];
  if (candidate && candidate.name && candidate.name.toLowerCase() === name.toLowerCase()) {
    morningClientId = candidate.id;
    try {
      await request(db, 'PUT', `/clients/${morningClientId}`, body);
    } catch (err) {
      console.error(`[ensureMorningClient] update failed for ${morningClientId}:`, err.message);
    }
  } else {
    // New client — include every contact detail we already collected on the
    // quote form so Morning's record isn't just a bare name. taxId/email are
    // never required on our side (an agent can issue a payment link without
    // full client details), so a malformed value here (e.g. errorCode 1111 —
    // "מספר עוסק / ת.פ אינו תקין") must not block getting the order out at
    // all — retry once with just the fields Morning actually accepted.
    try {
      const created = await request(db, 'POST', '/clients', body);
      morningClientId = created.id;
    } catch (err) {
      if (!body.taxId && !body.emails) throw err;
      console.error(`[ensureMorningClient] client creation rejected details, retrying with name/phone/address only:`, err.message);
      const minimalBody = buildClientBody(name, { phone: extra.phone, address: extra.address });
      const created = await request(db, 'POST', '/clients', minimalBody);
      morningClientId = created.id;
    }
  }

  // INSERT OR IGNORE: another request may have raced and inserted this same
  // local_client_name in between our lookup and here.
  db.prepare(`INSERT OR IGNORE INTO morning_clients_map (local_client_name, morning_client_id) VALUES (?, ?)`)
    .run(name, morningClientId);
  const row = db.prepare(`SELECT morning_client_id FROM morning_clients_map WHERE local_client_name = ?`).get(name);
  return row.morning_client_id;
}

// Powers the client-search autocomplete on the quote form — looks up
// existing Morning clients by name so an agent can pick one instead of
// typing a new client from scratch. An empty query omits the `name` filter
// entirely (rather than short-circuiting to []) so focusing the field with
// nothing typed yet still shows Morning's client list — a plain "browse"
// mode, not just search-after-typing.
async function searchClients(db, query) {
  const name = (query || '').trim();
  const body = { pageSize: 10 };
  if (name) body.name = name;
  const found = await request(db, 'POST', '/clients/search', body);
  const items = (found && found.items) || [];
  return items.map(c => ({
    id: c.id,
    name: c.name,
    phone: c.phone || c.mobile || '',
    address: c.address || '',
    vatId: c.taxId || '',
    email: (c.emails && c.emails[0]) || '',
    paymentTerms: c.paymentTerms ?? 0,
  }));
}

// Explicit "create/update this client now" action for the calculator's
// "לקוח חדש" flow — unlike ensureMorningClient (fire-and-forget side effect
// of saving a quote), this is awaited directly by the caller so the agent
// gets an immediate success/failure instead of finding out only later.
// Shares the same search-then-create-or-update logic and morning_clients_map
// cache as ensureMorningClient, so the two paths can never disagree about
// which Morning client a given name maps to.
async function createClient(db, { name, phone, address, vatId, email, paymentTerms } = {}) {
  const morningClientId = await ensureMorningClient(db, name, { phone, address, vatId, email, paymentTerms });
  return { id: morningClientId, name: (name || '').trim(), phone: phone || '', address: address || '', vatId: vatId || '', email: email || '', paymentTerms: paymentTerms != null ? Number(paymentTerms) : 0 };
}

function buildIncomeRows(quote) {
  let items = [];
  try { items = JSON.parse(quote.line_items || '[]'); } catch (_) { items = []; }

  if (!Array.isArray(items) || items.length === 0) {
    // Morning requires at least one income row (error 2413) — fall back to a
    // single row summarizing the whole quote rather than failing the sync.
    return [{
      description: quote.notes || quote.quote_number,
      quantity: 1,
      price: quote.price_before_vat || 0,
      currency: CURRENCY,
      vatType: VAT_TYPE_DEFAULT,
    }];
  }

  return items.map(item => ({
    // Quotes saved before the calculator started folding the full spec into
    // `description` kept the agent's free text in its own `freeText` field,
    // which never reached Morning. Append it for those; newer quotes already
    // carry it inside the description, so the check keeps it from doubling up.
    description: item.freeText && !String(item.description || '').includes(item.freeText)
      ? `${item.description}\n${item.freeText}`
      : item.description,
    quantity: item.quantity,
    price: item.unitPrice,
    currency: CURRENCY,
    vatType: VAT_TYPE_DEFAULT,
    ...(item.sku ? { catalogNum: item.sku } : {}),
  }));
}

async function createOrConvertDocument(db, { quoteId, targetType, actorUsername }) {
  const action = 'sync';
  let quote;
  try {
    quote = db.prepare(`SELECT * FROM signshop_quotes WHERE id = ?`).get(quoteId);
    if (!quote) throw new Error('Quote not found');

    const morningClientId = await ensureMorningClient(db, quote.client_name, {
      phone: quote.client_phone,
      address: quote.client_address,
      vatId: quote.client_vat_id,
      email: quote.client_email,
    });

    const prevMap = db.prepare(
      `SELECT * FROM morning_documents_map WHERE quote_id = ? ORDER BY id DESC LIMIT 1`
    ).get(quoteId);
    const isConvert = !!prevMap;

    const body = {
      type: targetType,
      lang: LANG,
      currency: CURRENCY,
      vatType: VAT_TYPE_DEFAULT,
      income: buildIncomeRows(quote),
      client: { id: morningClientId },
      ...(isConvert ? { linkedDocumentIds: [prevMap.morning_document_id], linkType: 'link' } : {}),
    };

    const response = await request(db, 'POST', '/documents', body);

    const documentUrl = response.url && (response.url.he || response.url.origin) || null;
    db.prepare(
      `INSERT INTO morning_documents_map (quote_id, morning_document_id, morning_document_type, morning_document_number, linked_from_id, document_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(quoteId, response.id, targetType, response.number || null, prevMap ? prevMap.id : null, documentUrl);

    // Once Morning has actually issued a document for this quote, its number
    // becomes the quote's number too — the internal "מכירות-NN" one assigned
    // at save time was only ever a placeholder for quotes that may never reach
    // Morning at all (drafts, rejected ones). Re-run on every conversion
    // (quote → order → invoice) so quote_number always reflects the latest
    // real document, not just the first one issued.
    if (response.number) {
      db.prepare(`UPDATE signshop_quotes SET quote_number = ? WHERE id = ?`).run(response.number, quoteId);
    }

    db.prepare(
      `INSERT INTO morning_sync_log (quote_id, action, request_json, response_json, success, created_by)
       VALUES (?, ?, ?, ?, 1, ?)`
    ).run(quoteId, isConvert ? 'convert_document' : 'create_document', JSON.stringify(body), JSON.stringify(response), actorUsername || null);

    // Fire-and-forget: send the document straight to the client's WhatsApp.
    // Never let a WhatsApp/GreenAPI failure affect the Morning result the
    // caller is waiting on — sendDocumentToWhatsApp swallows its own errors.
    sendDocumentToWhatsApp(db, quote, response)
      .catch(err => console.error(`[createOrConvertDocument] WhatsApp send failed for quote #${quoteId}:`, err.message));

    return response;
  } catch (err) {
    db.prepare(
      `INSERT INTO morning_sync_log (quote_id, action, success, error_message, created_by)
       VALUES (?, ?, 0, ?, ?)`
    ).run(quoteId || null, action, err.message, actorUsername || null);
    throw err;
  }
}

// A standalone payment link via POST /payments/form — NOT the paymentRequestData
// attached to a document in createOrConvertDocument above. That mechanism only
// works on document types the account's payment plugins are actually configured
// for (a receipt/tax-invoice-receipt here, confirmed against this business's
// real active plugins — never an "order"/100), and worse, converting/attaching
// a payment button to an existing order document would close it, blocking the
// delivery note (תעודת משלוח) and everything else normally issued from an open
// order. This endpoint is fully independent of any existing document: Morning
// only creates the underlying receipt once the customer actually pays, so the
// order this is generated alongside is never touched.
async function createPaymentForm(db, quoteId) {
  const action = 'payment_form';
  let quote;
  try {
    quote = db.prepare(`SELECT * FROM signshop_quotes WHERE id = ?`).get(quoteId);
    if (!quote) throw new Error('Quote not found');

    const morningClientId = await ensureMorningClient(db, quote.client_name, {
      phone: quote.client_phone,
      address: quote.client_address,
      vatId: quote.client_vat_id,
      email: quote.client_email,
    });

    // Omitting pluginId is supposed to fall back to "the business's default
    // payment plugin" per the docs, but in practice this account has no
    // plugin actually marked default (errorCode 2600 "לא נמצא מסוף סליקה
    // פעיל" even with two plugins active) — so the plugin must be resolved
    // and passed explicitly. GET /documents/info returns the SAME
    // paymentPlugins list regardless of the ?type= queried (confirmed live —
    // it does not actually filter by type), so query it once and pick the
    // document type from the CHOSEN PLUGIN'S OWN settings.docType — pairing a
    // plugin with any other type is what would actually cause a mismatch.
    // PayPal (Green Invoice plugin type 12010) is explicitly excluded per
    // request — only a direct credit-card terminal should be offered here.
    const PAYPAL_PLUGIN_TYPE = 12010;
    const info = await request(db, 'GET', '/documents/info?type=400');
    const activePlugins = (info.paymentPlugins || [])
      .filter(p => p.active && p.settings?.docType && p.type !== PAYPAL_PLUGIN_TYPE);
    const plugin =
      activePlugins.find(p => p.settings.docType === 400) ||
      activePlugins[0];
    if (!plugin) throw new Error('No active (non-PayPal) Morning payment plugin found on this account');
    const paymentType = plugin.settings.docType;
    const pluginId = plugin.id;

    const body = {
      description: `תשלום עבור הזמנה ${quote.quote_number}`,
      type: paymentType,
      amount: quote.price_with_vat || 0,
      currency: CURRENCY,
      vatType: VAT_TYPE_DEFAULT,
      lang: LANG,
      client: { id: morningClientId },
      maxPayments: 1,
      pluginId,
    };

    const response = await request(db, 'POST', '/payments/form', body);

    db.prepare(
      `INSERT INTO morning_sync_log (quote_id, action, request_json, response_json, success, created_by)
       VALUES (?, ?, ?, ?, 1, NULL)`
    ).run(quoteId, action, JSON.stringify(body), JSON.stringify(response));

    return response.url;
  } catch (err) {
    db.prepare(
      `INSERT INTO morning_sync_log (quote_id, action, success, error_message)
       VALUES (?, ?, 0, ?)`
    ).run(quoteId || null, action, err.message);
    throw err;
  }
}

// Latest Morning document per quote — powers the QuotesHistory list (one row
// per quote), which needs the "convert to order" button and the document
// number/PDF link without opening each quote's full history individually.
function getLatestDocuments(db, quoteIds) {
  if (!Array.isArray(quoteIds) || quoteIds.length === 0) return {};
  const placeholders = quoteIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM morning_documents_map
     WHERE quote_id IN (${placeholders})
     AND id IN (SELECT MAX(id) FROM morning_documents_map WHERE quote_id IN (${placeholders}) GROUP BY quote_id)`
  ).all(...quoteIds, ...quoteIds);
  const byQuoteId = {};
  for (const row of rows) byQuoteId[row.quote_id] = row;
  return byQuoteId;
}

function getHistory(db, quoteId) {
  return {
    documents: db.prepare(`SELECT * FROM morning_documents_map WHERE quote_id = ? ORDER BY id`).all(quoteId),
    log: db.prepare(`SELECT * FROM morning_sync_log WHERE quote_id = ? ORDER BY id DESC`).all(quoteId),
  };
}

module.exports = { ensureMorningClient, createOrConvertDocument, createPaymentForm, getHistory, buildIncomeRows, searchClients, createClient, getLatestDocuments };
