// Documents that exist in Morning but never went through this system —
// issued straight from Morning's own UI by the office, with no
// signshop_quotes row and no morning_documents_map entry pointing at them.
//
// Every report/screen that wants "what happened in the business", rather than
// "what our agents did in this app", has to account for these or it silently
// under-reports. Shared by the sales email report (services/reports/
// salesReport.js) and the analytics screen's "מורנינג" agent row
// (routes/morning.js → GET /api/morning/direct-activity) so the two can't
// drift apart on what counts as "direct".

const { request } = require('./client');

// 0 = פתוח, 1 = סגור. Deliberately excludes 2 (סומן ידנית כסגור), 3 (מבטל)
// and 4 (בוטל) — see GET /documents/statuses. Same rule as the delivery-notes
// report: a cancelled or manually-closed-out document is not real business.
const LIVE_STATUSES = [0, 1];

// Pre-VAT total. amountDueVat is the amount VAT was calculated on; amount
// minus vat is the same number and covers documents that don't carry
// amountDueVat (e.g. a fully VAT-exempt one).
function preVatAmount(doc) {
  const value = doc.amountDueVat ?? (doc.amount != null && doc.vat != null ? doc.amount - doc.vat : doc.amount);
  return value || 0;
}

// Returns the Morning document ids of `type` issued in the period that this
// system has no record of creating. `withDetails` additionally fetches each
// one (search results carry no line items) — skip it when only a count is
// needed, since it costs one API call per document.
async function fetchMorningOnlyDocuments(db, { type, fromDate, toDate, withDetails = false }) {
  const known = new Set(
    db.prepare(`SELECT morning_document_id FROM morning_documents_map WHERE morning_document_type = ?`)
      .all(type)
      .map((r) => String(r.morning_document_id))
  );

  const candidates = [];
  let page = 1;
  for (;;) {
    const result = await request(db, 'POST', '/documents/search', {
      type: [type],
      status: LIVE_STATUSES,
      fromDate,
      toDate,
      page,
      pageSize: 100,
    });
    for (const doc of result.items || []) {
      if (!known.has(String(doc.id))) {
        candidates.push({ id: doc.id, number: doc.number, amount: preVatAmount(doc), clientName: doc.client?.name || '' });
      }
    }
    if (page >= (result.pages || 1)) break;
    page += 1;
  }

  if (!withDetails || !candidates.length) return candidates;

  // One GET per document — only worth it when the caller needs line items.
  // A single failed fetch must not lose the whole batch: the document is
  // still real business, so keep it with whatever the search already gave us.
  return Promise.all(candidates.map(async (c) => {
    try {
      const doc = await request(db, 'GET', `/documents/${c.id}`);
      return { ...c, income: doc?.income || [] };
    } catch (err) {
      console.error(`[fetchMorningOnlyDocuments] detail fetch failed for ${c.id}:`, err.message);
      return { ...c, income: [] };
    }
  }));
}

module.exports = { fetchMorningOnlyDocuments, LIVE_STATUSES, preVatAmount };
