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

const { request: mondayRequest, uploadFileToColumn } = require('../monday/client');
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
// For status-type columns, monday's settings_str carries the board's actual
// configured labels (e.g. {"0":"ליד חדש","1":"עסקה נסגרה",...}) — surfaced
// here as `labels` so the admin UI can offer a real dropdown of the values
// that exist on THIS board, instead of a free-text guess.
async function fetchBoardColumns(db, boardId) {
  const data = await mondayRequest(
    db,
    `query ($boardId: [ID!]) { boards (ids: $boardId) { name columns { id title type settings_str } } }`,
    { boardId: [boardId] }
  );
  const board = data.boards && data.boards[0];
  if (!board) throw new Error('בורד לא נמצא');
  const columns = board.columns.map(c => {
    let labels = null;
    if (c.type === 'status' || c.type === 'color') {
      try {
        const parsed = JSON.parse(c.settings_str || '{}').labels || {};
        labels = Object.values(parsed).filter(Boolean);
      } catch (_) { labels = []; }
    }
    return { id: c.id, title: c.title, type: c.type, labels };
  });
  return { boardName: board.name, columns };
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
    `INSERT INTO crm_leads (customer_id, campaign_id, source, external_ref, status, title, assigned_to, follow_up_date)
     VALUES (@customer_id, @campaign_id, 'monday', @external_ref, 'new', @title, @assigned_to, @follow_up_date)`
  );
  // Follow-up dates keep moving on the board, so unlike the rest of the lead
  // (frozen at first pull) this one is refreshed on every poll for leads that
  // are still open — it drives the "פולואאפים להיום" column on My Day.
  const updateFollowUp = db.prepare(
    `UPDATE crm_leads SET follow_up_date = ? WHERE id = ? AND status NOT IN ('won','lost','disqualified')`
  );

  let created = 0;
  const tx = db.transaction(() => {
    for (const item of items) {
      const name = columnMap.name ? columnText(item.column_values, columnMap.name) : item.name;
      const phone = columnMap.phone ? columnText(item.column_values, columnMap.phone) : null;
      const email = columnMap.email ? columnText(item.column_values, columnMap.email) : null;
      // monday date columns come back as 'YYYY-MM-DD' (sometimes with a time) —
      // keep just the date part so it compares cleanly against date('now').
      const followUp = columnMap.follow_up
        ? (columnText(item.column_values, columnMap.follow_up) || '').slice(0, 10) || null
        : null;

      const existingMap = findItemMap.get(boardMap.board_id, item.id);
      if (existingMap) {
        touchItemMap.run(JSON.stringify(item), existingMap.id);
        // Already-known item: don't recreate anything, but DO refresh the
        // follow-up date — an agent moving it on the board must show up on
        // My Day, and this is the only place we see the new value.
        if (existingMap.lead_id && columnMap.follow_up) updateFollowUp.run(followUp, existingMap.lead_id);
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
          follow_up_date: followUp,
        });
        lead = { id: lastInsertRowid };
        created += 1;
      } else if (columnMap.follow_up) {
        updateFollowUp.run(followUp, lead.id);
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

// Uploads an issued quote's PDF to its monday item's mapped "quote file"
// column — triggered once, right after Morning creates the document (see
// services/morning/sync.js createOrConvertDocument). The lead's status push
// (e.g. -> "נשלחה הצעה") already happens on its own via the pushBoard tick
// once crm.js's /leads/:id/convert sets crm_leads.status='quoted'; this
// function only handles the file, which that generic status-pusher can't.
// Silent no-op (not an error) when the lead has no monday origin or the
// admin never mapped a quote-file column for its board — most quotes aren't
// tied to a monday lead at all.
async function pushQuoteDocument(db, { leadId, documentUrl, fileName }) {
  if (!leadId || !documentUrl) return { pushed: false, reason: 'missing leadId or documentUrl' };
  const itemMap = db.prepare(`SELECT * FROM monday_item_map WHERE lead_id = ?`).get(leadId);
  if (!itemMap) return { pushed: false, reason: 'lead has no monday origin' };
  const boardMap = db.prepare(`SELECT * FROM monday_board_map WHERE board_id = ?`).get(itemMap.board_id);
  if (!boardMap) return { pushed: false, reason: 'board not mapped' };
  const columnMap = JSON.parse(boardMap.column_map || '{}');
  if (!columnMap.quote_file) return { pushed: false, reason: 'no quote-file column mapped for this board' };

  try {
    await uploadFileToColumn(db, {
      itemId: itemMap.monday_item_id, columnId: columnMap.quote_file, fileUrl: documentUrl, fileName,
    });
    logSync(db, { direction: 'push', board_id: itemMap.board_id, monday_item_id: itemMap.monday_item_id, lead_id: leadId, success: true, response_json: { fileName } });
    return { pushed: true };
  } catch (err) {
    logSync(db, { direction: 'push', board_id: itemMap.board_id, monday_item_id: itemMap.monday_item_id, lead_id: leadId, success: false, error_message: err.message });
    return { pushed: false, reason: err.message };
  }
}

module.exports = { fetchBoardColumns, pullBoard, pushBoard, pushQuoteDocument, logSync };
