// CRM background jobs — same in-process setInterval design as
// startReportScheduler (src/services/reports/scheduledReports.js): one
// timer, every tick wrapped so a throw can never kill the loop, no new
// dependency (no node-cron/queue library).

const { pullBoard, pushBoard } = require('./mondaySync');
const { getActiveWhatsApp, getBulkWhatsApp } = require('../channels');
const { publish } = require('./realtime');
const { downloadFile } = require('../google/driveClient');
const { DOCUMENT_TYPE } = require('../morning/mappings');
const inforuClient = require('../inforu/client');
const { syncInforuChats } = require('../channels/whatsapp/inforuChatSync');
const { handleInboundEvent } = require('../channels/whatsapp/inbound');
const { CLOSED_SQL } = require('./leadStatuses');

const POLL_TICK_MS = 60 * 1000;
const QUEUE_TICK_MS = 5 * 1000;
const IDLE_TICK_MS = 60 * 1000;
const INFORU_PULL_TICK_MS = 10 * 1000;

// Module-level pacing state for bulk (priority > 10) sends — deliberately
// in-memory, not persisted: a restart resuming immediately (one un-jittered
// send) is strictly safer than a persisted lock that could wedge the queue
// forever. See CLAUDE.md CRM plan Phase 4 §10.
let nextAllowedBulkSendAt = 0;

// Reentrancy guard for the InforU pull tick — a 10s interval CAN overlap a
// slow HTTP round-trip. Without this, two concurrent pulls would split one
// batch across two ticks and the second could run against a half-written DB.
// Module-level and in-memory on purpose, same reasoning as nextAllowedBulkSendAt.
let inforuPulling = false;
let inforuChatSyncing = false;

// 10s. At 30s an agent could be reading a reply on their phone half a minute
// before the CRM showed it, which is long enough to answer twice or to answer
// something the customer had already followed up on. 6 calls/minute is modest
// against InforU's limits, and the call costs the same whether or not anything
// arrived — it is a windowed read, not a queue drain.
const INFORU_CHAT_SYNC_MS = 10 * 1000;

// The window re-read on every tick. Deliberately far wider than the interval:
// the read is idempotent (OR IGNORE on WhatsAppMessageId), so overlap is free,
// while a gap would lose messages permanently. Also covers a message InforU
// records slightly late, and a few minutes of downtime, with no catch-up logic.
const INFORU_CHAT_SYNC_WINDOW_MIN = 20;

// Reads InforU's CHAT store rather than the PullData queue — see
// channels/whatsapp/inforuChatSync.js for why the queue was unusable on this
// account. Gated only on "is InforU the active provider and configured": no
// opt-in switch, because unlike the pull this consumes nothing, so two
// instances running it concurrently is harmless rather than destructive.
async function inforuChatSyncTick(db) {
  if (inforuChatSyncing) return;
  const provider = getActiveWhatsApp(db);
  if (provider.name !== 'inforu' || !provider.isConfigured(db)) return;

  inforuChatSyncing = true;
  try {
    const from = new Date(Date.now() - INFORU_CHAT_SYNC_WINDOW_MIN * 60000)
      .toISOString().slice(0, 19).replace('T', ' ');
    const r = await syncInforuChats(db, { fromDateTime: from });
    if (r.imported) {
      console.log(`[crm jobs] inforuChatSync: imported ${r.imported} message(s), ${r.inbound} inbound`);
    }
  } finally {
    inforuChatSyncing = false;
  }
}

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
    try { leadOutcomeSweepTick(db); } catch (err) { console.error('[crm jobs] leadOutcomeSweep tick failed:', err.message); }
  }, IDLE_TICK_MS);
  setInterval(() => {
    inforuPullTick(db).catch(err => console.error('[crm jobs] inforuPull tick failed:', err.message));
  }, INFORU_PULL_TICK_MS);
  setInterval(() => {
    inforuChatSyncTick(db).catch(err => console.error('[crm jobs] inforuChatSync tick failed:', err.message));
  }, INFORU_CHAT_SYNC_MS);
  console.log('[crm jobs] started (monday poller/pusher 60s, wa queue drainer 5s, idle sweeper 60s, inforu pull 10s)');
}

