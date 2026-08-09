// Scheduled email report: every Morning "תעודת משלוח" (delivery note,
// document type 200) closed in the reporting period, with its number,
// client name, and pre-VAT amount. Frequency (daily/weekly/monthly), send
// time, and recipients are all admin-configurable (smtp_credentials row).
// No cron dependency — a once-a-minute check against the clock, guarded by
// an in-memory "already sent for this period" flag so a second tick in the
// same minute (or a process restart later the same period) can't double-send.

const { request } = require('../morning/client');
const mail = require('../mail');

const DELIVERY_NOTE_TYPE = 200;
// 1 = מסמך סגור, 2 = מסמך סומן ידנית כסגור — "closed" as requested; an open
// (0) delivery note hasn't actually gone out yet and shouldn't be reported.
const CLOSED_STATUSES = [1, 2];

const FREQUENCY_LABELS = { daily: 'יומי', weekly: 'שבועי', monthly: 'חודשי' };

function pad(n) { return String(n).padStart(2, '0'); }
function dateToStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// Comma/newline/semicolon-separated list, as typed into the admin UI's
// multi-email field — trimmed and de-duplicated so a stray trailing
// separator or repeated paste doesn't produce a blank/duplicate recipient.
function parseRecipients(raw) {
  if (!raw) return [];
  const seen = new Set();
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(s) && seen.add(s));
}

// The reporting window ending "today" — daily = just today, weekly = the
// last 7 days (rolling, not calendar-week), monthly = the last 30 days
// (rolling, not calendar-month) — simpler and unambiguous vs. calendar
// months of varying length.
function computeDateRange(frequency, today) {
  const toDate = dateToStr(today);
  const from = new Date(today);
  if (frequency === 'weekly') from.setDate(from.getDate() - 6);
  else if (frequency === 'monthly') from.setDate(from.getDate() - 29);
  return { fromDate: dateToStr(from), toDate };
}

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

function buildReportEmail(items, frequency, fromDate, toDate) {
  const total = items.reduce((sum, it) => sum + it.amount, 0);
  const fmt = (n) => `₪ ${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const label = FREQUENCY_LABELS[frequency] || frequency;
  const periodLabel = fromDate === toDate ? toDate : `${fromDate} — ${toDate}`;
  const subject = `דוח תעודות משלוח ${label} — ${periodLabel} (${items.length})`;

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

  const text = `דוח תעודות משלוח ${label} — ${periodLabel}\n\n` +
    `${items.length} תעודות, סה"כ ${fmt(total)} לפני מע"מ\n\n` +
    items.map((it) => `תעודה ${it.number} — ${it.clientName}: ${fmt(it.amount)}`).join('\n');

  return { subject, html, text };
}

// Returns { sent: false } when no recipients are configured (the scheduled
// caller treats this as a normal no-op) or { sent: true, count } — the
// manual test endpoint uses this to tell "sent" apart from "not configured".
async function sendDailyDeliveryReport(db) {
  const cfg = mail.getSmtpConfig(db);
  const recipients = parseRecipients(cfg && cfg.report_recipient_email);
  if (!recipients.length) return { sent: false };

  const frequency = (cfg && cfg.report_frequency) || 'daily';
  const { fromDate, toDate } = computeDateRange(frequency, new Date());
  const items = await fetchClosedDeliveryNotes(db, fromDate, toDate);
  const { subject, html, text } = buildReportEmail(items, frequency, fromDate, toDate);
  await mail.sendMail(db, { to: recipients.join(', '), subject, html, text });
  console.log(`[dailyDeliveryReport] sent ${items.length} delivery note(s) for ${fromDate}..${toDate} to ${recipients.join(', ')}`);
  return { sent: true, count: items.length };
}

// Whether `now` is a scheduled send moment for the configured frequency:
// - daily: every day
// - weekly: only on the configured weekday (0=Sunday..6=Saturday)
// - monthly: only on the configured day-of-month, clamped to the last day of
//   shorter months (so "31" still fires in February, on the 28th/29th)
function isScheduledDay(now, frequency, weekday, dayOfMonth) {
  if (frequency === 'weekly') return now.getDay() === weekday;
  if (frequency === 'monthly') {
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return now.getDate() === Math.min(dayOfMonth, lastDayOfMonth);
  }
  return true; // daily
}

// No node-cron dependency — a plain minute-tick is simple, restart-safe (a
// missed run just doesn't happen; it isn't backfilled, which is fine for an
// operational report), and avoids adding a new package for what's really
// just "at a fixed time, on some days".
function startDailyReportScheduler(db) {
  let lastSentKey = null;
  setInterval(() => {
    const cfg = mail.getSmtpConfig(db);
    if (!cfg) return;
    const [reportHour, reportMinute] = (cfg.report_time || '17:00').split(':').map(Number);
    const now = new Date();
    if (now.getHours() !== reportHour || now.getMinutes() !== reportMinute) return;

    const frequency = cfg.report_frequency || 'daily';
    if (!isScheduledDay(now, frequency, cfg.report_weekday ?? 0, cfg.report_day_of_month ?? 1)) return;

    // Keyed by date (not just frequency) so a restart later the same day
    // can't re-trigger, but a genuinely new day/period always can.
    const key = `${dateToStr(now)}-${frequency}`;
    if (lastSentKey === key) return;
    lastSentKey = key;
    sendDailyDeliveryReport(db).catch((err) => {
      console.error('[dailyDeliveryReport] failed:', err.message);
    });
  }, 60 * 1000);
}

module.exports = { startDailyReportScheduler, sendDailyDeliveryReport, fetchClosedDeliveryNotes, parseRecipients, computeDateRange };
