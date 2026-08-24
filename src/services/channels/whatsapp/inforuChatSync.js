// Imports InforU conversations from GetWhatsAppChats — the store behind their
// own chat UI — instead of the PullData queue.
//
// Why this exists at all: PullData answered {"Count":0,"List":[]} 8,400+ times
// on this account while the messages sat plainly visible in InforU's web chat.
// GetWhatsAppChats reads that same store and returns them, using the identical
// credentials. It is better on every axis that hurt us:
//
//   - NOT destructive. Nothing is consumed, so two instances can't steal each
//     other's messages and it is safe to run from a dev machine.
//   - Both directions. The pull only ever exposed inbound, so a reply an agent
//     typed in InforU's own UI stayed invisible to the CRM. Those land here.
//   - Real history. FromDateTime reaches backwards, so existing conversations
//     can be imported rather than only messages arriving from now on.
//   - WhatsAppMessageId — a stable per-message id the pull never provided.
//     It is what makes re-running this safe.
//
// NOT routed through inbound.js/handleInboundEvent on purpose: that path
// hardcodes direction 'in' and stamps created_at with CURRENT_TIMESTAMP, both
// of which are wrong for an import that carries outbound messages and their
// original timestamps.

const client = require('../../inforu/client');
const { toE164, toChatId } = require('../../crm/phone');
const { resolveConversation } = require('./outbox');
const { findOrCreateCustomerByPhone } = require('./inbound');
const { publish } = require('../../crm/realtime');

// What Asia/Jerusalem's UTC offset was at a given instant. Computed rather
// than hardcoded to +2/+3 because the import reaches back over DST boundaries,
// and a fixed guess would put half the year's messages off by an hour.
function israelOffsetMs(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day,
    parts.hour === '24' ? 0 : parts.hour, parts.minute, parts.second);
  return asUTC - date.getTime();
}

// InforU sends '2026-08-24T16:51:28.707' with no timezone marker, and it is
// ISRAEL WALL TIME — verified against a real thread: messages WhatsApp shows
// at 16:51 came back as 16:51. crm_messages.created_at is UTC everywhere else
// (SQLite CURRENT_TIMESTAMP), and the thread renders it as UTC, so storing
// their string as-is pushed every imported message 3 hours into the future.
//
// Converted here, at the single point the value enters the system, rather than
// compensating in the UI — the column has one meaning and imported rows have
// to sort correctly against locally-created ones.
function inforuTs(s) {
  if (!s) return null;
  const clean = String(s).replace('T', ' ').replace(/\.\d+/, '').replace('Z', '').slice(0, 19);
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(clean);
  if (!m) return clean; // unexpected shape — better stored raw than dropped
  const [, y, mo, d, h, mi, sec] = m.map(Number);
  // Two passes: the first offset is looked up at the wrong instant near a DST
  // boundary, and re-deriving it from the corrected instant settles it.
  let utc = Date.UTC(y, mo - 1, d, h, mi, sec);
  utc -= israelOffsetMs(new Date(utc));
  utc = Date.UTC(y, mo - 1, d, h, mi, sec) - israelOffsetMs(new Date(utc));
  return new Date(utc).toISOString().slice(0, 19).replace('T', ' ');
}

// Their docs say Direction is "Incoming"/"Outgoing"; the live API actually
// returns "Inbound"/"Outgoing". Filtering on the documented spelling silently
// discarded every inbound message. Treat anything not explicitly outgoing as
// inbound: a message we didn't send is one the customer sent, and mislabelling
// it inbound is far less harmful than dropping it.
function directionOf(m) {
  return String(m.Direction || '').toLowerCase().startsWith('out') ? 'out' : 'in';
}

function mediaOf(m) {
  const info = m.AddtionalInfo || m.AdditionalInfo || {};
  const urls = Array.isArray(info.MediaUrls) ? info.MediaUrls : [];
  const tpl = info.WhatsappTemplateInfo || {};
  const url = urls[0] || tpl.Media || null;
  const name = tpl.MediaFileName || null;
  return (url || name) ? { url: url || null, filename: name } : null;
}

/**
 * @param {string} fromDateTime 'YYYY-MM-DD HH:MM:SS' — how far back to read.
 * @returns {{chats:number, messages:number, imported:number, inbound:number, skipped:number}}
 */
