// Idempotent seeding for the SignCalc Pro (signshop_*) tables.
//
// Safe to run repeatedly and on a live database.sqlite: each table is only
// populated when it is currently EMPTY. The numbers below are PLACEHOLDERS so
// the engine runs end-to-end — the real values live in base44's remote backend
// and are meant to be corrected via the admin UI. The paint surcharges
// (₪850 / ₪1100) are the only values copied verbatim from the reference.
//
// Exposes seedSignshop(db) for the server to call on boot; also runnable
// standalone via `npm run db:seed-signshop`.

const path = require('path');

// ── Config: placeholder ₪ values + Hebrew labels (from PricingConfig.jsonc) ──
const CONFIG_SEED = [
  // Materials
  ['pvc_white_cost_per_mm',            8,    'עלות PVC לבן (₪/מ"מ/מ"ר)'],
  ['pvc_black_cost_per_mm',            9,    'עלות PVC שחור (₪/מ"מ/מ"ר)'],
  ['perspex_cost_per_mm',              14,   'עלות פרספקס (₪/מ"מ/מ"ר)'],
  ['ink_cost',                         15,   'עלות דיו (₪/מ"ר)'],
  ['dowel_cost_per_sqm',               10,   'עלות דוץ (₪/מ"ר)'],
  ['mounting_board_cost',              25,   'עלות לוח התקנה (₪/יחידה)'],
  ['packaging_cost',                   12,   'עלות אריזה (₪/יחידה)'],
  ['instruction_sheet_cost',           3,    'עלות דף הסבר (₪/יחידה)'],
  ['spacers_cost',                     4,    'עלות ספייסרים (₪/יחידה)'],
  ['spacers_per_element',              4,    'מספר ספייסרים לאלמנט'],
  ['spray_paint_cost',                 35,   'עלות ספריי צבע RAL (₪/יחידה)'],
  ['spray_paint_per_sqm',              1,    'מספר ספריי למ"ר'],
  ['raw_material_waste_percent',       10,   'אחוז פחת חומרי גלם (%)'],
  // Time / labor
  ['pre_print_time_minutes',           15,   'זמן קדם הדפסה (דקות)'],
  ['print_time_per_sqm_minutes',       8,    'זמן הדפסה למ"ר (דקות)'],
  // Cutting time is per thickness (מ"מ) — the engine reads
  // logo_{laser|soma}_cut_time_minutes_{3|5|10|19}. Seeded flat across
  // thicknesses as a placeholder; tune per thickness via the admin UI.
  ['logo_laser_cut_time_minutes_3',    12,   'זמן חיתוך לייזר 3 מ"מ (דקות)'],
  ['logo_laser_cut_time_minutes_5',    12,   'זמן חיתוך לייזר 5 מ"מ (דקות)'],
  ['logo_laser_cut_time_minutes_10',   12,   'זמן חיתוך לייזר 10 מ"מ (דקות)'],
  ['logo_laser_cut_time_minutes_19',   12,   'זמן חיתוך לייזר 19 מ"מ (דקות)'],
  ['logo_soma_cut_time_minutes_3',     10,   'זמן חיתוך סומא 3 מ"מ (דקות)'],
  ['logo_soma_cut_time_minutes_5',     10,   'זמן חיתוך סומא 5 מ"מ (דקות)'],
  ['logo_soma_cut_time_minutes_10',    10,   'זמן חיתוך סומא 10 מ"מ (דקות)'],
  ['logo_soma_cut_time_minutes_19',    10,   'זמן חיתוך סומא 19 מ"מ (דקות)'],
  ['packaging_time_minutes',           10,   'זמן אריזה (דקות)'],
  ['paint_room_cost',                  40,   'עבודה בחדר צבע (₪/מ"ר)'],
  ['print_hour_cost',                  120,  'עלות שעת דפוס'],
  ['general_worker_hour_cost',         60,   'עלות שעת עובד כללי'],
  // Overhead / commission
  ['operational_overhead_percent',     15,   'אחוז תקורה תפעולית (%)'],
  ['sales_agent_commission_percent',   10,   'עמלת סוכן מכירות (%)'],
  ['marketing_commission_percent',     5,    'עמלת שיווק / קמפיינים (%)'],
  // Payment terms
  ['payment_default_surcharge_percent',     5,   'תוספת תנאי תשלום ברירת מחדל (%)'],
  ['payment_installment_surcharge_percent', 2.5, 'תוספת עמלת תשלומים (%)'],
  // Vinyl sticker
  ['vinyl_sticker_material_cost_per_sqm',   25,  'מדבקת ויניל - חומר (₪/מ"ר)'],
  ['vinyl_sticker_ink_cost_per_sqm',        15,  'מדבקת ויניל - דיו (₪/מ"ר)'],
  ['vinyl_sticker_install_cost_per_sqm',    40,  'התקנת ויניל (₪/מ"ר)'],
  ['vinyl_sticker_install_min_price',       250, 'מינ׳ התקנת ויניל - מרכז (₪)'],
  ['vinyl_sticker_install_min_price_south', 400, 'מינ׳ התקנת ויניל - דרום (₪)'],
  // Selling price is a flat ₪/m² rate (+ minimum), not the old area-tier table
  // (signshop_sticker_tiers is no longer read by the engine — see useCalculator.jsx).
  ['vinyl_sticker_price_per_sqm',           140, 'מחיר מ"ר מדבקת ויניל (₪/מ"ר)'],
  ['vinyl_sticker_min_price',               180, 'מחיר מינימום לייצור מדבקת ויניל (₪)'],
  ['vinyl_sticker_install_price_per_sqm',    50, 'מחיר מ"ר התקנת ויניל (₪/מ"ר)'],
  ['vinyl_sticker_print_time_per_sqm',      6,   'זמן הדפסה ויניל (דקות/מ"ר)'],
  ['vinyl_sticker_cut_time_per_sqm',        4,   'זמן חיתוך ויניל (דקות/מ"ר)'],
  ['vinyl_sticker_pre_print_time_minutes',  10,  'זמן קדם הדפסה ויניל (דקות)'],
  ['vinyl_sticker_pre_cut_time_minutes',    8,   'זמן קדם חיתוך ויניל (דקות)'],
  // Texture sticker
  ['texture_sticker_material_cost_per_sqm',   45,  'מדבקת טקסטורה - חומר (₪/מ"ר)'],
  ['texture_sticker_ink_cost_per_sqm',        20,  'מדבקת טקסטורה - דיו (₪/מ"ר)'],
  ['texture_sticker_install_cost_per_sqm',    60,  'התקנת טקסטורה (₪/מ"ר)'],
  ['texture_sticker_install_min_price',       350, 'מינ׳ התקנת טקסטורה - מרכז (₪)'],
  ['texture_sticker_install_min_price_south', 500, 'מינ׳ התקנת טקסטורה - דרום (₪)'],
  ['texture_sticker_price_per_sqm',           210, 'מחיר מ"ר מדבקת טקסטורה (₪/מ"ר)'],
  ['texture_sticker_min_price',               260, 'מחיר מינימום לייצור מדבקת טקסטורה (₪)'],
  ['texture_sticker_install_price_per_sqm',    70, 'מחיר מ"ר התקנת טקסטורה (₪/מ"ר)'],
  ['texture_sticker_print_time_per_sqm',      8,   'זמן הדפסה טקסטורה (דקות/מ"ר)'],
  ['texture_sticker_cut_time_per_sqm',        5,   'זמן חיתוך טקסטורה (דקות/מ"ר)'],
  ['texture_sticker_pre_print_time_minutes',  12,  'זמן קדם הדפסה טקסטורה (דקות)'],
  ['texture_sticker_pre_cut_time_minutes',    10,  'זמן קדם חיתוך טקסטורה (דקות)'],
  // Lightbox
  ['lightbox_led_waterproof_cost', 12, 'לדים מוגני מים לארגז מואר (₪/יחידה)'],
  ['lightbox_led_qty_per_sqm',     10, 'כמות לדים למ"ר'],
  // Minimum price fallback — per product family (0 = disabled)
  ['logo_min_width',     50, 'לוגו — רוחב מינימום (ס"מ)'],
  ['logo_min_height',    50, 'לוגו — גובה מינימום (ס"מ)'],
  ['logo_min_price',      0, 'לוגו — מחיר מינימום (₪)'],
  ['sticker_min_width',  50, 'מדבקה — רוחב מינימום (ס"מ)'],
  ['sticker_min_height', 50, 'מדבקה — גובה מינימום (ס"מ)'],
  ['sticker_min_price',   0, 'מדבקה — מחיר מינימום (₪)'],
  ['lightbox_min_price',  0, 'ארגז מואר — מחיר מינימום (₪)'],
  // Global financial params — used by both calculators
  ['vat_percent',                      18,  'מע״מ (%)'],
  ['cash_discount_percent',             5,  'הנחת מזומן (%)'],
  ['installment_surcharge_percent',   2.5,  'תוספת תשלומים (%)'],
  // Roll-up — production time (מידע פנימי בלבד למנהל, לא משפיע על החישוב)
  ['rollup_pre_print_time_minutes',    10,  'רול אפ — קדם הדפסה (דקות)'],
  ['rollup_print_time_minutes',        15,  'רול אפ — זמן הדפסה (דקות)'],
  ['rollup_cut_time_minutes',           8,  'רול אפ — זמן חיתוך (דקות)'],
  ['rollup_packaging_time_minutes',     5,  'רול אפ — זמן אריזה (דקות)'],
  // Glass (extra clear) — production time: pre-print + print only, no cutting (bought pre-sized)
  ['glass_pre_print_time_minutes',     10,  'זכוכית אקסטרה קליר — קדם הדפסה (דקות)'],
  ['glass_print_time_minutes',         15,  'זכוכית אקסטרה קליר — זמן הדפסה (דקות)'],
];

