// Vista System 2026 catalog → משפחה → מוצר → מידה (3 levels).
//
// The product list is the catalog's own TABLE OF CONTENT, not the page list.
//
// The first attempt treated every page as a product, which was wrong twice over:
// it turned marketing spreads ("We do it your Way-Finding", "We are green!")
// into orderable products, and it split one product across the six pages of its
// spread. The TOC is the vendor's own answer to "what do you sell": each entry
// is a product section with a start page, and the section runs until the next
// entry begins. "About ..." and "Measurement Table" entries are chapter
// furniture, not products, so they are excluded by name.
//
// A product's sizes are the model codes printed across its pages. Vista codes
// ARE the size — the number is the sign height in mm, which the catalog confirms
// itself where it prints both: "V300 (A3)", "V11 (279)", "V17 (432)".
const fs = require('fs');
const path = require('path');

// [family_en, family_he, [[product_en, product_he, start_page], ...]]
// Page numbers transcribed from the catalog's Table of Content (page 2).
// product_he === null marks a non-product section (About / Measurement Table).
const FAMILIES = [
  ['Vista Classic', 'ויסטה קלאסי', [
    ['About Vista System', null, 4],
    ['Wall Signs', 'שלטי קיר', 7],
    ['Projecting Signs', 'שלטי דגל ניצבים', 16],
    ['Directories', 'לוחות מדריך', 21],
    ['Table Stands', 'סטנדים שולחניים', 29],
    ['Double Sided Pylons', 'פילונים דו-צדדיים', 35],
    ['Suspended Signs', 'שלטים תלויים', 38],
    ['Double Sided Post Signs', 'שלטי עמוד דו-צדדיים', 42],
    ['Triangular Post Signs', 'שלטי עמוד משולשים', 44],
    ['Triangular Pylons', 'פילונים משולשים', 46],
    ['Custom Products', 'מוצרים בהתאמה אישית', 49],
    ['Vista Slider', 'ויסטה סליידר', 50],
  ]],
  ['Vista Sharp', 'ויסטה שארפ', [
    ['About Vista Sharp', null, 52],
    ['Wall Frames - with end caps', 'מסגרות קיר עם פסי סיום', 55],
    ['Wall Frames - 4 extrusions', 'מסגרות קיר 4 פרופילים', 60],
    ['Directories', 'לוחות מדריך', 79],
    ['Suspended Signs', 'שלטים תלויים', 81],
    ['Flag Signs', 'שלטי דגל', 89],
    ['Double Sided Pylon', 'פילון דו-צדדי', 92],
    ['Table Stands', 'סטנדים שולחניים', 94],
  ]],
  ['Vista Square', 'ויסטה סקוור', [
    ['About Vista Square', null, 100],
    ['Wall Frames Portrait', 'מסגרות קיר לאורך', 103],
    ['Wall Frames Landscape', 'מסגרות קיר לרוחב', 121],
    ['Directories', 'לוחות מדריך', 131],
    ['Suspended Signs', 'שלטים תלויים', 139],
    ['Flag Signs', 'שלטי דגל', 151],
    ['Corner Signs', 'שלטי פינה', 155],
    ['Table Signs', 'שלטים שולחניים', 163],
    ['Square Slider', 'סקוור סליידר', 167],
    ['Measurement Table', null, 168],
  ]],
  ['Vista Nova', 'ויסטה נובה', [
    ['About Vista Nova', null, 170],
    ['Wall Frames', 'מסגרות קיר', 173],
    ['Projecting Signs', 'שלטי דגל ניצבים', 179],
    ['Directories', 'לוחות מדריך', 181],
    ['Table Stands', 'סטנדים שולחניים', 185],
    ['Suspended Signs', 'שלטים תלויים', 188],
    ['Nova Slider', 'נובה סליידר', 193],
    ['Measurement Table', null, 194],
  ]],
  ['Vista Light', 'ויסטה לייט (מואר)', [
    ['About Vista Light', null, 202],
    ['VL Wall Signs', 'שלטי קיר מוארים', 205],
    ['VL Projecting Signs', 'שלטי דגל ניצבים מוארים', 208],
    ['VL Suspended Signs', 'שלטים תלויים מוארים', 210],
    ['VL Post Signs', 'שלטי עמוד מוארים', 212],
    ['VL Pylons', 'פילונים מוארים', 214],
  ]],
  ['Vista Fabric', 'ויסטה פבריק (בד)', [
    ['About Vista Fabric', null, 226],
    ['Fab20', 'Fab20', 227],
    ['Fab40-DS', 'Fab40-DS', 228],
    ['Fab80', 'Fab80', 229],
    ['Fab120-DS', 'Fab120-DS', 230],
  ]],
  ['Vista Expand', 'ויסטה אקספנד', [
    ['About Vista Expand', null, 232],
    ['Wall Frames Portrait', 'מסגרות קיר לאורך', 235],
    ['Wall Frames Landscape', 'מסגרות קיר לרוחב', 238],
    ['Double Sided Pylons', 'פילונים דו-צדדיים', 242],
    ['Post & Panel Portrait', 'עמוד ופאנל לאורך', 246],
    ['Post & Panel Landscape', 'עמוד ופאנל לרוחב', 250],
    ['Measurement Table', null, 253],
  ]],
  ['Vista ADA', 'ויסטה ADA (נגישות)', [['Vista ADA', 'שילוט נגישות', 254]]],
  ['Vista Insert', 'ויסטה אינסרט', [['Vista Insert', 'ויסטה אינסרט', 260]]],
  ['Vista Art', 'ויסטה ארט', [['Vista Art', 'ויסטה ארט', 263]]],
  ['Tools', 'כלי עבודה והתקנה', [['Tools', 'כלי עבודה והתקנה', 276]]],
  ['Vista Slider', 'ויסטה סליידר', [['Vista Slider', 'ויסטה סליידר', 282]]],
  ['Snap Frames', 'מסגרות סנאפ', [['Snap Frames', 'מסגרות סנאפ', 286]]],
  ['Wall Mounted Display', 'תצוגה לקיר', [['Wall Mounted Display', 'תצוגה לקיר', 294]]],
  ['Plexiglas Display Stands', 'סטנדים פרספקס', [['Plexiglas Display Stands', 'סטנדים פרספקס', 299]]],
  ['A-Sign', 'שלט A', [['A-Sign', 'שלט A למדרכה', 300]]],
  ['Counter Slide-in Frame', 'מסגרת דלפק', [['Counter Slide-in Frame', 'מסגרת דלפק', 303]]],
  ['Brochure Holders', 'מתקני ברושורים', [['Brochure Holders', 'מתקני ברושורים', 304]]],
  ['Information and Menu Stands', 'סטנדי מידע ותפריט', [['Information and Menu Stands', 'סטנדי מידע ותפריט', 314]]],
  ['Bulletin Board', 'לוח מודעות', [['Bulletin Board', 'לוח מודעות', 317]]],
  ['Poster Stands', 'סטנדי פוסטר', [['Poster Stands', 'סטנדי פוסטר', 319]]],
  ['Sidewalk Sign', 'שלט מדרכה', [['Sidewalk Sign', 'שלט מדרכה', 322]]],
  ['Rigid Poster Stand', 'סטנד פוסטר קשיח', [['Rigid Poster Stand', 'סטנד פוסטר קשיח', 323]]],
  ['Queue Belt Barriers', 'מחסומי תור', [['Queue Belt Barriers', 'מחסומי תור', 324]]],
  ['Sample & Display Kits', 'ערכות דוגמה', [['Sample & Display Kits', 'ערכות דוגמה', 329]]],
];

