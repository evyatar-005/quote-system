// Sends a just-created/converted Morning document to the client's WhatsApp,
// automatically, right after sync.js logs the Morning success. Never throws —
// a WhatsApp/GreenAPI failure must never affect the Morning document that
// already exists; it's only logged for support/debugging.
//
// Routed through the CRM channel adapter (services/channels) rather than
// calling GreenAPI directly, so this respects whichever provider is active
// in crm_settings and so the send shows up on the customer's conversation
// timeline in the shared inbox — not just in whatsapp_send_log, which is
// kept purely for backwards-compatible auditing.
const { toE164 } = require('../crm/phone');
const { getActiveWhatsApp } = require('../channels');

function findOrCreateConversationForQuote(db, quote, phoneE164) {
  let customerId = quote.customer_id || null;
  if (!customerId && phoneE164) {
    const customer = db.prepare(`SELECT id FROM customers WHERE phone_e164 = ? AND merged_into_id IS NULL`).get(phoneE164);
    customerId = customer ? customer.id : null;
  }
  const chatId = `${phoneE164.slice(1)}@c.us`;
  const existing = db.prepare(`SELECT * FROM crm_conversations WHERE channel = 'whatsapp' AND channel_thread_id = ?`).get(chatId);
  if (existing) return existing.id;
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO crm_conversations (customer_id, channel, provider, channel_thread_id) VALUES (?, 'whatsapp', 'greenapi', ?)`
  ).run(customerId, chatId);
  return lastInsertRowid;
}

async function sendDocumentToWhatsApp(db, quote, morningResponse) {
  const phoneE164 = toE164(quote.client_phone);
  if (!phoneE164) {
    db.prepare(
      `INSERT INTO whatsapp_send_log (quote_id, morning_document_id, phone, success, error_message) VALUES (?, ?, ?, 0, ?)`
    ).run(quote.id, morningResponse.id, quote.client_phone || null, 'No client phone on quote');
    return;
  }

  const urlFile = morningResponse.url && (morningResponse.url.he || morningResponse.url.origin);
  if (!urlFile) {
    db.prepare(
      `INSERT INTO whatsapp_send_log (quote_id, morning_document_id, phone, success, error_message) VALUES (?, ?, ?, 0, ?)`
    ).run(quote.id, morningResponse.id, quote.client_phone, 'Morning response had no document URL');
    return;
  }

  try {
    const provider = getActiveWhatsApp(db);
    const result = await provider.sendMedia(db, {
      toE164: phoneE164,
      url: urlFile,
      filename: `${quote.quote_number || 'document'}.pdf`,
      caption: quote.quote_number || undefined,
    });
    if (!result.ok) throw new Error(result.error || 'send failed');

    const conversationId = findOrCreateConversationForQuote(db, quote, phoneE164);
    db.prepare(
      `INSERT INTO crm_messages (conversation_id, direction, body, media_url, media_filename, message_type, provider, provider_message_id, status, sent_by)
       VALUES (?, 'out', ?, ?, ?, 'document', ?, ?, 'sent', 'system')`
    ).run(conversationId, quote.quote_number || null, urlFile, `${quote.quote_number || 'document'}.pdf`, provider.name, result.providerMessageId || null);
    db.prepare(`UPDATE crm_conversations SET last_message_at = CURRENT_TIMESTAMP, last_outbound_at = CURRENT_TIMESTAMP WHERE id = ?`).run(conversationId);

    db.prepare(
      `INSERT INTO whatsapp_send_log (quote_id, morning_document_id, phone, success) VALUES (?, ?, ?, 1)`
    ).run(quote.id, morningResponse.id, quote.client_phone);
  } catch (err) {
    db.prepare(
      `INSERT INTO whatsapp_send_log (quote_id, morning_document_id, phone, success, error_message) VALUES (?, ?, ?, 0, ?)`
    ).run(quote.id, morningResponse.id, quote.client_phone, err.message);
  }
}

module.exports = { sendDocumentToWhatsApp };
