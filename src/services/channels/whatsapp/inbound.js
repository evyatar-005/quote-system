// Turns a NormalizedInbound event (from a provider's normalizeInboundWebhook)
// into DB writes: find-or-create the customer + conversation, insert the
// message, bump conversation timestamps/unread. One function handles both
// 'message' and 'status' kinds since both arrive on the same webhook route.

function findOrCreateConversation(db, { customerId, provider, chatId, senderName }) {
  const existing = db.prepare(`SELECT * FROM crm_conversations WHERE channel = 'whatsapp' AND channel_thread_id = ?`).get(chatId);
  if (existing) return existing;
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO crm_conversations (customer_id, channel, provider, channel_thread_id, subject)
     VALUES (?, 'whatsapp', ?, ?, ?)`
  ).run(customerId, provider, chatId, senderName || null);
  return db.prepare(`SELECT * FROM crm_conversations WHERE id = ?`).get(lastInsertRowid);
}

function findOrCreateCustomerByPhone(db, phoneE164, senderName) {
  if (!phoneE164) return null;
  const existing = db.prepare(`SELECT * FROM customers WHERE phone_e164 = ? AND merged_into_id IS NULL`).get(phoneE164);
  if (existing) return existing.id;
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO customers (display_name, phone_e164, phone_raw, source) VALUES (?, ?, ?, 'whatsapp_inbound')`
  ).run(senderName || phoneE164, phoneE164, phoneE164);
  return lastInsertRowid;
}

// Returns { conversationId, messageId } | null (status updates return null —
// nothing new was created, an existing message's status was just updated).
function handleInboundEvent(db, providerName, event) {
  if (event.kind === 'status') {
    if (!event.providerMessageId) return null;
    db.prepare(
      `UPDATE crm_messages SET status = ? WHERE provider = ? AND provider_message_id = ?`
    ).run(event.status || 'sent', providerName, event.providerMessageId);
    return null;
  }
  if (event.kind !== 'message' || !event.chatId) return null;

  const customerId = findOrCreateCustomerByPhone(db, event.fromE164, event.senderName);
  const conversation = findOrCreateConversation(db, { customerId, provider: providerName, chatId: event.chatId, senderName: event.senderName });

  // A conversation created before this customer existed (shouldn't happen
  // via this path, but defensive) gets backfilled once we know the customer.
  if (customerId && !conversation.customer_id) {
    db.prepare(`UPDATE crm_conversations SET customer_id = ? WHERE id = ?`).run(customerId, conversation.id);
  }

  const { lastInsertRowid: messageId } = db.prepare(
    `INSERT INTO crm_messages (conversation_id, direction, body, media_url, media_mime, media_filename, message_type, provider, provider_message_id, status, raw_json)
     VALUES (@conversation_id, 'in', @body, @media_url, @media_mime, @media_filename, @message_type, @provider, @provider_message_id, 'received', @raw_json)`
  ).run({
    conversation_id: conversation.id,
    body: event.body || null,
    media_url: event.media?.url || null,
    media_mime: event.media?.mime || null,
    media_filename: event.media?.filename || null,
    message_type: event.messageType || 'text',
    provider: providerName,
    provider_message_id: event.providerMessageId || null,
    raw_json: JSON.stringify(event.raw || {}),
  });

  // first_response_ms: only ever set once, the first time an inbound message
  // arrives on a conversation that has never had one before (i.e. this is
  // literally the opening message) — later inbound messages don't touch it.
  db.prepare(
    `UPDATE crm_conversations SET
       last_message_at = CURRENT_TIMESTAMP,
       last_inbound_at = CURRENT_TIMESTAMP,
       unread_count = unread_count + 1,
       status = CASE WHEN status = 'closed' THEN 'open' ELSE status END
     WHERE id = ?`
  ).run(conversation.id);

  return { conversationId: conversation.id, messageId };
}

module.exports = { handleInboundEvent };
