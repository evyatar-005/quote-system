// Shared config/scheduling primitives for every scheduled email report. A
// report_type (e.g. 'delivery_notes', 'sales') can have SEVERAL independent
// schedules at once — a daily digest and a monthly rollup of the same report
// are two separate rows in report_schedules, each with its own recipients/
// frequency/time/enabled state. Each report module (deliveryNotesReport.js,
// salesReport.js) only implements "what to fetch and how to render it" —
// recipients, frequency/time resolution, and the clock-driven dispatch all
// live here so adding a new report type never means re-implementing scheduling.

function pad(n) { return String(n).padStart(2, '0'); }
function dateToStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function listSchedules(db, reportType) {
  return db.prepare(`SELECT * FROM report_schedules WHERE report_type = ? ORDER BY id`).all(reportType);
}

function listAllSchedules(db) {
  return db.prepare(`SELECT * FROM report_schedules`).all();
}

function getSchedule(db, id) {
  return db.prepare(`SELECT * FROM report_schedules WHERE id = ?`).get(id) || null;
}

// id === null/undefined creates a new schedule; otherwise updates the
// existing one (and must belong to reportType — checked by the route).
function saveSchedule(db, id, reportType, { enabled, recipients, frequency, time, weekday, dayOfMonth, daysOfWeek }) {
  const values = {
    report_type: reportType,
    enabled: enabled ? 1 : 0,
    recipients: recipients || null,
    frequency: frequency || 'daily',
    time: time || '17:00',
    weekday: weekday ?? 0,
    day_of_month: dayOfMonth ?? 1,
    days_of_week: Array.isArray(daysOfWeek) && daysOfWeek.length ? daysOfWeek.join(',') : null,
  };
  if (id) {
    db.prepare(
      `UPDATE report_schedules SET enabled=@enabled, recipients=@recipients, frequency=@frequency,
         time=@time, weekday=@weekday, day_of_month=@day_of_month, days_of_week=@days_of_week, updated_at=CURRENT_TIMESTAMP
       WHERE id=@id AND report_type=@report_type`
    ).run({ ...values, id });
    return getSchedule(db, id);
  }
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO report_schedules (report_type, enabled, recipients, frequency, time, weekday, day_of_month, days_of_week)
     VALUES (@report_type, @enabled, @recipients, @frequency, @time, @weekday, @day_of_month, @days_of_week)`
  ).run(values);
  return getSchedule(db, lastInsertRowid);
}

function deleteSchedule(db, id, reportType) {
  db.prepare(`DELETE FROM report_schedules WHERE id = ? AND report_type = ?`).run(id, reportType);
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
// last full calendar week (Sunday..Saturday, matching the Israeli week —
// NOT a rolling 7 days, since that drifts against how Morning itself
// reports "this week" and only lines up when the schedule happens to fire
// on a Sunday), monthly = the last 30 days (rolling, not calendar-month) —
// simpler and unambiguous vs. calendar months of varying length.
function computeDateRange(frequency, today) {
  if (frequency === 'weekly') {
    // Most recently completed Sunday..Saturday as of `today` (inclusive of
    // today if today itself is Saturday). getDay(): 0=Sun..6=Sat.
    const daysSinceSaturday = (today.getDay() + 1) % 7;
    const saturday = new Date(today);
    saturday.setDate(today.getDate() - daysSinceSaturday);
    const sunday = new Date(saturday);
    sunday.setDate(saturday.getDate() - 6);
    return { fromDate: dateToStr(sunday), toDate: dateToStr(saturday) };
  }
  const toDate = dateToStr(today);
  const from = new Date(today);
  if (frequency === 'monthly') from.setDate(from.getDate() - 29);
  return { fromDate: dateToStr(from), toDate };
}

// Whether `now` is a scheduled send moment for the configured frequency:
// - daily: every day
// - weekly: only on the configured weekday (0=Sunday..6=Saturday)
// - monthly: only on the configured day-of-month, clamped to the last day of
//   shorter months (so "31" still fires in February, on the 28th/29th)
function isScheduledDay(now, frequency, weekday, dayOfMonth, daysOfWeek) {
  if (frequency === 'weekly') return now.getDay() === weekday;
  if (frequency === 'monthly') {
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return now.getDate() === Math.min(dayOfMonth, lastDayOfMonth);
  }
  // daily, optionally restricted to a subset of weekdays (e.g. skip Fri/Sat)
  if (!daysOfWeek) return true;
  const allowed = String(daysOfWeek).split(',').map(Number);
  return allowed.includes(now.getDay());
}

// Runs `runner(db, schedule)` and writes the outcome to last_sent_at/
// last_run_status/last_run_error — the ONE code path both the automatic
// scheduler tick and the manual "שלח עכשיו לבדיקה" route go through, so the
// two callers can never leave this state out of sync with each other.
// last_sent_at only advances on an actual send (result.sent === true) — "no
// recipients configured" is a real, visible error state, not a silent no-op.
async function runAndRecord(db, schedule, runner) {
  try {
    const result = await runner(db, schedule);
    if (result.sent) {
      db.prepare(
        `UPDATE report_schedules SET last_sent_at=CURRENT_TIMESTAMP, last_run_status='success', last_run_error=NULL WHERE id=?`
      ).run(schedule.id);
    } else {
      db.prepare(
        `UPDATE report_schedules SET last_run_status='error', last_run_error='אין נמענים מוגדרים' WHERE id=?`
      ).run(schedule.id);
    }
    return result;
  } catch (err) {
    db.prepare(
      `UPDATE report_schedules SET last_run_status='error', last_run_error=? WHERE id=?`
    ).run(err.message, schedule.id);
    throw err;
  }
}

// One shared minute-tick drives every schedule of every report — no
// per-schedule setInterval, and no node-cron dependency (a plain clock check
// is simple, restart-safe: a missed run just doesn't happen, which is fine
// for an operational report). `reportRunners` maps report_type -> async
// (db, schedule) => {sent, count?}.
function startReportScheduler(db, reportRunners) {
  const lastSentKeys = {}; // schedule id -> `${date}` already sent
  setInterval(() => {
    const now = new Date();
    for (const schedule of listAllSchedules(db)) {
      if (!schedule.enabled) continue;
      const runner = reportRunners[schedule.report_type];
      if (!runner) continue;

      const [hour, minute] = (schedule.time || '17:00').split(':').map(Number);
      if (now.getHours() !== hour || now.getMinutes() !== minute) continue;
      if (!isScheduledDay(now, schedule.frequency, schedule.weekday, schedule.day_of_month, schedule.days_of_week)) continue;

      // Keyed by schedule id + date so a restart later the same day can't
      // re-trigger, but a genuinely new day/period always can.
      const key = dateToStr(now);
      if (lastSentKeys[schedule.id] === key) continue;
      lastSentKeys[schedule.id] = key;

      runAndRecord(db, schedule, runner).catch((err) => {
        console.error(`[scheduledReports] schedule #${schedule.id} (${schedule.report_type}) failed:`, err.message);
      });
    }
  }, 60 * 1000);
}

module.exports = {
  listSchedules,
  listAllSchedules,
  getSchedule,
  saveSchedule,
  deleteSchedule,
  parseRecipients,
  computeDateRange,
  runAndRecord,
  startReportScheduler,
};