// ── Logo selling tiers: product_type, thickness_mm, price_per_sqm, min_price ──
const PRICE_TIERS = [
  ['pvc_white', '3',  700,  600],  ['pvc_white', '5',  900,  750],
  ['pvc_white', '8',  1200, 1000], ['pvc_white', '10', 1500, 1250],
  ['pvc_black', '3',  750,  640],  ['pvc_black', '5',  950,  800],
  ['pvc_black', '8',  1250, 1050], ['pvc_black', '10', 1550, 1300],
  ['perspex',   '3',  1100, 900],  ['perspex',   '5',  1400, 1150],
  ['perspex',   '8',  1800, 1500], ['perspex',   '10', 2200, 1850],
];

// ── Sticker tiers: type, area_sqm, sticker_price, install_center, install_south ──
// area_sqm = 999 is the engine's "large area" per-m² fallback row.
const STICKER_TIERS = [
  ['vinyl_sticker',   1,   180, 250, 400], ['vinyl_sticker',   2,   320, 250, 400],
  ['vinyl_sticker',   3,   450, 300, 450], ['vinyl_sticker',   5,   700, 400, 600],
  ['vinyl_sticker',   999, 140, 50,  80],
  ['texture_sticker', 1,   260, 350, 500], ['texture_sticker', 2,   480, 350, 500],
  ['texture_sticker', 3,   680, 420, 600], ['texture_sticker', 5,   1050, 520, 750],
  ['texture_sticker', 999, 210, 70,  110],
];

