// CRM background jobs — same in-process setInterval design as
// startReportScheduler (src/services/reports/scheduledReports.js): one
// timer, every tick wrapped so a throw can never kill the loop, no new
// dependency (no node-cron/queue library).

const { pullBoard, pushBoard } = require('./mondaySync');

const POLL_TICK_MS = 60 * 1000;

function startCrmJobs(db) {
  setInterval(() => {
    mondayPollerTick(db).catch(err => console.error('[crm jobs] mondayPoller tick failed:', err.message));
    mondayPusherTick(db).catch(err => console.error('[crm jobs] mondayPusher tick failed:', err.message));
  }, POLL_TICK_MS);
  console.log('[crm jobs] started (monday poller/pusher, 60s tick)');
}

// One board per tick — the board whose poll_minutes has most overdue elapsed
// — so a large number of mapped boards never bursts monday.com's API in the
// same minute (CRM plan §10.2).
async function mondayPollerTick(db) {
  const settings = db.prepare(`SELECT monday_poll_enabled FROM crm_settings WHERE id = 1`).get();
  if (!settings || !settings.monday_poll_enabled) return;

  const boards = db.prepare(`SELECT * FROM monday_board_map WHERE pull_enabled = 1`).all();
  const due = boards
    .filter(b => !b.last_polled_at || (Date.now() - new Date(b.last_polled_at.replace(' ', 'T') + 'Z').getTime()) >= b.poll_minutes * 60 * 1000)
    .sort((a, b) => (a.last_polled_at || '').localeCompare(b.last_polled_at || ''));
  const board = due[0];
  if (!board) return;

  try {
    const result = await pullBoard(db, board, 'monday-sync');
    if (result.created) console.log(`[crm jobs] monday board ${board.board_id}: pulled ${result.pulled}, created ${result.created} lead(s)`);
  } catch (err) {
    console.error(`[crm jobs] monday board ${board.board_id} pull failed:`, err.message);
  }
}

async function mondayPusherTick(db) {
  const boards = db.prepare(`SELECT * FROM monday_board_map WHERE push_enabled = 1 AND status_column_id IS NOT NULL`).all();
  for (const board of boards) {
    try {
      const result = await pushBoard(db, board);
      if (result.pushed) console.log(`[crm jobs] monday board ${board.board_id}: pushed ${result.pushed} status update(s)`);
    } catch (err) {
      console.error(`[crm jobs] monday board ${board.board_id} push failed:`, err.message);
    }
  }
}

module.exports = { startCrmJobs };
