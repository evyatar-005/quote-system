// Shared config/scheduling primitives for every scheduled email report (one
// row per report_type in scheduled_reports). Each report module (e.g.
// deliveryNotesReport.js, salesReport.js) only implements "what to fetch and
// how to render it" — recipients, frequency/time resolution, and the actual
// clock-driven dispatch all live here so adding a new report type never means
// re-implementing scheduling.

function pad(n) { return String(n).padStart(2, '0'); }
function dateToStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function getReportConfig(db, reportType) {
  return db.prepare(`SELECT * FROM scheduled_reports WHERE report_type = ?`).get(reportType) || null;
}

function listReportConfigs(db) {
  return db.prepare(`SELECT * FROM scheduled_reports`).all();
}

function saveReportConfig(db, reportType, { enabled, recipients, frequency, time, weekday, dayOfMonth }) {
  db.prepare(
    `INSERT INTO scheduled_reports (report_type, enabled, recipients, frequency, time, weekday, day_of_month)
     VALUES (@report_type, @enabled, @recipients, @frequency, @time, @weekday, @day_of_month)
     ON CONFLICT(report_type) DO UPDATE SET enabled=excluded.enabled, recipients=excluded.recipients,
       frequency=excluded.frequency, time=excluded.time, weekday=excluded.weekday,
       day_of_month=excluded.day_of_month, updated_at=CURRENT_TIMESTAMP`
  ).run({
    report_type: reportType,
    enabled: enabled ? 1 : 0,
    recipients: recipients || null,
    frequency: frequency || 'daily',
    time: time || '17:00',
    weekday: weekday ?? 0,
    day_of_month: dayOfMonth ?? 1,
  });
  return getReportConfig(db, reportType);
}

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

// One shared minute-tick drives every registered report — no per-report
// setInterval, and no node-cron dependency (a plain clock check is simple,
// restart-safe: a missed run just doesn't happen, which is fine for an
// operational report, and doesn't need a new package for "at a fixed time,
// on some days"). `reportRunners` maps report_type -> async (db, cfg) => {}.
function startReportScheduler(db, reportRunners) {
  const lastSentKeys = {};
  setInterval(() => {
    const now = new Date();
    for (const cfg of listReportConfigs(db)) {
      if (!cfg.enabled) continue;
      const runner = reportRunners[cfg.report_type];
      if (!runner) continue;

      const [hour, minute] = (cfg.time || '17:00').split(':').map(Number);
      if (now.getHours() !== hour || now.getMinutes() !== minute) continue;
      if (!isScheduledDay(now, cfg.frequency, cfg.weekday, cfg.day_of_month)) continue;

      // Keyed by date (not just report_type) so a restart later the same day
      // can't re-trigger, but a genuinely new day/period always can.
      const key = `${cfg.report_type}:${dateToStr(now)}`;
      if (lastSentKeys[cfg.report_type] === key) continue;
      lastSentKeys[cfg.report_type] = key;

      runner(db, cfg).catch((err) => {
        console.error(`[scheduledReports] ${cfg.report_type} failed:`, err.message);
      });
    }
  }, 60 * 1000);
}

module.exports = {
  getReportConfig,
  listReportConfigs,
  saveReportConfig,
  parseRecipients,
  computeDateRange,
  startReportScheduler,
};
