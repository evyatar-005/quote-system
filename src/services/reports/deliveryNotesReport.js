// "תעודות משלוח" report — every Morning delivery note (document type 200)
// closed in the reporting period, with its number, client name, and pre-VAT
// amount. Plugs into the shared scheduler in scheduledReports.js.

const { request } = require('../morning/client');
const mail = require('../mail');
const { parseRecipients, computeDateRange } = require('./scheduledReports');
const { renderReportEmail, tableShell, tableRow, barCell, formatDateRangeHe } = require('./emailTemplate');

const REPORT_TYPE = 'delivery_notes';
const DELIVERY_NOTE_TYPE = 200;
// Full status enum (from GET /documents/statuses): 0=פתוח, 1=סגור,
// 2=סומן ידנית כסגור, 3=מבטל, 4=בוטל. The report should list every delivery
// note actually issued that day regardless of open/closed, but exclude ones
// that were cancelled or manually closed out (not a real delivery).
const REPORTABLE_STATUSES = [0, 1];

// Paginated search — pageSize 100 keeps this to one request on any normal
// period; the loop only continues if Morning reports more pages than that.
async function fetchClosedDeliveryNotes(db, fromDate, toDate) {
  const items = [];
  let page = 1;
  for (;;) {
    const result = await request(db, 'POST', '/documents/search', {
      type: [DELIVERY_NOTE_TYPE],
      status: REPORTABLE_STATUSES,
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

function fmt(n) {
  return `₪ ${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildEmail(items, frequencyLabel, fromDate, toDate) {
  const total = items.reduce((sum, it) => sum + it.amount, 0);
  const periodLabel = fromDate === toDate ? toDate : `${fromDate} — ${toDate}`;
  const subject = `דוח תעודות משלוח ${frequencyLabel} — ${periodLabel} (${items.length})`;

  const max = Math.max(...items.map((it) => it.amount || 0), 0);
  const rows = items.map((it) => tableRow([it.number, it.clientName, fmt(it.amount), barCell(it.amount, max)]));
  const tableHtml = tableShell(
    ['מס׳ תעודה', 'לקוח', 'סכום (לפני מע״מ)', 'חלק יחסי'],
    rows,
    'לא נסגרו תעודות משלוח בתקופה זו.'
  );

  const html = renderReportEmail({
    title: 'דוח תעודות משלוח',
    periodLabel: `${frequencyLabel} · ${formatDateRangeHe(fromDate, toDate)}`,
    kpis: [
      { label: 'תעודות שנסגרו', value: items.length },
      { label: 'סה״כ לפני מע״מ', value: fmt(total) },
    ],
    sections: [{ heading: 'לפי תעודה', tableHtml }],
    footerNote: 'נשלח אוטומטית ממערכת הצעות מחיר.',
  });

  const text = `דוח תעודות משלוח ${frequencyLabel} — ${periodLabel}\n\n` +
    `${items.length} תעודות, סה"כ ${fmt(total)} לפני מע"מ\n\n` +
    items.map((it) => `תעודה ${it.number} — ${it.clientName}: ${fmt(it.amount)}`).join('\n');

  return { subject, html, text };
}

const FREQUENCY_LABELS = { daily: 'יומי', weekly: 'שבועי', monthly: 'חודשי' };

// Shared by sendReport and the "דוחות" tab's preview endpoint — fetches the
// data and renders the email, but never sends anything, so a preview never
// has a side effect.
async function buildReport(db, cfg) {
  const { fromDate, toDate } = cfg.fromDate && cfg.toDate
    ? { fromDate: cfg.fromDate, toDate: cfg.toDate }
    : computeDateRange(cfg.frequency, new Date());
  const items = await fetchClosedDeliveryNotes(db, fromDate, toDate);
  const periodLabel = FREQUENCY_LABELS[cfg.frequency] || cfg.frequency || 'ידני';
  return { ...buildEmail(items, periodLabel, fromDate, toDate), count: items.length };
}

// `cfg` is a scheduled_reports row when called from the scheduler; the
// manual "send now" endpoint instead passes the freshly-saved config (same
// shape) so a test send always reflects whatever's on screen, not stale DB
// state from before the admin's last edit. An on-demand generation (the
// "דוחות" tab's manual generator, /api/reports/generate) instead passes an
// explicit fromDate/toDate with no frequency at all — that period wins over
// computeDateRange whenever it's present, so a manually-picked range is
// never silently overridden by "today"/"this week".
async function sendReport(db, cfg) {
  const recipients = parseRecipients(cfg.recipients);
  if (!recipients.length) return { sent: false };

  const { subject, html, text, count } = await buildReport(db, cfg);
  await mail.sendMail(db, { to: recipients.join(', '), subject, html, text });
  console.log(`[deliveryNotesReport] sent ${count} delivery note(s) to ${recipients.join(', ')}`);
  return { sent: true, count };
}

module.exports = { REPORT_TYPE, sendReport, buildReport, fetchClosedDeliveryNotes };
