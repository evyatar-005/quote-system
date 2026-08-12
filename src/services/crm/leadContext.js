// Builds the lead-workspace payload: the lead + customer + campaign + claim +
// "who handled it last" + (when the lead came from monday) every column the
// board pulls, with friendly titles. See CLAUDE.md CRM plan Phase 5 §7.

const { getDocumentStatus } = require('./leadOutcome');
const { DOCUMENT_TYPE } = require('../morning/mappings');

const SYSTEM_PREFIXES = ['pulse_log', 'pulse_updated', 'subitems', 'formula', 'auto_number', 'creation_log', 'last_updated'];
const ROLE_TITLES = { name: 'שם', phone: 'טלפון', email: 'אימייל', follow_up: 'תאריך פולואפ', quote_file: 'קובץ הצעה' };

function buildMondayFields(db, leadId) {
  const im = db.prepare(`SELECT * FROM monday_item_map WHERE lead_id = ?`).get(leadId);
  if (!im) return null;
  const bm = db.prepare(`SELECT * FROM monday_board_map WHERE board_id = ?`).get(im.board_id);

  const columnMap = JSON.parse(bm?.column_map || '{}');
  const columns = JSON.parse(bm?.columns_json || '[]');
  const titleById = Object.fromEntries(columns.map(c => [c.id, c]));
  const roleByCol = Object.fromEntries(Object.entries(columnMap).map(([role, id]) => [id, role]));
  let raw = {};
  try { raw = JSON.parse(im.raw_json || '{}'); } catch (_) { raw = {}; }

  const fields = [
    { column_id: '__name', title: 'שם הפריט', text: raw.name || null, mapped_as: 'name', system: false },
    ...(raw.column_values || [])
      .filter(cv => cv.text != null && String(cv.text).trim() !== '')
      .map(cv => ({
        column_id: cv.id,
        // Precedence: the board's real title -> the mapping role's Hebrew
        // label -> the raw column id. Never hide a value for lack of a title.
        title: titleById[cv.id]?.title || ROLE_TITLES[roleByCol[cv.id]] || cv.id,
        type: titleById[cv.id]?.type || null,
        text: cv.text,
        mapped_as: roleByCol[cv.id] || null,
        // File-type columns (e.g. "טופס הזמנה") are raw upload links from
        // monday, not something an agent acts on day-to-day — collapsed
        // into the same "system fields" toggle as true system columns,
        // rather than deleted, so the link is still reachable if ever
        // needed. quote_file is the one exception — that's OUR own tracked
        // upload target (see mondaySync.js's pushQuoteDocument).
        system: SYSTEM_PREFIXES.some(p => cv.id.startsWith(p))
          || (titleById[cv.id]?.type === 'file' && roleByCol[cv.id] !== 'quote_file'),
        // Status-type columns' real label bank (from monday's settings_str,
        // cached at pull time) — lets the workspace render an editable
        // dropdown of the values that actually exist on THIS board instead
        // of plain text. null/empty = not a status column, render as text.
        labels: titleById[cv.id]?.labels?.length ? titleById[cv.id].labels : null,
      }))
      // The phone number already has its own clickable line at the top of
      // the panel — showing the raw mapped column again here is a pure
      // duplicate.
      .filter(f => f.mapped_as !== 'phone'),
  ];

  return {
    board_id: im.board_id,
    board_name: bm?.board_name || null,
    item_id: im.monday_item_id,
    pulled_at: im.last_pulled_at,
    fields,
  };
}

// 4-level fallback so "who handled it last" isn't blank while conversation
// traffic is still thin — see plan §5.
function lastHandled(db, customerId, leadId) {
  const row = db.prepare(`
    SELECT COALESCE(
      (SELECT lk.username FROM crm_conversation_locks lk
         JOIN crm_conversations c2 ON c2.id = lk.conversation_id
        WHERE c2.customer_id = @customerId AND lk.expires_at > CURRENT_TIMESTAMP LIMIT 1),
      (SELECT h.username FROM crm_conversation_handling h
         JOIN crm_conversations c3 ON c3.id = h.conversation_id
        WHERE c3.customer_id = @customerId ORDER BY h.id DESC LIMIT 1),
      (SELECT m.sent_by FROM crm_messages m
         JOIN crm_conversations c4 ON c4.id = m.conversation_id
        WHERE c4.customer_id = @customerId AND m.direction = 'out' AND m.sent_by IS NOT NULL
        ORDER BY m.id DESC LIMIT 1),
      (SELECT lh.username FROM crm_lead_handling lh WHERE lh.lead_id = @leadId ORDER BY lh.id DESC LIMIT 1)
    ) AS username,
    COALESCE(
      (SELECT COALESCE(h.ended_at, h.started_at) FROM crm_conversation_handling h
         JOIN crm_conversations c5 ON c5.id = h.conversation_id
        WHERE c5.customer_id = @customerId ORDER BY h.id DESC LIMIT 1),
      (SELECT m.created_at FROM crm_messages m
         JOIN crm_conversations c6 ON c6.id = m.conversation_id
        WHERE c6.customer_id = @customerId AND m.direction = 'out' ORDER BY m.id DESC LIMIT 1)
    ) AS at
  `).get({ customerId, leadId });
  if (!row?.username) return null;
  const user = db.prepare(`SELECT full_name FROM users WHERE username = ?`).get(row.username);
  return { username: row.username, full_name: user?.full_name || row.username, at: row.at };
}

