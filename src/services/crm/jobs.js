// CRM background jobs — same in-process setInterval design as
// startReportScheduler (src/services/reports/scheduledReports.js): one
// timer, every tick wrapped so a throw can never kill the loop, no new
// dependency (no node-cron/queue library).

const { pullBoard, pushBoard } = require('./mondaySync');
const { getActiveWhatsApp, getBulkWhatsApp } = require('../channels');
const { publish } = require('./realtime');

const POLL_TICK_MS = 60 * 1000;
const QUEUE_TICK_MS = 5 * 1000;
const IDLE_TICK_MS = 60 * 1000;

// Module-level pacing state for bulk (priority > 10) sends — deliberately
// in-memory, not persisted: a restart resuming immediately (one un-jittered
// send) is strictly safer than a persisted lock that could wedge the queue
// forever. See CLAUDE.md CRM plan Phase 4 §10.
let nextAllowedBulkSendAt = 0;

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

function crmSettingsRow(db) {
  return db.prepare(`SELECT * FROM crm_settings WHERE id = 1`).get() || {};
}

// LOCAL time — the host is on Israel time and SQLite's CURRENT_TIMESTAMP is
// UTC (2-3h off). Window/day checks must never use strftime('%H','now').
function inSendWindow(s) {
  const now = new Date();
  const days = (s.send_days || '0,1,2,3,4').split(',').map(Number);
  if (!days.includes(now.getDay())) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = (s.send_window_start || '09:00').split(':').map(Number);
  const [eh, em] = (s.send_window_end || '20:00').split(':').map(Number);
  return mins >= sh * 60 + sm && mins < eh * 60 + em;
}

// Cap counting on wa_send_queue.sent_at (the actual wire event), scoped to
// the LOCAL calendar day via SQLite's 'localtime' modifier — not UTC.
function sentToday(db, campaignId) {
  const where = campaignId ? `AND campaign_id = ?` : `AND campaign_id IS NOT NULL`;
  const args = campaignId ? [campaignId] : [];
  return db.prepare(
    `SELECT COUNT(*) c FROM wa_send_queue
     WHERE status = 'sent' AND sent_at IS NOT NULL
       AND date(sent_at, 'localtime') = date('now', 'localtime') ${where}`
  ).get(...args).c;
}

function pickRow(db, extraWhere, extraArgs = []) {
  return db.prepare(
    `SELECT q.* FROM wa_send_queue q
     LEFT JOIN wa_campaigns c ON c.id = q.campaign_id
     WHERE q.status = 'pending' AND q.next_attempt_at <= CURRENT_TIMESTAMP AND (${extraWhere})
     ORDER BY q.priority ASC, q.id ASC LIMIT 1`
  ).get(...extraArgs);
}

// A campaign completes when nothing is left in flight. Called after every
// terminal outcome rather than on a timer, so the UI flips the moment the
// last recipient resolves.
function finalizeCampaignIfDone(db, campaignId) {
  const { n } = db.prepare(
    `SELECT COUNT(*) n FROM wa_campaign_recipients WHERE campaign_id = ? AND status IN ('pending','queued')`
  ).get(campaignId);
  if (n > 0) return;
  const { changes } = db.prepare(
    `UPDATE wa_campaigns SET status='completed', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running'`
  ).run(campaignId);
  if (changes) publish('campaign.completed', { campaignId });
}

