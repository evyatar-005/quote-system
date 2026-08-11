// CRM Phase 3 — shared WhatsApp inbox: conversation list/detail, claim/
// heartbeat/release locking, sending replies (via the outbox), and the SSE
// live-update stream. Locking is DB-authoritative (see crm_conversation_locks
// PRIMARY KEY on conversation_id) — SSE only makes the UI feel live.
//
// deps: { requireAuth, requireAdmin }

const { enqueueText } = require('../services/channels/whatsapp/outbox');
const { fromChatId } = require('../services/crm/phone');
const { publish, subscribe } = require('../services/crm/realtime');

module.exports = function registerInbox(app, db, deps) {
  const { requireAuth, requireAdmin } = deps;

  function lockTtlSec() {
    const s = db.prepare(`SELECT lock_ttl_sec FROM crm_settings WHERE id = 1`).get();
    return (s && s.lock_ttl_sec) || 120;
  }

  function conversationWithLock(id) {
    return db.prepare(
      `SELECT c.*, cu.display_name AS customer_name, cu.phone_e164 AS customer_phone,
              l.username AS lock_username, l.expires_at AS lock_expires_at
       FROM crm_conversations c
       LEFT JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN crm_conversation_locks l ON l.conversation_id = c.id AND l.expires_at > CURRENT_TIMESTAMP
       WHERE c.id = ?`
    ).get(id);
  }

  // ── List / detail ──────────────────────────────────────────────────────
  app.get('/api/inbox/conversations', requireAuth, (req, res) => {
    const { status, channel, include_broadcast } = req.query;
    const where = [];
    const params = [];
    // Conversations created purely by a דיוור (bulk broadcast) are hidden
    // from the default list until the customer replies — otherwise one
    // 200-recipient blast buries every real conversation. The campaign
    // detail screen passes ?include_broadcast=1 to see them anyway.
    if (!include_broadcast) where.push('c.is_broadcast_only = 0');
    if (status) { where.push('c.status = ?'); params.push(status); }
    if (channel) { where.push('c.channel = ?'); params.push(channel); }
    let sql = `
      SELECT c.*, cu.display_name AS customer_name, cu.phone_e164 AS customer_phone,
             l.username AS lock_username, l.expires_at AS lock_expires_at
      FROM crm_conversations c
      LEFT JOIN customers cu ON cu.id = c.customer_id
      LEFT JOIN crm_conversation_locks l ON l.conversation_id = c.id AND l.expires_at > CURRENT_TIMESTAMP`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC LIMIT 200`;
    res.json(db.prepare(sql).all(...params));
  });

  app.get('/api/inbox/conversations/:id/messages', requireAuth, (req, res) => {
    const conversation = conversationWithLock(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'שיחה לא נמצאה' });
    const messages = db.prepare(`SELECT * FROM crm_messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 500`).all(conversation.id);
    res.json({ conversation, messages });
  });

  app.put('/api/inbox/conversations/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare(`SELECT * FROM crm_conversations WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'שיחה לא נמצאה' });
    const body = req.body || {};
    const row = { id };
    const setCols = [];
    if ('status' in body) {
      row.status = body.status; setCols.push('status');
      if (body.status === 'closed') { row.closed_at = new Date().toISOString(); row.closed_by = req.user.username; setCols.push('closed_at', 'closed_by'); }
    }
    if ('assigned_to' in body) { row.assigned_to = body.assigned_to; setCols.push('assigned_to'); }
    if ('unread_count' in body) { row.unread_count = body.unread_count; setCols.push('unread_count'); }
    if (setCols.length) {
      db.prepare(`UPDATE crm_conversations SET ${setCols.map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`).run(row);
    }
    publish('conversation.updated', { id });
    res.json(conversationWithLock(id));
  });

  // ── Locking (claim/heartbeat/release/force-claim) ─────────────────────────
  app.post('/api/inbox/conversations/:id/claim', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const conversation = db.prepare(`SELECT * FROM crm_conversations WHERE id = ?`).get(id);
    if (!conversation) return res.status(404).json({ error: 'שיחה לא נמצאה' });

    const expiresAt = new Date(Date.now() + lockTtlSec() * 1000).toISOString();
    // Only inserts/updates when no lock exists or the existing one expired —
    // the WHERE on DO UPDATE makes this a true "claim if free" upsert.
    const { changes } = db.prepare(
      `INSERT INTO crm_conversation_locks (conversation_id, username, acquired_at, heartbeat_at, expires_at)
       VALUES (@id, @username, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, @expires_at)
       ON CONFLICT(conversation_id) DO UPDATE SET
         username = excluded.username, acquired_at = CURRENT_TIMESTAMP,
         heartbeat_at = CURRENT_TIMESTAMP, expires_at = excluded.expires_at
       WHERE crm_conversation_locks.expires_at < CURRENT_TIMESTAMP OR crm_conversation_locks.username = @username`
    ).run({ id, username: req.user.username, expires_at: expiresAt });

    const lock = db.prepare(`SELECT * FROM crm_conversation_locks WHERE conversation_id = ?`).get(id);
    if (lock.username !== req.user.username) {
      return res.status(409).json({ error: 'השיחה כבר בטיפול', locked_by: lock.username, expires_at: lock.expires_at });
    }
    if (changes) {
      db.prepare(`INSERT INTO crm_conversation_handling (conversation_id, username, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)`)
        .run(id, req.user.username);
    }
    publish('lock.claimed', { conversationId: id, username: req.user.username });
    res.json({ ok: true, expires_at: lock.expires_at });
  });

  app.post('/api/inbox/conversations/:id/heartbeat', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lock = db.prepare(`SELECT * FROM crm_conversation_locks WHERE conversation_id = ?`).get(id);
    if (!lock || lock.username !== req.user.username) return res.status(409).json({ error: 'אין ברשותך נעילה על שיחה זו' });
    const expiresAt = new Date(Date.now() + lockTtlSec() * 1000).toISOString();
    db.prepare(`UPDATE crm_conversation_locks SET heartbeat_at = CURRENT_TIMESTAMP, expires_at = ? WHERE conversation_id = ?`).run(expiresAt, id);
    res.json({ ok: true, expires_at: expiresAt });
  });

  function releaseLock(id, username, reason) {
    const lock = db.prepare(`SELECT * FROM crm_conversation_locks WHERE conversation_id = ?`).get(id);
    if (!lock) return;
    db.prepare(`DELETE FROM crm_conversation_locks WHERE conversation_id = ?`).run(id);
    db.prepare(
      `UPDATE crm_conversation_handling SET ended_at = CURRENT_TIMESTAMP, end_reason = ?,
         duration_sec = CAST((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400 AS INTEGER)
       WHERE conversation_id = ? AND username = ? AND ended_at IS NULL`
    ).run(reason, id, lock.username);
    publish('lock.released', { conversationId: id, reason });
  }

  app.post('/api/inbox/conversations/:id/release', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lock = db.prepare(`SELECT * FROM crm_conversation_locks WHERE conversation_id = ?`).get(id);
    if (lock && lock.username !== req.user.username) return res.status(409).json({ error: 'הנעילה שייכת לסוכן אחר' });
    releaseLock(id, req.user.username, 'released');
    res.json({ ok: true });
  });

  app.post('/api/inbox/conversations/:id/force-claim', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    releaseLock(id, req.user.username, 'stolen');
    const expiresAt = new Date(Date.now() + lockTtlSec() * 1000).toISOString();
    db.prepare(
      `INSERT INTO crm_conversation_locks (conversation_id, username, expires_at) VALUES (?, ?, ?)`
    ).run(id, req.user.username, expiresAt);
    db.prepare(`INSERT INTO crm_conversation_handling (conversation_id, username, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)`)
      .run(id, req.user.username);
    publish('lock.claimed', { conversationId: id, username: req.user.username });
    res.json({ ok: true, expires_at: expiresAt });
  });

  // ── Send a reply ───────────────────────────────────────────────────────
  app.post('/api/inbox/conversations/:id/messages', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const conversation = db.prepare(`SELECT * FROM crm_conversations WHERE id = ?`).get(id);
    if (!conversation) return res.status(404).json({ error: 'שיחה לא נמצאה' });
    const lock = db.prepare(`SELECT * FROM crm_conversation_locks WHERE conversation_id = ? AND expires_at > CURRENT_TIMESTAMP`).get(id);
    if (!lock || lock.username !== req.user.username) {
      return res.status(409).json({ error: 'יש לנעול את השיחה לפני מענה' });
    }
    const customer = conversation.customer_id ? db.prepare(`SELECT phone_e164 FROM customers WHERE id = ?`).get(conversation.customer_id) : null;
    const toE164 = customer?.phone_e164 || fromChatId(conversation.channel_thread_id);
    try {
      const messageId = enqueueText(db, { conversationId: id, toE164, body: req.body?.body, sentBy: req.user.username, priority: 10 });
      publish('message.created', { conversationId: id, messageId });
      res.status(201).json(db.prepare(`SELECT * FROM crm_messages WHERE id = ?`).get(messageId));
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  // ── SSE stream ─────────────────────────────────────────────────────────
  app.get('/api/inbox/stream', (req, res) => {
    // EventSource can't set an Authorization header — accept the token via
    // query string on this one route only (same trust boundary as a bearer
    // token, just a different transport for it).
    const token = req.query.token;
    if (!token) return res.status(401).end();
    const session = db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token);
    if (!session) return res.status(401).end();
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(session.user_id);
    if (!user) return res.status(401).end();
    subscribe(res, { username: user.username });
  });
};