const LAST_PAGE = 331;

// Which code prefix each family uses. Codes leaking in from another family (a
// comparison shot, a cross-reference) are dropped — otherwise a Nova product
// picks up stray F-codes and offers sizes it doesn't ship in.
const PREFIX = {
  'Vista Classic': ['V'],
  'Vista Sharp': ['FRL'],
  'Vista Square': ['F', 'DF'],
  'Vista Nova': ['VN', 'N'],
  'Vista Light': ['VL'],
  'Vista Expand': ['XP'],
  'Vista Insert': ['V', 'F', 'VN'],
  'Vista Slider': ['V', 'F'],
};

const PAPER_MM = { A3: 297, A4: 210, A5: 148, A6: 105, A7: 74, LETTER: 215.9 };

// A bare number in a code is millimetres; a 2-digit one is inches (V11 = 279mm,
// the catalog prints both). 25 is the cutoff: no Vista frame is 11–24 mm tall,
// and no inch size runs past 24".
function mmOf(code) {
  const m = code.match(/^[A-Z]+-?(A\d|Letter|\d+)$/i);
  if (!m) return 0;
  const v = m[1];
  const paper = PAPER_MM[v.toUpperCase()];
  if (paper) return paper;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return 0;
  return n < 25 ? Math.round(n * 25.4) : n;
}

