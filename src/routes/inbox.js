// CRM Phase 3 — shared WhatsApp inbox: conversation list/detail, claim/
// heartbeat/release locking, sending replies (via the outbox), and the SSE
// live-update stream. Locking is DB-authoritative (see crm_conversation_locks
// PRIMARY KEY on conversation_id) — SSE only makes the UI feel live.
//
// deps: { requireAuth, requireAdmin }

const { enqueue, enqueueText } = require('../services/channels/whatsapp/outbox');
const { fromChatId } = require('../services/crm/phone');
const { isSessionOpen } = require('../services/channels/whatsapp/sessionWindow');
const { getActiveWhatsApp } = require('../services/channels');
const { publish, subscribe } = require('../services/crm/realtime');
const { slotCount, crmSettingsRow } = require('../services/crm/leadClaims');
const { pickAgentForLead } = require('../services/crm/leadRouting');
const { drainNow } = require('../services/crm/jobs');

// Must stay in sync with SESSION_TTL_MS in routes/auth.js — the SSE stream
// below authenticates its own token (EventSource can't send headers) and has
// to apply the exact same expiry rule as userFromRequest.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

module.exports = function registerInbox(app, db, deps) {
  const { requireAuth, requireAdmin } = deps;

  function lockTtlSec() {
    const s = db.prepare(`SELECT lock_ttl_sec FROM crm_settings WHERE id = 1`).get();
    return (s && s.lock_ttl_sec) || 120;
  }

  function overdueMinutes() {
    const s = db.prepare(`SELECT reply_overdue_minutes FROM crm_settings WHERE id = 1`).get();
    return (s && s.reply_overdue_minutes) || 60;
  }

  // "Waiting too long for a reply" — byte-for-byte the same expression as
  // crm.js's campaigns-overview exceptions list, so the manager report and
  // the inbox can never disagree about which conversation is late. UTC
  // ('now' with no 'localtime') on purpose: last_inbound_at is written with
  // CURRENT_TIMESTAMP, which is also UTC.
  const MINUTES_WAITING_SQL = `CAST((julianday('now') - julianday(c.last_inbound_at)) * 1440 AS INTEGER)`;
  const IS_OVERDUE_SQL = `(c.unread_count > 0 AND c.last_inbound_at IS NOT NULL AND ${MINUTES_WAITING_SQL} >= @overdueMinutes)`;

  // WhatsApp shows the customer one business identity regardless of who on
  // the team typed, so the agent's name can only live inside the message
  // body. Prefixed here — the one route both the shared inbox and the lead
  // workspace send through — and deliberately NOT inside outbox.enqueue,
  // so campaigns and auto-sent documents stay unsigned.
  //
  // Skipped when the agent already opened with their own name, so a manual
  // "היי, כאן דני" doesn't come out doubled.
  function withSignature(body, username) {
    const text = (body || '').toString();
    const s = db.prepare(`SELECT agent_signature_enabled, agent_signature_template FROM crm_settings WHERE id = 1`).get();
    if (!s || !s.agent_signature_enabled) return text;
    // full_name ONLY — never fall back to the username. A customer reading
    // "*sales3* מפרינטלה:" is worse than no signature at all. Creation of an
    // agent/admin now requires a full name (routes/auth.js), so this only
    // guards accounts that predate that rule.
    const user = db.prepare(`SELECT full_name FROM users WHERE username = ?`).get(username);
    // First name only. A customer reading "*אביתר אבינועם* מפרינטלה:" gets a
    // formal full name where a person would just say their first — and the
    // surname is noise the customer has no use for. The full name is still
    // what the CRM shows internally on each bubble (sent_by_name), so the team
    // can still tell two agents with the same first name apart.
    const name = user && user.full_name && user.full_name.trim().split(/\s+/)[0];
    if (!name) return text;
    if (text.includes(name)) return text;
    const line = (s.agent_signature_template || '*{agent}*').replace(/\{agent\}/g, name);
    return `${line}\n${text}`;
  }

  function conversationWithLock(id) {
    const row = db.prepare(
      `SELECT c.*, cu.display_name AS customer_name, cu.phone_e164 AS customer_phone,
              l.username AS lock_username, l.expires_at AS lock_expires_at,
              ld.status AS lead_status, ld.title AS lead_title
       FROM crm_conversations c
       LEFT JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN crm_conversation_locks l ON l.conversation_id = c.id AND l.expires_at > CURRENT_TIMESTAMP
       LEFT JOIN crm_leads ld ON ld.id = c.lead_id
       WHERE c.id = ?`
    ).get(id);
    if (!row) return row;
    // Only meaningful for a provider that lives under the WhatsApp 24h rule
    // (InforU). GreenAPI reports the window as always-open so its composer
    // behaves exactly as it always has.
    const requiresWindow = getActiveWhatsApp(db).capabilities(db).requiresSessionWindow;
    const win = requiresWindow ? isSessionOpen(db, row.channel_thread_id) : { open: true, expiresAt: null };
    row.session_window_open = win.open;
    row.session_expires_at = win.expiresAt;
    return row;
  }

  // ── List / detail ──────────────────────────────────────────────────────
  app.get('/api/inbox/conversations', requireAuth, (req, res) => {
    const { status, channel, include_broadcast, q, filter } = req.query;
    const where = [];
    // Named (not positional) params: with q/filter/status/channel all
    // optional, positional `?` ordering becomes impossible to follow. Note
    // better-sqlite3 THROWS on a bound param the SQL never references, so
    // every key here is added only alongside the clause that uses it —
    // except overdueMinutes, which the SELECT always references.
    const params = { overdueMinutes: overdueMinutes() };

    // Conversations created purely by a דיוור (bulk broadcast) are hidden
    // from the default list until the customer replies — otherwise one
    // 200-recipient blast buries every real conversation. The campaign
    // detail screen passes ?include_broadcast=1 to see them anyway.
    if (!include_broadcast) where.push('c.is_broadcast_only = 0');
    // A thread with no messages at all isn't inbox material — since opening a
    // lead's workspace creates its WhatsApp conversation up front (see
    // routes/leadQueue.js POST /leads/:id/conversation), the shared inbox would
    // otherwise fill with blank rows for every lead anyone merely looked at.
    where.push('EXISTS (SELECT 1 FROM crm_messages m WHERE m.conversation_id = c.id)');
    if (status) { where.push('c.status = @status'); params.status = status; }
    if (channel) { where.push('c.channel = @channel'); params.channel = channel; }

    if (q && q.trim()) {
      // channel_thread_id is in there so a number with no saved name is still
      // findable by typing the digits.
      where.push('(cu.display_name LIKE @q OR cu.phone_e164 LIKE @q OR c.channel_thread_id LIKE @q)');
      params.q = `%${q.trim()}%`;
    }

    // Both "mine" and "free" read off the lock JOIN below, which is already
    // filtered to live locks — so a lock that expired counts as free with no
    // extra condition.
    switch (filter) {
      case 'mine':
        where.push('l.username = @me');
        params.me = req.user.username;
        break;
      case 'free':
        where.push('l.username IS NULL');
        break;
      case 'overdue':
        where.push(IS_OVERDUE_SQL);
        break;
      // "The customer wrote and nobody has answered" — read off the two
      // timestamps rather than unread_count, so opening a thread and walking
      // away doesn't clear it. Only an actual outbound reply does. Same rule
      // the leads screen's tiles use, which is the point: they now count the
      // SAME thing, from the same table.
      case 'awaiting':
        where.push(`c.last_inbound_at IS NOT NULL AND (c.last_outbound_at IS NULL OR c.last_inbound_at > c.last_outbound_at)`);
        break;
      case 'awaiting_overdue':
        where.push(`c.last_inbound_at IS NOT NULL AND (c.last_outbound_at IS NULL OR c.last_inbound_at > c.last_outbound_at)
                    AND ${MINUTES_WAITING_SQL} >= @overdueMinutes`);
        break;
      default:
        break; // 'all' / absent
    }

    // "Nobody ever opened a lead for this customer." Deliberately checked
    // against the CUSTOMER, not just c.lead_id: a thread can be unlinked while
    // the same person already has an open lead from another conversation, and
    // listing them as lead-less would be wrong. Closed outcomes don't count —
    // a customer whose only lead was lost months ago genuinely has no live
    // lead for the message they just sent.
    if (req.query.without_lead === '1') {
      where.push(`c.lead_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM crm_leads gl
         WHERE gl.customer_id = c.customer_id
           AND gl.status NOT IN ('won','lost','disqualified')
      )`);
    }

    let sql = `
      SELECT c.*, cu.display_name AS customer_name, cu.phone_e164 AS customer_phone,
             l.username AS lock_username, l.expires_at AS lock_expires_at,
             -- Last-message preview, so the list can look like a real WhatsApp
             -- chat list instead of name+phone only. Correlated subqueries are
             -- fine here: the list is capped at 200 rows and crm_messages is
             -- indexed on conversation_id.
             (SELECT m.body      FROM crm_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
             (SELECT m.direction FROM crm_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_direction,
             (SELECT m.message_type FROM crm_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_type,
             CASE WHEN c.last_inbound_at IS NULL THEN NULL ELSE ${MINUTES_WAITING_SQL} END AS minutes_waiting,
             CASE WHEN ${IS_OVERDUE_SQL} THEN 1 ELSE 0 END AS is_overdue,
             -- Rides on every row so a caller that only needs the count can
             -- ask for LIMIT 1 instead of paging 200 rows to count them.
             COUNT(*) OVER() AS total_count,
             -- Who owns this thread. c.assigned_to is only a username, and a
             -- list that says "sapir" instead of a person's name is unreadable
             -- to a manager scanning who is sitting on unanswered customers.
             -- Falls back to the LEAD's owner: a conversation created before
             -- anyone claimed it has no assigned_to of its own, but the lead
             -- behind it does, and that is still the answer to "whose is this".
             COALESCE(au.full_name, c.assigned_to, lau.full_name, ld.assigned_to) AS assigned_to_name
      FROM crm_conversations c
      LEFT JOIN customers cu ON cu.id = c.customer_id
      LEFT JOIN crm_conversation_locks l ON l.conversation_id = c.id AND l.expires_at > CURRENT_TIMESTAMP
      LEFT JOIN users au ON au.username = c.assigned_to
      LEFT JOIN crm_leads ld ON ld.id = c.lead_id
      LEFT JOIN users lau ON lau.username = ld.assigned_to`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    // Deliberate deviation from WhatsApp's pure recency order: a conversation
    // that has been waiting past the manager's threshold outranks a fresher
    // one. Without this the most urgent thread sinks out of view exactly when
    // it matters most. Not a bug — don't "fix" it back to recency-only.
    sql += ` ORDER BY is_overdue DESC, c.last_message_at DESC NULLS LAST, c.created_at DESC LIMIT 200`;
    res.json(db.prepare(sql).all(params));
  });

  // ── Lead from conversation ─────────────────────────────────────────────
  // An inbound WhatsApp message auto-creates a `customers` row but never a
  // lead, so a conversation from an unknown number is invisible to the queue,
  // to My Day and to every campaign report. This is the manual bridge.
  // Deliberately manual: auto-creating a lead per inbound message would pour
  // spam and wrong numbers straight into the pool and the analytics.

  app.get('/api/inbox/conversations/:id/lead-candidates', requireAuth, (req, res) => {
    const conversation = db.prepare(`SELECT * FROM crm_conversations WHERE id = ?`).get(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'שיחה לא נמצאה' });
    if (!conversation.customer_id) return res.json([]);
    res.json(db.prepare(
      `SELECT l.id, l.title, l.status, l.assigned_to, cam.name AS campaign_name,
              COALESCE(l.source_created_at, l.created_at) AS at
         FROM crm_leads l
         LEFT JOIN crm_campaigns cam ON cam.id = l.campaign_id
        WHERE l.customer_id = ? AND l.status NOT IN ('won','lost','disqualified')
        ORDER BY at DESC LIMIT 20`
    ).all(conversation.customer_id));
  });

  // Best-effort starting values for the "צור ליד" form. Everything here is
  // already-known data (the customer row built from the inbound WhatsApp
  // message), never a guess: the agent still confirms every field. Splitting
  // display_name on the first space is the one inference, and only when no
  // explicit first/last name was ever captured — a WhatsApp profile name is
  // free text, so the agent is expected to correct it.
  app.get('/api/inbox/conversations/:id/lead-prefill', requireAuth, (req, res) => {
    const conversation = db.prepare(`SELECT * FROM crm_conversations WHERE id = ?`).get(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'שיחה לא נמצאה' });

    const customer = conversation.customer_id
      ? db.prepare(`SELECT * FROM customers WHERE id = ?`).get(conversation.customer_id)
      : null;

    let firstName = customer?.first_name || '';
    let lastName = customer?.last_name || '';
    if (!firstName && !lastName && customer?.display_name) {
      const parts = String(customer.display_name).trim().split(/\s+/);
      firstName = parts.shift() || '';
      lastName = parts.join(' ');
    }

    res.json({
      first_name: firstName,
      last_name: lastName,
      // The phone is the one field that is genuinely authoritative here — it
      // is the chat's own identity, normalized on inbound.
      phone: customer?.phone_e164 || (conversation.chat_id ? fromChatId(conversation.chat_id) : '') || '',
      email: customer?.email || '',
      company: customer?.company || '',
      address: customer?.address || '',
      vat_id: customer?.vat_id || '',
    });
  });

  // Empty body creates a new lead; { lead_id } links an existing one.
  app.post('/api/inbox/conversations/:id/lead', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const me = req.user.username;
    const conversation = db.prepare(`SELECT * FROM crm_conversations WHERE id = ?`).get(id);
    if (!conversation) return res.status(404).json({ error: 'שיחה לא נמצאה' });
    // Idempotency matters: this button lives in a panel that re-renders on
    // every SSE event, so a double-fire is normal rather than exceptional.
    if (conversation.lead_id) return res.status(409).json({ error: 'לשיחה כבר משויך ליד' });
    if (!conversation.customer_id) return res.status(400).json({ error: 'לשיחה אין לקוח משויך' });

    // Creating a lead is taking ownership of the customer — same bar as
    // replying. Admins bypass, as they do for force-claim.
    const lock = db.prepare(`SELECT * FROM crm_conversation_locks WHERE conversation_id = ? AND expires_at > CURRENT_TIMESTAMP`).get(id);
    if (req.user.role !== 'admin' && (!lock || lock.username !== me)) {
      return res.status(409).json({ error: 'יש לנעול את השיחה לפני יצירת ליד' });
    }

    const linkId = req.body && req.body.lead_id;
    try {
      if (linkId) {
        const lead = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(linkId);
        if (!lead) return res.status(404).json({ error: 'הליד לא נמצא' });
        // Binding a conversation to another customer's lead would make
        // leadContext.js's `lead_id = ? OR customer_id = ?` lookup return
        // contradictory rows.
        if (lead.customer_id !== conversation.customer_id) {
          return res.status(400).json({ error: 'הליד שייך ללקוח אחר' });
        }
        db.prepare(`UPDATE crm_conversations SET lead_id = ?, assigned_to = COALESCE(assigned_to, ?) WHERE id = ?`)
          .run(lead.id, me, id);
        publish('conversation.updated', { conversationId: id });
        return res.json({ lead, conversation: conversationWithLock(id) });
      }

      // Details the agent must capture before a lead exists at all. These are
      // the same fields a quote needs, so the lead can become a quote later
      // without chasing the customer again. Email is deliberately NOT
      // required — it is almost never knowable from WhatsApp, and blocking on
      // it would just stop real leads being recorded; the lead is flagged
      // instead (see missing_details below).
      const body = req.body || {};
      const str = (v) => (v == null ? '' : String(v).trim());
      const firstName = str(body.first_name);
      const lastName = str(body.last_name);
      const phone = str(body.phone);
      const email = str(body.email);
      const missingFields = [];
      if (!firstName) missingFields.push('שם פרטי');
      if (!lastName) missingFields.push('שם משפחה');
      if (!phone) missingFields.push('טלפון');
      if (missingFields.length) {
        return res.status(400).json({ error: `חסרים פרטי חובה: ${missingFields.join(', ')}`, code: 'missing_required' });
      }

      const settings = crmSettingsRow(db);
      const maxClaimed = settings.max_claimed_leads || 4;
      const ttlHours = settings.lead_claim_ttl_hours || 0;

      // Who should actually own this lead — an agent working right now with
      // the most room, or nobody (the pool). Resolved BEFORE the transaction:
      // it only reads, and db.transaction() bodies here are strictly
      // synchronous critical sections (see leadClaims.js).
      const assignee = pickAgentForLead(db);

      const tx = db.transaction(() => {
        // A slot check still applies, but only when the lead is actually
        // being given to somebody. pickAgentForLead already respects the cap;
        // this is the belt-and-braces re-check inside the transaction, and it
        // is what stops "create lead" being an unlimited back door around the
        // queue's per-agent cap.
        if (assignee && slotCount(db, assignee) >= maxClaimed) {
          throw Object.assign(new Error(`הגעת למקסימום ${maxClaimed} לידים במקביל`), { status: 409, code: 'slot_limit' });
        }

        // The customer row was created from an inbound message and carries
        // little more than a phone number — write back what the agent just
        // confirmed. COALESCE-style guarding is deliberately NOT used: the
        // agent's typed value is the corrected one and must win.
        db.prepare(
          `UPDATE customers
              SET first_name = @first_name,
                  last_name  = @last_name,
                  display_name = @display_name,
                  email    = COALESCE(NULLIF(@email, ''), email),
                  company  = COALESCE(NULLIF(@company, ''), company),
                  address  = COALESCE(NULLIF(@address, ''), address),
                  vat_id   = COALESCE(NULLIF(@vat_id, ''), vat_id),
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = @id`
        ).run({
          id: conversation.customer_id,
          first_name: firstName,
          last_name: lastName,
          display_name: `${firstName} ${lastName}`.trim(),
          email,
          company: str(body.company),
          address: str(body.address),
          vat_id: str(body.vat_id),
        });
        const lastIn = db.prepare(
          `SELECT body FROM crm_messages WHERE conversation_id = ? AND direction = 'in' ORDER BY id DESC LIMIT 1`
        ).get(id);
        const title = lastIn && lastIn.body ? String(lastIn.body).replace(/\s+/g, ' ').trim().slice(0, 60) : null;

        // campaign_id stays NULL — a synthetic "inbound WhatsApp" campaign
        // would show up in campaigns-overview with no spend and no audience
        // and corrupt every funnel number. source distinguishes these from
        // monday-synced and manually-typed leads, which is the whole reason
        // auto-creation was rejected.
        // assigned_to may be NULL — that is the "goes to the pool" outcome,
        // and it is what makes the lead visible to the existing "משוך ליד"
        // queue (which only offers leads with no owner).
        const leadId = db.prepare(
          `INSERT INTO crm_leads (customer_id, campaign_id, source, status, title, assigned_to)
           VALUES (?, NULL, 'whatsapp_inbound', 'new', ?, ?)`
        ).run(conversation.customer_id, title, assignee).lastInsertRowid;

        // A claim/handling row only makes sense for a lead someone actually
        // owns. A pooled lead must stay unclaimed or the pull-queue would
        // never offer it to anyone.
        if (assignee) {
          const expiresAt = ttlHours > 0 ? new Date(Date.now() + ttlHours * 3600e3).toISOString() : null;
          db.prepare(`INSERT INTO crm_lead_claims (lead_id, username, acquired_at, expires_at) VALUES (?, ?, CURRENT_TIMESTAMP, ?)`)
            .run(leadId, assignee, expiresAt);
          db.prepare(`INSERT INTO crm_lead_handling (lead_id, username, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)`)
            .run(leadId, assignee);
        }

        const routedNote = assignee
          ? `ליד נוצר משיחת ווצאפ ושויך אוטומטית ל-${assignee}`
          : 'ליד נוצר משיחת ווצאפ ונכנס לבריכת הלידים';
        db.prepare(
          `INSERT INTO crm_activity_log (customer_id, lead_id, type, summary, actor)
           VALUES (?, ?, 'note', ?, ?)`
        ).run(conversation.customer_id, leadId, routedNote, me);
        db.prepare(`UPDATE crm_conversations SET lead_id = ?, assigned_to = COALESCE(assigned_to, ?) WHERE id = ?`)
          .run(leadId, assignee || me, id);
        return leadId;
      });

      const leadId = tx();
      publish('conversation.updated', { conversationId: id });
      // Derived, never stored: "missing details" must stop being true the
      // moment someone fills the email in, and a stored flag would go stale
      // the first time a customer is edited from any other screen.
      const customer = db.prepare(`SELECT email FROM customers WHERE id = ?`).get(conversation.customer_id);
      res.status(201).json({
        lead: db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(leadId),
        conversation: conversationWithLock(id),
        assigned_to: assignee,
        missing_details: !(customer && customer.email),
      });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message, code: err.code });
    }
  });

  app.get('/api/inbox/conversations/:id/messages', requireAuth, (req, res) => {
    let conversation = conversationWithLock(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'שיחה לא נמצאה' });
    // sent_by is a username; the thread needs a person's name. Joined here
    // rather than resolved client-side so it works for agents too — the agent
    // list endpoint is admin-only, and every role needs to see who replied on
    // a conversation the whole team shares.
    const messages = db.prepare(
      `SELECT m.*, u.full_name AS sent_by_name
         FROM crm_messages m
         LEFT JOIN users u ON u.username = m.sent_by
        WHERE m.conversation_id = ? ORDER BY m.id ASC LIMIT 500`
    ).all(conversation.id);
    // Fetching the thread IS reading it — reset unread_count here so it
    // never drifts, regardless of which screen opened the thread (this
    // endpoint is the one thing CrmInbox.jsx and the lead workspace's
    // ConversationThread both go through). Previously nothing ever reset
    // this counter, so "ממתין לתשובה" (My Day) would stay stuck forever.
    if (conversation.unread_count > 0) {
      db.prepare(`UPDATE crm_conversations SET unread_count = 0 WHERE id = ?`).run(conversation.id);
      conversation = { ...conversation, unread_count: 0 };
      publish('conversation.updated', { conversationId: conversation.id });
    }
    res.json({ conversation, messages });
  });

  app.put('/api/inbox/conversations/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare(`SELECT * FROM crm_conversations WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'שיחה לא נמצאה' });
    const body = req.body || {};
    const row = { id };
    const setCols = [];
    if ('status' in body) {
      row.status = body.status; setCols.push('status');
      if (body.status === 'closed') { row.closed_at = new Date().toISOString(); row.closed_by = req.user.username; setCols.push('closed_at', 'closed_by'); }
    }
    if ('assigned_to' in body) { row.assigned_to = body.assigned_to; setCols.push('assigned_to'); }
    if ('unread_count' in body) { row.unread_count = body.unread_count; setCols.push('unread_count'); }
    if (setCols.length) {
      db.prepare(`UPDATE crm_conversations SET ${setCols.map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`).run(row);
    }
    publish('conversation.updated', { id });
    res.json(conversationWithLock(id));
  });

  // ── Locking (claim/heartbeat/release/force-claim) ─────────────────────────
  app.post('/api/inbox/conversations/:id/claim', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const conversation = db.prepare(`SELECT * FROM crm_conversations WHERE id = ?`).get(id);
    if (!conversation) return res.status(404).json({ error: 'שיחה לא נמצאה' });

    const expiresAt = new Date(Date.now() + lockTtlSec() * 1000).toISOString();
    // Only inserts/updates when no lock exists or the existing one expired —
    // the WHERE on DO UPDATE makes this a true "claim if free" upsert.
    const { changes } = db.prepare(
      `INSERT INTO crm_conversation_locks (conversation_id, username, acquired_at, heartbeat_at, expires_at)
       VALUES (@id, @username, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, @expires_at)
       ON CONFLICT(conversation_id) DO UPDATE SET
         username = excluded.username, acquired_at = CURRENT_TIMESTAMP,
         heartbeat_at = CURRENT_TIMESTAMP, expires_at = excluded.expires_at
       WHERE crm_conversation_locks.expires_at < CURRENT_TIMESTAMP OR crm_conversation_locks.username = @username`
    ).run({ id, username: req.user.username, expires_at: expiresAt });

    const lock = db.prepare(`SELECT * FROM crm_conversation_locks WHERE conversation_id = ?`).get(id);
    if (lock.username !== req.user.username) {
      return res.status(409).json({ error: 'השיחה כבר בטיפול', locked_by: lock.username, expires_at: lock.expires_at });
    }
    if (changes) {
      db.prepare(`INSERT INTO crm_conversation_handling (conversation_id, username, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)`)
        .run(id, req.user.username);
    }
    publish('lock.claimed', { conversationId: id, username: req.user.username });
    res.json({ ok: true, expires_at: lock.expires_at });
  });

  app.post('/api/inbox/conversations/:id/heartbeat', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lock = db.prepare(`SELECT * FROM crm_conversation_locks WHERE conversation_id = ?`).get(id);
    if (!lock || lock.username !== req.user.username) return res.status(409).json({ error: 'אין ברשותך נעילה על שיחה זו' });
    const expiresAt = new Date(Date.now() + lockTtlSec() * 1000).toISOString();
    db.prepare(`UPDATE crm_conversation_locks SET heartbeat_at = CURRENT_TIMESTAMP, expires_at = ? WHERE conversation_id = ?`).run(expiresAt, id);
    res.json({ ok: true, expires_at: expiresAt });
  });

  function releaseLock(id, username, reason) {
    const lock = db.prepare(`SELECT * FROM crm_conversation_locks WHERE conversation_id = ?`).get(id);
    if (!lock) return;
    db.prepare(`DELETE FROM crm_conversation_locks WHERE conversation_id = ?`).run(id);
    db.prepare(
      `UPDATE crm_conversation_handling SET ended_at = CURRENT_TIMESTAMP, end_reason = ?,
         duration_sec = CAST((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400 AS INTEGER)
       WHERE conversation_id = ? AND username = ? AND ended_at IS NULL`
    ).run(reason, id, lock.username);
    publish('lock.released', { conversationId: id, reason });
  }

  app.post('/api/inbox/conversations/:id/release', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lock = db.prepare(`SELECT * FROM crm_conversation_locks WHERE conversation_id = ?`).get(id);
    if (lock && lock.username !== req.user.username) return res.status(409).json({ error: 'הנעילה שייכת לסוכן אחר' });
    releaseLock(id, req.user.username, 'released');
    res.json({ ok: true });
  });

  app.post('/api/inbox/conversations/:id/force-claim', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    releaseLock(id, req.user.username, 'stolen');
    const expiresAt = new Date(Date.now() + lockTtlSec() * 1000).toISOString();
    db.prepare(
      `INSERT INTO crm_conversation_locks (conversation_id, username, expires_at) VALUES (?, ?, ?)`
    ).run(id, req.user.username, expiresAt);
    db.prepare(`INSERT INTO crm_conversation_handling (conversation_id, username, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)`)
      .run(id, req.user.username);
    publish('lock.claimed', { conversationId: id, username: req.user.username });
    res.json({ ok: true, expires_at: expiresAt });
  });

  // ── Send a reply ───────────────────────────────────────────────────────
  app.post('/api/inbox/conversations/:id/messages', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const conversation = db.prepare(`SELECT * FROM crm_conversations WHERE id = ?`).get(id);
    if (!conversation) return res.status(404).json({ error: 'שיחה לא נמצאה' });
    const lock = db.prepare(`SELECT * FROM crm_conversation_locks WHERE conversation_id = ? AND expires_at > CURRENT_TIMESTAMP`).get(id);
    if (!lock || lock.username !== req.user.username) {
      return res.status(409).json({ error: 'יש לנעול את השיחה לפני מענה' });
    }
    const customer = conversation.customer_id ? db.prepare(`SELECT phone_e164 FROM customers WHERE id = ?`).get(conversation.customer_id) : null;
    const toE164 = customer?.phone_e164 || fromChatId(conversation.channel_thread_id);
    const { templateId, parameters, body: templateBody } = req.body || {};
    try {
      let result;
      if (templateId) {
        // A pre-approved template's text is fixed by Meta — withSignature
        // must NOT touch it, or the sent text stops matching what was
        // approved. This is also the one send that's allowed with the 24h
        // window closed; it's what reopens it.
        //
        // `body` here is display-only, straight from the client's template
        // picker (ConversationThread.jsx) — it is NOT what actually gets
        // sent to WhatsApp (that's templateId + parameters, resolved by the
        // provider adapter). Without it crm_messages.body stays NULL and the
        // sent bubble renders empty in the thread forever, even though the
        // send itself succeeded.
        result = enqueue(db, {
          conversationId: id, toE164, kind: 'template', templateId, templateParameters: parameters || [],
          body: templateBody || null,
          sentBy: req.user.username, priority: 10,
        });
        if (result.skipped) return res.status(400).json({ error: `send skipped: ${result.reason}`, code: result.reason });
      } else {
        result = { messageId: enqueueText(db, {
          conversationId: id, toE164, body: withSignature(req.body?.body, req.user.username),
          sentBy: req.user.username, priority: 10,
        }) };
      }
      publish('message.created', { conversationId: id, messageId: result.messageId });
      // Send it now rather than waiting up to 5s for the drainer's timer —
      // the agent is watching the thread, and the delay was long enough for
      // the customer to send two more messages before ours went out.
      drainNow(db);
      res.status(201).json(db.prepare(`SELECT * FROM crm_messages WHERE id = ?`).get(result.messageId));
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message, code: err.code });
    }
  });

  // ── SSE stream ─────────────────────────────────────────────────────────
  app.get('/api/inbox/stream', (req, res) => {
    // EventSource can't set an Authorization header — accept the token via
    // query string on this one route only (same trust boundary as a bearer
    // token, just a different transport for it).
    const token = req.query.token;
    if (!token) return res.status(401).end();
    const session = db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token);
    if (!session) return res.status(401).end();
    // Same 7-day absolute TTL userFromRequest (routes/auth.js) enforces on every
    // other route — replicated here because registerInbox is only handed
    // { requireAuth, requireAdmin }, not userFromRequest. Without it a leaked
    // token stayed valid forever on this one endpoint. SQLite's CURRENT_TIMESTAMP
    // is "YYYY-MM-DD HH:MM:SS" (UTC) — normalize to ISO 8601 so it isn't parsed
    // as local time. Expired rows are deleted lazily, exactly as auth.js does.
    const age = Date.now() - new Date(session.created_at.replace(' ', 'T') + 'Z').getTime();
    if (age > SESSION_TTL_MS) {
      db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
      return res.status(401).end();
    }
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(session.user_id);
    if (!user) return res.status(401).end();
    subscribe(res, { username: user.username });
  });
};
