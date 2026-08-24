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
const { CLOSED_SQL, statusForLabel, labelOf, LEAD_STATUSES, LEGACY_STATUS_MAP } = require('./leadStatuses');

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

// monday returns '2026-04-23T09:50:11Z'; SQLite's CURRENT_TIMESTAMP is
// '2026-04-23 09:50:11'. Lexicographically 'T' (0x54) > ' ' (0x20), so mixing
// the two formats in one ORDER BY sorts every monday timestamp above every
// local one — normalize on write, always.
function mondayTs(s) {
  return s ? String(s).replace('T', ' ').replace(/\.\d+/, '').replace('Z', '') : null;
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

  // The email fallback ONLY applies when the item has no usable phone at all.
  //
  // It used to run whenever the phone didn't match an existing customer, and
  // that silently glued unrelated people together: several boards carry the
  // company's own address (sales@printella.co.il) in their email column on
  // every row, so the first item created a customer holding that address and
  // then every later item — each with its own real, distinct phone number —
  // matched it by email and was attached to that one person. It collapsed
  // ~1,700 leads (half the table) onto two customers, discarding phone numbers
  // that were right there in the payload.
  //
  // A phone number identifies a person; a shared mailbox does not. So when we
  // have a phone and it finds nobody, the correct answer is a NEW customer.
  if (!customer && !e164 && email) {
    customer = db.prepare(`SELECT * FROM customers WHERE email = ? AND merged_into_id IS NULL`).get(email);
  }
  if (customer) return customer.id;

  const { lastInsertRowid } = db.prepare(
    `INSERT INTO customers (display_name, phone_e164, phone_raw, email, source, owner_username, created_by)
     VALUES (?, ?, ?, ?, 'monday', ?, ?)`
  ).run(name || 'ליד ממנדיי', e164, phone || null, email || null, ownerUsername, ownerUsername);
  return lastInsertRowid;
}

// Pulls up to 100 items from one board and upserts customers/leads.
// Returns { pulled, created, errors }.
//
// Full cursor pagination — NOT the old "first 100 items only" cap. Verified
// live against monday: some boards have 1000+ items (קמפיין קאפות: 1008,
// קמפיין לוגו: 2283) and were silently truncated to their first page since
// this was written. `items_page` gives the first page + a cursor; every
// subsequent page comes from the top-level `next_items_page(cursor)` field
// (not nested under boards — the cursor already carries that context). A
// board this size costs real monday query-complexity budget to fully page,
// so this only runs once per board per poll tick, same as before.
async function fetchAllItems(db, boardId) {
  let data;
  try {
    data = await mondayRequest(
      db,
      `query ($boardId: ID!) {
         boards (ids: [$boardId]) {
           columns { id title type settings_str }
           items_page (limit: 100) {
             cursor
             items { id name created_at updated_at column_values { id text } }
           }
         }
       }`,
      { boardId }
    );
  } catch (err) {
    return { error: err };
  }
  const board = data.boards && data.boards[0];
  if (!board) return { columns: [], items: [] };

  const items = [...board.items_page.items];
  let cursor = board.items_page.cursor;
  while (cursor) {
    const page = await mondayRequest(
      db,
      `query ($cursor: String!) { next_items_page (limit: 100, cursor: $cursor) { cursor items { id name created_at updated_at column_values { id text } } } }`,
      { cursor }
    );
    items.push(...page.next_items_page.items);
    cursor = page.next_items_page.cursor;
  }
  return { columns: board.columns || [], items };
}

