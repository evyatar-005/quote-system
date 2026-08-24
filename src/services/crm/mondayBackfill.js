// Retroactive status completion for leads pulled from monday boards that are
// no longer mapped.
//
// Why this can work at all: monday_item_map has no foreign key to
// monday_board_map, and deleting a board mapping only deletes the board row —
// so every item's raw_json snapshot survives, including the text of every
// column at the moment it was pulled. The status is therefore already in our
// own database; it was simply never interpreted, because at pull time the
// mapping could hold one label per status and only three statuses (see
// mondaySync.js), so anything else landed as 'new' and stayed there.
//
// Nothing here talks to monday. It re-reads data we already stored.

const { CLOSED_SQL, LEAD_STATUSES, LEGACY_STATUS_MAP } = require('./leadStatuses');

// Same refusal as the live pull: a lead an agent has already moved past 'new'
// is theirs, and a months-old board snapshot must never overrule it.
const UPDATE_SQL = `
  UPDATE crm_leads
     SET status = @status,
         closed_at = CASE WHEN @status IN (${CLOSED_SQL})
                          THEN COALESCE(closed_at, @now) ELSE closed_at END,
         updated_at = @now
   WHERE id = @id AND status = 'new' AND status != @status`;

// label → internal status, unioned across every board mapping we still have.
// Unioned rather than per-board because the boards these items came from are
// gone: their labels can only be matched against whatever mappings survive,
// and a company tends to reuse the same wording across its boards.
function buildLabelMap(db) {
  const out = new Map();
  for (const row of db.prepare(`SELECT status_values FROM monday_board_map`).all()) {
    let sv = {};
    try { sv = JSON.parse(row.status_values || '{}'); } catch (_) { sv = {}; }
    for (const [internal, value] of Object.entries(sv)) {
      for (const label of (Array.isArray(value) ? value : [value])) {
        const trimmed = (label || '').toString().trim();
        // A mapping saved before the status list changed still names a legacy
        // key; translate it, or it would write a value nothing recognises.
        if (trimmed) out.set(trimmed, LEGACY_STATUS_MAP[internal] || internal);
      }
    }
  }
  // The canonical labels win over any configured wording: board labels ARE
  // our statuses now (see leadStatuses.js), and a stale saved mapping must
  // not be able to redirect one of them somewhere else.
  for (const s of LEAD_STATUSES) out.set(s.label, s.key);
  return out;
}

// Every stored column value for an item, as trimmed strings. The original
// board's status column id is unknown (its mapping was deleted), so any column
// whose text matches a known label is treated as the status. In practice only
// a status column ever carries these words; the preview exists so this is
// verified against real numbers rather than assumed.
function itemLabels(rawJson) {
  let item;
  try { item = JSON.parse(rawJson || '{}'); } catch (_) { return []; }
  return (item.column_values || [])
    .map((c) => (c && c.text ? String(c.text).trim() : ''))
    .filter(Boolean);
}

// Walks every mapped item whose lead is still 'new' and works out what its
// status would become. Returns counts only — never writes.
function analyze(db) {
  const labelMap = buildLabelMap(db);
  const rows = db.prepare(`
    SELECT m.lead_id, m.raw_json, m.board_id
      FROM monday_item_map m
      JOIN crm_leads l ON l.id = m.lead_id
     WHERE l.status = 'new'
  `).all();

  const byLabel = new Map();     // label → { label, status, count }
  const unmatched = new Map();   // label → count, for labels we cannot read
  const boards = new Set();
  let matched = 0;

  for (const row of rows) {
    const labels = itemLabels(row.raw_json);
    const hit = labels.find((l) => labelMap.has(l));
    if (hit) {
      matched += 1;
      boards.add(row.board_id);
      const key = hit;
      const entry = byLabel.get(key) || { label: hit, status: labelMap.get(hit), count: 0 };
      entry.count += 1;
      byLabel.set(key, entry);
    } else {
      // We cannot tell which column was the status one for a board whose
      // mapping is gone, so every cell is a candidate. Long values are
      // dropped — a status label is short, and keeping addresses and notes
      // would bury the real labels in the report.
      for (const l of labels) {
        if (l.length <= 40) unmatched.set(l, (unmatched.get(l) || 0) + 1);
      }
    }
  }

  return {
    candidates: rows.length,
    matched,
    boards: boards.size,
    byStatus: Array.from(byLabel.values()).sort((a, b) => b.count - a.count),
    topUnmatched: Array.from(unmatched.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([label, count]) => ({ label, count })),
  };
}

// Applies exactly what analyze() reported. One transaction: a half-finished
// backfill across thousands of leads would be worse than none.
function apply(db) {
  const labelMap = buildLabelMap(db);
  const rows = db.prepare(`
    SELECT m.lead_id, m.raw_json
      FROM monday_item_map m
      JOIN crm_leads l ON l.id = m.lead_id
     WHERE l.status = 'new'
  `).all();

  const stmt = db.prepare(UPDATE_SQL);
  const now = new Date().toISOString();
  let updated = 0;

  db.transaction(() => {
    for (const row of rows) {
      const hit = itemLabels(row.raw_json).find((l) => labelMap.has(l));
      if (!hit) continue;
      updated += stmt.run({ id: row.lead_id, status: labelMap.get(hit), now }).changes;
    }
  })();

  console.log(`[mondayBackfill] completed statuses for ${updated} lead(s) from stored item snapshots`);
  return { updated };
}

module.exports = { analyze, apply, buildLabelMap };
