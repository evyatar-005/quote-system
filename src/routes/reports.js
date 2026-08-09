// Scheduled email reports (admin) — config CRUD + on-demand "send now" per
// report type. The scheduler itself (src/services/reports/scheduledReports.js
// startReportScheduler) is wired up once in server.js, not here; this file is
// only the HTTP surface for viewing/editing config and triggering a test send.

const { listReportConfigs, saveReportConfig } = require('../services/reports/scheduledReports');
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
  // One row per known report type, defaults filled in for types never saved yet.
  app.get('/api/reports/config', requireAdmin, (req, res) => {
    const saved = Object.fromEntries(listReportConfigs(db).map((r) => [r.report_type, r]));
    const result = {};
    for (const type of Object.keys(REPORT_RUNNERS)) {
      const row = saved[type];
      result[type] = {
        enabled: !!(row && row.enabled),
        recipients: (row && row.recipients) || '',
        frequency: (row && row.frequency) || 'daily',
        time: (row && row.time) || '17:00',
        weekday: row && row.weekday != null ? row.weekday : 0,
        day_of_month: row && row.day_of_month != null ? row.day_of_month : 1,
      };
    }
    res.json(result);
  });

  // ── PUT /api/reports/config/:type ──────────────────────────────────────────
  app.put('/api/reports/config/:type', requireAdmin, (req, res) => {
    const { type } = req.params;
    if (!REPORT_RUNNERS[type]) return res.status(404).json({ error: `unknown report type "${type}"` });
    const { enabled, recipients, frequency, time, weekday, day_of_month } = req.body || {};
    const row = saveReportConfig(db, type, {
      enabled, recipients, frequency, time, weekday, dayOfMonth: day_of_month,
    });
    console.log(`[PUT /api/reports/config/${type}] enabled=${!!row.enabled} frequency=${row.frequency}`);
    res.json({ ok: true });
  });

  // ── POST /api/reports/test/:type ───────────────────────────────────────────
  // Sends using whatever's currently saved for this type — save first, then
  // test, same two-step flow as the SMTP test-send button.
  app.post('/api/reports/test/:type', requireAdmin, async (req, res) => {
    const { type } = req.params;
    const runner = REPORT_RUNNERS[type];
    if (!runner) return res.status(404).json({ error: `unknown report type "${type}"` });
    try {
      const result = await runner.sendNow(db);
      if (!result.sent) {
        return res.status(400).json({ error: 'לא הוגדרו נמענים לדוח זה' });
      }
      res.json({ ok: true, count: result.count });
    } catch (err) {
      console.error(`[POST /api/reports/test/${type}] failed:`, err.message);
      res.status(400).json({ error: err.message });
    }
  });

  return { REPORT_RUNNERS };
};
