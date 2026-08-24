// CRM → monday: push a lead that originated HERE onto the board.
//
// The sync was one-way for existence: monday created leads in the CRM, but a
// lead born here — someone who wrote to the business WhatsApp, or was typed in
// by hand — existed nowhere on the board. The sales team works the board, so
// those leads were invisible to them, and the two systems drifted apart the
// moment anyone used the CRM as more than a viewer.
//
// Deliberately NOT applied to leads whose source is 'monday': those came from
// the board and pushing them back would duplicate the item they came from.

const { request: mondayRequest } = require('../monday/client');
const { labelOf } = require('./leadStatuses');

// monday's column_values is a JSON object keyed by column id, and the shape of
// each value depends on the COLUMN TYPE — a phone column rejects a bare
// string, an email column needs both address and display text. The board's
// column list is already cached on monday_board_map.columns_json (id/title/
// type), so the right shape can be built instead of guessed.
function formatColumnValue(type, value) {
  const text = (value == null ? '' : String(value)).trim();
  if (!text) return null;
  switch (type) {
    case 'email':
      return { email: text, text };
    case 'phone':
      // countryShortName is required by monday for a phone column; every
      // number this system stores is normalized to E.164 Israeli (see
      // services/crm/phone.js).
      return { phone: text, countryShortName: 'IL' };
    case 'status':
    case 'color':
      return { label: text };
    case 'date':
      return { date: text };
    default:
      return text;
  }
}

function columnTypes(boardMap) {
  const out = new Map();
  try {
    for (const c of JSON.parse(boardMap.columns_json || '[]')) out.set(c.id, c.type);
  } catch (_) { /* no cache yet — every column falls back to plain text */ }
  return out;
}

// The board that receives leads created in the CRM. With a single mapped board
// the choice is unambiguous; with several it is a business decision nobody has
// made, so nothing is pushed rather than guessing which board a lead belongs
// to. Only boards we are allowed to write to are considered.
function targetBoard(db) {
  const boards = db.prepare(`SELECT * FROM monday_board_map WHERE push_enabled = 1`).all();
  return boards.length === 1 ? boards[0] : null;
}

// Returns { created: false, reason } rather than throwing: a monday outage
// must never stop a lead being recorded in the CRM. Callers fire and forget.
async function createItemForLead(db, leadId) {
  const lead = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(leadId);
  if (!lead) return { created: false, reason: 'lead not found' };
  if (lead.source === 'monday') return { created: false, reason: 'lead came from monday' };

  const already = db.prepare(`SELECT 1 FROM monday_item_map WHERE lead_id = ?`).get(leadId);
  if (already) return { created: false, reason: 'already on a board' };

  const boardMap = targetBoard(db);
  if (!boardMap) return { created: false, reason: 'no single push-enabled board to receive new leads' };

  const customer = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(lead.customer_id);
  if (!customer) return { created: false, reason: 'lead has no customer' };

  let columnMap = {};
  try { columnMap = JSON.parse(boardMap.column_map || '{}'); } catch (_) { columnMap = {}; }
  const types = columnTypes(boardMap);

  const columnValues = {};
  const put = (columnId, value) => {
    if (!columnId) return;
    const formatted = formatColumnValue(types.get(columnId) || 'text', value);
    if (formatted !== null) columnValues[columnId] = formatted;
  };
  put(columnMap.phone, customer.phone_e164 || customer.phone_raw);
  put(columnMap.email, customer.email);
  // The board's status column gets the lead's CURRENT status, not a hardcoded
  // "new" — a lead can already have been worked in the CRM before anyone
  // pushed it, and arriving on the board as brand new would lose that.
  if (boardMap.status_column_id) {
    const formatted = formatColumnValue(types.get(boardMap.status_column_id) || 'status', labelOf(lead.status));
    if (formatted !== null) columnValues[boardMap.status_column_id] = formatted;
  }

  const itemName = customer.display_name || customer.phone_e164 || `ליד ${leadId}`;

  try {
    const data = await mondayRequest(
      db,
      `mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON) {
         create_item (board_id: $boardId, item_name: $itemName, column_values: $columnValues) { id }
       }`,
      { boardId: boardMap.board_id, itemName, columnValues: JSON.stringify(columnValues) }
    );
    const itemId = data?.create_item?.id;
    if (!itemId) return { created: false, reason: 'monday returned no item id' };

    // Recorded exactly like a pulled item, so every existing mechanism —
    // status pull, status push, the quote-file upload — treats this lead as
    // board-backed from now on. last_pushed_status is seeded with what we just
    // wrote, so the pusher does not immediately rewrite the same value.
    db.prepare(
      `INSERT INTO monday_item_map (board_id, monday_item_id, lead_id, customer_id, last_pulled_at, last_pushed_status, raw_json)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`
    ).run(boardMap.board_id, String(itemId), leadId, lead.customer_id, lead.status, JSON.stringify({ id: itemId, created_by: 'crm' }));

    db.prepare(
      `INSERT INTO crm_activity_log (customer_id, lead_id, type, summary, actor)
       VALUES (?, ?, 'note', ?, 'system')`
    ).run(lead.customer_id, leadId, `הליד נוצר גם בבורד ${boardMap.board_name || boardMap.board_id} במנדיי`);

    console.log(`[mondayCreateItem] lead #${leadId} → monday item ${itemId} on board ${boardMap.board_id}`);
    return { created: true, itemId };
  } catch (err) {
    console.error(`[mondayCreateItem] failed for lead #${leadId}:`, err.message);
    return { created: false, reason: err.message };
  }
}

module.exports = { createItemForLead, formatColumnValue, targetBoard };