// ── Paint surcharge tiers (single/dual, base + step) — verbatim base values ──
const PAINT_TIERS = [
  ['single_color', 0.33, 0.8,  850,  'בסיס עד 0.8 מ"ר'],
  ['single_color', 0.8,  null, 150,  'מדרגה לכל 0.3 מ"ר נוספים'],
  ['dual_color',   0.33, 0.8,  1100, 'בסיס עד 0.8 מ"ר'],
  ['dual_color',   0.8,  null, 200,  'מדרגה לכל 0.3 מ"ר נוספים'],
];

// ── Lightbox size tiers ──
// label, w_cm, h_cm, frame, led, transformer, sell_base, sell_per_sqm
const LIGHTBOX_TIERS = [
  ['40×60',   40,  60,  180, 12, 90,  900,  600],
  ['60×90',   60,  90,  280, 12, 120, 1400, 600],
  ['100×100', 100, 100, 420, 12, 150, 2200, 600],
];

// ── Roll-up tiers ──
// product_type, sku, description, width_m, height_m, paper_cost_per_sqm, price_unit_1, price_unit_2, price_unit_3_plus
const ROLLUP_TIERS = [
  ['rollup_magnetic', 'ROLLUP-MAG-01', 'רול אפ מגנטי 1.6×0.6', 1.6, 0.6, 8.5, 310, 310, 310],
  ['rollup_regular',  'ROLLUP-REG-01', 'רול אפ רגיל 2×0.85',   2,   0.85, 0,   35,  35,  35],
  ['rollup_regular',  'ROLLUP-REG-02', 'רול אפ רגיל 2×1.2',    2,   1.2,  0,   60,  60,  60],
];

