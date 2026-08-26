// CRM Phase 2 — monday.com two-way sync: board-map CRUD, column discovery,
// manual sync triggers, and the inbound webhook. All admin-only except the
// webhook, which monday.com itself calls (no session).
//
// deps: { requireAdmin }

const { fetchBoardColumns, pullBoard, pushBoard, logSync } = require('../services/crm/mondaySync');
const mondayBackfill = require('../services/crm/mondayBackfill');
const leadReset = require('../services/crm/leadReset');
const path = require('path');

module.exports = function registerMondaySync(app, db, deps) {
  const { requireAdmin } = deps;

  app.get('/api/monday-sync/boards', requireAdmin, (req, res) => {
    res.json(db.prepare(`SELECT * FROM monday_board_map ORDER BY created_at DESC`).all());
  });

  // Real column ids/types for the mapping UI — never guessed.
  app.get('/api/monday-sync/boards/:boardId/columns', requireAdmin, async (req, res) => {
    try {
      res.json(await fetchBoardColumns(db, req.params.boardId));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/monday-sync/boards', requireAdmin, (req, res) => {
    const body = req.body || {};
    if (!body.board_id) return res.status(400).json({ error: 'board_id required' });
    const row = {
      board_id: body.board_id,
      board_name: body.board_name || null,
      campaign_id: body.campaign_id || null,
      column_map: JSON.stringify(body.column_map || {}),
      status_column_id: body.status_column_id || null,
      status_values: JSON.stringify(body.status_values || {}),
      pull_enabled: body.pull_enabled === false ? 0 : 1,
      push_enabled: body.push_enabled === false ? 0 : 1,
      poll_minutes: body.poll_minutes || 10,
    };
    try {
      const { lastInsertRowid } = db.prepare(
        `INSERT INTO monday_board_map (board_id, board_name, campaign_id, column_map, status_column_id, status_values, pull_enabled, push_enabled, poll_minutes)
         VALUES (@board_id, @board_name, @campaign_id, @column_map, @status_column_id, @status_values, @pull_enabled, @push_enabled, @poll_minutes)`
      ).run(row);
      res.status(201).json(db.prepare(`SELECT * FROM monday_board_map WHERE id = ?`).get(lastInsertRowid));
    } catch (err) {
      res.status(400).json({ error: err.message.includes('UNIQUE') ? 'הבורד הזה כבר ממופה' : err.message });
    }
  });

  app.put('/api/monday-sync/boards/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare(`SELECT * FROM monday_board_map WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'לא נמצא' });
    const body = req.body || {};
    const row = { id };
    const setCols = [];
    for (const [field, key] of [
      ['board_name', 'board_name'], ['campaign_id', 'campaign_id'],
      ['status_column_id', 'status_column_id'], ['pull_enabled', 'pull_enabled'],
      ['push_enabled', 'push_enabled'], ['poll_minutes', 'poll_minutes'],
    ]) {
      if (field in body) { row[key] = body[field]; setCols.push(key); }
    }
    if ('column_map' in body) { row.column_map = JSON.stringify(body.column_map || {}); setCols.push('column_map'); }
    if ('status_values' in body) { row.status_values = JSON.stringify(body.status_values || {}); setCols.push('status_values'); }
    if (setCols.length) {
      db.prepare(`UPDATE monday_board_map SET ${setCols.map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`).run(row);
    }
    res.json(db.prepare(`SELECT * FROM monday_board_map WHERE id = ?`).get(id));
  });

  // ── Retroactive status completion ────────────────────────────────────────
  // Leads pulled from boards that are no longer mapped can never be updated by
  // a sync — there is nothing left to sync against. Their monday snapshots
  // survive in monday_item_map though, so their real status is already in our
  // own DB, just never interpreted. Preview and apply are separate endpoints
  // on purpose: this touches thousands of rows and must be seen before it runs.
  app.get('/api/monday-sync/backfill/preview', requireAdmin, (req, res) => {
    res.json(mondayBackfill.analyze(db));
  });

  app.post('/api/monday-sync/backfill', requireAdmin, (req, res) => {
    const result = mondayBackfill.apply(db);
    console.log(`[POST /api/monday-sync/backfill] ${result.updated} lead(s) updated by ${req.user.username}`);
    res.json(result);
  });

  // ── "Start the CRM from today" ────────────────────────────────────────────
  // Deletes monday history whose board is no longer connected. Preview and
  // apply are separate, and apply writes a full JSON backup of every deleted
  // row before touching anything — foreign keys are on, so the delete itself
  // is clean, but nothing in SQLite brings the rows back.
  app.get('/api/crm/lead-reset/preview', requireAdmin, (req, res) => {
    res.json(leadReset.preview(db));
  });

  app.post('/api/crm/lead-reset', requireAdmin, (req, res) => {
    // A destructive bulk action must not be reachable by a stray click or a
    // replayed request: the caller has to echo back the exact number the
    // preview showed, so an out-of-date screen can never authorise a delete.
    const expected = leadReset.preview(db).doomed;
    const confirmed = parseInt(req.body && req.body.confirm_count, 10);
    if (confirmed !== expected) {
      return res.status(409).json({
        error: `המספר שאושר (${confirmed || 0}) אינו תואם למצב הנוכחי (${expected}). רענן את התצוגה המקדימה ונסה שוב.`,
        expected,
      });
    }
    try {
      const result = leadReset.apply(db, { backupDir: path.join(__dirname, '../../backups') });
      console.log(`[POST /api/crm/lead-reset] ${result.deleted} lead(s) deleted by ${req.user.username}`);
      res.json(result);
    } catch (err) {
      console.error('[POST /api/crm/lead-reset] failed:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/monday-sync/boards/:id', requireAdmin, (req, res) => {
    db.prepare(`DELETE FROM monday_board_map WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  });

  // Manual "sync now" — same logic the poller/pusher jobs run on a timer.
  app.post('/api/monday-sync/boards/:id/pull', requireAdmin, async (req, res) => {
    const boardMap = db.prepare(`SELECT * FROM monday_board_map WHERE id = ?`).get(req.params.id);
    if (!boardMap) return res.status(404).json({ error: 'לא נמצא' });
    try {
      res.json(await pullBoard(db, boardMap, req.user.username));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/monday-sync/boards/:id/push', requireAdmin, async (req, res) => {
    const boardMap = db.prepare(`SELECT * FROM monday_board_map WHERE id = ?`).get(req.params.id);
    if (!boardMap) return res.status(404).json({ error: 'לא נמצא' });
    try {
      res.json(await pushBoard(db, boardMap));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/monday-sync/log', requireAdmin, (req, res) => {
    res.json(db.prepare(`SELECT * FROM monday_sync_log ORDER BY id DESC LIMIT 100`).all());
  });

  // ── Inbound webhook — public, monday.com calls this directly ──────────────
  // Same 200-first-then-work convention as the Morning payment webhook
  // (src/routes/morning.js): respond immediately so monday.com's own retry
  // logic doesn't fire on a slow downstream pull, then process async.
  // monday.com's challenge handshake must be echoed back verbatim on setup.
  // Optional shared secret (monday_credentials.webhook_secret), same
  // "optional, degrade gracefully" convention as morning_credentials.webhook_secret
  // and crm_settings.wa_webhook_secret — unset = unverified but still
  // processed. Checked as ?secret= (monday.com webhooks carry no custom
  // headers), and only AFTER the challenge handshake below: monday.com's own
  // registration call never sends the secret, so gating the challenge on it
  // would make it impossible to (re-)register the webhook.
  app.post('/api/monday-sync/webhooks/items', (req, res) => {
    const body = req.body || {};
    if (body.challenge) return res.json({ challenge: body.challenge });

    const creds = db.prepare(`SELECT webhook_secret FROM monday_credentials WHERE id = 1`).get();
    if (creds && creds.webhook_secret && req.query.secret !== creds.webhook_secret) {
      console.error('[monday webhook] secret verification failed');
      logSync(db, { direction: 'webhook', success: false, error_message: 'secret verification failed', request_json: body });
      return res.status(200).json({ ok: true }); // 200, not 401 — never give an unauthenticated caller a signal to probe against
    }
    res.status(200).json({ ok: true });

    (async () => {
      try {
        const boardId = body.event && String(body.event.boardId);
        if (!boardId) return;
        const boardMap = db.prepare(`SELECT * FROM monday_board_map WHERE board_id = ? AND pull_enabled = 1`).get(boardId);
        if (!boardMap) return;
        await pullBoard(db, boardMap, 'monday-webhook');
      } catch (err) {
        logSync(db, { direction: 'webhook', success: false, error_message: err.message, request_json: body });
      }
    })();
  });
};
