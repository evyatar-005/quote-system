// CRM — "היום שלי": the sales agent's home screen. One endpoint that answers
// the four questions an agent opens the system to ask: what came in for me,
// who is waiting on my reply, who did I promise to call back today, and what
// happened to the quotes I sent.
//
// Deliberately ONE round-trip (not four) — this is the first screen loaded on
// every session, and four parallel calls each re-authenticating and
// re-querying SQLite is wasteful for what is a handful of small indexed reads.
//
// deps: { requireAuth }

module.exports = function registerMyDay(app, db, deps) {
  const { requireAuth } = deps;

  app.get('/api/crm/my-day', requireAuth, (req, res) => {
    const me = req.user.username;
    // Admins see everything (they act as a manager covering the floor);
    // agents see only what's assigned to them. Same force-scoping convention
    // as quoteList in entities.js — never trust a client-supplied filter.
    const isAdmin = req.user.role === 'admin';
    const mineOnly = isAdmin ? '' : ' AND l.assigned_to = @me ';

    // 1. New leads waiting for first contact.
    const newLeads = db.prepare(`
      SELECT l.id, l.title, l.status, l.created_at, l.follow_up_date,
             c.id AS customer_id, c.display_name, c.phone_e164, c.email,
             cam.name AS campaign_name
      FROM crm_leads l
      JOIN customers c ON c.id = l.customer_id
      LEFT JOIN crm_campaigns cam ON cam.id = l.campaign_id
      WHERE l.status = 'new' ${mineOnly}
      ORDER BY l.created_at DESC
      LIMIT 50
    `).all({ me });

    // 2. Conversations with an inbound message we haven't answered yet.
    //    last_inbound_at > last_outbound_at is the "ball is in our court" test;
    //    a never-answered thread (no outbound at all) counts too.
    const waiting = db.prepare(`
      SELECT conv.id, conv.customer_id, conv.unread_count, conv.last_inbound_at,
             c.display_name, c.phone_e164,
             (SELECT body FROM crm_messages m WHERE m.conversation_id = conv.id AND m.direction = 'in'
              ORDER BY m.id DESC LIMIT 1) AS last_message,
             CAST((julianday('now') - julianday(conv.last_inbound_at)) * 24 AS INTEGER) AS hours_waiting
      FROM crm_conversations conv
      LEFT JOIN customers c ON c.id = conv.customer_id
      WHERE conv.status != 'closed'
        AND conv.is_broadcast_only = 0
        AND conv.last_inbound_at IS NOT NULL
        AND (conv.last_outbound_at IS NULL OR conv.last_inbound_at > conv.last_outbound_at)
        ${isAdmin ? '' : ' AND (conv.assigned_to = @me OR conv.assigned_to IS NULL) '}
      ORDER BY conv.last_inbound_at ASC
      LIMIT 50
    `).all({ me });

    // 3. Follow-ups due today or overdue. Compared with date('now','localtime')
    //    — the host runs on Israel time and a UTC comparison would flip the
    //    "today" bucket for anything scheduled late in the evening.
    const followUps = db.prepare(`
      SELECT l.id, l.title, l.status, l.follow_up_date,
             c.id AS customer_id, c.display_name, c.phone_e164,
             CASE WHEN date(l.follow_up_date) < date('now','localtime') THEN 1 ELSE 0 END AS is_overdue
      FROM crm_leads l
      JOIN customers c ON c.id = l.customer_id
      WHERE l.follow_up_date IS NOT NULL
        AND date(l.follow_up_date) <= date('now','localtime')
        AND l.status NOT IN ('won','lost','disqualified')
        ${mineOnly}
      ORDER BY l.follow_up_date ASC
      LIMIT 50
    `).all({ me });

    // 4. Quotes this agent sent that are still awaiting a decision.
    const pendingQuotes = db.prepare(`
      SELECT id, quote_number, client_name, price_with_vat, status, created_at
      FROM signshop_quotes
      WHERE status = 'sent' ${isAdmin ? '' : ' AND created_by = @me '}
      ORDER BY created_at DESC
      LIMIT 20
    `).all({ me });

    res.json({
      counts: {
        new_leads: newLeads.length,
        waiting_replies: waiting.length,
        follow_ups: followUps.length,
        pending_quotes: pendingQuotes.length,
      },
      new_leads: newLeads,
      waiting_replies: waiting,
      follow_ups: followUps,
      pending_quotes: pendingQuotes,
    });
  });

  // Snooze / reschedule a follow-up straight from the My Day card, without
  // opening the lead. `date` is 'YYYY-MM-DD' (or null to clear).
  app.put('/api/crm/leads/:id/follow-up', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lead = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });
    const date = req.body?.date || null;
    // follow_up_source = 'agent' (even when clearing, date=null) is what stops
    // mondaySync's poll from silently overwriting/erasing this the next time
    // it runs — see updateFollowUp in mondaySync.js.
    db.prepare(`UPDATE crm_leads SET follow_up_date = ?, follow_up_source = 'agent', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(date, id);
    res.json(db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id));
  });
};
