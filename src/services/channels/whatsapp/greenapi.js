// GreenAPI adapter — delegates to services/greenapi/client.js (the existing
// low-level HTTP client, already used by the Morning-document auto-send).
// This file is the ONLY place that translates GreenAPI's specific request/
// response/webhook shapes into the provider-agnostic contract.

const { assertProvider } = require('./provider');
const { toChatId, fromChatId } = require('../../crm/phone');
const client = require('../../greenapi/client');

function capabilities() {
  return {
    supportsTemplates: false,
    supportsMedia: true,
    supportsBulk: false, // unofficial personal-WhatsApp session — see CRM plan §10.1 ban-risk note
    supportsDeliveryReceipts: true,
    supportsInboundWebhook: true,
    requiresSessionWindow: false,
  };
}

function isConfigured(db) {
  const row = db.prepare(`SELECT * FROM greenapi_credentials WHERE id = 1`).get();
  return !!(row && row.instance_id && row.api_token && row.api_url);
}

async function sendText(db, { toE164, body }) {
  const chatId = toChatId(toE164);
  if (!chatId) return { ok: false, providerMessageId: null, status: 'failed', error: 'invalid phone', retryable: false };
  try {
    const result = await client.sendText(db, { chatId, message: body });
    return { ok: true, providerMessageId: result?.idMessage || null, status: 'sent', error: null, retryable: false };
  } catch (err) {
    return { ok: false, providerMessageId: null, status: 'failed', error: err.message, retryable: true };
  }
}

async function sendMedia(db, { toE164, url, filename, caption }) {
  const chatId = toChatId(toE164);
  if (!chatId) return { ok: false, providerMessageId: null, status: 'failed', error: 'invalid phone', retryable: false };
  try {
    const result = await client.sendFileByUrl(db, { chatId, urlFile: url, fileName: filename, caption });
    return { ok: true, providerMessageId: result?.idMessage || null, status: 'sent', error: null, retryable: false };
  } catch (err) {
    return { ok: false, providerMessageId: null, status: 'failed', error: err.message, retryable: true };
  }
}

// Used exclusively by the Drive materials sender (see outbox.js's 'drive'
// kind) — the file is downloaded server-side first, so no public URL is
// ever exposed and the customer receives an actual file, never a link.
async function sendMediaUpload(db, { toE164, fileBuffer, mimeType, filename, caption }) {
  const chatId = toChatId(toE164);
  if (!chatId) return { ok: false, providerMessageId: null, status: 'failed', error: 'invalid phone', retryable: false };
  try {
    const result = await client.sendFileByUpload(db, { chatId, fileBuffer, mimeType, fileName: filename, caption });
    return { ok: true, providerMessageId: result?.idMessage || null, status: 'sent', error: null, retryable: false, urlFile: result?.urlFile || null };
  } catch (err) {
    return { ok: false, providerMessageId: null, status: 'failed', error: err.message, retryable: true };
  }
}

async function sendTemplate() {
  throw Object.assign(new Error('GreenAPI does not support pre-approved templates'), { code: 'UNSUPPORTED' });
}

// GreenAPI has no built-in signature scheme — best-effort: if an admin set a
// shared secret (crm_settings.wa_webhook_secret), require it as ?token= on
// the webhook URL configured in the GreenAPI console. Unset = unverified but
// still processed, same "optional, degrade gracefully" convention as
// Morning's webhook_secret.
function verifyWebhook(db, req) {
  const settings = db.prepare(`SELECT wa_webhook_secret FROM crm_settings WHERE id = 1`).get();
  if (!settings || !settings.wa_webhook_secret) return true;
  return req.query.token === settings.wa_webhook_secret;
}

function normalizeInboundWebhook(payload) {
  if (!payload || !payload.typeWebhook) return [];

  if (payload.typeWebhook === 'incomingMessageReceived') {
    const md = payload.messageData || {};
    const sd = payload.senderData || {};
    let messageType = 'unknown';
    let body = null;
    let media = null;
    if (md.typeMessage === 'textMessage') {
      messageType = 'text';
      body = md.textMessageData?.textMessage || null;
    } else if (md.typeMessage === 'extendedTextMessage') {
      messageType = 'text';
      body = md.extendedTextMessageData?.text || null;
    } else if (['imageMessage', 'documentMessage', 'audioMessage', 'videoMessage'].includes(md.typeMessage)) {
      messageType = md.typeMessage.replace('Message', '').toLowerCase();
      const fd = md.fileMessageData || {};
      media = { url: fd.downloadUrl || null, mime: fd.mimeType || null, filename: fd.fileName || null };
      body = fd.caption || null;
    }
    return [{
      kind: 'message',
      providerMessageId: payload.idMessage || null,
      fromE164: fromChatId(sd.chatId),
      chatId: sd.chatId || null,
      senderName: sd.senderName || sd.chatName || null,
      messageType,
      body,
      media,
      statusFor: null,
      status: null,
      raw: payload,
    }];
  }

  if (payload.typeWebhook === 'outgoingMessageStatus') {
    return [{
      kind: 'status',
      providerMessageId: payload.idMessage || null,
      fromE164: null,
      chatId: payload.chatId || null,
      senderName: null,
      messageType: 'unknown',
      body: null,
      media: null,
      statusFor: payload.idMessage || null,
      status: payload.status || null,
      raw: payload,
    }];
  }

  return [{ kind: 'ignore', raw: payload }];
}

module.exports = assertProvider({
  name: 'greenapi',
  capabilities,
  isConfigured,
  sendText,
  sendMedia,
  sendMediaUpload,
  sendTemplate,
  verifyWebhook,
  normalizeInboundWebhook,
});
