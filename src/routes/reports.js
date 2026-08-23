// Scheduled email reports (admin) — config CRUD (one report_type can have
// several independent schedules) + on-demand "send now" per schedule. The
// scheduler itself (src/services/reports/scheduledReports.js
// startReportScheduler) is wired up once in server.js, not here; this file
// is only the HTTP surface for viewing/editing schedules and triggering a
// test send.

const { listSchedules, getSchedule, saveSchedule, deleteSchedule, runAndRecord } = require('../services/reports/scheduledReports');
const deliveryNotesReport = require('../services/reports/deliveryNotesReport');
const salesReport = require('../services/reports/salesReport');

// Every report type this app knows about — the admin UI renders one card per
// entry here (via GET /api/reports/config), so adding a new report type is
// just one more line in this map plus its own report module.
const REPORT_RUNNERS = {
  [deliveryNotesReport.REPORT_TYPE]: deliveryNotesReport,
  [salesReport.REPORT_TYPE]: salesReport,
};

module.exports = function registerReports(app, db, deps) {
  const { requireAdmin } = deps;

  // ── GET /api/reports/config ────────────────────────────────────────────────
  // { [reportType]: Schedule[] } — one array per known report type, empty if
  // none configured yet.
  app.get('/api/reports/config', requireAdmin, (req, res) => {
    const result = {};
    for (const type of Object.keys(REPORT_RUNNERS)) result[type] = listSchedules(db, type);
    res.json(result);
  });

  // ── POST /api/reports/config/:type ─────────────────────────────────────────
  // Creates a new schedule for this report type.
  app.post('/api/reports/config/:type', requireAdmin, (req, res) => {
    const { type } = req.params;
    if (!REPORT_RUNNERS[type]) return res.status(404).json({ error: `unknown report type "${type}"` });
    const { enabled, recipients, frequency, time, weekday, day_of_month, days_of_week } = req.body || {};
    const schedule = saveSchedule(db, null, type, { enabled, recipients, frequency, time, weekday, dayOfMonth: day_of_month, daysOfWeek: days_of_week });
    console.log(`[POST /api/reports/config/${type}] created schedule #${schedule.id}`);
    res.status(201).json(schedule);
  });

  // ── PUT /api/reports/config/:type/:id ──────────────────────────────────────
  app.put('/api/reports/config/:type/:id', requireAdmin, (req, res) => {
    const { type, id } = req.params;
    if (!REPORT_RUNNERS[type]) return res.status(404).json({ error: `unknown report type "${type}"` });
    const { enabled, recipients, frequency, time, weekday, day_of_month, days_of_week } = req.body || {};
    const schedule = saveSchedule(db, Number(id), type, { enabled, recipients, frequency, time, weekday, dayOfMonth: day_of_month, daysOfWeek: days_of_week });
    if (!schedule) return res.status(404).json({ error: 'schedule not found' });
    console.log(`[PUT /api/reports/config/${type}/${id}] enabled=${!!schedule.enabled} frequency=${schedule.frequency}`);
    res.json(schedule);
  });

  // ── DELETE /api/reports/config/:type/:id ───────────────────────────────────
  app.delete('/api/reports/config/:type/:id', requireAdmin, (req, res) => {
    const { type, id } = req.params;
    if (!REPORT_RUNNERS[type]) return res.status(404).json({ error: `unknown report type "${type}"` });
    deleteSchedule(db, Number(id), type);
    res.json({ ok: true });
  });

  // ── POST /api/reports/test/:type/:id ───────────────────────────────────────
  // Sends using whatever's currently saved for this schedule — save first,
  // then test, same two-step flow as the SMTP test-send button. Goes through
  // runAndRecord so a manual test updates last_sent_at/last_run_status the
  // same way an automatic scheduled run would.
  app.post('/api/reports/test/:type/:id', requireAdmin, async (req, res) => {
    const { type, id } = req.params;
    const runner = REPORT_RUNNERS[type];
    if (!runner) return res.status(404).json({ error: `unknown report type "${type}"` });
    const schedule = getSchedule(db, Number(id));
    if (!schedule || schedule.report_type !== type) return res.status(404).json({ error: 'schedule not found' });
    try {
      const result = await runAndRecord(db, schedule, runner.sendReport);
      if (!result.sent) {
        return res.status(400).json({ error: 'לא הוגדרו נמענים לדוח זה' });
      }
      res.json({ ok: true, count: result.count });
    } catch (err) {
      console.error(`[POST /api/reports/test/${type}/${id}] failed:`, err.message);
      res.status(400).json({ error: err.message });
    }
  });

  return { REPORT_RUNNERS };
};
