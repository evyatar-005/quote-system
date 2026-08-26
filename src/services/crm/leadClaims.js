// CRM Phase 5 — the lead pull-queue ("משוך ליד"). Two independent concepts:
// crm_leads.assigned_to is OWNERSHIP (who this lead belongs to, forever,
// cleared only by an admin's explicit "החזר לבריכה"); a crm_lead_claims row
// is the SLOT (one of the agent's max_claimed_leads active work items,
// cleared by any release trigger below). This split is what lets "set a
// follow-up" free a slot WITHOUT losing the lead — otherwise the follow-up
// would vanish from the agent's own "פולואפ להיום" the instant they set it.
//
// The claim model mirrors Phase 3's conversation locking (crm_conversation_locks)
// — same PRIMARY-KEY-is-the-resource trick, same closed-span history table —
// with one difference: a conversation lock is a 2-minute heartbeat; a lead
// claim is an OUTCOME lock, released when the agent produces a result, not
// when they stop typing. Hence expires_at is nullable and usually NULL.

const { publish } = require('./realtime');
const { OPEN_KEYS, CLOSED_KEYS, isClosed } = require('./leadStatuses');

// Every open status is claimable: a lead someone already spoke to and then
// released is still live work, and after the release it has no owner left to
// reach it. Only the closed outcomes stay out.
const CLAIMABLE_SQL = OPEN_KEYS.map((k) => `'${k}'`).join(',');

function crmSettingsRow(db) {
  return db.prepare(`SELECT * FROM crm_settings WHERE id = 1`).get() || {};
}

function slotCount(db, username) {
  return db.prepare(
    `SELECT COUNT(*) n FROM crm_lead_claims WHERE username = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`
  ).get(username).n;
}

// Oldest claimable lead first, campaign-scoped. No restriction rows for this
// agent = unrestricted (globally oldest); one or more rows = only those
// campaigns. A restricted agent gets nothing from campaign-less leads — the
// honest reading of "restrict this agent to these campaigns".
const NEXT_CLAIMABLE_SQL = `
  SELECT l.id
  FROM crm_leads l
  LEFT JOIN crm_lead_claims cl ON cl.lead_id = l.id
         AND (cl.expires_at IS NULL OR cl.expires_at > CURRENT_TIMESTAMP)
  WHERE l.assigned_to IS NULL
    AND cl.lead_id IS NULL
    -- Any OPEN status, not just 'new' — see CLAIMABLE_SQL above.
    AND l.status IN (${CLAIMABLE_SQL})
    AND ( NOT EXISTS (SELECT 1 FROM crm_agent_campaigns WHERE username = @me)
          OR l.campaign_id IN (SELECT campaign_id FROM crm_agent_campaigns WHERE username = @me) )
  ORDER BY COALESCE(l.source_created_at, l.created_at) ASC, l.id ASC
  LIMIT 1
`;

// The single atomic "pull the next lead" operation. Synchronous end-to-end —
// better-sqlite3 + a single Node process means a db.transaction() body is a
// genuine critical section. Do NOT add an `await` inside this function; it
// would silently break the race-freedom the belt-and-braces checks rely on.
function claimNext(db, username) {
  const settings = crmSettingsRow(db);
  const maxClaimed = settings.max_claimed_leads || 4;
  const ttlHours = settings.lead_claim_ttl_hours || 0;

  const tx = db.transaction(() => {
    const n = slotCount(db, username);
    if (n >= maxClaimed) throw Object.assign(new Error(`הגעת למקסימום ${maxClaimed} לידים במקביל`), { status: 409, code: 'slot_limit' });

    const candidate = db.prepare(NEXT_CLAIMABLE_SQL).get({ me: username });
    if (!candidate) throw Object.assign(new Error('אין לידים ממתינים בתור'), { status: 404, code: 'empty_pool' });

    // Same fixed-width 'YYYY-MM-DD HH:MM:SS' format CURRENT_TIMESTAMP uses —
    // NOT .toISOString(). This was dormant until now (lead_claim_ttl_hours
    // was 0, so expiresAt was always NULL), but a plain ISO string here
    // compares as always-later than same-day CURRENT_TIMESTAMP (the 'T' vs
    // space byte), so the moment a TTL is configured, expires_at rows in
    // slotCount/claimNext/releaseClaim's comparisons would never be seen as
    // expired until the date rolls over — see mondaySync.js's pushBoard fix
    // for the same bug, non-dormant there.
    const expiresAt = ttlHours > 0 ? new Date(Date.now() + ttlHours * 3600e3).toISOString().slice(0, 19).replace('T', ' ') : null;

    // Mirrors routes/inbox.js's claim upsert — the WHERE on DO UPDATE is what
    // makes this a true "claim if free" upsert rather than a blind overwrite.
    db.prepare(
      `INSERT INTO crm_lead_claims (lead_id, username, acquired_at, expires_at)
       VALUES (@lead_id, @username, CURRENT_TIMESTAMP, @expires_at)
       ON CONFLICT(lead_id) DO UPDATE SET
         username = excluded.username, acquired_at = CURRENT_TIMESTAMP, expires_at = excluded.expires_at
       WHERE (crm_lead_claims.expires_at IS NOT NULL AND crm_lead_claims.expires_at < CURRENT_TIMESTAMP)
          OR crm_lead_claims.username = @username`
    ).run({ lead_id: candidate.id, username, expires_at: expiresAt });

    // Re-read and verify — never trust `changes` (same convention as inbox.js).
    const claim = db.prepare(`SELECT * FROM crm_lead_claims WHERE lead_id = ?`).get(candidate.id);
    if (claim.username !== username) throw Object.assign(new Error('הליד נתפס ע״י סוכן אחר'), { status: 409, code: 'taken' });

    // Second lock: 0 rows matched means someone already owns this lead —
    // abort the whole transaction.
    const { changes } = db.prepare(
      `UPDATE crm_leads SET assigned_to = @me, updated_at = CURRENT_TIMESTAMP WHERE id = @id AND assigned_to IS NULL`
    ).run({ me: username, id: candidate.id });
    if (!changes) throw Object.assign(new Error('הליד נתפס ע״י סוכן אחר'), { status: 409, code: 'taken' });

    db.prepare(`INSERT INTO crm_lead_handling (lead_id, username, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)`)
      .run(candidate.id, username);
    db.prepare(
      `INSERT INTO crm_activity_log (customer_id, lead_id, type, summary, actor)
       SELECT customer_id, id, 'claim', 'הליד נמשך מהתור', ? FROM crm_leads WHERE id = ?`
    ).run(username, candidate.id);

    // Bind the WhatsApp conversation to this lead + agent, if one exists.
    // crm_conversations.lead_id is written by nothing else today — this is
    // the first writer — so the shared inbox can finally show lead context.
    db.prepare(
      `UPDATE crm_conversations
          SET lead_id = @lead_id, assigned_to = COALESCE(assigned_to, @me)
        WHERE channel = 'whatsapp' AND lead_id IS NULL
          AND customer_id = (SELECT customer_id FROM crm_leads WHERE id = @lead_id)`
    ).run({ lead_id: candidate.id, me: username });

    return candidate.id;
  });

  const leadId = tx();
  publish('lead.claimed', { leadId, username });
  return { leadId, slots: { used: slotCount(db, username), max: maxClaimed } };
}