// ── Glass (extra clear) tiers ──
// product_type, sku, description, width_cm, height_cm, cost_price, selling_price
// Source: אביתר's cost sheet (מחירון עלות 2.1.2024, glass sheet rows only — spacer
// bracket rows excluded) matched against the selling-price sheet by size. Two
// cost-sheet sizes (50x50, 50x130) had no matching selling price and are NOT
// seeded here — add them via the admin UI once a selling price is set.
const GLASS_TIERS = [
  ['glass_extra_clear', 'GLASS-20X30',   'זכוכית אקסטרה קליר 20×30',   20,  30,  14.90,  152.99],
  ['glass_extra_clear', 'GLASS-30X45',   'זכוכית אקסטרה קליר 30×45',   30,  45,  22.90,  180.78],
  ['glass_extra_clear', 'GLASS-40X40',   'זכוכית אקסטרה קליר 40×40',   40,  40,  24.90,  187.82],
  ['glass_extra_clear', 'GLASS-40X60',   'זכוכית אקסטרה קליר 40×60',   40,  60,  32.90,  215.69],
  ['glass_extra_clear', 'GLASS-40X80',   'זכוכית אקסטרה קליר 40×80',   40,  80,  45.90,  259.89],
  ['glass_extra_clear', 'GLASS-50X70',   'זכוכית אקסטרה קליר 50×70',   50,  70,  45.90,  260.34],
  ['glass_extra_clear', 'GLASS-60X90',   'זכוכית אקסטרה קליר 60×90',   60,  90,  71.90,  349.86],
  ['glass_extra_clear', 'GLASS-70X100',  'זכוכית אקסטרה קליר 70×100',  70,  100, 81.90,  385.59],
  ['glass_extra_clear', 'GLASS-50X100',  'זכוכית אקסטרה קליר 50×100',  50,  100, 89.90,  409.26],
  ['glass_extra_clear', 'GLASS-60X120',  'זכוכית אקסטרה קליר 60×120',  60,  120, 99.90,  445.89],
  ['glass_extra_clear', 'GLASS-60X100',  'זכוכית אקסטרה קליר 60×100',  60,  100, 111.90, 475.00],
  ['glass_extra_clear', 'GLASS-80X120',  'זכוכית אקסטרה קליר 80×120',  80,  120, 119.90, 600.00],
  ['glass_extra_clear', 'GLASS-100X100', 'זכוכית אקסטרה קליר 100×100', 100, 100, 179.90, 690.00],
];

