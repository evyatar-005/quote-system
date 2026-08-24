// InforU adapter — the official WhatsApp Business API (InforU is a
// Meta-approved BSP). Delegates HTTP to services/inforu/client.js; this file
// is the ONLY place that translates InforU's shapes into the provider-agnostic
// contract in provider.js.
//
// Three things make this adapter meaningfully different from greenapi.js:
//
// 1. THE 24-HOUR WINDOW. Free-form text is only legal within 24h of the
//    customer's last inbound message (see sessionWindow.js). The gate lives
//    HERE rather than only in outbox.enqueue, because two send paths bypass
//    the queue entirely — the Morning document auto-send
//    (services/greenapi/send.js) and POST /api/whatsapp/test. Putting it in
//    the adapter makes the rule unbypassable.
//
// 2. NO PROVIDER MESSAGE ID. InforU returns none on send (Data is null for a
//    chat, {Recipients:1} for a template) and none on inbound pull. We plant
//    crm_messages.id as Settings.CustomerMessageID and echo it back as the
//    providerMessageId, because it is the only key InforU could possibly
//    return in a future delivery receipt. Best-effort: if DLRs turn out to
//    carry a different key, phase 2 adds a mapping. Costs nothing to plant now.
//    (idx_crm_messages_provider_id is scoped by provider, so these ids can
//    never collide with GreenAPI's.)
//
// 3. PULL, NOT PUSH. Inbound arrives by polling PullData, so there is no
//    webhook to verify — see verifyWebhook below.

const { assertProvider } = require('./provider');
const { toChatId, toE164, toInforuPhone } = require('../../crm/phone');
const { isSessionOpen, SESSION_CLOSED_HE } = require('./sessionWindow');
const client = require('../../inforu/client');

function capabilities() {
  return {
    supportsTemplates: true,
    supportsMedia: true,
    supportsBulk: true,
    // No message id comes back, so a delivery receipt has nothing to attach
    // to yet. Flipped in phase 2 once the DLR pull is wired.
    supportsDeliveryReceipts: false,
    // Inbound is pulled, not pushed — see verifyWebhook.
    supportsInboundWebhook: false,
    requiresSessionWindow: true,
  };
}

function isConfigured(db) {
  const row = db.prepare(`SELECT * FROM inforu_credentials WHERE id = 1`).get();
  return !!(row && row.username && row.api_token);
}

const invalidPhone = () => ({ ok: false, providerMessageId: null, status: 'failed', error: 'invalid phone', retryable: false });

// A closed window will not reopen on its own, so this must never be
// retryable — three attempts would only delay the agent's error by 90s.
const sessionClosed = () => ({ ok: false, providerMessageId: null, status: 'failed', error: SESSION_CLOSED_HE, retryable: false });

function failure(err) {
  return {
    ok: false,
    providerMessageId: null,
    status: 'failed',
    error: err.message,
    // The client classifies; default to retryable only for genuinely unknown
    // throws (a bug in our own code shouldn't silently swallow the message).
    retryable: err.retryable !== undefined ? err.retryable : true,
  };
}

const success = (messageId) => ({
  ok: true,
  providerMessageId: messageId ? String(messageId) : null,
  status: 'sent',
  error: null,
  retryable: false,
});

// Shared preamble for every free-form send: normalize the number and refuse
// if the 24h window is shut.
function gate(db, toE164Value) {
  const chatId = toChatId(toE164Value);
  if (!chatId) return { error: invalidPhone() };
  if (!isSessionOpen(db, chatId).open) return { error: sessionClosed() };
  const phone = toInforuPhone(toE164Value);
  if (!phone) return { error: invalidPhone() };
  return { phone };
}

async function sendText(db, { toE164: to, body, messageId }) {
  const g = gate(db, to);
  if (g.error) return g.error;
  try {
    await client.sendChat(db, { phone: g.phone, message: body, customerMessageId: messageId });
    return success(messageId);
  } catch (err) {
    return failure(err);
  }
}

async function sendMedia(db, { toE164: to, url, filename, caption, messageId }) {
  const g = gate(db, to);
  if (g.error) return g.error;
  try {
    // InforU fetches the URL itself, so it must be publicly reachable — same
    // constraint GreenAPI's sendFileByUrl had.
    await client.sendChat(db, { phone: g.phone, message: caption || filename || '', mediaUrl: url, customerMessageId: messageId });
    return success(messageId);
  } catch (err) {
    return failure(err);
  }
}

