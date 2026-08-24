// Automatic first assignment for a lead that arrives outside any campaign —
// today only the "צור ליד" action on an inbound WhatsApp conversation
// (routes/inbox.js). Before this, such a lead was always handed to whoever
// happened to click, which made distribution a function of who was watching
// the inbox rather than who actually had capacity.
//
// The rule, per the business owner:
//   1. Only agents who are working RIGHT NOW are eligible (users.last_seen_at
//      within PRESENCE_WINDOW_MINUTES — written by requireAuth, see auth.js).
//   2. Among those, the one with the most room in their queue wins.
//   3. Queue load counts only leads that are NOT still 'new'. A 'new' lead
//      "belongs to everyone" — it is sitting in the queue rather than being
//      worked — so counting it would penalise an agent for leads they have
//      not actually started on.
//   4. Nobody eligible → the lead goes to the pool (assigned_to stays NULL)
//      and any agent can pull it with the existing "משוך ליד" queue.

const { OPEN_KEYS } = require('./leadStatuses');

// How recently a user must have made an authenticated request to count as
// "working now". Generous on purpose: an agent reading a long thread or on a
// phone call is still at work, and wrongly skipping them just sends more
// leads to the pool — a safe failure, unlike handing a lead to someone who
// went home.
const PRESENCE_WINDOW_MINUTES = 20;

// Statuses that represent live work an agent is actually carrying. 'new' is
// excluded per rule 3 above; the closed outcomes are excluded because they
// are finished and must not make an agent look permanently busy.
const ACTIVE_LOAD_STATUSES = OPEN_KEYS.filter((k) => k !== 'new');

function crmSettings(db) {
  return db.prepare(`SELECT * FROM crm_settings WHERE id = 1`).get() || {};
}

// Agents eligible to receive a lead right now, least-loaded first.
// `slots` counts ACTIVE CLAIMS (the same thing max_claimed_leads caps in
// leadClaims.js) so this router can never push an agent past the cap that
// the manual pull-queue enforces — the two must agree or "משוך ליד" would
// start rejecting work the router just assigned.
function eligibleAgents(db) {
  const placeholders = ACTIVE_LOAD_STATUSES.map(() => '?').join(',');
  return db.prepare(`
    SELECT
      u.username,
      u.full_name,
      (SELECT COUNT(*) FROM crm_leads l
        WHERE l.assigned_to = u.username
          AND l.status IN (${placeholders})) AS activeLoad,
      (SELECT COUNT(*) FROM crm_lead_claims c
        WHERE c.username = u.username
          AND (c.expires_at IS NULL OR c.expires_at > CURRENT_TIMESTAMP)) AS slots
    FROM users u
    WHERE u.role = 'agent'
      AND u.last_seen_at IS NOT NULL
      AND u.last_seen_at > datetime('now', ?)
    ORDER BY activeLoad ASC, slots ASC, u.username ASC
  `).all(...ACTIVE_LOAD_STATUSES, `-${PRESENCE_WINDOW_MINUTES} minutes`);
}

// Returns the chosen agent's username, or null to mean "leave it in the pool".
// Never throws: an unroutable lead must still be created, just unassigned.
function pickAgentForLead(db) {
  try {
    const maxClaimed = crmSettings(db).max_claimed_leads || 4;
    const candidate = eligibleAgents(db).find((a) => a.slots < maxClaimed);
    return candidate ? candidate.username : null;
  } catch (err) {
    console.error('[leadRouting] agent selection failed, falling back to the pool:', err.message);
    return null;
  }
}

// Exposed for an admin-facing "who would get the next lead" view and for
// tests; the routing decision itself always goes through pickAgentForLead.
module.exports = { pickAgentForLead, eligibleAgents, PRESENCE_WINDOW_MINUTES, ACTIVE_LOAD_STATUSES };