function seedSignshop(db) {
  const isEmpty = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n === 0;
  const summary = [];

  const tx = db.transaction(() => {
    // Config: always INSERT OR IGNORE so new keys are added to a live table
    // without overwriting values the user already edited via the admin UI.
    const upsertCfg = db.prepare(
      `INSERT OR IGNORE INTO signshop_config (key, value, label) VALUES (?, ?, ?)`
    );
    let newKeys = 0;
    for (const [k, v, l] of CONFIG_SEED) {
      const { changes } = upsertCfg.run(k, v, l);
      newKeys += changes;
    }
    if (newKeys) summary.push(`signshop_config: ${newKeys} מפתחות חדשים הוספו`);
    if (isEmpty('signshop_price_tiers')) {
      const ins = db.prepare(`INSERT INTO signshop_price_tiers (product_type, thickness_mm, price_per_sqm, min_price) VALUES (?, ?, ?, ?)`);
      for (const r of PRICE_TIERS) ins.run(...r);
      summary.push(`signshop_price_tiers: ${PRICE_TIERS.length} שורות`);
    }
    if (isEmpty('signshop_sticker_tiers')) {
      const ins = db.prepare(`INSERT INTO signshop_sticker_tiers (product_type, area_sqm, sticker_price, installation_price_center, installation_price_south) VALUES (?, ?, ?, ?, ?)`);
      for (const r of STICKER_TIERS) ins.run(...r);
      summary.push(`signshop_sticker_tiers: ${STICKER_TIERS.length} שורות`);
    }
    if (isEmpty('signshop_paint_tiers')) {
      const ins = db.prepare(`INSERT INTO signshop_paint_tiers (paint_type, area_from, area_to, surcharge, tier_description) VALUES (?, ?, ?, ?, ?)`);
      for (const r of PAINT_TIERS) ins.run(...r);
      summary.push(`signshop_paint_tiers: ${PAINT_TIERS.length} שורות`);
    }
    if (isEmpty('signshop_lightbox_tiers')) {
      const ins = db.prepare(`INSERT INTO signshop_lightbox_tiers (size_label, width_cm, height_cm, frame_cost, led_cost, transformer_cost, selling_base_price, selling_price_per_sqm) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const r of LIGHTBOX_TIERS) ins.run(...r);
      summary.push(`signshop_lightbox_tiers: ${LIGHTBOX_TIERS.length} שורות`);
    }
    if (isEmpty('signshop_rollup_tiers')) {
      const ins = db.prepare(`INSERT INTO signshop_rollup_tiers (product_type, sku, description, width_m, height_m, paper_cost_per_sqm, price_unit_1, price_unit_2, price_unit_3_plus) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const r of ROLLUP_TIERS) ins.run(...r);
      summary.push(`signshop_rollup_tiers: ${ROLLUP_TIERS.length} שורות`);
    }
    if (isEmpty('signshop_glass_tiers')) {
      const ins = db.prepare(`INSERT INTO signshop_glass_tiers (product_type, sku, description, width_cm, height_cm, cost_price, selling_price) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const r of GLASS_TIERS) ins.run(...r);
      summary.push(`signshop_glass_tiers: ${GLASS_TIERS.length} שורות`);
    }
    if (isEmpty('signshop_lightbox_selling_prices')) {
      const ins = db.prepare(`INSERT INTO signshop_lightbox_selling_prices (sub_type, size_label, selling_base_price, selling_price_per_sqm) VALUES (?, ?, ?, ?)`);
      for (const st of ['003-01', '003-02', '003-03']) ins.run(st, '', 0, 0);
      summary.push(`signshop_lightbox_selling_prices: 3 שורות`);
    }
  });
  tx();

  if (summary.length) {
    console.log('[signshop seed] עדכון:');
    for (const s of summary) console.log(`  ${s}`);
  } else {
    console.log('[signshop seed] הכל מעודכן — אין שינויים.');
  }
  return summary;
}

module.exports = { seedSignshop, CONFIG_SEED };

// Standalone run: ensure schema then seed against the live DB.
if (require.main === module) {
  const fs = require('fs');
  const Database = require('better-sqlite3');
  const DB_PATH = path.join(__dirname, '../../database.sqlite');
  const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  console.log('[signshop seed] סכמה אומתה (IF NOT EXISTS).');
  seedSignshop(db);
  db.close();
  console.log('[signshop seed] הסתיים.');
}