const txt = fs.readFileSync(path.join(process.cwd(), 'vendor-catalogs/vista-2026.txt'), 'utf8');
const pageText = {};
let cur = null;
for (const line of txt.split('\n')) {
  const m = line.match(/^-- (\d+) of 334 --$/);
  if (m) { cur = +m[1]; pageText[cur] = []; continue; }
  if (cur != null) pageText[cur].push(line);
}

const imgDir = path.join(process.cwd(), 'sign-smart-quote/public/vista-pages');
// Photo-vs-drawing score per page, produced by tools/vista-page-scores.cjs.
// Used to pick which page of a product's spread becomes its card image.
let PAGE_SCORES = {};
try { PAGE_SCORES = require(process.cwd() + '/tools/vista-page-scores.json'); } catch (_) {}
const pageFile = p => 'p' + String(p).padStart(3, '0') + '.jpg';
const hasImage = p => fs.existsSync(path.join(imgDir, pageFile(p)));

// Flatten the TOC into one ordered section list, so a section's end page is the
// next section's start minus one — including across a family boundary.
const sections = [];
for (const [famEn, famHe, entries] of FAMILIES) {
  for (const [nameEn, nameHe, start] of entries) {
    sections.push({ famEn, famHe, nameEn, nameHe, start });
  }
}
sections.sort((a, b) => a.start - b.start);

const products = [];
sections.forEach((sec, i) => {
  // "About Vista Square" / "Measurement Table": real pages, not sellable
  // products. Skipped here, which also gives the product before them its
  // correct end page.
  if (sec.nameHe === null) return;
  const end = sections[i + 1] ? sections[i + 1].start - 1 : LAST_PAGE;
  const pages = [];
  for (let p = sec.start; p <= end; p++) if (hasImage(p)) pages.push(p);
  if (!pages.length) return;

  const allowed = PREFIX[sec.famEn] || null;
  const sizes = new Map();
  for (const p of pages) {
    const body = (pageText[p] || []).join('\n');
    for (const m of body.matchAll(/\b([A-Z]{1,3}-?(?:A[3-7]|Letter|\d{2,4}))\b/g)) {
      const code = m[1].toUpperCase().replace('-', '');
      if (/^(PDF|RGB|CMYK|ISO|USA|LED|RAL)/.test(code)) continue;
      const prefix = (code.match(/^[A-Z]+/) || [''])[0];
      if (allowed && !allowed.includes(prefix)) continue;
      const mm = mmOf(code);
      if (!mm) continue;
      if (!sizes.has(code)) sizes.set(code, { code, height_mm: mm });
    }
  }

  // Card image = the most colourful page of the spread, i.e. the installation
  // photo rather than a line drawing. Falls back to the first page when no
  // scores are available or the whole section is drawings.
  let cover = pages[0];
  let best = -1;
  for (const p of pages) {
    const sc = PAGE_SCORES[p];
    if (sc != null && sc > best) { best = sc; cover = p; }
  }
  // Below ~15 the section has no real photograph at all — keep the opening page
  // so the card still shows the product's own heading rather than a random chart.
  if (best < 15) cover = pages[0];

  products.push({
    family: sec.famEn, family_he: sec.famHe,
    name: sec.nameEn, name_he: sec.nameHe,
    page: pages[0], page_to: pages[pages.length - 1],
    cover_page: cover,
    image_file: pageFile(cover),
    sizes: [...sizes.values()].sort((a, b) => a.height_mm - b.height_mm),
    active: 1,
  });
});

