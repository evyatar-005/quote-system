// The ONLY entry point for sending a WhatsApp message. Writes a crm_messages
// row (status 'queued') + a wa_send_queue row; the queue drainer (jobs.js)
// is the sole caller of a provider's send*. This indirection is what makes
// the provider swappable and lets 1:1 replies and future bulk campaigns
// share one rate-limited pipe.

const { toE164 } = require('../../crm/phone');

// opts: { conversationId, toE164 (or toPhone), body, sentBy, priority }
function enqueueText(db, { conversationId, toE164: toRaw, toPhone, body, sentBy, priority = 10 }) {
  const to = toRaw || toE164(toPhone);
  if (!to) throw Object.assign(new Error('invalid destination phone'), { status: 400 });
  if (!body || !body.toString().trim()) throw Object.assign(new Error('body required'), { status: 400 });

  const tx = db.transaction(() => {
    const { lastInsertRowid: messageId } = db.prepare(
      `INSERT INTO crm_messages (conversation_id, direction, body, message_type, status, sent_by)
       VALUES (?, 'out', ?, 'text', 'queued', ?)`
    ).run(conversationId, body, sentBy || null);
    db.prepare(
      `INSERT INTO wa_send_queue (channel, to_e164, conversation_id, message_id, payload_json, priority)
       VALUES ('whatsapp', ?, ?, ?, ?, ?)`
    ).run(to, conversationId, messageId, JSON.stringify({ kind: 'text', body }), priority);
    db.prepare(`UPDATE crm_conversations SET last_message_at = CURRENT_TIMESTAMP, last_outbound_at = CURRENT_TIMESTAMP WHERE id = ?`).run(conversationId);
    return messageId;
  });
  return tx();
}

module.exports = { enqueueText };
