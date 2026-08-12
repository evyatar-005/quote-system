// Derives a lead's real downstream document state from morning_documents_map
// (per-quote, one row per document created/converted via Morning — see
// services/morning/sync.js's createOrConvertDocument) instead of relying on
// crm_leads.status being kept manually in sync. See CLAUDE.md CRM
// "קמפיינים" plan follow-up.
//
// hasDeliveryNote will realistically stay false on real data today — no
// screen in this app currently converts a quote to DOCUMENT_TYPE.deliveryNote
// (200) per-quote; that type is only ever produced as an account-wide
// aggregate by services/reports/deliveryNotesReport.js, never linked back to
// a specific quote_id. This is still worth building now so it lights up the
// moment that workflow exists, without another migration.

const { DOCUMENT_TYPE } = require('../morning/mappings');

function getDocumentStatus(db, quoteId) {
  if (!quoteId) return null;
  const rows = db.prepare(
    `SELECT morning_document_type, morning_document_number, document_url
     FROM morning_documents_map WHERE quote_id = ? ORDER BY id DESC`
  ).all(quoteId);
  return {
    hasQuoteDoc: rows.some(r => r.morning_document_type === DOCUMENT_TYPE.quote),
    hasOrder: rows.some(r => r.morning_document_type === DOCUMENT_TYPE.order),
    hasDeliveryNote: rows.some(r => r.morning_document_type === DOCUMENT_TYPE.deliveryNote),
    latest: rows[0] || null,
  };
}

module.exports = { getDocumentStatus };