// Pulls inbound WhatsApp messages from InforU. THIS READ IS DESTRUCTIVE — a
// pulled message is gone from InforU's queue forever, so:
//  - the raw response is persisted to inforu_pull_log BEFORE any parsing, so
//    a bug in normalizePullItem can never lose a customer's message;
//  - each item is handled in its own try/catch, so one malformed item can't
//    drop the other 499 in the same batch;
//  - triple-gated (inforu_pull_enabled + active provider is inforu +
//    configured) so a dev machine can never silently steal messages meant
//    for production — see the column's comment in server.js.
async function inforuPullTick(db) {
  if (inforuPulling) return;
  const s = crmSettingsRow(db);
  if (!s.inforu_pull_enabled) return;
  const provider = getActiveWhatsApp(db);
  if (provider.name !== 'inforu' || !provider.isConfigured(db)) return;

  inforuPulling = true;
  let totalPulled = 0;
  try {
    const BATCH_SIZE = 500;
    // Loop until the queue is drained or we hit a safety cap — 5 * 500 = 2500
    // messages/tick, and 5 requests comfortably fits InforU's rate limit.
    for (let i = 0; i < 5; i++) {
      const data = await inforuClient.pullData(db, { type: 'IncomingMessagesWhatsapp', batchSize: BATCH_SIZE });
      const list = (data && data.List) || [];
      db.prepare(`INSERT INTO inforu_pull_log (pull_type, raw_json, item_count) VALUES (?, ?, ?)`)
        .run('IncomingMessagesWhatsapp', JSON.stringify(data), list.length);
      if (!list.length) break;

      for (const item of list) {
        try {
          const event = provider.normalizePullItem(item);
          if (!event) {
            console.error('[crm jobs] inforuPull: could not normalize item (bad phone?) — raw kept in inforu_pull_log:', JSON.stringify(item).slice(0, 200));
            continue;
          }
          const result = handleInboundEvent(db, 'inforu', event);
          if (result) publish('message.received', result);
        } catch (err) {
          console.error('[crm jobs] inforuPull: item failed, continuing with the rest of the batch:', err.message);
        }
      }
      totalPulled += list.length;
      if (data.Count < BATCH_SIZE) break;
    }
    // Reached only when every request in the loop came back clean, so this is
    // the one place that can honestly clear a previous error.
    recordPullOutcome(db, { error: null, count: totalPulled });
  } catch (err) {
    // Re-thrown for the caller's console log, but persisted FIRST — this is
    // the InforU StatusDescription ("permission not enabled", bad credentials,
    // a rejected account) that the admin screen needs and that used to exist
    // only in a terminal nobody reads.
    recordPullOutcome(db, { error: err.message, count: totalPulled });
    throw err;
  } finally {
    inforuPulling = false;
  }
}

