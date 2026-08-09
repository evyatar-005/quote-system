// Daily 17:00 email report: every Morning "תעודת משלוח" (delivery note,
// document type 200) closed that day, with its number and pre-VAT amount.
// No cron dependency in this project — a simple once-a-minute check against
// the clock, guarded by an in-memory "already sent today" flag so a second
// tick in the same minute (or a process restart later the same day) can't
// double-send.

const { request } = require('../morning/client');
const mail = require('../mail');

const REPORT_HOUR = 17;
const REPORT_MINUTE = 0;
const DELIVERY_NOTE_TYPE = 200;
// 1 = מסמך סגור, 2 = מסמך סומן ידנית כסגור — "closed" as requested; an open
// (0) delivery note hasn't actually gone out yet and shouldn't be reported.
const CLOSED_STATUSES = [1, 2];

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Paginated search — pageSize 100 keeps this to one request on any normal
// day; the loop only continues if Morning reports more pages than that.
async function fetchClosedDeliveryNotes(db, dateStr) {
  const items = [];
  let page = 1;
  for (;;) {
    const result = await request(db, 'POST', '/documents/search', {
      type: [DELIVERY_NOTE_TYPE],
      status: CLOSED_STATUSES,
      fromDate: dateStr,
      toDate: dateStr,
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

function buildReportEmail(items, dateStr) {
  const total = items.reduce((sum, it) => sum + it.amount, 0);
  const fmt = (n) => `₪ ${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const subject = `דוח תעודות משלוח יומי — ${dateStr} (${items.length})`;

  const rows = items
    .map((it) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${it.number}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${it.clientName}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${fmt(it.amount)}</td></tr>`)
    .join('');

  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; color: #1e293b;">
      <p>שלום,</p>
      <p>ביום ${dateStr} נסגרו <strong>${items.length}</strong> תעודות משלוח, בסך כולל (לפני מע״מ) של <strong>${fmt(total)}</strong>.</p>
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
      </table>` : '<p>לא נסגרו תעודות משלוח היום.</p>'}
    </div>`;

  const text = `דוח תעודות משלוח יומי — ${dateStr}\n\n` +
    `${items.length} תעודות, סה"כ ${fmt(total)} לפני מע"מ\n\n` +
    items.map((it) => `תעודה ${it.number} — ${it.clientName}: ${fmt(it.amount)}`).join('\n');

  return { subject, html, text };
}

// Returns { sent: false } when no recipient is configured (the scheduled
// caller treats this as a normal no-op) or { sent: true, count } — the
// manual test endpoint uses this to tell "sent" apart from "not configured".
async function sendDailyDeliveryReport(db) {
  const dateStr = todayStr();
  const cfg = mail.getSmtpConfig(db);
  const to = cfg && cfg.report_recipient_email;
  if (!to) return { sent: false };

  const items = await fetchClosedDeliveryNotes(db, dateStr);
  const { subject, html, text } = buildReportEmail(items, dateStr);
  await mail.sendMail(db, { to, subject, html, text });
  console.log(`[dailyDeliveryReport] sent ${items.length} delivery note(s) for ${dateStr} to ${to}`);
  return { sent: true, count: items.length };
}

// No node-cron dependency — a plain minute-tick is simple, restart-safe (a
// missed run today just doesn't happen; it isn't backfilled, which is fine
// for a same-day operational report), and avoids adding a new package for
// what's really just "once a day at a fixed time".
function startDailyReportScheduler(db) {
  let lastSentDate = null;
  setInterval(() => {
    const now = new Date();
    if (now.getHours() !== REPORT_HOUR || now.getMinutes() !== REPORT_MINUTE) return;
    const today = todayStr();
    if (lastSentDate === today) return;
    lastSentDate = today;
    sendDailyDeliveryReport(db).catch((err) => {
      console.error('[dailyDeliveryReport] failed:', err.message);
    });
  }, 60 * 1000);
}

module.exports = { startDailyReportScheduler, sendDailyDeliveryReport, fetchClosedDeliveryNotes };
