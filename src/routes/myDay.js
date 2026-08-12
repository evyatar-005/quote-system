// CRM — "היום שלי": the sales agent's home screen. Agents no longer see the
// raw lead pool (manager-only, see routes/leadQueue.js's /api/crm/lead-pool).
// due_follow_ups pops up a reminder the instant a scheduled callback's
// date+time arrives, rather than sitting as a passive list. waiting_unread
// is a simple binary count (unread_count > 0) — not an "overdue" heuristic —
// surfaced as a click-to-expand panel on the frontend, not a standing column.
//
// Deliberately ONE round-trip — this is the first screen loaded on every
// session.
//
// deps: { requireAuth }

const { releaseClaim, releaseReason } = require('../services/crm/leadClaims');

// How early a scheduled follow-up starts warning the agent (the pop-up counts
// down to the exact minute from here).
const PRE_ALERT_MINUTES = 20;

module.exports = function registerMyDay(app, db, deps) {
  const { requireAuth } = deps;

  app.get('/api/crm/my-day', requireAuth, (req, res) => {
    const me = req.user.username;
    const isAdmin = req.user.role === 'admin';
    const settings = db.prepare(`SELECT reply_overdue_minutes, max_claimed_leads, agents_see_follow_ups FROM crm_settings WHERE id = 1`).get() || {};
    const overdueMinutes = settings.reply_overdue_minutes || 60;
    const maxClaimed = settings.max_claimed_leads || 4;
    // Admins act as a manager covering the floor but are also agents for
    // their own claims — everyone gets "my claimed leads" scoped to @me.
    const mineOnly = ' AND l.assigned_to = @me ';

    // 1. My leads — everything I OWN and haven't closed, not just what holds a
    // slot right now. A follow-up frees the slot but keeps the lead with its
    // agent (see leadClaims.js); when this query was claim-based, that lead
    // vanished from the screen until FollowUpPopup happened to fire, so a missed
    // pop-up meant a lost lead. `holds_slot` marks the ones actually occupying
    // one of the max_claimed_leads slots, which is what "משוך ליד (X/4)" counts.
    // Each row carries the "טופל לאחרונה ע״י" line from its handling spans.
    const myLeads = db.prepare(`
      SELECT l.id, l.title, l.status, l.follow_up_date, l.quote_id, cl.acquired_at AS claimed_at,
             (cl.lead_id IS NOT NULL) AS holds_slot,
             c.id AS customer_id, c.display_name, c.phone_e164, c.email,
             cam.name AS campaign_name,
             conv.id AS conversation_id, conv.unread_count, conv.last_message_at,
             conv.last_inbound_at, conv.last_outbound_at,
             (SELECT m.body FROM crm_messages m WHERE m.conversation_id = conv.id ORDER BY m.id DESC LIMIT 1) AS last_message,
             (SELECT h.username FROM crm_lead_handling h WHERE h.lead_id = l.id ORDER BY h.id DESC LIMIT 1) AS last_handled_by,
             (SELECT u.full_name FROM users u WHERE u.username = (SELECT h.username FROM crm_lead_handling h WHERE h.lead_id = l.id ORDER BY h.id DESC LIMIT 1)) AS last_handled_by_name
      FROM crm_leads l
      LEFT JOIN crm_lead_claims cl ON cl.lead_id = l.id
             AND cl.username = @me AND (cl.expires_at IS NULL OR cl.expires_at > CURRENT_TIMESTAMP)
      JOIN customers c ON c.id = l.customer_id
      LEFT JOIN crm_campaigns cam ON cam.id = l.campaign_id
      LEFT JOIN crm_conversations conv ON conv.id = (
        SELECT c2.id FROM crm_conversations c2
        WHERE c2.lead_id = l.id OR c2.customer_id = l.customer_id
        ORDER BY c2.last_message_at DESC, c2.id DESC LIMIT 1
      )
      WHERE l.assigned_to = @me
        AND l.status NOT IN ('won','lost','disqualified')
      ORDER BY cl.acquired_at ASC, l.updated_at DESC
    `).all({ me });

    // 2. Follow-ups due RIGHT NOW (date+time precision) — powers a pop-up
    // reminder rather than a passive list. datetime() parses both a plain
    // 'YYYY-MM-DD' (due at local midnight — an all-day reminder) and a
    // 'YYYY-MM-DD HH:MM' (due at that exact minute — a customer who asked
    // for a callback at a specific hour) the same way, so no schema change
    // was needed to add hour-level precision. 'localtime' (unlike the
    // WhatsApp-reply query elsewhere in this file) because the agent enters
    // these as Israel wall-clock times. Hidden entirely for non-admins when
    // the manager turned off agents_see_follow_ups — not just visually, so
    // a disabled feature isn't sitting in the response payload either.
    const showFollowUps = isAdmin || settings.agents_see_follow_ups;
    // The window opens PRE_ALERT_MINUTES early so the pop-up can count down to
    // the exact minute the customer asked for, instead of appearing at it —
    // the agent needs a moment to open the lead and read the thread first.
    // due_in_seconds is negative once the time has passed (already overdue).
    const dueFollowUps = showFollowUps ? db.prepare(`
      SELECT l.id, l.title, l.follow_up_date, l.status, l.notes, l.value_estimate, l.quote_id,
             CAST((julianday(l.follow_up_date) - julianday('now','localtime')) * 86400 AS INTEGER) AS due_in_seconds,
             c.id AS customer_id, c.display_name, c.phone_e164, c.email,
             cam.name AS campaign_name,
             (SELECT m.body FROM crm_messages m
               WHERE m.conversation_id = (
                 SELECT c2.id FROM crm_conversations c2
                  WHERE c2.lead_id = l.id OR c2.customer_id = l.customer_id
                  ORDER BY c2.last_message_at DESC, c2.id DESC LIMIT 1)
               ORDER BY m.id DESC LIMIT 1) AS last_message
      FROM crm_leads l
      JOIN customers c ON c.id = l.customer_id
      LEFT JOIN crm_campaigns cam ON cam.id = l.campaign_id
      WHERE l.follow_up_date IS NOT NULL
        AND datetime(l.follow_up_date) <= datetime('now','localtime',@preAlert)
        AND l.status NOT IN ('won','lost','disqualified')
        ${mineOnly}
      ORDER BY l.follow_up_date ASC
      LIMIT 10
    `).all({ me, preAlert: `+${PRE_ALERT_MINUTES} minutes` }) : [];

    // 3. Conversations with an unread inbound message ("ממתין לתשובה").
    // Deliberately simple and binary — unread_count > 0 — not a "haven't
    // replied since their last message" heuristic (that was the previous,
    // now-removed design; it read as a duplicate of the pool concept and
    // needed an overdue-minutes threshold nobody asked for). unread_count
    // is reset the moment the thread is opened (see routes/inbox.js's
    // GET .../messages), so this can never get stuck non-zero.
    const waitingUnread = db.prepare(`
      SELECT conv.id, conv.customer_id, conv.lead_id, conv.unread_count, conv.last_inbound_at,
             c.display_name, c.phone_e164,
             (SELECT body FROM crm_messages m WHERE m.conversation_id = conv.id AND m.direction = 'in'
              ORDER BY m.id DESC LIMIT 1) AS last_message
      FROM crm_conversations conv
      LEFT JOIN customers c ON c.id = conv.customer_id
      WHERE conv.unread_count > 0
        AND conv.is_broadcast_only = 0
        ${isAdmin ? '' : ' AND (conv.assigned_to = @me OR conv.assigned_to IS NULL) '}
      ORDER BY conv.last_inbound_at ASC
      LIMIT 100
    `).all({ me });

    // 4. Quotes this agent sent that are still awaiting a manager decision.
    const pendingQuotes = db.prepare(`
      SELECT id, quote_number, client_name, price_with_vat, status, created_at
      FROM signshop_quotes
      WHERE status = 'sent' ${isAdmin ? '' : ' AND created_by = @me '}
      ORDER BY created_at DESC
      LIMIT 20
    `).all({ me });

    // 4b. The agent's own to-do on the quotes side: approved by a manager but
    // NOT yet issued to the customer. "Issued" isn't a column — it's the
    // existence of a Morning document for the quote (morning_documents_map),
    // the same source leadOutcome.js derives document state from. Waiting for a
    // manager's decision is someone else's task; THIS is the one that leaves a
    // customer sitting without the quote they were promised.
    // sent_at: a quote is CREATED already in status 'sent' (see routes/entities.js
    // quoteCreate → notifyAdminsOfSentQuote), so created_at IS the moment it went
    // for review. The exception is a manager-discount revision, which is created
    // when the MANAGER saves it — for those the send moment is the parent's
    // created_at, so that's what COALESCE reaches for first. Deliberately not
    // taken from the 'sent' notification: notifications are user-deletable
    // ("מחק הכל" in the bell), so they can't be trusted as a timestamp.
    // The approved discount is the gap to the parent quote: a revision saved out
    // of the manager review screen carries parent_quote_number, and the parent is
    // the price the agent originally asked for.
    // "Handled" is stricter than "a later revision exists": a revision that is
    // itself still sitting unissued does NOT clear the earlier one — only a
    // revision (at any depth: a revision of a revision is possible) that was
    // actually issued to the customer does. root_of walks the parent_quote_number
    // chain to a shared root for every quote, so "any quote sharing my root has
    // an issued document" is a single self-join instead of one query per depth.
    const readyToIssue = db.prepare(`
      WITH RECURSIVE root_of(quote_number, root_number) AS (
        SELECT quote_number, quote_number FROM signshop_quotes WHERE parent_quote_number IS NULL
        UNION ALL
        SELECT c.quote_number, r.root_number
        FROM signshop_quotes c JOIN root_of r ON c.parent_quote_number = r.quote_number
      )
      SELECT q.id, q.quote_number, q.client_name, q.price_with_vat, q.created_at,
             q.origin, q.parent_quote_number,
             COALESCE(
               (SELECT p.created_at FROM signshop_quotes p
                 WHERE p.quote_number = q.parent_quote_number ORDER BY p.id DESC LIMIT 1),
               q.created_at
             ) AS sent_at,
             (SELECT p.price_with_vat FROM signshop_quotes p
               WHERE p.quote_number = q.parent_quote_number
               ORDER BY p.id DESC LIMIT 1) AS parent_price_with_vat,
             (SELECT l.id FROM crm_leads l WHERE l.quote_id = q.id ORDER BY l.id DESC LIMIT 1) AS lead_id
      FROM signshop_quotes q
      JOIN root_of ro ON ro.quote_number = q.quote_number
      WHERE q.status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM morning_documents_map m WHERE m.quote_id = q.id)
        AND NOT EXISTS (
          SELECT 1 FROM root_of ro2
          JOIN signshop_quotes c ON c.quote_number = ro2.quote_number
          WHERE ro2.root_number = ro.root_number
            AND EXISTS (SELECT 1 FROM morning_documents_map m WHERE m.quote_id = c.id)
        )
        ${isAdmin ? '' : ' AND q.created_by = @me '}
      ORDER BY q.created_at DESC
      LIMIT 20
    `).all({ me });

    // 5. Manager-only: who hasn't shown up today, and what is waiting on them.
    // "Active today" = a session row created today; there is no last_login
    // column and sessions are created on login, so this is the honest signal
    // without a schema change. Only agents who actually have work today are
    // listed — an absent agent with nothing pending isn't the manager's problem.
    const inactiveAgents = isAdmin ? db.prepare(`
      SELECT * FROM (
      SELECT u.username, u.full_name,
             (SELECT COUNT(*) FROM crm_leads l WHERE l.assigned_to = u.username
                AND l.status NOT IN ('won','lost','disqualified')
                AND l.follow_up_date IS NOT NULL
                AND date(l.follow_up_date) <= date('now','localtime')) AS due_today,
             (SELECT COUNT(*) FROM crm_lead_claims c WHERE c.username = u.username
                AND (c.expires_at IS NULL OR c.expires_at > CURRENT_TIMESTAMP)) AS open_slots
      FROM users u
      WHERE u.role = 'agent'
        AND NOT EXISTS (
          SELECT 1 FROM sessions s WHERE s.user_id = u.id
            AND date(s.created_at,'localtime') = date('now','localtime')
        )
      ) WHERE due_today > 0 OR open_slots > 0
      ORDER BY due_today DESC, open_slots DESC
    `).all() : [];

    const payload = {
      view: isAdmin ? 'manager' : 'agent',
      settings: { max_claimed_leads: maxClaimed, reply_overdue_minutes: overdueMinutes, agents_see_follow_ups: !!settings.agents_see_follow_ups, follow_up_pre_alert_minutes: PRE_ALERT_MINUTES },
      counts: {
        my_leads: myLeads.length,
        slots_used: myLeads.filter((l) => l.holds_slot).length,
        inactive_agents: inactiveAgents.length,
        due_follow_ups: dueFollowUps.length,
        waiting_unread: waitingUnread.length,
        pending_quotes: pendingQuotes.length,
        ready_to_issue: readyToIssue.length,
      },
      my_leads: myLeads,
      inactive_agents: inactiveAgents,
      due_follow_ups: dueFollowUps,
      waiting_unread: waitingUnread,
      pending_quotes: pendingQuotes,
      ready_to_issue: readyToIssue,
    };

    // Neither the lead pool nor the per-agent workload strip is surfaced
    // here (per user feedback: My Day is the personal work screen, even for
    // a manager acting as an agent) — both stay available standalone via
    // GET /api/crm/lead-pool and GET /api/crm/agents/workload, surfaced on
    // the CrmLeads.jsx manager reports screen instead.

    res.json(payload);
  });

  // Snooze / reschedule a follow-up. `date` is 'YYYY-MM-DD' (due at local
  // midnight) or 'YYYY-MM-DD HH:MM' (due at that exact minute — a customer
  // who asked for a callback at a specific hour), or null to clear.
  app.put('/api/crm/leads/:id/follow-up', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lead = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });
    // Ownership check — the claim holder, the lead's owner, or an admin.
    // Without this any authenticated user could reschedule (and thereby
    // release the slot of) any lead in the system.
    const claim = db.prepare(`SELECT username FROM crm_lead_claims WHERE lead_id = ?`).get(id);
    const isHolder = claim?.username === req.user.username;
    const isOwner = lead.assigned_to === req.user.username;
    if (!isHolder && !isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'אין לך הרשאה לתזמן פולואפ לליד זה' });
    }
    const date = req.body?.date || null;
    // follow_up_source = 'agent' (even when clearing, date=null) is what stops
    // mondaySync's poll from silently overwriting/erasing this the next time
    // it runs — see updateFollowUp in mondaySync.js.
    db.prepare(`UPDATE crm_leads SET follow_up_date = ?, follow_up_source = 'agent', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(date, id);
    const updated = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id);
    // Release trigger (a) — setting a date frees the SLOT, not the lead
    // (see leadClaims.js header). Clearing a date (date === null) must not
    // release; releaseReason already encodes that via `!prev && next`.
    const reason = releaseReason(lead, { follow_up_date: date });
    if (reason) releaseClaim(db, id, reason);
    res.json(updated);
  });
};
