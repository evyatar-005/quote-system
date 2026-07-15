// Business logic for the Morning integration — client resolution, income row
// construction, and document create/convert. Route handlers (routes/morning.js)
// should only ever call into this module, never ./client directly.

const { request } = require('./client');
const { CURRENCY, VAT_TYPE_DEFAULT, LANG } = require('./mappings');

async function ensureMorningClient(db, clientName) {
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
    const created = await request(db, 'POST', '/clients', { name });
    morningClientId = created.id;
  }

  // INSERT OR IGNORE: another request may have raced and inserted this same
  // local_client_name in between our lookup and here.
  db.prepare(`INSERT OR IGNORE INTO morning_clients_map (local_client_name, morning_client_id) VALUES (?, ?)`)
    .run(name, morningClientId);
  const row = db.prepare(`SELECT morning_client_id FROM morning_clients_map WHERE local_client_name = ?`).get(name);
  return row.morning_client_id;
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
  }));
}

async function createOrConvertDocument(db, { quoteId, targetType, actorUsername }) {
  const action = 'sync';
  let quote;
  try {
    quote = db.prepare(`SELECT * FROM signshop_quotes WHERE id = ?`).get(quoteId);
    if (!quote) throw new Error('Quote not found');

    const morningClientId = await ensureMorningClient(db, quote.client_name);

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

    db.prepare(
      `INSERT INTO morning_documents_map (quote_id, morning_document_id, morning_document_type, morning_document_number, linked_from_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run(quoteId, response.id, targetType, response.number || null, prevMap ? prevMap.id : null);

    db.prepare(
      `INSERT INTO morning_sync_log (quote_id, action, request_json, response_json, success, created_by)
       VALUES (?, ?, ?, ?, 1, ?)`
    ).run(quoteId, isConvert ? 'convert_document' : 'create_document', JSON.stringify(body), JSON.stringify(response), actorUsername || null);

    return response;
  } catch (err) {
    db.prepare(
      `INSERT INTO morning_sync_log (quote_id, action, success, error_message, created_by)
       VALUES (?, ?, 0, ?, ?)`
    ).run(quoteId || null, action, err.message, actorUsername || null);
    throw err;
  }
}

function getHistory(db, quoteId) {
  return {
    documents: db.prepare(`SELECT * FROM morning_documents_map WHERE quote_id = ? ORDER BY id`).all(quoteId),
    log: db.prepare(`SELECT * FROM morning_sync_log WHERE quote_id = ? ORDER BY id DESC`).all(quoteId),
  };
}

module.exports = { ensureMorningClient, createOrConvertDocument, getHistory, buildIncomeRows };
