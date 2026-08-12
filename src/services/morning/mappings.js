// Morning (Green Invoice) document type codes — see docs/morning-api-reference.md
// "Document Type codes" table. Only the subset this integration actually uses.
const DOCUMENT_TYPE = {
  quote: 10,
  order: 100,
  deliveryNote: 200,  // תעודת משלוח — no code path creates this per-quote yet
                       // (see services/crm/leadOutcome.js); previously only
                       // hardcoded in services/reports/deliveryNotesReport.js
                       // for an account-wide aggregate, not linked to quote_id.
  dealInvoice: 300,   // חשבון עסקה
  taxInvoice: 305,     // חשבונית מס
  taxInvoiceReceipt: 320,
  creditNote: 330,
  receipt: 400,
};

// This project only ever bills in ILS — see reference doc "Currency" section.
const CURRENCY = 'ILS';

// 0 = default VAT behavior based on the configured business type; this project
// never needs exempt (1) or mixed (2) VAT, so it's never surfaced as a choice.
const VAT_TYPE_DEFAULT = 0;

const LANG = 'he';

// payment[] rows are never sent on document creation — Payments (hosted forms /
// saved card tokens) are explicitly out of scope for this integration (see
// docs/morning-api-reference.md "Explicitly out of scope"). Morning documents
// are created/converted without recording a payment against them here.

module.exports = { DOCUMENT_TYPE, CURRENCY, VAT_TYPE_DEFAULT, LANG };
