// Sends a just-created/converted Morning document to the client's WhatsApp,
// automatically, right after sync.js logs the Morning success. Never throws —
// a WhatsApp/GreenAPI failure must never affect the Morning document that
// already exists; it's only logged for support/debugging.
const { toChatId, sendFileByUrl } = require('./client');

async function sendDocumentToWhatsApp(db, quote, morningResponse) {
  const chatId = toChatId(quote.client_phone);
  if (!chatId) {
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
    await sendFileByUrl(db, {
      chatId,
      urlFile,
      fileName: `${quote.quote_number || 'document'}.pdf`,
      caption: quote.quote_number || undefined,
    });
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
