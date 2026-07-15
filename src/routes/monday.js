// monday.com integration — credential config + board/group discovery for the
// admin settings tab. Item-creation ("הפוך להזמנה" writing into the chosen
// board) is NOT built yet — it needs the real column IDs of the specific
// board once real credentials are configured, so we can inspect it instead
// of guessing.
//
// deps: { requireAdmin }
const { request } = require('../services/monday/client');

module.exports = function registerMonday(app, db, deps) {
  const { requireAdmin } = deps;

  const credRow = db.prepare(`SELECT * FROM monday_credentials WHERE id = 1`);

  app.get('/api/monday/config', requireAdmin, (req, res) => {
    const row = credRow.get();
    res.json({
      configured: !!(row && row.api_token),
      api_token_masked: row && row.api_token ? '••••' + row.api_token.slice(-4) : '',
      board_id: (row && row.board_id) || '',
      group_id: (row && row.group_id) || '',
    });
  });

  app.put('/api/monday/config', requireAdmin, (req, res) => {
    const { api_token, board_id, group_id } = req.body || {};
    const existing = credRow.get();
    const tokenToStore = (api_token && api_token.trim())
      ? api_token.trim()
      : (existing ? existing.api_token : null);

    db.prepare(
      `INSERT INTO monday_credentials (id, api_token, board_id, group_id) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET api_token=excluded.api_token, board_id=excluded.board_id,
         group_id=excluded.group_id, updated_at=CURRENT_TIMESTAMP`
    ).run(tokenToStore, board_id || null, group_id || null);

    console.log(`[PUT /api/monday/config] board_id="${board_id || ''}" group_id="${group_id || ''}"`);
    res.json({ ok: true });
  });

  // ── GET /api/monday/boards — for the board-picker dropdown ────────────────
  app.get('/api/monday/boards', requireAdmin, async (req, res) => {
    try {
      const data = await request(db, `query { boards (limit: 100) { id name } }`);
      res.json({ boards: data.boards });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── GET /api/monday/boards/:boardId/groups — for the group-picker dropdown ─
  app.get('/api/monday/boards/:boardId/groups', requireAdmin, async (req, res) => {
    try {
      const data = await request(
        db,
        `query ($boardId: [ID!]) { boards (ids: $boardId) { groups { id title } } }`,
        { boardId: [req.params.boardId] }
      );
      res.json({ groups: (data.boards[0] && data.boards[0].groups) || [] });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};
