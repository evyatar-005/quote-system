// Turns a NormalizedInbound event (from a provider's normalizeInboundWebhook)
// into DB writes: find-or-create the customer + conversation, insert the
// message, bump conversation timestamps/unread, detect opt-out keywords.
// One function handles both 'message' and 'status' kinds since both arrive
// on the same webhook route.

const { enqueue } = require('./outbox');
const { optOutKeywords, normalizeKeyword } = require('../../crm/templates');
const { publish } = require('../../crm/realtime');

function findOrCreateConversation(db, { customerId, provider, chatId, senderName }) {
  const existing = db.prepare(`SELECT * FROM crm_conversations WHERE channel = 'whatsapp' AND channel_thread_id = ?`).get(chatId);
  if (existing) return existing;
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO crm_conversations (customer_id, channel, provider, channel_thread_id, subject)
     VALUES (?, 'whatsapp', ?, ?, ?)`
  ).run(customerId, provider, chatId, senderName || null);
  return db.prepare(`SELECT * FROM crm_conversations WHERE id = ?`).get(lastInsertRowid);
}

// Matching semantics: WHOLE-MESSAGE match after normalization, not substring.
// "הסר" opts out; "אל תסיר את השלט מהקיר" must not. This is a deliberate
// trade-off: a false negative costs one more marketing message; a false
// positive silently removes a paying customer from all future דיוור with no
// trace in the UI.
function detectOptOut(db, body) {
  const text = normalizeKeyword(body);
  if (!text) return null;
  return optOutKeywords(db).find(k => text === k) || null;
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

// Provider status vocabulary → the six values crm_messages.status documents.
// GreenAPI also emits noAccount/notInGroup for a number that can't receive
// the message at all; writing those through verbatim left the UI rendering a
// "still sending" clock forever on a message that will never arrive.
const STATUS_MAP = {
  sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed',
  noAccount: 'failed', notInGroup: 'failed', pending: 'queued',
};

// Receipts can arrive out of order — a delayed 'delivered' must not walk an
// already-'read' message backwards. Higher wins; 'failed' outranks everything
// because a terminal failure has to beat a stale optimistic 'sent'.
const STATUS_RANK = `CASE %s WHEN 'failed' THEN 9 WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'sent' THEN 2 ELSE 1 END`;

// Returns { conversationId, messageId } | null. A status update returns the
// pair too (so the SSE stream can push fresh tick marks instead of the UI
// waiting for its 8s poll) — but only when the write actually changed
// something, so no-op receipts don't spam every connected client.
function handleInboundEvent(db, providerName, event) {
  if (event.kind === 'status') {
    if (!event.providerMessageId) return null;
    const status = STATUS_MAP[event.status] || 'sent';
    const { changes } = db.prepare(
      `UPDATE crm_messages SET status = @status
        WHERE provider = @provider AND provider_message_id = @pmid
          AND ${STATUS_RANK.replace('%s', 'status')} < ${STATUS_RANK.replace('%s', '@status')}`
    ).run({ status, provider: providerName, pmid: event.providerMessageId });
    if (!changes) return null;
    const row = db.prepare(
      `SELECT id, conversation_id FROM crm_messages WHERE provider = ? AND provider_message_id = ?`
    ).get(providerName, event.providerMessageId);
    return row ? { conversationId: row.conversation_id, messageId: row.id } : null;
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
  // A reply to a broadcast-only conversation also turns it into a real one —
  // otherwise it stays hidden from the shared inbox forever (see outbox.js).
  db.prepare(
    `UPDATE crm_conversations SET
       last_message_at = CURRENT_TIMESTAMP,
       last_inbound_at = CURRENT_TIMESTAMP,
       unread_count = unread_count + 1,
       status = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
       is_broadcast_only = 0
     WHERE id = ?`
  ).run(conversation.id);

  // Credit the campaign recipient this is a reply to, if any — most-recent
  // sent/queued row for this phone, so a reply always lands on the campaign
  // that's actually still in flight to them.
  const recipient = db.prepare(
    `SELECT * FROM wa_campaign_recipients WHERE phone_e164 = ? AND status IN ('sent','queued') ORDER BY id DESC LIMIT 1`
  ).get(event.fromE164);
  if (recipient && !recipient.replied_at) {
    db.prepare(`UPDATE wa_campaign_recipients SET status = 'replied', replied_at = CURRENT_TIMESTAMP WHERE id = ?`).run(recipient.id);
    db.prepare(`UPDATE wa_campaigns SET replied_count = replied_count + 1 WHERE id = ?`).run(recipient.campaign_id);
  }

  const keyword = event.body ? detectOptOut(db, event.body) : null;
  if (keyword) {
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO crm_opt_outs (phone_e164, customer_id, source, keyword, message_id, campaign_id)
         VALUES (?, ?, 'keyword', ?, ?, ?)`
      ).run(event.fromE164, customerId || null, keyword, messageId, recipient?.campaign_id || null);
      if (customerId) {
        db.prepare(
          `UPDATE customers SET marketing_consent = 0, consent_source = 'optout',
             consent_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(customerId);
      }
      // Cancel anything already queued for this number — including rows
      // belonging to OTHER running campaigns.
      db.prepare(`UPDATE wa_send_queue SET status = 'cancelled', last_error = 'opted out' WHERE to_e164 = ? AND status = 'pending'`)
        .run(event.fromE164);
      db.prepare(`UPDATE wa_campaign_recipients SET status = 'opted_out' WHERE phone_e164 = ? AND status IN ('pending','queued')`)
        .run(event.fromE164);
      if (recipient) db.prepare(`UPDATE wa_campaigns SET optout_count = optout_count + 1 WHERE id = ?`).run(recipient.campaign_id);
    });
    tx();

    // Confirmation reply at priority 5 — ABOVE 1:1 replies (10) so it never
    // waits behind a queue of paced broadcast rows. marketing:false: this is
    // a service message to someone who just opted out, and must bypass the
    // suppression gate this very block just created.
    const settings = db.prepare(`SELECT optout_reply_text FROM crm_settings WHERE id = 1`).get();
    if (settings?.optout_reply_text) {
      try {
        enqueue(db, {
          conversationId: conversation.id, toE164: event.fromE164,
          body: settings.optout_reply_text, priority: 5, marketing: false,
        });
      } catch (err) { console.error('[optout] confirmation reply failed:', err.message); }
    }
    publish('optout.created', { phone: event.fromE164, customerId });
  }

  return { conversationId: conversation.id, messageId };
}

module.exports = { handleInboundEvent, findOrCreateCustomerByPhone };
