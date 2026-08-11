// CRM Phase 2 — monday.com two-way sync: board-map CRUD, column discovery,
// manual sync triggers, and the inbound webhook. All admin-only except the
// webhook, which monday.com itself calls (no session).
//
// deps: { requireAdmin }

const { fetchBoardColumns, pullBoard, pushBoard, logSync } = require('../services/crm/mondaySync');

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
  app.post('/api/monday-sync/webhooks/items', (req, res) => {
    const body = req.body || {};
    if (body.challenge) return res.json({ challenge: body.challenge });
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