// "Is this a returning customer?" — the question the workspace could never
// answer. A customer row is created silently at import (findOrCreateCustomer
// in mondaySync.js keys on phone, email as fallback), so the link to a past
// purchase already EXISTS in the data; it was simply never surfaced where the
// agent works, and an agent would open a brand-new lead with no hint that the
// same person bought a sign from us last year.
//
// "Bought from us" = a Morning ORDER document (DOCUMENT_TYPE.order) exists on
// one of the customer's quotes. That is the exact same signal that flips a
// lead to 'won' below and that the campaign analytics call "closed", so the
// three can never disagree.
//
// Everything here is DERIVED at read time — no `is_returning` column, nothing
// to keep in sync, and no write path that a monday pull could fight with.
function customerHistory(db, customerId, currentLeadId) {
  if (!customerId) return null;

  const purchases = db.prepare(`
    SELECT COUNT(DISTINCT q.id) AS n,
           MIN(md.created_at) AS first_at,
           MAX(md.created_at) AS last_at,
           SUM(q.price_with_vat) AS total
    FROM signshop_quotes q
    JOIN morning_documents_map md ON md.quote_id = q.id AND md.morning_document_type = ?
    WHERE q.customer_id = ? AND (q.lead_id IS NULL OR q.lead_id != ?)
  `).get(DOCUMENT_TYPE.order, customerId, currentLeadId) || {};

  // Prior enquiries from the same person on any campaign — useful even before
  // a single order exists, and the honest answer to "did we talk to them
  // already?". Excludes the lead being viewed.
  const otherLeads = db.prepare(`
    SELECT l.id, l.status, l.created_at, l.source_created_at, l.closed_at,
           cam.name AS campaign_name
    FROM crm_leads l
    LEFT JOIN crm_campaigns cam ON cam.id = l.campaign_id
    WHERE l.customer_id = ? AND l.id != ?
    ORDER BY COALESCE(l.source_created_at, l.created_at) DESC
    LIMIT 20
  `).all(customerId, currentLeadId);

  const quoteCount = db.prepare(
    `SELECT COUNT(*) AS n FROM signshop_quotes WHERE customer_id = ? AND (lead_id IS NULL OR lead_id != ?)`
  ).get(customerId, currentLeadId).n;

  return {
    purchases: purchases.n || 0,
    first_purchase_at: purchases.first_at || null,
    last_purchase_at: purchases.last_at || null,
    total_purchased: purchases.total || 0,
    prior_quotes: quoteCount,
    prior_leads: otherLeads.length,
    other_leads: otherLeads,
    // The one flag the UI keys its banner off. Deliberately NOT "has any prior
    // lead" — every customer with two campaign enquiries would qualify and the
    // banner would mean nothing.
    is_returning_buyer: (purchases.n || 0) > 0,
  };
}

function buildLeadContext(db, leadId) {
  let lead = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(leadId);
  if (!lead) return null;
  const customer = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(lead.customer_id);
  const campaign = lead.campaign_id ? db.prepare(`SELECT id, name FROM crm_campaigns WHERE id = ?`).get(lead.campaign_id) : null;
  const claim = db.prepare(`SELECT * FROM crm_lead_claims WHERE lead_id = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`).get(leadId);
  const conversation = db.prepare(`SELECT id FROM crm_conversations WHERE lead_id = ? OR customer_id = ? ORDER BY last_message_at DESC LIMIT 1`).get(leadId, lead.customer_id);

  // Derives outcome from the real downstream document state (morning_documents_map)
  // instead of trusting crm_leads.status to have been kept manually in sync —
  // see services/crm/leadOutcome.js. Lazy, on-read: no poller needed, this
  // runs every time the workspace is opened, which is exactly when it matters.
  const documentStatus = getDocumentStatus(db, lead.quote_id);
  if (documentStatus?.hasOrder && lead.status === 'quoted') {
    db.prepare(`UPDATE crm_leads SET status = 'won', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(leadId);
    db.prepare(`INSERT INTO crm_activity_log (customer_id, lead_id, type, summary, actor) VALUES (?, ?, 'status_change', 'עודכן אוטומטית ל-"זכינו" — זוהתה הזמנת עבודה', 'system')`)
      .run(lead.customer_id, leadId);
    lead = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(leadId);
  }

  return {
    lead, customer, campaign,
    claim: claim ? { username: claim.username, acquired_at: claim.acquired_at } : null,
    conversation_id: conversation?.id || null,
    last_handled: lastHandled(db, lead.customer_id, leadId),
    monday: buildMondayFields(db, leadId),
    document_status: documentStatus,
    customer_history: customerHistory(db, lead.customer_id, leadId),
  };
}

module.exports = { buildLeadContext };