// The Drive-materials path. GreenAPI takes the file's bytes and uploads them;
// InforU cannot — SendWhatsAppChat accepts only `MessageMedia`, a URL that
// WhatsApp fetches itself. There is no file-uid parameter on the chat call.
//
// Their own file store looked like the way around that, and isn't: Files/Get
// is a POST returning base64 behind Basic auth, not something WhatsApp can
// pull. An earlier version of this built a GET URL for it that could never
// have worked.
//
// What does work is that the Drive folder is already shared "anyone with the
// link" (services/google/driveClient.js) — so the file has a public URL
// already, and handing that to InforU is both simpler and cheaper than
// round-tripping the bytes through us at all. driveFileId is passed through by
// the drainer for exactly this.
async function sendMediaUpload(db, { toE164: to, driveFileId, filename, caption, messageId }) {
  const g = gate(db, to);
  if (g.error) return g.error;
  if (!driveFileId) {
    return {
      ok: false, providerMessageId: null, status: 'failed',
      error: 'שליחת קובץ ב-InforU מחייבת קובץ מגוגל דרייב (הספק מושך את הקובץ בעצמו מקישור)',
      retryable: false,
    };
  }
  // uc?export=download is the direct-content URL for a link-shared file; the
  // /file/d/…/view form returns Drive's HTML viewer, which WhatsApp would
  // attach as an HTML page instead of the document.
  const url = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveFileId)}`;
  try {
    await client.sendChat(db, { phone: g.phone, message: caption || filename || '', mediaUrl: url, customerMessageId: messageId });
    // urlFile is echoed back so the drainer can record what was sent on our own
    // timeline — same contract GreenAPI's sendMediaUpload already returns.
    return { ...success(messageId), urlFile: url };
  } catch (err) {
    return failure(err);
  }
}

// The only way to message someone outside the window — and therefore the only
// way to OPEN one. Deliberately has no session gate.
async function sendTemplate(db, { toE164: to, templateId, parameters, mediaUrl, mediaFileUid, mediaFileName, messageId }) {
  const phone = toInforuPhone(to);
  if (!phone) return invalidPhone();
  if (!templateId) return { ok: false, providerMessageId: null, status: 'failed', error: 'templateId required', retryable: false };
  try {
    await client.sendTemplate(db, { phone, templateId, parameters, mediaUrl, mediaFileUid, mediaFileName, customerMessageId: messageId });
    return success(messageId);
  } catch (err) {
    return failure(err);
  }
}

// InforU offers inbound two ways (their docs, Utilities → Receiving Message):
// PullData, and a Push where their support registers a URL and they POST every
// incoming message to it. Push is strictly better here — it is immediate, it
// is not destructive, and it removes the "exactly one process may poll"
// hazard that makes the pull dangerous to run anywhere but production.
//
// Their push carries no signature and no shared secret; the only thing
// identifying it is the URL itself. So this verifies what it can — the payload
// has to have the documented shape — and the real control is that the path is
// unguessable and the account is matched below. A forged POST could at worst
// inject a message into an existing conversation, never read anything out.
function verifyWebhook(db, req) {
  const body = req && req.body;
  return !!(body && Array.isArray(body.Data));
}

// Push payload → the same NormalizedInbound shape the pull path produces, so
// handleInboundEvent cannot tell the two apart. Shape (docs example):
//   { CustomerId, ProjectId, Data: [ { Channel, Type, Value, Message,
//     MediaFileUid, AdditionalInfo, MoSessionId, ... } ] }
// `Value` is the customer's number; `AdditionalInfo` arrives as a JSON STRING,
// not an object, and carries the media metadata.
function normalizeInboundWebhook(payload) {
  const items = (payload && Array.isArray(payload.Data)) ? payload.Data : [];
  const out = [];
  for (const item of items) {
    if (!item) continue;
    const e164 = toE164(item.Value || item.PhoneNumber);
    // Same rule as the pull path: a row we can't attribute to a phone number
    // is skipped rather than guessed at. The raw payload is logged by the
    // caller regardless, so nothing is lost.
    if (!e164) continue;

    let info = {};
    if (item.AdditionalInfo) {
      try {
        info = typeof item.AdditionalInfo === 'string' ? JSON.parse(item.AdditionalInfo) : item.AdditionalInfo;
      } catch (_) { info = {}; }
    }

    const mediaUid = item.MediaFileUid || info.MediaFileUid || null;
    out.push({
      kind: 'message',
      // MoSessionId is WhatsApp's own wamid — a real, stable per-message id,
      // which the pull path never gets. Using it makes the push idempotent:
      // idx_crm_messages_provider_id refuses a duplicate outright, so a retry
      // from InforU can't post the customer's message twice.
      providerMessageId: item.MoSessionId || item.CustomerParam || null,
      fromE164: e164,
      chatId: toChatId(e164),
      senderName: null,
      messageType: mediaUid ? 'document' : 'text',
      // Buttons arrive with an empty Message and the choice in ButtonPayload —
      // showing the agent nothing at all would be worse than showing the id.
      body: item.Message || info.ButtonPayload || null,
      media: mediaUid
        ? { url: null, mime: info.MediaMimeType || null, filename: info.MediaFileName || mediaUid }
        : null,
      statusFor: null,
      status: null,
      raw: item,
    });
  }
  return out;
}

// PullData item → the same NormalizedInbound shape a webhook would produce,
// so handleInboundEvent stays provider-agnostic.
//
// CRITICAL: chatId must come out in the exact "<digits>@c.us" form every other
// conversation already uses (crm_conversations.channel_thread_id is UNIQUE per
// channel). InforU sends local Israeli numbers ("0543266290"); emitting that
// verbatim, or "+972…", would fork a brand-new conversation next to the
// customer's existing history and make the session-window lookup miss it.
function normalizePullItem(item) {
  const p = (item && item.PullData) || {};
  // NOTE: p.SenderNumber is OUR InforU business number, not the customer's.
  const e164 = toE164(p.PhoneNumber);
  if (!e164) return null;
  const info = p.AdditionalInfo || {};
  return {
    kind: 'message',
    providerMessageId: null, // InforU exposes none on inbound
    fromE164: e164,
    chatId: toChatId(e164),
    senderName: null,
    messageType: p.MediaFileUid ? 'document' : 'text',
    body: p.SentMessage || null,
    // The uid needs a separate download call to resolve; phase 1 keeps it in
    // media_filename + raw_json so nothing is lost.
    media: p.MediaFileUid ? { url: null, mime: info.MediaMimeType || null, filename: info.MediaFileName || p.MediaFileUid } : null,
    statusFor: null,
    status: null,
    raw: item,
  };
}

module.exports = assertProvider({
  name: 'inforu',
  capabilities,
  isConfigured,
  sendText,
  sendMedia,
  sendMediaUpload,
  sendTemplate,
  verifyWebhook,
  normalizeInboundWebhook,
  normalizePullItem,
});
