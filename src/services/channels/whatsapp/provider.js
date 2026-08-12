// WhatsApp provider contract — every adapter (greenapi.js, and a future
// metaCloud.js) exports exactly this shape. Nothing outside outbox.js is
// allowed to call send*/verifyWebhook/normalizeInboundWebhook directly; see
// CLAUDE.md CRM plan §2 for why (provider-agnostic requirement).
//
// @typedef {Object} WhatsAppCapabilities
// @property {boolean} supportsTemplates
// @property {boolean} supportsMedia
// @property {boolean} supportsBulk
// @property {boolean} supportsDeliveryReceipts
// @property {boolean} supportsInboundWebhook
// @property {boolean} requiresSessionWindow
//
// @typedef {Object} SendResult
// @property {boolean} ok
// @property {string|null} providerMessageId
// @property {'sent'|'queued'|'failed'} status
// @property {string|null} error
// @property {boolean} retryable
//
// @typedef {Object} NormalizedInbound
// @property {'message'|'status'|'ignore'} kind
// @property {string|null} providerMessageId
// @property {string|null} fromE164
// @property {string|null} chatId
// @property {string|null} senderName
// @property {'text'|'image'|'document'|'audio'|'video'|'unknown'} messageType
// @property {string|null} body
// @property {{url:string,mime:string,filename:string}|null} media
// @property {string|null} statusFor
// @property {'sent'|'delivered'|'read'|'failed'|null} status
// @property {any} raw
//
// @typedef {Object} WhatsAppProvider
// @property {string} name
// @property {(db)=>WhatsAppCapabilities} capabilities
// @property {(db)=>boolean} isConfigured
// @property {(db, {toE164:string, body:string})=>Promise<SendResult>} sendText
// @property {(db, {toE164:string, url:string, filename?:string, caption?:string})=>Promise<SendResult>} sendMedia
// @property {(db, {toE164:string, fileBuffer:Buffer, mimeType?:string, filename?:string, caption?:string})=>Promise<SendResult>} sendMediaUpload
// @property {(db, req)=>boolean} verifyWebhook
// @property {(payload, headers)=>NormalizedInbound[]} normalizeInboundWebhook

function assertProvider(impl) {
  const required = ['name', 'capabilities', 'isConfigured', 'sendText', 'sendMedia', 'sendMediaUpload', 'verifyWebhook', 'normalizeInboundWebhook'];
  for (const key of required) {
    if (typeof impl[key] === 'undefined') throw new Error(`WhatsApp provider "${impl.name || '?'}" is missing "${key}"`);
  }
  return impl;
}

module.exports = { assertProvider };
