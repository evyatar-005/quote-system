// One-off "start the CRM from today" reset.
//
// The lead table accumulated years of monday history from boards that are no
// longer connected. None of it can be worked, synced or corrected — the boards
// behind it are gone — and all of it distorts every count, funnel and close
// rate on the analytics screens.
//
// What is KEPT, deliberately:
//   * leads that belong to a board still connected today (the live pipeline)
//   * leads that were never monday's to begin with — WhatsApp, manual, quote —
//     because those were created inside this CRM and represent live work, not
//     imported history. Deleting them would throw away conversations the team
//     is in the middle of.
// Everything else is monday history with no board behind it.
//
// Quotes and orders are NOT touched. They live in signshop_quotes, carry real
// money and are linked to issued Morning documents.

const fs = require('fs');
const path = require('path');

// A lead survives if it is on a connected board, or if it did not come from
// monday at all. Written once and used by preview and apply alike so the two
// can never disagree about what is about to happen.
const DOOMED_SQL = `
  FROM crm_leads l
 WHERE l.source = 'monday'
   AND NOT EXISTS (
     SELECT 1 FROM monday_item_map m
      WHERE m.lead_id = l.id
        AND m.board_id IN (SELECT board_id FROM monday_board_map)
   )`;

function preview(db) {
  const doomed = db.prepare(`SELECT COUNT(*) n ${DOOMED_SQL}`).get().n;
  const total = db.prepare(`SELECT COUNT(*) n FROM crm_leads`).get().n;

  const byStatus = db.prepare(
    `SELECT l.status, COUNT(*) n ${DOOMED_SQL} GROUP BY l.status ORDER BY n DESC`
  ).all();

  // What survives, split by why — an admin about to delete thousands of rows
  // needs to see what is being protected, not only what is going.
  const keptOnBoard = db.prepare(`
    SELECT COUNT(*) n FROM crm_leads l
     WHERE l.source = 'monday'
       AND EXISTS (SELECT 1 FROM monday_item_map m
                    WHERE m.lead_id = l.id
                      AND m.board_id IN (SELECT board_id FROM monday_board_map))
  `).get().n;
  const keptNonMonday = db.prepare(
    `SELECT source, COUNT(*) n FROM crm_leads WHERE source != 'monday' GROUP BY source ORDER BY n DESC`
  ).all();

  return {
    total,
    doomed,
    kept: total - doomed,
    keptOnBoard,
    keptNonMonday,
    byStatus,
    // Conversations survive: crm_conversations.lead_id is ON DELETE SET NULL,
    // so a WhatsApp thread is unlinked from its deleted lead, never destroyed.
    conversationsAffected: db.prepare(`
      SELECT COUNT(*) n FROM crm_conversations c
       WHERE c.lead_id IN (SELECT l.id ${DOOMED_SQL})
    `).get().n,
  };
}

// Writes every row about to be deleted to a timestamped JSON file first. This
// is what makes an irreversible operation recoverable: foreign keys are on, so
// the delete itself is clean, but nothing in SQLite brings the rows back.
function apply(db, { backupDir }) {
  const rows = db.prepare(`SELECT l.* ${DOOMED_SQL}`).all();
  if (!rows.length) return { deleted: 0, backupFile: null };

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');

  const backup = {
    created_at: new Date().toISOString(),
    reason: 'CRM lead reset — monday history with no connected board',
    leads: rows,
    // The link rows too, so a restore can rebuild the monday association.
    item_map: db.prepare(`SELECT * FROM monday_item_map WHERE lead_id IN (${placeholders})`).all(...ids),
    activity_log: db.prepare(`SELECT * FROM crm_activity_log WHERE lead_id IN (${placeholders})`).all(...ids),
  };

  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `crm-lead-reset-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf8');

  let deleted = 0;
  db.transaction(() => {
    // These three carry lead_id with no foreign key, so nothing cleans them
    // up automatically and they would be left pointing at rows that no longer
    // exist. Cleared before the leads themselves.
    db.prepare(`DELETE FROM crm_lead_handling WHERE lead_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM crm_activity_log WHERE lead_id IN (${placeholders})`).run(...ids);
    db.prepare(`UPDATE monday_sync_log SET lead_id = NULL WHERE lead_id IN (${placeholders})`).run(...ids);
    // crm_lead_claims cascades, crm_conversations.lead_id and
    // monday_item_map.lead_id are SET NULL — all handled by the FKs.
    deleted = db.prepare(`DELETE FROM crm_leads WHERE id IN (${placeholders})`).run(...ids).changes;
  })();

  console.log(`[leadReset] deleted ${deleted} lead(s); backup written to ${backupFile}`);
  return { deleted, backupFile };
}

module.exports = { preview, apply };