// Two-pass pick, then dispatch. Pass 1: 1:1 replies (priority <= 10) are
// NEVER paced, capped or window-restricted — a customer waiting for an
// answer at 21:30 gets one. Pass 2: bulk rows (priority > 10), gated by
// pacing/window/global-cap, and only from a campaign that is actually
// 'running' — pausing must stop the queue, not just the UI.
async function waQueueDrainerTick(db) {
  let row = pickRow(db, `q.priority <= 10`);

  if (!row) {
    const s = crmSettingsRow(db);
    if (Date.now() < nextAllowedBulkSendAt) return;
    if (!inSendWindow(s)) return;
    if (sentToday(db) >= (s.global_daily_send_cap || 300)) return;

    row = pickRow(db, `q.priority > 10 AND (c.id IS NULL OR c.status = 'running')`);
    if (!row) return;

    if (row.campaign_id) {
      const camp = db.prepare(`SELECT daily_cap FROM wa_campaigns WHERE id = ?`).get(row.campaign_id);
      if (camp && camp.daily_cap && sentToday(db, row.campaign_id) >= camp.daily_cap) {
        // Push this campaign's remaining pending rows to tomorrow rather than
        // stalling the tick, so one capped campaign can't starve another.
        db.prepare(
          `UPDATE wa_send_queue SET next_attempt_at = datetime(CURRENT_TIMESTAMP, '+1 day') WHERE campaign_id = ? AND status = 'pending'`
        ).run(row.campaign_id);
        return;
      }
    }

    // Arm the next bulk slot BEFORE awaiting the provider, so a slow send can
    // never collapse the gap. Uniform jitter — a fixed cadence is exactly the
    // fingerprint an anti-spam heuristic looks for.
    const min = s.queue_min_delay_sec || 25;
    const max = Math.max(min, s.queue_max_delay_sec || 90);
    nextAllowedBulkSendAt = Date.now() + (min + Math.random() * (max - min)) * 1000;
  }

  // row.attempts is read BEFORE this UPDATE — attemptNo below must be
  // row.attempts + 1, never row.attempts, or the first retry fires
  // immediately and a "3 attempts" cap becomes 4 sends.
  const attemptNo = row.attempts + 1;
  db.prepare(`UPDATE wa_send_queue SET status = 'sending', attempts = ? WHERE id = ?`).run(attemptNo, row.id);
  if (row.recipient_id) {
    db.prepare(`UPDATE wa_campaign_recipients SET status = 'queued' WHERE id = ? AND status = 'pending'`).run(row.recipient_id);
  }

  let provider;
  try {
    provider = row.priority > 10 ? getBulkWhatsApp(db) : getActiveWhatsApp(db);
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
    if (row.campaign_id) {
      db.prepare(`UPDATE wa_campaigns SET sent_count = sent_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.campaign_id);
      if (row.recipient_id) {
        db.prepare(`UPDATE wa_campaign_recipients SET status = 'sent', sent_at = CURRENT_TIMESTAMP, message_id = ? WHERE id = ?`)
          .run(row.message_id, row.recipient_id);
      }
      publish('campaign.progress', { campaignId: row.campaign_id });
      finalizeCampaignIfDone(db, row.campaign_id);
    }
  } else if (result.retryable && attemptNo < 3) {
    // 30s then 60s — 3 attempts total. MUST be computed by SQLite via
    // datetime(): a JS ISO string sorts ABOVE CURRENT_TIMESTAMP (it's UTC
    // with a 'T' separator, which is lexicographically > ' ') and the row
    // would never become ready again.
    const delaySec = 30 * attemptNo;
    db.prepare(`UPDATE wa_send_queue SET status = 'pending', last_error = ?, next_attempt_at = datetime(CURRENT_TIMESTAMP, '+' || ? || ' seconds') WHERE id = ?`)
      .run(result.error, delaySec, row.id);
  } else {
    db.prepare(`UPDATE wa_send_queue SET status = 'failed', last_error = ? WHERE id = ?`).run(result.error, row.id);
    if (row.message_id) db.prepare(`UPDATE crm_messages SET status = 'failed', error_message = ? WHERE id = ?`).run(result.error, row.message_id);
    if (row.campaign_id) {
      db.prepare(`UPDATE wa_campaigns SET failed_count = failed_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.campaign_id);
      if (row.recipient_id) {
        db.prepare(`UPDATE wa_campaign_recipients SET status = 'failed', error_message = ? WHERE id = ?`).run(result.error, row.recipient_id);
      }
      publish('campaign.progress', { campaignId: row.campaign_id });
      finalizeCampaignIfDone(db, row.campaign_id);
    }
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