// Never let bookkeeping take the poller down: a failure to write the status is
// strictly less important than the pull itself continuing to run.
function recordPullOutcome(db, { error, count }) {
  try {
    db.prepare(
      `UPDATE crm_settings
          SET inforu_last_pull_at = CURRENT_TIMESTAMP,
              inforu_last_pull_error = ?,
              inforu_last_pull_count = ?
        WHERE id = 1`
    ).run(error ? String(error).slice(0, 500) : null, count);
  } catch (err) {
    console.error('[crm jobs] inforuPull: could not record pull status:', err.message);
  }
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
    if (payload.kind === 'media') {
      result = await provider.sendMedia(db, { toE164: row.to_e164, url: payload.url, filename: payload.filename, caption: payload.caption, messageId: row.message_id });
    } else if (payload.kind === 'drive') {
      // Download server-side, then upload straight to WhatsApp — the
      // customer gets a real file, we never expose a public URL for it.
      const file = await downloadFile(db, payload.driveFileId);
      result = await provider.sendMediaUpload(db, {
        toE164: row.to_e164, fileBuffer: file.buffer, mimeType: file.mimeType,
        filename: payload.filename || file.filename, caption: payload.caption, messageId: row.message_id,
        // InforU can't take bytes — it fetches a URL itself — so it needs the
        // Drive id to build the link-shared file's public URL. GreenAPI ignores
        // this and uploads the buffer as before.
        driveFileId: payload.driveFileId,
      });
      if (result.ok && result.urlFile && row.message_id) {
        // Internal only — the URL never reaches the customer, it just lets
        // our own timeline show what was sent (GreenAPI's CDN, ~15 days).
        db.prepare(`UPDATE crm_messages SET media_url = ?, media_filename = ? WHERE id = ?`)
          .run(result.urlFile, payload.filename || file.filename, row.message_id);
      }
    } else if (payload.kind === 'template') {
      // Approved templates are the only send InforU allows outside the 24h
      // window — see sessionWindow.js. Not every provider supports them
      // (GreenAPI never will: it has no concept of a Meta-approved template),
      // so this guards the same way outbox.enqueue's session gate does.
      if (!provider.capabilities(db).supportsTemplates || typeof provider.sendTemplate !== 'function') {
        result = { ok: false, error: `ספק ${provider.name} אינו תומך בתבניות מאושרות`, retryable: false };
      } else {
        result = await provider.sendTemplate(db, {
          toE164: row.to_e164, templateId: payload.templateId, parameters: payload.parameters,
          mediaUrl: payload.mediaUrl, messageId: row.message_id,
        });
      }
    } else {
      result = await provider.sendText(db, { toE164: row.to_e164, body: payload.body, messageId: row.message_id });
    }
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

// Marks a lead 'won' + stamps closed_at once its quote has a Morning ORDER
// document (הזמנת עבודה) — the same signal QuotesAnalytics treats as "closed",
// so campaign profitability and the quotes reports can never disagree.
//
// leadContext.js already does this, but only lazily when someone opens the
// lead's workspace. Campaign analytics has to be right whether or not anyone
// clicked into a lead, hence this sweep. Both write the same COALESCE'd
// closed_at, so whichever runs first wins and the other is a no-op.
function leadOutcomeSweepTick(db) {
  const rows = db.prepare(`
    SELECT l.id, l.customer_id
    FROM crm_leads l
    JOIN morning_documents_map m ON m.quote_id = l.quote_id
    WHERE l.quote_id IS NOT NULL
      AND l.closed_at IS NULL
      AND l.status NOT IN (${CLOSED_SQL})
      AND m.morning_document_type = ?
    GROUP BY l.id
  `).all(DOCUMENT_TYPE.order);
  for (const r of rows) {
    db.prepare(`UPDATE crm_leads SET status = 'won', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(r.id);
    db.prepare(`INSERT INTO crm_activity_log (customer_id, lead_id, type, summary, actor) VALUES (?, ?, 'status_change', 'עודכן אוטומטית ל-"זכינו" — זוהתה הזמנת עבודה', 'system')`)
      .run(r.customer_id, r.id);
  }
  if (rows.length) console.log(`[crm jobs] lead outcome sweep: marked ${rows.length} lead(s) as won`);
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
  // Gated on the SAME setting as the poller. The admin toggle is labelled
  // "סנכרון אוטומטי" and states that turning it off still allows pulling and
  // pushing manually — but only the poller ever honoured it, so the pusher
  // kept writing to monday every tick with the switch off. That is dangerous
  // while an admin is editing the status mapping: pushing is one-to-one, so
  // it rewrites every item whose lead status is mapped, collapsing distinct
  // board labels onto the canonical one. Turning the switch off must actually
  // stop automatic writes to someone else's board.
  const settings = db.prepare(`SELECT monday_poll_enabled FROM crm_settings WHERE id = 1`).get();
  if (!settings || !settings.monday_poll_enabled) return;

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

// Drains the queue NOW instead of waiting up to QUEUE_TICK_MS for the timer.
// A 1:1 reply is a person watching the screen: five seconds of nothing after
// pressing send reads as broken, and it let the customer get two messages in
// before ours left. The tick stays as the safety net for retries and bulk.
//
// Only ever drains priority <= 10 (1:1 traffic). Bulk keeps its pacing —
// firing a campaign the instant it's queued is exactly what the jitter and the
// daily cap exist to prevent.
//
// Deliberately fire-and-forget: the HTTP request that enqueued the message has
// already returned 200, and the row is durable in wa_send_queue either way, so
// a failure here is picked up by the next tick rather than surfaced twice.
function drainNow(db) {
  setImmediate(() => {
    waQueueDrainerTick(db).catch(err => console.error('[crm jobs] drainNow failed:', err.message));
  });
}

module.exports = { startCrmJobs, drainNow };