async function pullBoard(db, boardMap, ownerUsername) {
  const columnMap = JSON.parse(boardMap.column_map || '{}');
  const { columns, items, error } = await fetchAllItems(db, boardMap.board_id);
  if (error) {
    db.prepare(`UPDATE monday_board_map SET last_error = ?, last_polled_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(error.message, boardMap.id);
    logSync(db, { direction: 'pull', board_id: boardMap.board_id, success: false, error_message: error.message });
    throw error;
  }
  const board = { columns };
  // Cached so the lead workspace can put a friendly Hebrew title on every
  // raw_json column_value — raw_json stores only column IDs, never titles.
  // `labels` (status-type columns' real label bank, see fetchBoardColumns
  // above) rides along so the workspace can render a real dropdown instead
  // of plain text for status fields.
  if (board) {
    const columns = (board.columns || []).map(c => {
      let labels = null;
      if (c.type === 'status' || c.type === 'color') {
        try {
          const parsed = JSON.parse(c.settings_str || '{}').labels || {};
          labels = Object.values(parsed).filter(Boolean);
        } catch (_) { labels = []; }
      }
      return { id: c.id, title: c.title, type: c.type, labels };
    });
    db.prepare(`UPDATE monday_board_map SET columns_json = ? WHERE id = ?`)
      .run(JSON.stringify(columns), boardMap.id);
  }
  const findItemMap = db.prepare(`SELECT * FROM monday_item_map WHERE board_id = ? AND monday_item_id = ?`);
  const insertItemMap = db.prepare(
    `INSERT INTO monday_item_map (board_id, monday_item_id, lead_id, customer_id, last_pulled_at, raw_json)
     VALUES (@board_id, @monday_item_id, @lead_id, @customer_id, CURRENT_TIMESTAMP, @raw_json)`
  );
  const touchItemMap = db.prepare(`UPDATE monday_item_map SET last_pulled_at = CURRENT_TIMESTAMP, raw_json = ? WHERE id = ?`);
  const findLeadByExt = db.prepare(`SELECT * FROM crm_leads WHERE source = 'monday' AND external_ref = ?`);
  // status comes from the board when its label is mapped, else 'new' — a lead
  // that arrives already marked "עסקה נסגרה" on the board should not land in
  // the CRM as brand new and re-enter the agents' queue.
  const insertLead = db.prepare(
    `INSERT INTO crm_leads (customer_id, campaign_id, source, external_ref, status, title, assigned_to, follow_up_date, follow_up_source, source_created_at)
     VALUES (@customer_id, @campaign_id, 'monday', @external_ref, @status, @title, @assigned_to, @follow_up_date, @follow_up_source, @source_created_at)`
  );
  // Follow-up dates keep moving on the board, so unlike the rest of the lead
  // (frozen at first pull) this one is refreshed on every poll for leads that
  // are still open — it drives the "פולואאפים להיום" column on My Day.
  //
  // BUT never over an agent's own schedule (follow_up_source = 'agent',
  // set by PUT /api/crm/leads/:id/follow-up): monday's value is usually
  // date-only (see followUp below) and often simply empty on boards where
  // follow-up isn't actually used there, and this poll runs every 60s — an
  // agent who scheduled a callback for 14:30 would otherwise see it silently
  // rounded to midnight, or erased outright, within a minute.
  const updateFollowUp = db.prepare(
    `UPDATE crm_leads SET follow_up_date = ?, follow_up_source = 'monday'
      WHERE id = ? AND status NOT IN (${CLOSED_SQL})
        AND follow_up_source IS NOT 'agent'`
  );

  // Status pull. Until this existed the sync was one-way for status — we
  // pushed won/lost/quoted TO the board and never read it back — so a lead
  // worked entirely on monday stayed 'new' in the CRM forever. That is why
  // ~3,665 of 3,665 leads read as "לידים חדשים": the value was written once
  // at creation and never revisited.
  //
  // The board's labels ARE our statuses now (services/crm/leadStatuses.js),
  // so the primary resolution is statusForLabel(label) — no configuration at
  // all. The board's own status_values map is kept only as a FALLBACK, for a
  // board that words its labels differently; it can no longer shadow a
  // canonical label.
  const statusByLabel = (() => {
    const out = new Map();
    let sv = {};
    try { sv = JSON.parse(boardMap.status_values || '{}'); } catch (_) { sv = {}; }
    // A value may be a single label (the original shape) or a LIST of labels.
    // Real boards use several labels that all mean the same thing to us —
    // "לא רלוונטי - מחיר / מרחק / אחר" are three ways of saying lost, and
    // "ניסיון ליצירת קשר 1 / 2", "נשלחה הודעה ווצאפ" and "פולואפ" all mean
    // contacted. One-label-per-status could not express that, so every item
    // carrying an unmapped label was left at 'new' forever — which is why a
    // whole board could read as "לידים חדשים" long after it had been worked.
    for (const [internal, value] of Object.entries(sv)) {
      for (const label of (Array.isArray(value) ? value : [value])) {
        const trimmed = (label || '').toString().trim();
        // A mapping saved under the old six-status list still names a legacy
        // key; translate it rather than writing a value nothing recognises.
        if (trimmed) out.set(trimmed, LEGACY_STATUS_MAP[internal] || internal);
      }
    }
    return out;
  })();
  // label → status: canonical first, configured mapping only when the label
  // isn't one of ours.
  const resolveLabel = (label) => statusForLabel(label) || statusByLabel.get(label) || null;

  // Never clobbers a decision an agent made in the CRM: only moves a lead
  // that is still 'new'. A lead someone actively worked here keeps its local
  // status even if the board disagrees — the board is authoritative for
  // untouched leads, the agent is authoritative for the rest.
  const updateStatusFromBoard = db.prepare(
    `UPDATE crm_leads
        SET status = @status,
            closed_at = CASE WHEN @status IN (${CLOSED_SQL})
                             THEN COALESCE(closed_at, @now) ELSE closed_at END,
            quoted_at = CASE WHEN @status = 'quoted' THEN COALESCE(quoted_at, @now) ELSE quoted_at END,
            updated_at = @now
      WHERE id = @id AND status = 'new' AND status != @status`
  );

  let created = 0;
  let statusPulled = 0;
  // Diagnostics. "0 סטטוסים עודכנו" has several very different causes — a
  // label nobody mapped, an item never linked to a lead, or a lead an agent
  // already moved past 'new' (which the update deliberately refuses to touch).
  // Without these the admin cannot tell which one they are looking at, and
  // the mapping screen gives no hint either.
  let itemsWithLabel = 0;
  let skippedNotNew = 0;
  let itemsWithoutLead = 0;
  const unmappedLabels = new Map();
  const tx = db.transaction(() => {
    for (const item of items) {
      const name = columnMap.name ? columnText(item.column_values, columnMap.name) : item.name;
      const phone = columnMap.phone ? columnText(item.column_values, columnMap.phone) : null;
      const email = columnMap.email ? columnText(item.column_values, columnMap.email) : null;
      // monday date columns come back as 'YYYY-MM-DD', or 'YYYY-MM-DD HH:MM'
      // when the column has time-tracking turned on — keep the time when it's
      // actually there instead of always truncating to the date, so a
      // callback time set on the board survives the sync. Anything that
      // doesn't match either shape (unexpected format) falls back to the
      // first 10 characters rather than failing closed.
      const rawFollowUp = columnMap.follow_up ? columnText(item.column_values, columnMap.follow_up) : null;
      const followUp = rawFollowUp
        ? ((/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?/.exec(rawFollowUp) || [])[0] || rawFollowUp.slice(0, 10)) || null
        : null;

      // The board's current label for this item, resolved to one of our
      // internal statuses. NULL when the board uses a label nobody mapped —
      // in which case the lead is simply left alone rather than guessed at.
      const boardLabel = boardMap.status_column_id
        ? (columnText(item.column_values, boardMap.status_column_id) || '').trim()
        : '';
      const boardStatus = boardLabel ? resolveLabel(boardLabel) : null;

      const existingMap = findItemMap.get(boardMap.board_id, item.id);
      if (existingMap) {
        touchItemMap.run(JSON.stringify(item), existingMap.id);
        // Backfills the real arrival time exactly once (COALESCE), for leads
        // pulled before this column existed — required for queue ordering.
        db.prepare(`UPDATE monday_item_map SET monday_created_at = COALESCE(monday_created_at, ?) WHERE id = ?`)
          .run(mondayTs(item.created_at), existingMap.id);
        if (boardLabel) {
          itemsWithLabel += 1;
          if (!boardStatus) unmappedLabels.set(boardLabel, (unmappedLabels.get(boardLabel) || 0) + 1);
        }
        if (!existingMap.lead_id) itemsWithoutLead += 1;
        if (existingMap.lead_id) {
          db.prepare(`UPDATE crm_leads SET source_created_at = COALESCE(source_created_at, ?) WHERE id = ?`)
            .run(mondayTs(item.created_at), existingMap.lead_id);
          // Already-known item: don't recreate anything, but DO refresh the
          // follow-up date — an agent moving it on the board must show up on
          // My Day, and this is the only place we see the new value.
          if (columnMap.follow_up) updateFollowUp.run(followUp, existingMap.lead_id);
          // …and the status, which is the whole point of the pull side: this
          // is the only moment we can see that a lead was progressed on the
          // board. The statement itself refuses to touch anything past 'new'.
          if (boardStatus) {
            const changed = updateStatusFromBoard.run({
              id: existingMap.lead_id, status: boardStatus, now: new Date().toISOString(),
            }).changes;
            statusPulled += changed;
            // Mapped correctly, but the lead is no longer 'new' — an agent
            // already decided here, and the board must not overrule that.
            if (!changed) skippedNotNew += 1;
          }
        }
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
          // NULL = in the claimable pool. NEVER ownerUsername: the poller
          // passes 'monday-sync' (a user that doesn't exist) and a manual
          // "sync now" click passes the clicking admin's username, which
          // would silently assign an entire 100-row board to whoever pressed
          // the button. See CLAUDE.md CRM plan Phase 5 §2/§3.
          assigned_to: null,
          status: boardStatus || 'new',
          follow_up_date: followUp,
          follow_up_source: followUp ? 'monday' : null,
          source_created_at: mondayTs(item.created_at),
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

  const diagnostics = {
    itemsWithLabel,
    itemsWithoutLead,
    skippedNotNew,
    hasStatusColumn: !!boardMap.status_column_id,
    // Canonical labels are always resolvable, with or without a saved
    // mapping — count them, or the admin screen reads as "0 labels mapped"
    // on a board that needs no configuration at all.
    mappedLabelCount: new Set([...statusByLabel.keys(), ...LEAD_STATUSES.map((s) => s.label)]).size,
    // Top offenders only — a board can have dozens of one-off labels and the
    // point is to name the ones actually costing status updates.
    unmappedLabels: Array.from(unmappedLabels.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([label, count]) => ({ label, count })),
  };
  logSync(db, { direction: 'pull', board_id: boardMap.board_id, success: true, response_json: { itemCount: items.length, created, statusPulled, ...diagnostics } });
  return { pulled: items.length, created, statusPulled, ...diagnostics };
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
    // Pushing is one-to-one by nature: many labels can mean "lost" to us, but
    // we must write exactly one back. The FIRST mapped label is the canonical
    // one — it is what the editor lists first and what an admin sees as the
    // primary spelling for that status.
    const mapped = statusValues[row.lead_status];
    // The board's own wording still wins when one is configured; otherwise
    // fall back to our canonical label, which IS the board's label now — so a
    // board with no status_values at all still gets written to correctly.
    const label = (Array.isArray(mapped) ? mapped[0] : mapped) || labelOf(row.lead_status);
    if (!label) continue; // nothing sensible to write — skip silently
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

// Direct single-field edit from the lead workspace (e.g. a status-type
// column rendered as a dropdown, per its real label bank — see
// leadContext.js). Same mutation pushBoard uses; unlike pushBoard this is
// one ad-hoc field on one item, called synchronously from the route handler,
// not the poll tick — so the raw_json cache is patched in place immediately
// rather than waiting for the next pull to reflect the new value.
async function updateItemColumn(db, { boardId, itemId, columnId, value }) {
  await mondayRequest(
    db,
    `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
       change_simple_column_value (board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
     }`,
    { boardId, itemId, columnId, value }
  );
  const map = db.prepare(`SELECT * FROM monday_item_map WHERE board_id = ? AND monday_item_id = ?`).get(boardId, itemId);
  if (map) {
    let raw = {};
    try { raw = JSON.parse(map.raw_json || '{}'); } catch (_) { raw = {}; }
    raw.column_values = raw.column_values || [];
    const cv = raw.column_values.find(c => c.id === columnId);
    if (cv) cv.text = value; else raw.column_values.push({ id: columnId, text: value });
    db.prepare(`UPDATE monday_item_map SET raw_json = ? WHERE id = ?`).run(JSON.stringify(raw), map.id);
  }
  logSync(db, { direction: 'push', board_id: boardId, monday_item_id: itemId, success: true, request_json: { columnId, value } });
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

module.exports = { fetchBoardColumns, pullBoard, pushBoard, pushQuoteDocument, updateItemColumn, logSync };
