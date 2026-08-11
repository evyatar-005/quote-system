// CRM Phase 2 — two-way monday.com sync core logic. Pull: board items ->
// customers + crm_leads. Push: lead status changes -> a status column on the
// board. Both directions go through monday_item_map so re-runs are
// idempotent and the pusher never re-writes an identical value.
//
// Deliberately simple pagination: one board per poll tick, first 100 items
// only (see CRM plan §10.2 — monday.com bills by query complexity, not
// request count, so this stays conservative rather than paging through a
// large board every minute). A board with more than 100 open items needs a
// tighter poll_minutes or a manual "sync now" until cursor paging is added.

const { request: mondayRequest } = require('../monday/client');
const { toE164 } = require('./phone');

function logSync(db, { direction, board_id, monday_item_id, lead_id, success, request_json, response_json, error_message }) {
  try {
    db.prepare(
      `INSERT INTO monday_sync_log (direction, board_id, monday_item_id, lead_id, success, request_json, response_json, error_message)
       VALUES (@direction, @board_id, @monday_item_id, @lead_id, @success, @request_json, @response_json, @error_message)`
    ).run({
      direction, board_id: board_id || null, monday_item_id: monday_item_id || null, lead_id: lead_id || null,
      success: success ? 1 : 0,
      request_json: request_json ? JSON.stringify(request_json) : null,
      response_json: response_json ? JSON.stringify(response_json) : null,
      error_message: error_message || null,
    });
  } catch (_) {}
}

function columnText(columnValues, columnId) {
  if (!columnId) return null;
  const cv = (columnValues || []).find(c => c.id === columnId);
  return cv ? (cv.text || null) : null;
}

// ── Column discovery (used by the admin mapping UI — never guess column ids) ─
async function fetchBoardColumns(db, boardId) {
  const data = await mondayRequest(
    db,
    `query ($boardId: [ID!]) { boards (ids: $boardId) { name columns { id title type } } }`,
    { boardId: [boardId] }
  );
  const board = data.boards && data.boards[0];
  if (!board) throw new Error('בורד לא נמצא');
  return { boardName: board.name, columns: board.columns };
}

function findOrCreateCustomer(db, { name, phone, email }, ownerUsername) {
  const e164 = phone ? toE164(phone) : null;
  let customer = null;
  if (e164) customer = db.prepare(`SELECT * FROM customers WHERE phone_e164 = ? AND merged_into_id IS NULL`).get(e164);
  if (!customer && email) customer = db.prepare(`SELECT * FROM customers WHERE email = ? AND merged_into_id IS NULL`).get(email);
  if (customer) return customer.id;

  const { lastInsertRowid } = db.prepare(
    `INSERT INTO customers (display_name, phone_e164, phone_raw, email, source, owner_username, created_by)
     VALUES (?, ?, ?, ?, 'monday', ?, ?)`
  ).run(name || 'ליד ממנדיי', e164, phone || null, email || null, ownerUsername, ownerUsername);
  return lastInsertRowid;
}