async function syncInforuChats(db, { fromDateTime, toDateTime, phoneNumbers } = {}) {
  const data = await client.getWhatsAppChats(db, { fromDateTime, toDateTime, phoneNumbers });
  const results = (data && data.Results) || [];

  const insertMessage = db.prepare(
    // OR IGNORE leans on idx_crm_messages_provider_id (UNIQUE on
    // provider+provider_message_id): re-running over an overlapping window is
    // a no-op instead of duplicating the customer's messages.
    `INSERT OR IGNORE INTO crm_messages
       (conversation_id, direction, body, media_url, media_filename, message_type,
        provider, provider_message_id, status, raw_json, created_at)
     VALUES (@conversation_id, @direction, @body, @media_url, @media_filename, @message_type,
        'inforu', @provider_message_id, @status, @raw_json, @created_at)`
  );

  let messages = 0, imported = 0, inbound = 0, skipped = 0;
  const touched = new Set();

  const tx = db.transaction(() => {
    for (const chat of results) {
      // InforU returns newest-first. crm_messages has no ordering of its own —
      // the thread renders by id, i.e. insertion order — so inserting in the
      // order received reversed every conversation on screen. Messages sent
      // inside the same minute made it obvious: "כבר שבוע / אתם לא עונים /
      // הלו יש מישהו?" read bottom-to-top against the customer's own WhatsApp.
      // Sorted oldest-first so ids ascend with time, which is what the thread
      // (and the "last message" preview) assume.
      const ordered = [...(chat.Messages || [])]
        .sort((a, b) => String(a.TimeSent || '').localeCompare(String(b.TimeSent || '')));
      for (const m of ordered) {
        messages += 1;
        const e164 = toE164(m.PhoneNumber);
        // No usable phone means no conversation to attach to. Counted rather
        // than swallowed so a systematic parsing problem is visible.
        if (!e164) { skipped += 1; continue; }
        // Without a stable id every re-run would re-insert this message.
        if (!m.WhatsAppMessageId) { skipped += 1; continue; }

        // Create the customer too, not just the thread — an imported chat for
        // a number nobody has quoted yet must still show a name in the inbox
        // and be reachable from the customers screen.
        const customerId = findOrCreateCustomerByPhone(db, e164, null);
        const conversationId = resolveConversation(db, { customerId, phoneE164: e164, provider: 'inforu' });
        const dir = directionOf(m);
        const media = mediaOf(m);

        // A message WE sent comes back from InforU too, under a different id —
        // theirs is WhatsAppMessageId, ours is the crm_messages row. Inserting
        // it blindly duplicated every outbound reply: once as the agent's own
        // bubble, once labelled "נשלח מממשק InforU".
        //
        // sendChat plants crm_messages.id as CustomerMessageId, and
        // GetWhatsAppChats echoes it back — so it identifies our own row
        // exactly. Adopt the WhatsApp id onto it instead of creating a second
        // message, which also means later syncs recognise it by that id.
        const ours = m.CustomerMessageId && db.prepare(
          `SELECT id, provider_message_id FROM crm_messages WHERE id = ?`
        ).get(Number(m.CustomerMessageId));
        if (ours) {
          if (!ours.provider_message_id) {
            db.prepare(`UPDATE crm_messages SET provider_message_id = ?, provider = 'inforu' WHERE id = ?`)
              .run(String(m.WhatsAppMessageId), ours.id);
          }
          touched.add(conversationId);
          continue;
        }

        // Fallback for sends made before CustomerMessageId was echoed, and for
        // any provider that drops it: same conversation, same direction, same
        // text, within two minutes, and already attributed to an agent. Narrow
        // enough that it can't collapse two genuinely different messages.
        if (dir === 'out' && m.MessageText) {
          const dup = db.prepare(
            `SELECT id FROM crm_messages
              WHERE conversation_id = ? AND direction = 'out' AND sent_by IS NOT NULL
                AND body = ? AND ABS(strftime('%s', created_at) - strftime('%s', ?)) <= 120
              LIMIT 1`
          ).get(conversationId, m.MessageText, inforuTs(m.TimeSent));
          if (dup) {
            db.prepare(`UPDATE crm_messages SET provider_message_id = COALESCE(provider_message_id, ?) WHERE id = ?`)
              .run(String(m.WhatsAppMessageId), dup.id);
            touched.add(conversationId);
            continue;
          }
        }

        const { changes } = insertMessage.run({
          conversation_id: conversationId,
          direction: dir,
          body: m.MessageText || null,
          media_url: media?.url || null,
          media_filename: media?.filename || null,
          message_type: media ? 'document' : 'text',
          provider_message_id: String(m.WhatsAppMessageId),
          // Imported outbound is already delivered; 'sent' is the honest value
          // (InforU exposes no read receipt here, so never claim one).
          status: dir === 'in' ? 'received' : 'sent',
          raw_json: JSON.stringify(m),
          created_at: inforuTs(m.TimeSent),
        });

        if (changes) {
          imported += 1;
          if (dir === 'in') inbound += 1;
          touched.add(conversationId);
        }
      }
    }

    // Recomputed from the messages themselves rather than nudged per-insert.
    // An import arrives out of order and overlaps what's already stored, so
    // deriving the totals is the only way they can't drift — and it stays
    // correct no matter how many times this runs.
    for (const id of touched) {
      db.prepare(
        `UPDATE crm_conversations SET
           last_message_at  = (SELECT MAX(created_at) FROM crm_messages WHERE conversation_id = @id),
           last_inbound_at  = (SELECT MAX(created_at) FROM crm_messages WHERE conversation_id = @id AND direction = 'in'),
           last_outbound_at = (SELECT MAX(created_at) FROM crm_messages WHERE conversation_id = @id AND direction = 'out'),
           -- A real inbound message means this is a live conversation, not a
           -- broadcast target hidden from the shared inbox (see outbox.js).
           is_broadcast_only = CASE
             WHEN EXISTS (SELECT 1 FROM crm_messages WHERE conversation_id = @id AND direction = 'in')
             THEN 0 ELSE is_broadcast_only END
         WHERE id = @id`
      ).run({ id });

      // unread_count is "inbound since our last reply" — the same rule the
      // awaiting-reply tiles use. Recomputed, not incremented, so a backfill
      // of old conversations doesn't leave a permanent phantom badge.
      db.prepare(
        `UPDATE crm_conversations SET unread_count = (
           SELECT COUNT(*) FROM crm_messages m
            WHERE m.conversation_id = @id AND m.direction = 'in'
              AND m.created_at > COALESCE(
                (SELECT MAX(created_at) FROM crm_messages WHERE conversation_id = @id AND direction = 'out'),
                '')
         ) WHERE id = @id`
      ).run({ id });
    }
  });
  tx();

  for (const id of touched) publish('conversation.updated', { conversationId: id });

  return { chats: results.length, messages, imported, inbound, skipped };
}

module.exports = { syncInforuChats, inforuTs, directionOf };
