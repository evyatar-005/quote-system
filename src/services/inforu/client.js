// Low-level InforU (InforUMobile) HTTP client — the official WhatsApp
// Business API BSP. Same shape as services/greenapi/client.js: native fetch,
// credentials from the DB, no retry logic (the queue drainer in
// services/crm/jobs.js owns retries).
//
// Two things differ from GreenAPI and both bite if ignored:
//
// 1. HTTP 200 does NOT mean success. InforU answers 200 with `StatusId: -1`
//    on a bad template id, an unapproved template, an invalid number, an
//    unsubscribed recipient — so a naive `res.ok` check would record every one
//    of those as a delivered message.
// 2. Errors must be classified. A rejected request will be rejected again
//    identically, so retrying it only burns rate-limit quota and delays the
//    error badge by 90 seconds. Only transport-level problems are retryable.

const DEFAULT_BASE_URL = 'https://capi.inforu.co.il';

function getCredentials(db) {
  const row = db.prepare(`SELECT * FROM inforu_credentials WHERE id = 1`).get();
  if (!row || !row.username || !row.api_token) {
    throw Object.assign(new Error('InforU is not configured'), { retryable: false });
  }
  return row;
}

// The single HTTP primitive. Every InforU v2 endpoint is a POST that takes
// `{ Data: ... }` and answers `{ StatusId, StatusDescription, Data, ... }`.
async function call(db, path, data) {
  const creds = getCredentials(db);
  const base = (creds.base_url || DEFAULT_BASE_URL).replace(/\/$/, '');
  const auth = Buffer.from(`${creds.username}:${creds.api_token}`).toString('base64');

  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({ Data: data || {} }),
    });
  } catch (err) {
    // Network-level failure (DNS, timeout, connection reset) — worth retrying.
    throw Object.assign(new Error(`InforU ${path} unreachable: ${err.message}`), { retryable: true });
  }

  const text = await res.text();
  if (!res.ok) {
    // 5xx and 429 are transient; a 4xx is our request being wrong.
    const retryable = res.status >= 500 || res.status === 429;
    throw Object.assign(new Error(`InforU ${path} failed (${res.status}): ${text.slice(0, 300)}`), {
      retryable,
      retryAfter: Number(res.headers.get('retry-after')) || null,
    });
  }

  let json;
  try { json = text ? JSON.parse(text) : null; } catch (_) {
    throw Object.assign(new Error(`InforU ${path} returned non-JSON: ${text.slice(0, 200)}`), { retryable: false });
  }

  if (!json || json.StatusId !== 1) {
    const detail = [json && json.StatusDescription, json && json.DetailedDescription].filter(Boolean).join(' — ');
    throw Object.assign(new Error(`InforU ${path} rejected: ${detail || 'unknown error'}`), { retryable: false });
  }
  return json.Data;
}

// Free-form chat message. ONLY valid inside an open 24h session window — the
// caller (the adapter) is what enforces that; InforU rejects it otherwise.
async function sendChat(db, { phone, message, mediaUrl, customerMessageId }) {
  return call(db, '/api/v2/WhatsApp/SendWhatsAppChat', {
    Message: message,
    Phone: phone,
    ...(mediaUrl ? { MessageMedia: mediaUrl } : {}),
    Settings: { ...(customerMessageId ? { CustomerMessageId: String(customerMessageId) } : {}) },
  });
}

// Pre-approved template — the ONLY way to message someone outside the 24h
// window, and therefore the only way to start a conversation at all.
async function sendTemplate(db, { phone, templateId, parameters, mediaUrl, mediaFileUid, mediaFileName, customerMessageId }) {
  const recipient = { Phone: phone };
  if (mediaUrl) recipient.MessageMedia = mediaUrl;
  if (mediaFileUid) recipient.MessageMediaFileUid = mediaFileUid;
  if (mediaFileName) recipient.MediaFileName = mediaFileName;

  const data = await call(db, '/api/v2/WhatsApp/SendWhatsApp', {
    TemplateId: String(templateId),
    ...(parameters && parameters.length ? { TemplateParameters: parameters } : {}),
    Recipients: [recipient],
    Settings: { ...(customerMessageId ? { CustomerMessageID: String(customerMessageId) } : {}) },
  });
  // StatusId can be 1 (accepted) while an individual recipient still failed —
  // a per-recipient rejection lives in Data.Errors, not in StatusId.
  if (data && data.Errors) {
    throw Object.assign(new Error(`InforU template rejected recipient: ${JSON.stringify(data.Errors).slice(0, 300)}`), { retryable: false });
  }
  return data;
}

async function getTemplateList(db) {
  const data = await call(db, '/api/v2/WhatsApp/GetTemplateList', {});
  return (data && data.List) || [];
}

// Base64 upload → a file uid usable as MessageMediaFileUid. This is what lets
// us send a file without a publicly reachable URL — the same reason the
// GreenAPI adapter uses sendFileByUpload for Drive materials.
async function uploadFile(db, { fileBuffer, contentType, fileName, expirationInMinutes = 60 }) {
  const data = await call(db, '/api/v2/Files/Upload', {
    ContentType: contentType || 'application/octet-stream',
    ExpirationInMinutes: String(expirationInMinutes),
    FileName: fileName || 'file',
    FileData: Buffer.from(fileBuffer).toString('base64'),
  });
  // The uid field name isn't documented consistently — accept the usual spellings.
  return (data && (data.FileUid || data.MediaFileUid || data.Uid)) || null;
}

// Reads the CHAT store — the same conversations the InforU web UI shows —
// rather than the PullData queue. Three things make it fundamentally better
// for us than the pull:
//   1. NOT destructive. Nothing is consumed, so it is safe to call from a dev
//      machine, and two instances can't steal each other's messages.
//   2. Returns BOTH directions. The pull only ever exposed inbound, so a reply
//      an agent sent from InforU's own UI was invisible to us.
//   3. Has real history. FromDateTime reaches backwards, so existing
//      conversations can be imported, not just messages arriving from now on.
// Every message carries WhatsAppMessageId — a stable id the pull never had,
// which is what makes repeated syncing idempotent.
async function getWhatsAppChats(db, { fromDateTime, toDateTime, phoneNumbers, lastMessageDatetime, chatId }) {
  return call(db, '/api/v2/WhatsApp/GetWhatsAppChats', {
    FromDateTime: fromDateTime,
    ...(toDateTime ? { ToDateTime: toDateTime } : {}),
    ...(lastMessageDatetime ? { LastMessageDatetime: lastMessageDatetime } : {}),
    ...(chatId ? { ChatId: chatId } : {}),
    ...(phoneNumbers && phoneNumbers.length ? { PhoneNumbers: phoneNumbers } : {}),
  });
}

// DESTRUCTIVE READ: whatever comes back is deleted from InforU's queue. The
// caller must persist the raw response before parsing it.
async function pullData(db, { type, batchSize = 500, phoneNumber }) {
  return call(db, '/api/v2/PullData', {
    Type: type,
    BatchSize: batchSize,
    ...(phoneNumber ? { PhoneNumber: phoneNumber } : {}),
  });
}

module.exports = { sendChat, sendTemplate, getTemplateList, uploadFile, pullData, getWhatsAppChats, DEFAULT_BASE_URL };