// Pulls up to 100 items from one board and upserts customers/leads.
// Returns { pulled, created, errors }.
async function pullBoard(db, boardMap, ownerUsername) {
  const columnMap = JSON.parse(boardMap.column_map || '{}');
  let data;
  try {
    data = await mondayRequest(
      db,
      `query ($boardId: ID!) {
         boards (ids: [$boardId]) {
           items_page (limit: 100) {
             items { id name updated_at column_values { id text } }
           }
         }
       }`,
      { boardId: boardMap.board_id }
    );
  } catch (err) {
    db.prepare(`UPDATE monday_board_map SET last_error = ?, last_polled_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(err.message, boardMap.id);
    logSync(db, { direction: 'pull', board_id: boardMap.board_id, success: false, error_message: err.message });
    throw err;
  }

  const items = (data.boards && data.boards[0] && data.boards[0].items_page.items) || [];
  const findItemMap = db.prepare(`SELECT * FROM monday_item_map WHERE board_id = ? AND monday_item_id = ?`);
  const insertItemMap = db.prepare(
    `INSERT INTO monday_item_map (board_id, monday_item_id, lead_id, customer_id, last_pulled_at, raw_json)
     VALUES (@board_id, @monday_item_id, @lead_id, @customer_id, CURRENT_TIMESTAMP, @raw_json)`
  );
  const touchItemMap = db.prepare(`UPDATE monday_item_map SET last_pulled_at = CURRENT_TIMESTAMP, raw_json = ? WHERE id = ?`);
  const findLeadByExt = db.prepare(`SELECT * FROM crm_leads WHERE source = 'monday' AND external_ref = ?`);
  const insertLead = db.prepare(
    `INSERT INTO crm_leads (customer_id, campaign_id, source, external_ref, status, title, assigned_to)
     VALUES (@customer_id, @campaign_id, 'monday', @external_ref, 'new', @title, @assigned_to)`
  );

  let created = 0;
  const tx = db.transaction(() => {
    for (const item of items) {
      const name = columnMap.name ? columnText(item.column_values, columnMap.name) : item.name;
      const phone = columnMap.phone ? columnText(item.column_values, columnMap.phone) : null;
      const email = columnMap.email ? columnText(item.column_values, columnMap.email) : null;

      const existingMap = findItemMap.get(boardMap.board_id, item.id);
      if (existingMap) {
        touchItemMap.run(JSON.stringify(item), existingMap.id);
        continue;
      }

      const customerId = findOrCreateCustomer(db, { name: name || item.name, phone, email }, ownerUsername);
      let lead = findLeadByExt.get(item.id);
      if (!lead) {
        const { lastInsertRowid } = insertLead.run({
          customer_id: customerId,
          campaign_id: boardMap.campaign_id || null,
          external_ref: item.id,
          title: item.name,
          assigned_to: ownerUsername,
        });
        lead = { id: lastInsertRowid };
        created += 1;
      }
      insertItemMap.run({
        board_id: boardMap.board_id,
        monday_item_id: item.id,
        lead_id: lead.id,
        customer_id: customerId,
        raw_json: JSON.stringify(item),
      });
    }
    db.prepare(`UPDATE monday_board_map SET last_polled_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?`).run(boardMap.id);
  });
  tx();

  logSync(db, { direction: 'pull', board_id: boardMap.board_id, success: true, response_json: { itemCount: items.length, created } });
  return { pulled: items.length, created };
}

// Pushes any lead whose status changed since it was last written to the
// board's status column. Returns { pushed }.
async function pushBoard(db, boardMap) {
  if (!boardMap.status_column_id) return { pushed: 0 };
  const statusValues = JSON.parse(boardMap.status_values || '{}');
  const rows = db.prepare(
    `SELECT m.*, l.status AS lead_status FROM monday_item_map m
     JOIN crm_leads l ON l.id = m.lead_id
     WHERE m.board_id = ? AND (m.last_pushed_status IS NULL OR m.last_pushed_status != l.status)`
  ).all(boardMap.board_id);

  let pushed = 0;
  for (const row of rows) {
    const label = statusValues[row.lead_status];
    if (!label) continue; // no mapped monday label for this internal status — skip silently
    try {
      await mondayRequest(
        db,
        `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
           change_simple_column_value (board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
         }`,
        { boardId: boardMap.board_id, itemId: row.monday_item_id, columnId: boardMap.status_column_id, value: label }
      );
      db.prepare(`UPDATE monday_item_map SET last_pushed_at = CURRENT_TIMESTAMP, last_pushed_status = ? WHERE id = ?`)
        .run(row.lead_status, row.id);
      logSync(db, { direction: 'push', board_id: boardMap.board_id, monday_item_id: row.monday_item_id, lead_id: row.lead_id, success: true });
      pushed += 1;
    } catch (err) {
      logSync(db, { direction: 'push', board_id: boardMap.board_id, monday_item_id: row.monday_item_id, lead_id: row.lead_id, success: false, error_message: err.message });
    }
  }
  return { pushed };
}

module.exports = { fetchBoardColumns, pullBoard, pushBoard, logSync };
