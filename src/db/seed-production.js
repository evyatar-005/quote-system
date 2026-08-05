// Idempotent seeding for the production_* (תפ"י recipe) tables.
//
// Seeds only the vocabulary — stations and operations — that every recipe is
// built from. Recipes themselves (production_recipes/production_recipe_steps)
// are NOT seeded here: they're entered product-by-product via the admin UI,
// per the plan this ships against (no auto-generated recipe content).
//
// Safe to run repeatedly and on a live database.sqlite: INSERT OR IGNORE by
// unique key, so re-running never overwrites/duplicates.
//
// Exposes seedProduction(db) for the server to call on boot.

const STATIONS_SEED = [
  // [key, name, kind]
  ['wotek5',     'ווטק 5 (הדפסה — גלילים וקשיחים)', 'print'],
  ['ar3',        'אר-3 (הדפסה — גלילים בלבד)',       'print'],
  ['laser',      'לייזר',                             'cut'],
  ['soma',       'סומא (CNC)',                        'cut'],
  ['paint_room', 'חדר צבע',                           'finish'],
  ['manual',     'עבודה ידנית',                       'finish'],
  ['external',   'ספק חיצוני',                        'external'],
];

const OPERATIONS_SEED = [
  // [key, name]
  ['pre_print', 'קדם הדפסה'],
  ['print',     'הדפסה'],
  ['pre_cut',   'קדם חיתוך'],
  ['cut',       'חיתוך'],
  ['peel',      'קילוף נייר מגן'],
  ['clean',     'ניקוי קצוות'],
  ['tape_3m',   'הדבקת דבק דו-צדדי 3M'],
  ['drill',     'קידוח חורים'],
  ['paint',     'צביעה בחדר צבע'],
  ['lacquer',   'לכה'],
  ['assemble',  'הרכבה'],
  ['packaging', 'אריזה'],
  ['install',   'התקנה'],
];

function seedProduction(db) {
  const summary = [];

  const tx = db.transaction(() => {
    const insStation = db.prepare(
      `INSERT OR IGNORE INTO production_stations (key, name, kind) VALUES (?, ?, ?)`
    );
    let newStations = 0;
    for (const row of STATIONS_SEED) newStations += insStation.run(...row).changes;
    if (newStations) summary.push(`production_stations: ${newStations} שורות חדשות`);

    const insOp = db.prepare(
      `INSERT OR IGNORE INTO production_operations (key, name) VALUES (?, ?)`
    );
    let newOps = 0;
    for (const row of OPERATIONS_SEED) newOps += insOp.run(...row).changes;
    if (newOps) summary.push(`production_operations: ${newOps} שורות חדשות`);
  });
  tx();

  if (summary.length) {
    console.log('[production seed] עדכון:');
    for (const s of summary) console.log(`  ${s}`);
  } else {
    console.log('[production seed] הכל מעודכן — אין שינויים.');
  }

  return summary;
}

module.exports = { seedProduction, STATIONS_SEED, OPERATIONS_SEED };
