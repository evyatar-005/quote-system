// In-app notifications for sales agents (bell icon) + the manager's
// approve/reject "decision" action on a quote, which is what creates them.
//
// deps: { requireAuth, requireAdmin }

module.exports = function registerNotifications(app, db, deps) {
  const { requireAuth, requireAdmin } = deps;

  const insertNotif = db.prepare(
    `INSERT INTO notifications (recipient_username, quote_id, quote_number, type, message) VALUES (?, ?, ?, ?, ?)`
  );
  const listForUser = db.prepare(
    `SELECT * FROM notifications WHERE recipient_username = ? ORDER BY id DESC LIMIT 50`
  );
  const markRead = db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_username = ?`);
  const markAllRead = db.prepare(`UPDATE notifications SET is_read = 1 WHERE recipient_username = ?`);
  const deleteOne = db.prepare(`DELETE FROM notifications WHERE id = ? AND recipient_username = ?`);
  const deleteAll = db.prepare(`DELETE FROM notifications WHERE recipient_username = ?`);
  const quoteById = db.prepare(`SELECT * FROM signshop_quotes WHERE id = ?`);

  // ── GET /api/notifications — mine, newest first ──────────────────────────
  app.get('/api/notifications', requireAuth, (req, res) => {
    const rows = listForUser.all(req.user.username);
    res.json({ notifications: rows });
  });

  // ── PUT /api/notifications/:id/read ───────────────────────────────────────
  app.put('/api/notifications/:id/read', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id must be integer' });
    markRead.run(id, req.user.username);
    res.json({ ok: true });
  });

  // ── PUT /api/notifications/read-all ───────────────────────────────────────
  app.put('/api/notifications/read-all', requireAuth, (req, res) => {
    markAllRead.run(req.user.username);
    res.json({ ok: true });
  });

  // ── DELETE /api/notifications/:id ─────────────────────────────────────────
  app.delete('/api/notifications/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id must be integer' });
    deleteOne.run(id, req.user.username);
    res.json({ ok: true });
  });

  // ── DELETE /api/notifications — clear all of mine ─────────────────────────
  app.delete('/api/notifications', requireAuth, (req, res) => {
    deleteAll.run(req.user.username);
    res.json({ ok: true });
  });

  // ── POST /api/quotes/:id/decision — admin approves or rejects a quote ─────
  // Quick-action version (no edits): sets status + notifies the original agent.
  // The "edit then save as a revised quote" flow (QuoteDetailsModal) counts as
  // the same "approved" decision and calls this too, from the client.
  app.post('/api/quotes/:id/decision', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id must be integer' });
    const { decision, quoteNumber } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' });

    const quote = quoteById.get(id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    db.prepare(`UPDATE signshop_quotes SET status = ? WHERE id = ?`).run(decision, id);

    if (quote.created_by) {
      const message = decision === 'approved'
        ? `הצעה ${quoteNumber || quote.quote_number} אושרה ע״י מנהל המכירות ומוכנה להנפקה ללקוח.`
        : `הצעה ${quoteNumber || quote.quote_number} נדחתה ע״י מנהל המכירות.`;
      insertNotif.run(quote.created_by, id, quoteNumber || quote.quote_number, decision, message);
    }

    console.log(`[POST /api/quotes/${id}/decision] "${decision}" → notified "${quote.created_by || '—'}"`);
    res.json({ ok: true, status: decision });
  });

  return { insertNotif };
};
