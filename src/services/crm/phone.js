// Phone-number normalization — the CRM's join key across every channel
// (WhatsApp chatId, caller-ID, quote client_phone). Extracted out of
// greenapi/client.js's toChatId(), which blindly assumed Israel for every
// number; this version only defaults to Israel when the input genuinely
// looks local (leading 0, or a bare 9-digit mobile/landline number), and
// otherwise trusts an explicit country code — a number already carrying one
// (e.g. "+44 7911 123456" or "00 44 7911 123456") must not be silently
// rewritten to 972…, which would merge two unrelated customers.
//
// Deliberately conservative: when a number can't be confidently normalized,
// toE164 returns null rather than guessing — callers fall back to email/name
// as the identity key (see services/crm/backfill.js) instead of risking a
// wrong merge.

const IL_COUNTRY_CODE = '972';

/**
 * @param {string|null|undefined} raw
 * @returns {string|null} E.164, e.g. "+972501234567", or null if unusable.
 */
function toE164(raw) {
  const trimmed = (raw || '').toString().trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (hadPlus) {
    // Explicit country code — trust it as-is.
    return digits.length >= 8 ? `+${digits}` : null;
  }
  if (digits.startsWith('00')) {
    // International prefix written as 00 instead of +.
    digits = digits.slice(2);
    return digits.length >= 8 ? `+${digits}` : null;
  }
  if (digits.startsWith(IL_COUNTRY_CODE) && digits.length >= 11) {
    // Already carries 972 but no +/00 (e.g. copy-pasted from GreenAPI chatId).
    return `+${digits}`;
  }
  if (digits.startsWith('0') && digits.length >= 9 && digits.length <= 10) {
    // Local Israeli format: 05x-xxxxxxx (mobile, 10 digits) or 0x-xxxxxxx (landline, 9).
    return `+${IL_COUNTRY_CODE}${digits.slice(1)}`;
  }
  if (digits.length === 9 || digits.length === 8) {
    // Bare national number with no leading 0 — still assume IL, the only
    // market this deployment currently serves (see CRM plan §10.3).
    return `+${IL_COUNTRY_CODE}${digits}`;
  }
  // Anything else (wrong length, ambiguous) — don't guess.
  return null;
}

/** E.164 → GreenAPI chatId format, e.g. "+972501234567" -> "972501234567@c.us". */
function toChatId(raw) {
  const e164 = raw && raw.startsWith('+') ? raw : toE164(raw);
  if (!e164) return null;
  return `${e164.slice(1)}@c.us`;
}

/** GreenAPI chatId ("972501234567@c.us") or wa_id -> E.164. */
function fromChatId(chatId) {
  if (!chatId) return null;
  const digits = chatId.replace(/@.*/, '').replace(/\D/g, '');
  if (!digits) return null;
  return `+${digits}`;
}

/** Loose validity check — enough digits to plausibly be a phone number. */
function isValidE164(value) {
  return typeof value === 'string' && /^\+\d{8,15}$/.test(value);
}

module.exports = { toE164, toChatId, fromChatId, isValidE164 };
