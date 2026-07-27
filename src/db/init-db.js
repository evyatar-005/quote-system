const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH     = path.join(__dirname, '../../database.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log('[init] נמחקה מסד הנתונים הישן');
}

const db = new Database(DB_PATH);
db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
console.log('[init] סכמה הוחלה.');

const insertProduct = db.prepare(`INSERT INTO products (name, sku) VALUES (?, ?)`);
const insertSub     = db.prepare(`INSERT INTO sub_products (product_id, name, sku) VALUES (?, ?, ?)`);
const insertVariant = db.prepare(`
  INSERT INTO product_variants (sub_product_id, thickness, price_per_sqm, minimum_price)
  VALUES (?, ?, ?, ?)
`);

const seed = db.transaction(() => {

  // ── 1. שמשונית ──────────────────────────────────────────────────────────────
  const { lastInsertRowid: shId } = insertProduct.run('שמשונית', 'SH-01');
  console.log(`[seed] product id=${shId} "שמשונית" sku=SH-01`);

  const { lastInsertRowid: shSubId } = insertSub.run(shId, 'שמשונית 500 גרם', 'SH-SUB-01');
  console.log(`[seed]   sub id=${shSubId} "שמשונית 500 גרם" sku=SH-SUB-01`);

  const { lastInsertRowid: shVId } = insertVariant.run(shSubId, 'Standard', 60, 150);
  console.log(`[seed]     variant id=${shVId} Standard ₪60/מ"ר מינ=₪150`);

  // ── 2. קאפה ─────────────────────────────────────────────────────────────────
  const { lastInsertRowid: kaId } = insertProduct.run('קאפה', 'KA-01');
  console.log(`[seed] product id=${kaId} "קאפה" sku=KA-01`);

  const { lastInsertRowid: kaSubId } = insertSub.run(kaId, 'קאפה 10 מ״מ', 'KA-SUB-01');
  console.log(`[seed]   sub id=${kaSubId} "קאפה 10 מ״מ" sku=KA-SUB-01`);

  const { lastInsertRowid: kaVId } = insertVariant.run(kaSubId, '10mm', 120, 200);
  console.log(`[seed]     variant id=${kaVId} 10mm ₪120/מ"ר מינ=₪200`);

  // ── 3. לוגו בחיתוך צורני ────────────────────────────────────────────────────
  const { lastInsertRowid: lgId } = insertProduct.run('לוגו בחיתוך צורני', 'LG-01');
  console.log(`[seed] product id=${lgId} "לוגו בחיתוך צורני" sku=LG-01`);

  const lgSubs = [
    { name: 'PVC לבן פרימיום', sku: 'PVC-W-01' },
    { name: 'PVC שחור',        sku: 'PVC-B-01' },
    { name: 'פרספקס שקוף',     sku: 'PRS-01'   },
  ];

  const lgVariants = [
    { thickness: '3 מ״מ',  price: 840,  min: 685  },
    { thickness: '6 מ״מ',  price: 1149, min: 1125 },
    { thickness: '10 מ״מ', price: 1650, min: 1346 },
    { thickness: '19 מ״מ', price: 3135, min: 2558 },
  ];

  for (const sub of lgSubs) {
    const { lastInsertRowid: subId } = insertSub.run(lgId, sub.name, sub.sku);
    console.log(`[seed]   sub id=${subId} "${sub.name}" sku=${sub.sku}`);
    for (const v of lgVariants) {
      const { lastInsertRowid: vId } = insertVariant.run(subId, v.thickness, v.price, v.min);
      console.log(`[seed]     variant id=${vId} ${v.thickness} ₪${v.price}/מ"ר מינ=₪${v.min}`);
    }
  }

  // ── חומרי גלם (עצמאי — לא נוגע במנוע תמחיר) ─────────────────────────────
  const insertRaw = db.prepare(
    `INSERT INTO raw_materials (name, sku, price) VALUES (?, ?, ?)`
  );

  const rawMaterials = [
    { name: 'גליל שמשונית בסיס',    sku: 'RAW-SH-01',  price: 350  },
    { name: 'PVC לבן גיליון',        sku: 'RAW-PVC-W',  price: 180  },
    { name: 'PVC שחור גיליון',       sku: 'RAW-PVC-B',  price: 195  },
    { name: 'פרספקס שקוף גיליון',    sku: 'RAW-PRS-01', price: 280  },
    { name: 'דבק UV צהוב',           sku: 'RAW-UV-01',  price: 45   },
    { name: 'ספריי לכה מגן',         sku: 'RAW-LK-01',  price: 68   },
  ];

  for (const r of rawMaterials) {
    const { lastInsertRowid } = insertRaw.run(r.name, r.sku, r.price);
    console.log(`[seed] raw_materials: id=${lastInsertRowid} sku=${r.sku} "${r.name}" ₪${r.price}`);
  }
});

seed();

const counts = {
  products:         db.prepare('SELECT COUNT(*) AS n FROM products').get().n,
  sub_products:     db.prepare('SELECT COUNT(*) AS n FROM sub_products').get().n,
  product_variants: db.prepare('SELECT COUNT(*) AS n FROM product_variants').get().n,
  raw_materials:    db.prepare('SELECT COUNT(*) AS n FROM raw_materials').get().n,
};

console.log('\n[verify] ספירת שורות:');
for (const [t, n] of Object.entries(counts)) console.log(`  ${t}: ${n} שורות`);
console.log('\n[done] database.sqlite מוכן.');
db.close();