// "מלא תיבה" — top the agent up to max_claimed_leads in one click instead of
// N presses of "משוך ליד". Deliberately a LOOP over claimNext rather than a
// batch SQL: each pull must stay its own transaction so a mid-way empty pool
// (or another agent racing us for the last lead) keeps the leads already
// claimed instead of rolling the whole fill back.
function claimFill(db, username) {
  const maxClaimed = crmSettingsRow(db).max_claimed_leads || 4;
  const leadIds = [];
  let reason = null;
  while (slotCount(db, username) < maxClaimed) {
    try {
      leadIds.push(claimNext(db, username).leadId);
    } catch (err) {
      reason = err.code || 'error';
      break;
    }
  }
  return { leadIds, claimed: leadIds.length, reason, slots: { used: slotCount(db, username), max: maxClaimed } };
}

// The ONE extension point for "when does a lead free its slot" (user
// requirement: "we'll build more later" — adding a rule is one line here).
// 'quoted' plus every closed outcome. The reason string is the status key
// itself, which is what crm_lead_handling.end_reason records.
const RELEASE_ON_STATUS = Object.fromEntries(['quoted', ...CLOSED_KEYS].map((k) => [k, k]));

function releaseReason(prev, next) {
  if (next.status !== undefined && next.status !== prev.status && RELEASE_ON_STATUS[next.status]) return RELEASE_ON_STATUS[next.status];
  if (next.follow_up_date !== undefined && !prev.follow_up_date && next.follow_up_date) return 'follow_up_set';
  if (next.quote_id !== undefined && next.quote_id && !prev.quote_id) return 'quoted';
  return null;
}

// Closes the claim + its handling span. Safe to call when there is no live
// claim (no-op) — callers don't need to check first.
function releaseClaim(db, leadId, reason) {
  const claim = db.prepare(`SELECT * FROM crm_lead_claims WHERE lead_id = ?`).get(leadId);
  if (!claim) return null;
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM crm_lead_claims WHERE lead_id = ?`).run(leadId);
    // An EXPLICIT "שחרר ליד" gives the lead up entirely, so ownership has to go
    // with the slot — otherwise the lead is an orphan: no claim (invisible in
    // "הלידים שלי", which is claim-based) and assigned_to set (invisible to the
    // pool query, which requires assigned_to IS NULL), so nobody could ever
    // reach it again short of an admin's "החזר לבריכה". Every OTHER reason
    // (follow_up_set, quoted, won, ...) frees only the slot and keeps the lead
    // with its agent on purpose — that's the ownership/slot split this file
    // opens with.
    if (reason === 'released') {
      db.prepare(`UPDATE crm_leads SET assigned_to = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(leadId);
    }
    db.prepare(
      `UPDATE crm_lead_handling SET ended_at = CURRENT_TIMESTAMP, end_reason = ?,
         duration_sec = CAST((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400 AS INTEGER)
       WHERE lead_id = ? AND username = ? AND ended_at IS NULL`
    ).run(reason, leadId, claim.username);
  });
  tx();
  publish('lead.released', { leadId, username: claim.username, reason });
  return claim.username;
}

module.exports = { claimNext, claimFill, releaseClaim, releaseReason, slotCount, crmSettingsRow };
