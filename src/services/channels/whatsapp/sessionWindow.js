// The WhatsApp 24-hour customer service window.
//
// This is a META rule, not a provider one: on the official WhatsApp Business
// API you may only send free-form text within 24 hours of the customer's last
// inbound message. Outside that window the only thing that goes through is a
// pre-approved template — which is also the only way to start a conversation
// in the first place.
//
// Providers declare whether they live under this rule via
// capabilities().requiresSessionWindow (false for GreenAPI, which impersonates
// a personal WhatsApp session and has no such limit; true for InforU).
//
// The check is deliberately done in SQL, never in JS: last_inbound_at is
// written with SQLite's CURRENT_TIMESTAMP, i.e. UTC with a space separator and
// no 'Z'. `new Date(that)` reads it as local time and would be 2-3 hours off —
// the exact hazard already documented in routes/inbox.js and routes/myDay.js.

const SESSION_CLOSED_HE = 'חלון 24 השעות סגור — יש לשלוח תבנית מאושרת כדי לפתוח שיחה';

/**
 * @returns {{open: boolean, expiresAt: string|null}} — expiresAt is NULL when
 * the customer has never written to us (no window was ever opened).
 */
function isSessionOpen(db, chatId) {
  if (!chatId) return { open: false, expiresAt: null };
  const row = db.prepare(
    `SELECT (last_inbound_at IS NOT NULL
             AND (julianday('now') - julianday(last_inbound_at)) < 1.0) AS open,
            datetime(last_inbound_at, '+1 day') AS expires_at
       FROM crm_conversations
      WHERE channel = 'whatsapp' AND channel_thread_id = ?`
  ).get(chatId);
  return { open: !!(row && row.open), expiresAt: (row && row.expires_at) || null };
}

module.exports = { isSessionOpen, SESSION_CLOSED_HE };
