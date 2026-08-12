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

    // 1. My claimed leads (requirement: "הלידים שלי (X/4)"). Each carries the
    // "טופל לאחרונה ע״י" line from the lead's own handling spans.
    const myLeads = db.prepare(`
      SELECT l.id, l.title, l.status, l.follow_up_date, cl.acquired_at AS claimed_at,
             c.id AS customer_id, c.display_name, c.phone_e164, c.email,
             cam.name AS campaign_name,
             (SELECT h.username FROM crm_lead_handling h WHERE h.lead_id = l.id ORDER BY h.id DESC LIMIT 1) AS last_handled_by,
             (SELECT u.full_name FROM users u WHERE u.username = (SELECT h.username FROM crm_lead_handling h WHERE h.lead_id = l.id ORDER BY h.id DESC LIMIT 1)) AS last_handled_by_name
      FROM crm_lead_claims cl
      JOIN crm_leads l ON l.id = cl.lead_id
      JOIN customers c ON c.id = l.customer_id
      LEFT JOIN crm_campaigns cam ON cam.id = l.campaign_id
      WHERE cl.username = @me AND (cl.expires_at IS NULL OR cl.expires_at > CURRENT_TIMESTAMP)
      ORDER BY cl.acquired_at ASC
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
    const dueFollowUps = showFollowUps ? db.prepare(`
      SELECT l.id, l.title, l.follow_up_date,
             c.id AS customer_id, c.display_name, c.phone_e164
      FROM crm_leads l
      JOIN customers c ON c.id = l.customer_id
      WHERE l.follow_up_date IS NOT NULL
        AND datetime(l.follow_up_date) <= datetime('now','localtime')
        AND l.status NOT IN ('won','lost','disqualified')
        ${mineOnly}
      ORDER BY l.follow_up_date ASC
      LIMIT 10
    `).all({ me }) : [];

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

    // 4. Quotes this agent sent that are still awaiting a decision.
    const pendingQuotes = db.prepare(`
      SELECT id, quote_number, client_name, price_with_vat, status, created_at
      FROM signshop_quotes
      WHERE status = 'sent' ${isAdmin ? '' : ' AND created_by = @me '}
      ORDER BY created_at DESC
      LIMIT 20
    `).all({ me });

    const payload = {
      view: isAdmin ? 'manager' : 'agent',
      settings: { max_claimed_leads: maxClaimed, reply_overdue_minutes: overdueMinutes, agents_see_follow_ups: !!settings.agents_see_follow_ups },
      counts: {
        my_leads: myLeads.length,
        due_follow_ups: dueFollowUps.length,
        waiting_unread: waitingUnread.length,
        pending_quotes: pendingQuotes.length,
      },
      my_leads: myLeads,
      due_follow_ups: dueFollowUps,
      waiting_unread: waitingUnread,
      pending_quotes: pendingQuotes,
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
