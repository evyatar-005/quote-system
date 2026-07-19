// Business logic for the Morning integration — client resolution, income row
// construction, and document create/convert. Route handlers (routes/morning.js)
// should only ever call into this module, never ./client directly.

const { request } = require('./client');
const { CURRENCY, VAT_TYPE_DEFAULT, LANG } = require('./mappings');
const { sendDocumentToWhatsApp } = require('../greenapi/send');

async function ensureMorningClient(db, clientName, extra = {}) {
  const name = (clientName || '').trim();
  if (!name) throw new Error('Quote has no client_name');

  const cached = db.prepare(`SELECT morning_client_id FROM morning_clients_map WHERE local_client_name = ?`).get(name);
  if (cached) return cached.morning_client_id;

  const found = await request(db, 'POST', '/clients/search', { name, pageSize: 1 });
  let morningClientId = null;
  const candidate = found && found.items && found.items[0];
  if (candidate && candidate.name && candidate.name.toLowerCase() === name.toLowerCase()) {
    morningClientId = candidate.id;
  } else {
    // New client — include contact details we already collected on the quote
    // form so Morning's record isn't just a bare name.
    const body = { name };
    if (extra.phone) body.phone = extra.phone;
    if (extra.address) body.address = extra.address;
    const created = await request(db, 'POST', '/clients', body);
    morningClientId = created.id;
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
// typing a new client from scratch.
async function searchClients(db, query) {
  const name = (query || '').trim();
  if (!name) return [];
  const found = await request(db, 'POST', '/clients/search', { name, pageSize: 10 });
  const items = (found && found.items) || [];
  return items.map(c => ({
    id: c.id,
    name: c.name,
    phone: c.phone || c.mobile || '',
    address: c.address || '',
  }));
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
    description: item.description,
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

    const morningClientId = await ensureMorningClient(db, quote.client_name, { phone: quote.client_phone, address: quote.client_address });

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

module.exports = { ensureMorningClient, createOrConvertDocument, getHistory, buildIncomeRows, searchClients, getLatestDocuments };
