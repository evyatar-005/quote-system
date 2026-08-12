// The ONLY entry point for sending a WhatsApp message. Writes a crm_messages
// row (status 'queued') + a wa_send_queue row; the queue drainer (jobs.js)
// is the sole caller of a provider's send*. This indirection is what makes
// the provider swappable and lets 1:1 replies and bulk broadcasts (Phase 4)
// share one rate-limited pipe.

const { toE164, toChatId } = require('../../crm/phone');

// Suppression is consulted ONLY for marketing sends (campaignId present or
// marketing:true). A customer who opted out of the דיוור list must still be
// answerable 1:1 by an agent — opt-out means "don't market to me", not
// "don't talk to me". Gating this unconditionally would silently break
// POST /api/inbox/conversations/:id/messages.
function suppressionReason(db, { phoneE164, customerId }) {
  const opted = db.prepare(
    `SELECT id FROM crm_opt_outs WHERE phone_e164 = ? AND revoked_at IS NULL LIMIT 1`
  ).get(phoneE164);
  if (opted) return 'opted_out';
  const customer = customerId
    ? db.prepare(`SELECT marketing_consent, status FROM customers WHERE id = ?`).get(customerId)
    : db.prepare(`SELECT marketing_consent, status FROM customers WHERE phone_e164 = ? AND merged_into_id IS NULL`).get(phoneE164);
  if (!customer) return 'no_customer';
  if (customer.status === 'blocked') return 'blocked';
  if (!customer.marketing_consent) return 'no_consent';
  return null;
}

// Find-or-create the conversation for a send. `broadcastOnly` (is_broadcast_only)
// is only applied when we CREATE it — an existing conversation is real and
// must stay visible in the shared inbox regardless of what sent this message.
function resolveConversation(db, { customerId, phoneE164, provider, campaignId, broadcastOnly }) {
  const chatId = toChatId(phoneE164);
  const existing = db.prepare(
    `SELECT id FROM crm_conversations WHERE channel = 'whatsapp' AND channel_thread_id = ?`
  ).get(chatId);
  if (existing) return existing.id;
  const name = customerId
    ? db.prepare(`SELECT display_name FROM customers WHERE id = ?`).get(customerId)?.display_name
    : null;
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO crm_conversations (customer_id, channel, provider, channel_thread_id, subject, is_broadcast_only, source_campaign_id)
     VALUES (?, 'whatsapp', ?, ?, ?, ?, ?)`
  ).run(customerId || null, provider || 'greenapi', chatId, name || null, broadcastOnly ? 1 : 0, campaignId || null);
  return lastInsertRowid;
}

// The ONE enqueue path. Returns { messageId, conversationId, queueId } on
// success, or { skipped: true, reason } — never throws for a suppression, so
// a 200-recipient build can report a per-recipient reason instead of aborting
// on the first opted-out number.
//
// opts: { conversationId?, customerId?, toE164|toPhone, kind='text', body,
//         mediaUrl?, mediaFilename?, driveFileId?, sentBy?, priority=10,
//         campaignId?, recipientId?, marketing=false, provider? }
//
// kind='drive' is the Google-Drive materials sender (CRM plan Phase 5 §8):
// media_url is deliberately left NULL — we have no URL, the drainer downloads
// driveFileId itself and uploads straight to WhatsApp (sendMediaUpload).
function enqueue(db, opts) {
  const {
    conversationId: convIn, customerId, toE164: toRaw, toPhone,
    kind = 'text', body, mediaUrl, mediaFilename, driveFileId,
    sentBy, priority = 10, campaignId = null, recipientId = null,
    marketing = false, provider = null,
  } = opts;

  const to = toRaw || toE164(toPhone);
  if (!to) return { skipped: true, reason: 'no_phone' };
  if (kind !== 'media' && kind !== 'drive' && !(body || '').toString().trim()) {
    throw Object.assign(new Error('body required'), { status: 400 });
  }
  if (kind === 'media' && !mediaUrl) {
    throw Object.assign(new Error('mediaUrl required for kind=media'), { status: 400 });
  }
  if (kind === 'drive' && !driveFileId) {
    throw Object.assign(new Error('driveFileId required for kind=drive'), { status: 400 });
  }

  if (marketing || campaignId) {
    const reason = suppressionReason(db, { phoneE164: to, customerId });
    if (reason) return { skipped: true, reason };
  }

  const tx = db.transaction(() => {
    const conversationId = convIn || resolveConversation(db, {
      customerId, phoneE164: to, provider, campaignId, broadcastOnly: !!campaignId,
    });

    const { lastInsertRowid: messageId } = db.prepare(
      `INSERT INTO crm_messages (conversation_id, direction, body, media_url, media_filename, message_type, status, sent_by, campaign_id)
       VALUES (?, 'out', ?, ?, ?, ?, 'queued', ?, ?)`
    ).run(conversationId, body || null, kind === 'drive' ? null : (mediaUrl || null), mediaFilename || null,
      (kind === 'media' || kind === 'drive') ? 'document' : 'text', sentBy || null, campaignId);

    const payload = kind === 'media'
      ? { kind: 'media', url: mediaUrl, filename: mediaFilename, caption: body }
      : kind === 'drive'
      ? { kind: 'drive', driveFileId, filename: mediaFilename, caption: body }
      : { kind: 'text', body };

    const { lastInsertRowid: queueId } = db.prepare(
      `INSERT INTO wa_send_queue (provider, channel, to_e164, conversation_id, message_id, campaign_id, recipient_id, payload_json, priority)
       VALUES (?, 'whatsapp', ?, ?, ?, ?, ?, ?, ?)`
    ).run(provider, to, conversationId, messageId, campaignId, recipientId, JSON.stringify(payload), priority);

    db.prepare(`UPDATE crm_conversations SET last_message_at = CURRENT_TIMESTAMP, last_outbound_at = CURRENT_TIMESTAMP WHERE id = ?`).run(conversationId);
    return { messageId, conversationId, queueId };
  });
  return tx();
}

// Back-compat wrapper — routes/inbox.js and any other 1:1 caller are
// untouched: same signature, same bare-messageId return, throws on failure
// instead of returning {skipped}.
function enqueueText(db, { conversationId, toE164: toRaw, toPhone, body, sentBy, priority = 10 }) {
  const r = enqueue(db, { conversationId, toE164: toRaw, toPhone, body, sentBy, priority, kind: 'text' });
  if (r.skipped) throw Object.assign(new Error(`send skipped: ${r.reason}`), { status: 400 });
  return r.messageId;
}

module.exports = { enqueue, enqueueText, suppressionReason };