// ── Family size fallback ─────────────────────────────────────────────────────
// Some product sections are pure vector art: the model codes are drawn as
// outlines, not set as text, so nothing lands in the PDF's text layer. The sizes
// still exist — they are printed on OTHER pages of the same family (measurement
// tables, spreads that did keep their text). Such a product inherits the
// family's full size list, flagged `sizes_inherited` so it is visibly a fallback
// and an admin can prune sizes the product doesn't actually ship in.
// Built from the family's ENTIRE page span, product sections and skipped ones
// alike — the "Measurement Table" pages are excluded as products but they are
// exactly where the vendor prints the full size chart, so they are the best
// source for this fallback. Dropping them here is what left Vista Expand with
// no sizes at all on the first run.
const familySizes = new Map();
for (const [famEn, , entries] of FAMILIES) {
  const bag = new Map();
  const from = Math.min(...entries.map(e => e[2]));
  const idx = sections.findIndex(s => s.famEn === famEn && s.start === Math.max(...entries.map(e => e[2])));
  const nextSec = sections[idx + 1];
  const to = nextSec ? nextSec.start - 1 : LAST_PAGE;
  const allowed = PREFIX[famEn] || null;
  for (let p = from; p <= to; p++) {
    const body = (pageText[p] || []).join(String.fromCharCode(10));
    for (const m of body.matchAll(/\b([A-Z]{1,3}-?(?:A[3-7]|Letter|\d{2,4}))\b/g)) {
      const code = m[1].toUpperCase().replace('-', '');
      if (/^(PDF|RGB|CMYK|ISO|USA|LED|RAL)/.test(code)) continue;
      const prefix = (code.match(/^[A-Z]+/) || [''])[0];
      if (allowed && !allowed.includes(prefix)) continue;
      const mm = mmOf(code);
      if (!mm) continue;
      if (!bag.has(code)) bag.set(code, { code, height_mm: mm });
    }
  }
  familySizes.set(famEn, bag);
}
for (const m of products) {
  if (m.sizes.length) { m.sizes_inherited = false; continue; }
  const bag = familySizes.get(m.family);
  if (!bag || !bag.size) { m.sizes_inherited = false; continue; }
  m.sizes = [...bag.values()].sort((a, b) => a.height_mm - b.height_mm);
  m.sizes_inherited = true;
}

fs.writeFileSync(path.join(process.cwd(), 'src/db/vista-catalog.json'), JSON.stringify(products, null, 1));

const byFam = {};
let totalSizes = 0;
for (const m of products) {
  byFam[m.family_he] = byFam[m.family_he] || { p: 0, s: 0 };
  byFam[m.family_he].p++; byFam[m.family_he].s += m.sizes.length;
  totalSizes += m.sizes.length;
}
console.log('products', products.length, '| sizes', totalSizes,
  '| inherited', products.filter(p => p.sizes_inherited).length,
  '| no sizes', products.filter(p => !p.sizes.length).length);
for (const [k, v] of Object.entries(byFam)) console.log(' ', k, '→', v.p, 'מוצרים,', v.s, 'מידות');
