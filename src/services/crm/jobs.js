// CRM background jobs — same in-process setInterval design as
// startReportScheduler (src/services/reports/scheduledReports.js): one
// timer, every tick wrapped so a throw can never kill the loop, no new
// dependency (no node-cron/queue library).

const { pullBoard, pushBoard } = require('./mondaySync');
const { getActiveWhatsApp } = require('../channels');
const { publish } = require('./realtime');

const POLL_TICK_MS = 60 * 1000;
const QUEUE_TICK_MS = 5 * 1000;
const IDLE_TICK_MS = 60 * 1000;

function startCrmJobs(db) {
  setInterval(() => {
    mondayPollerTick(db).catch(err => console.error('[crm jobs] mondayPoller tick failed:', err.message));
    mondayPusherTick(db).catch(err => console.error('[crm jobs] mondayPusher tick failed:', err.message));
  }, POLL_TICK_MS);
  setInterval(() => {
    waQueueDrainerTick(db).catch(err => console.error('[crm jobs] waQueueDrainer tick failed:', err.message));
  }, QUEUE_TICK_MS);
  setInterval(() => {
    try { idleSweeperTick(db); } catch (err) { console.error('[crm jobs] idleSweeper tick failed:', err.message); }
  }, IDLE_TICK_MS);
  console.log('[crm jobs] started (monday poller/pusher 60s, wa queue drainer 5s, idle sweeper 60s)');
}

// Drains one ready row per tick — highest priority (1:1 replies = 10) first.
// Bulk-campaign pacing (random delay between sends) is added in Phase 4;
// today every row is a 1:1 reply, so near-immediate delivery is correct.
async function waQueueDrainerTick(db) {
  const row = db.prepare(
    `SELECT * FROM wa_send_queue WHERE status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP ORDER BY priority ASC, id ASC LIMIT 1`
  ).get();
  if (!row) return;

  db.prepare(`UPDATE wa_send_queue SET status = 'sending', attempts = attempts + 1 WHERE id = ?`).run(row.id);
  let provider;
  try {
    provider = getActiveWhatsApp(db);
  } catch (err) {
    db.prepare(`UPDATE wa_send_queue SET status = 'pending', last_error = ? WHERE id = ?`).run(err.message, row.id);
    return;
  }

  const payload = JSON.parse(row.payload_json);
  let result;
  try {
    result = payload.kind === 'media'
      ? await provider.sendMedia(db, { toE164: row.to_e164, url: payload.url, filename: payload.filename, caption: payload.caption })
      : await provider.sendText(db, { toE164: row.to_e164, body: payload.body });
  } catch (err) {
    result = { ok: false, error: err.message, retryable: true };
  }

  if (result.ok) {
    db.prepare(`UPDATE wa_send_queue SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
    if (row.message_id) {
      db.prepare(`UPDATE crm_messages SET status = 'sent', provider = ?, provider_message_id = ? WHERE id = ?`)
        .run(provider.name, result.providerMessageId || null, row.message_id);
    }
    if (row.conversation_id) publish('message.sent', { conversationId: row.conversation_id, messageId: row.message_id });
  } else if (result.retryable && row.attempts < 3) {
    // Exponential-ish backoff: 30s, 60s, 90s.
    const delaySec = 30 * row.attempts;
    db.prepare(`UPDATE wa_send_queue SET status = 'pending', last_error = ?, next_attempt_at = datetime(CURRENT_TIMESTAMP, '+' || ? || ' seconds') WHERE id = ?`)
      .run(result.error, delaySec, row.id);
  } else {
    db.prepare(`UPDATE wa_send_queue SET status = 'failed', last_error = ? WHERE id = ?`).run(result.error, row.id);
    if (row.message_id) db.prepare(`UPDATE crm_messages SET status = 'failed', error_message = ? WHERE id = ?`).run(result.error, row.message_id);
  }
}

// Expires stale conversation locks (an agent closed the tab without
// releasing) so the conversation becomes claimable again, and closes the
// matching handling span with end_reason='expired'.
function idleSweeperTick(db) {
  const stale = db.prepare(`SELECT * FROM crm_conversation_locks WHERE expires_at <= CURRENT_TIMESTAMP`).all();
  for (const lock of stale) {
    db.prepare(`DELETE FROM crm_conversation_locks WHERE conversation_id = ?`).run(lock.conversation_id);
    db.prepare(
      `UPDATE crm_conversation_handling SET ended_at = CURRENT_TIMESTAMP, end_reason = 'expired',
         duration_sec = CAST((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400 AS INTEGER)
       WHERE conversation_id = ? AND username = ? AND ended_at IS NULL`
    ).run(lock.conversation_id, lock.username);
    publish('lock.released', { conversationId: lock.conversation_id, reason: 'expired' });
  }
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
