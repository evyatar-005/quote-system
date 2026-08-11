// {{placeholder}} substitution for message_templates / wa_campaigns bodies,
// and the opt-out keyword helpers shared with inbound.js (see CLAUDE.md CRM
// plan Phase 4 §3-4). Deliberately dumb: no expressions, no conditionals, no
// nesting — a marketing manager writes the body and a typo must degrade to
// an empty string, never crash mid-blast.

const VARIABLES = {
  name: c => c.display_name || '',
  first_name: c => (c.display_name || '').trim().split(/\s+/)[0] || '',
  company: c => c.company || '',
  phone: c => c.phone_e164 || '',
  agent: c => c.owner_full_name || c.owner_username || '',
  last_quote_date: c => (c.last_quote_at || '').slice(0, 10),
};

function render(body, customer) {
  const c = customer || {};
  return (body || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
    const fn = VARIABLES[key];
    return fn ? String(fn(c) ?? '') : '';
  });
}

function usedVariables(body) {
  const matches = (body || '').matchAll(/\{\{\s*(\w+)\s*\}\}/g);
  return [...new Set([...matches].map(m => m[1]))];
}

function unknownVariables(body) {
  return usedVariables(body).filter(v => !(v in VARIABLES));
}

// Hebrew has no case, so toLowerCase only matters for the Latin keywords;
// nikud/bidi marks and surrounding punctuation are stripped so "הסר!" and
// "‏הסר" both match. NFC first — a copy-pasted Hebrew word can arrive
// decomposed.
function normalizeKeyword(s) {
  return (s || '').toString().normalize('NFC').trim().toLowerCase()
    .replace(/[֑-ׇ‎‏‪-‮]/g, '')
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
}

// Split+normalize crm_settings.auto_optout_keywords ONCE, shared by this
// module and inbound.js so the two can never drift.
function optOutKeywords(db) {
  const raw = db.prepare(`SELECT auto_optout_keywords FROM crm_settings WHERE id = 1`).get()
    ?.auto_optout_keywords || 'הסר,הסירו,STOP,UNSUBSCRIBE';
  return raw.split(',').map(normalizeKeyword).filter(Boolean);
}

// Validation matches on the KEYWORD the customer is told to send back, not on
// the exact footer wording — a manager may reword the sentence, but cannot
// ship a marketing body that never tells the customer how to leave.
function hasOptOutLine(db, body) {
  const kws = optOutKeywords(db);
  const text = (body || '').toString();
  return kws.some(k => text.includes(k));
}

module.exports = { render, VARIABLES, usedVariables, unknownVariables, hasOptOutLine, optOutKeywords, normalizeKeyword };
