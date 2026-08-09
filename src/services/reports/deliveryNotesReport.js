// "תעודות משלוח" report — every Morning delivery note (document type 200)
// closed in the reporting period, with its number, client name, and pre-VAT
// amount. Plugs into the shared scheduler in scheduledReports.js.

const { request } = require('../morning/client');
const mail = require('../mail');
const { getReportConfig, parseRecipients, computeDateRange } = require('./scheduledReports');

const REPORT_TYPE = 'delivery_notes';
const DELIVERY_NOTE_TYPE = 200;
// 1 = מסמך סגור, 2 = מסמך סומן ידנית כסגור — "closed" as requested; an open
// (0) delivery note hasn't actually gone out yet and shouldn't be reported.
const CLOSED_STATUSES = [1, 2];

// Paginated search — pageSize 100 keeps this to one request on any normal
// period; the loop only continues if Morning reports more pages than that.
async function fetchClosedDeliveryNotes(db, fromDate, toDate) {
  const items = [];
  let page = 1;
  for (;;) {
    const result = await request(db, 'POST', '/documents/search', {
      type: [DELIVERY_NOTE_TYPE],
      status: CLOSED_STATUSES,
      fromDate,
      toDate,
      page,
      pageSize: 100,
    });
    for (const doc of result.items || []) {
      // amountDueVat is the amount VAT was calculated on, i.e. the pre-VAT
      // total — amount (incl. VAT) minus vat gives the same number, used as
      // a fallback in case a given document has no amountDueVat for some
      // reason (e.g. a fully VAT-exempt document).
      const preVat = doc.amountDueVat ?? (doc.amount != null && doc.vat != null ? doc.amount - doc.vat : doc.amount);
      items.push({ number: doc.number, amount: preVat || 0, clientName: doc.client?.name || '' });
    }
    if (page >= (result.pages || 1)) break;
    page += 1;
  }
  return items;
}

function buildEmail(items, frequencyLabel, fromDate, toDate) {
  const total = items.reduce((sum, it) => sum + it.amount, 0);
  const fmt = (n) => `₪ ${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const periodLabel = fromDate === toDate ? toDate : `${fromDate} — ${toDate}`;
  const subject = `דוח תעודות משלוח ${frequencyLabel} — ${periodLabel} (${items.length})`;

  const rows = items
    .map((it) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${it.number}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${it.clientName}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${fmt(it.amount)}</td></tr>`)
    .join('');

  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; color: #1e293b;">
      <p>שלום,</p>
      <p>בתקופה ${periodLabel} נסגרו <strong>${items.length}</strong> תעודות משלוח, בסך כולל (לפני מע״מ) של <strong>${fmt(total)}</strong>.</p>
      ${items.length ? `
      <table style="border-collapse:collapse; margin-top:12px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:6px 10px; text-align:right;">מס׳ תעודה</th>
            <th style="padding:6px 10px; text-align:right;">לקוח</th>
            <th style="padding:6px 10px; text-align:right;">סכום (לפני מע״מ)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>` : '<p>לא נסגרו תעודות משלוח בתקופה זו.</p>'}
    </div>`;

  const text = `דוח תעודות משלוח ${frequencyLabel} — ${periodLabel}\n\n` +
    `${items.length} תעודות, סה"כ ${fmt(total)} לפני מע"מ\n\n` +
    items.map((it) => `תעודה ${it.number} — ${it.clientName}: ${fmt(it.amount)}`).join('\n');

  return { subject, html, text };
}

const FREQUENCY_LABELS = { daily: 'יומי', weekly: 'שבועי', monthly: 'חודשי' };

// `cfg` is a scheduled_reports row when called from the scheduler; the
// manual "send now" endpoint instead passes the freshly-saved config (same
// shape) so a test send always reflects whatever's on screen, not stale DB
// state from before the admin's last edit.
async function sendReport(db, cfg) {
  const recipients = parseRecipients(cfg.recipients);
  if (!recipients.length) return { sent: false };

  const { fromDate, toDate } = computeDateRange(cfg.frequency, new Date());
  const items = await fetchClosedDeliveryNotes(db, fromDate, toDate);
  const { subject, html, text } = buildEmail(items, FREQUENCY_LABELS[cfg.frequency] || cfg.frequency, fromDate, toDate);
  await mail.sendMail(db, { to: recipients.join(', '), subject, html, text });
  console.log(`[deliveryNotesReport] sent ${items.length} delivery note(s) for ${fromDate}..${toDate} to ${recipients.join(', ')}`);
  return { sent: true, count: items.length };
}

// Convenience for the "send now" endpoint — loads the current saved config
// itself so the caller doesn't need to.
async function sendNow(db) {
  const cfg = getReportConfig(db, REPORT_TYPE);
  if (!cfg) return { sent: false };
  return sendReport(db, cfg);
}

module.exports = { REPORT_TYPE, sendReport, sendNow, fetchClosedDeliveryNotes };
