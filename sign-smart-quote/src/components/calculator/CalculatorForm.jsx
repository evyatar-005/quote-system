import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronRight, Check, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import GlowSignPicker, { glowSignLabel, glowImageSrc } from "./GlowSignPicker";
import VistaPicker, { vistaLineLabel, vistaProductLabel, vistaImageSrc } from "./VistaPicker";
import logo001 from "@/assets/products/logo-001.png";
import sticker002 from "@/assets/products/sticker-002.png";
import kapa004 from "@/assets/products/kapa-004.png";
import lokobond005 from "@/assets/products/lokobond-005.png";
import foamex006 from "@/assets/products/foamex-006.png";
import rollup007 from "@/assets/products/rollup-007.png";
import rollupMagnetic007 from "@/assets/products/rollup-magnetic-007.png";
import glass009 from "@/assets/products/glass-009.png";
import perspexBoard003 from "@/assets/products/perspex-board-003.png";
import numbers012 from "@/assets/products/numbers-012.png";
import pvcCarpet013 from "@/assets/products/pvc-carpet-013.png";

// Same category thumbnails used in the admin price tables — reused here so the
// מק"ט picker (shared by both admin test panel and agent quote builder) shows
// a small product image next to each category and item.
export const CATEGORY_IMAGES = {
  "001": lokobond005,
  "002": foamex006,
  "003": perspexBoard003,
  "005": logo001,
  "006": sticker002,
  "008": kapa004,
  "009": rollupMagnetic007,
  "009-1": rollupMagnetic007,
  "009-2": rollup007,
  "010": glass009,
  "012": numbers012,
  "013": pvcCarpet013,
};

export const PRODUCT_CODES = {
  lokobond_plain: "001-1",
  lokobond_diecut: "001-2",
  foamex_white: "002-1",
  foamex_black: "002-2",
  perspex_board_clear_print: "003-1",
  perspex_board_black_matte: "003-2",
  perspex_board_black_glossy: "003-3",
  perspex_board_white: "003-4",
  perspex_board_milky: "003-5",
  perspex_board_back_print: "003-6",
  pvc_white: "005-1",
  pvc_black: "005-2",
  perspex_print: "005-3",
  perspex_print_back: "005-9",
  perspex_black: "005-4",
  perspex_white: "005-5",
  perspex_milky: "005-6",
  perspex_mirror: "005-7",
  perspex_metallic: "005-8",
  vinyl_sticker: "006-1",
  texture_sticker: "006-2",
  kapa: "008",
  rollup_magnetic: "009-1",
  rollup_regular: "009-2",
  glass_extra_clear: "010",
  pvc_carpet: "013",
  numbers_perspex_clear: "012-1",
  numbers_perspex_black: "012-2",
  numbers_perspex_white: "012-3",
  numbers_perspex_milky: "012-4",
  numbers_perspex_mirror: "012-5",
  numbers_perspex_metallic: "012-6",
  graphics: "0000",
  glow_sign: "004",
  vista_item: "014",
};

// Product image for a given productType, resolved via its מק"ט's parent code
// (e.g. "005-1" → "005") — same thumbnails as the מק"ט picker.
export function productImage(pt) {
  const code = PRODUCT_CODES[pt];
  if (!code) return null;
  return CATEGORY_IMAGES[code] || CATEGORY_IMAGES[code.split("-")[0]] || null;
}

export const PRODUCT_NAMES = {
  pvc_white: "לוגו בחיתוך צורני PVC לבן",
  pvc_black: "לוגו בחיתוך צורני PVC שחור",
  perspex_print: "לוגו בחיתוך צורני פרספקס שקוף כולל הדפסה",
  perspex_print_back: "לוגו בחיתוך צורני פרספקס בהדפסה אחורית",
  perspex_black: "לוגו בחיתוך צורני פרספקס שחור",
  perspex_white: "לוגו בחיתוך צורני פרספקס לבן",
  perspex_milky: "לוגו בחיתוך צורני פרספקס חלבי",
  perspex_mirror: "לוגו בחיתוך צורני צבעי מראה (כסוף, זהב, רוז-גולד)",
  perspex_metallic: "לוגו בחיתוך צורני צבעי זהב/כסף מטאלי",
  vinyl_sticker: "מדבקות ויניל תוצרת אורופול",
  texture_sticker: "מדבקות טקסטורה",
  kapa: "קאפה",
  lokobond_diecut: "שילוט לוקובונד עם חיתוך צורני",
  lokobond_plain: "שילוט לוקובונד ללא חיתוך צורני",
  foamex_white: "שילוט פיויסי לבן",
  foamex_black: "שילוט פיויסי שחור",
  rollup_magnetic: "רול אפ מגנטי",
  rollup_regular: "רול אפ רגיל",
  glass_extra_clear: "זכוכית אקסטרה קליר",
  perspex_board_clear_print: "פרספקס שקוף הדפסה קדמית",
  perspex_board_black_matte: "פרספקס שחור מט",
  perspex_board_black_glossy: "פרספקס שחור מבריק",
  perspex_board_white: "פרספקס לבן",
  perspex_board_milky: "פרספקס חלבי",
  perspex_board_back_print: "פרספקס שקוף הדפסה אחורית",
  pvc_carpet: "שטיח פיויסי",
  numbers_perspex_clear: "מספרים בחיתוך לייזר פרספקס שקוף",
  numbers_perspex_black: "מספרים בחיתוך לייזר פרספקס שחור",
  numbers_perspex_white: "מספרים בחיתוך לייזר פרספקס לבן",
  numbers_perspex_milky: "מספרים בחיתוך לייזר פרספקס חלבי",
  numbers_perspex_mirror: "מספרים בחיתוך לייזר פרספקס מראה",
  numbers_perspex_metallic: "מספרים בחיתוך לייזר פרספקס מטאלי",
  graphics: "גרפיקה",
  glow_sign: "שילוט פולט אור",
  vista_item: "שילוט משרדי ויסטה",
};

const STICKER_TYPES = ["vinyl_sticker", "texture_sticker"];
const KAPA_TYPES = ["kapa"];
const ROLLUP_TYPES = ["rollup_magnetic", "rollup_regular"];
const LOKOBOND_TYPES = ["lokobond_plain", "lokobond_diecut"];
const FOAMEX_TYPES = ["foamex_white", "foamex_black"];
const GLASS_TYPES = ["glass_extra_clear"];
const PVC_CARPET_TYPES = ["pvc_carpet"];
const GRAPHICS_TYPES = ["graphics"];
// Glow signs (004) — one product type; the specific sign is chosen from the
// catalog modal, not from a sub-product list.
const GLOW_TYPES = ["glow_sign"];
// Vista (014) — vendor catalog items, chosen from the same style of modal.
const VISTA_TYPES = ["vista_item"];
// Laser-cut numbers (012) — same perspex finishes as the logo family, but
// priced per single digit by height+thickness, not per m².
const NUMBER_TYPES = [
  "numbers_perspex_clear", "numbers_perspex_black", "numbers_perspex_white",
  "numbers_perspex_milky", "numbers_perspex_mirror", "numbers_perspex_metallic",
];
const PERSPEX_BOARD_TYPES = ["perspex_board_clear_print", "perspex_board_black_matte", "perspex_board_black_glossy", "perspex_board_white", "perspex_board_milky", "perspex_board_back_print"];
const REGIONS = ["מרכז", "דרום"];
const THICKNESS_OPTIONS = ["3", "5", "10", "19"];
const THICKNESS_OPTIONS_BY_CATEGORY = {
  logo: THICKNESS_OPTIONS,
  foamex: ["2", "3", "5"],
  perspexBoard: ["3", "5", "10"],
};

export const EXTRAS_OPTIONS = [
  { key: "spacers", label: "ספייסרים" },
  { key: "hidden_spacers", label: "ספייסרים נסתרים" },
  { key: "paint_single", label: "צביעה בחדר צבע - גוון יחיד" },
  { key: "paint_double", label: "צביעה בחדר צבע - 2 גוונים" },
  { key: "double_sided_tape", label: "דבק דו-צדדי" },
];

// Which extras each product category actually offers. Spacers/paint stay
// logo-only (that's their whole pricing model — per-element / per-area
// surcharge tiers that only make sense for the logo family). Double-sided
// tape is priced independently per family (its own cost + selling-price
// config keys, see useCalculator.jsx applyTapeExtra), so it's offered
// wherever sales asked for it — adding a category here is the ONLY place
// needed to expose it in every calculator that renders CalculatorForm
// (agent calculator + admin test tool both share this component).
const TAPE_OPTION = EXTRAS_OPTIONS.find((o) => o.key === "double_sided_tape");
export const EXTRAS_BY_CATEGORY = {
  logo: EXTRAS_OPTIONS,
  lokobond: [TAPE_OPTION],
  foamex: [TAPE_OPTION],
  perspexBoard: [TAPE_OPTION],
  kapa: [TAPE_OPTION],
};

const LOGO_PRODUCTS = {
  pvc_white: 'לוגו PVC לבן', pvc_black: 'לוגו PVC שחור',
  perspex_print: 'לוגו פרספקס שקוף כולל הדפסה', perspex_print_back: 'לוגו פרספקס בהדפסה אחורית', perspex_black: 'לוגו פרספקס שחור',
  perspex_white: 'לוגו פרספקס לבן', perspex_milky: 'לוגו פרספקס חלבי',
  perspex_mirror: 'לוגו צבעי מראה', perspex_metallic: 'לוגו צבעי זהב/כסף מטאלי',
};
const STICKER_PRODUCTS = { vinyl_sticker: 'מדבקת ויניל', texture_sticker: 'מדבקת טקסטורה' };

// Products requested by clients but without pricing/cost data configured yet
// in the system — shown in the picker so the agent knows they exist, but
// disabled with a "בקרוב" badge instead of a live SKU (no calculator behind
// them yet). Once an admin sets real prices for one, move it into CATALOG.
const COMING_SOON_PRODUCTS = [
  "מדבקות בחיתוך צורני",
  "ארגז מואר",
];

// Morning-style cascade: parent (אב מק"ט) → sub-products (תת מק"ט). Exported
// so other screens that need the same product-family grouping (e.g. the
// production-recipe admin) reuse this instead of re-deriving it from
// PRODUCT_CODES/PRODUCT_NAMES and risking the two lists drifting apart.
export const CATALOG = [
  { parent: "001", label: "שילוט לוקובונד", subs: ["lokobond_plain", "lokobond_diecut"] },
  { parent: "002", label: "שילוט פיויסי", subs: ["foamex_white", "foamex_black"] },
  { parent: "003", label: "שילוט פרספקס", subs: PERSPEX_BOARD_TYPES },
  { parent: "005", label: "לוגו בחיתוך צורני", subs: ["pvc_white", "pvc_black", "perspex_print", "perspex_print_back", "perspex_black", "perspex_white", "perspex_milky", "perspex_mirror", "perspex_metallic"] },
  { parent: "006", label: "מדבקות קיר", subs: ["vinyl_sticker", "texture_sticker"] },
  { parent: "008", label: "קאפה", subs: ["kapa"] },
  { parent: "009", label: "רול אפ", subs: ["rollup_magnetic", "rollup_regular"] },
  { parent: "010", label: "זכוכית אקסטרה קליר", subs: ["glass_extra_clear"] },
  { parent: "012", label: "מספרים בחיתוך לייזר", subs: NUMBER_TYPES },
  { parent: "013", label: "שטיח פיויסי", subs: ["pvc_carpet"] },
  { parent: "004", label: "שילוט פולט אור", subs: ["glow_sign"] },
  { parent: "014", label: "שילוט משרדי ויסטה", subs: ["vista_item"] },
  { parent: "0000", label: "גרפיקה", subs: ["graphics"] },
];

// One muted brand hue per product family (Printela palette) — every category
// in the מק"ט picker gets a distinct, consistent color for its badge/accent so
// the domains are visually separated at a glance, not just listed as text.
// Full class strings (not bare color names) so Tailwind's content scanner —
// which just looks for literal class-like text in the file — picks them up.
const CATEGORY_ACCENT = {
  "001": "border-brand-green bg-brand-green",  // לוקובונד
  "002": "border-brand-purple bg-brand-purple", // פיויסי
  "003": "border-brand-teal bg-brand-teal",   // פרספקס
  "004": "border-brand-gold bg-brand-gold",   // פולט אור
  "014": "border-brand-teal bg-brand-teal",   // ויסטה
  "005": "border-brand-gold bg-brand-gold",   // לוגו
  "006": "border-brand-pink bg-brand-pink",   // מדבקות
  "008": "border-brand-teal bg-brand-teal",   // קאפה
  "009": "border-brand-green bg-brand-green",  // רול אפ
  "010": "border-brand-purple bg-brand-purple", // זכוכית
};

// Default form values applied when a sub-product is chosen, per family.
// widthM/heightM always start as "" (not undefined) — an undefined value trips
// the "חובה > 0" validation immediately on selection, before the agent even
// touched the field, and forces them to first clear it before typing real
// measurements. "" reads as untouched and shows a clean empty cell instead.
const CATEGORY_DEFAULTS = {
  logo:     { widthM: "", heightM: "", thicknessMm: "5", region: "מרכז", quantity: "1", elements: "", extras: [] },
  sticker:  { widthM: "", heightM: "", thicknessMm: "", region: "מרכז", quantity: "1", includeInstallation: "yes", extras: [] },
  kapa:     { quantity: "1", cutType: "straight", standardShelves: "", customShelves: "", legsQty: "", coloredShelfQty: "", dealOverrides: null, extras: [] },
  // Roll-up is a fixed-price catalog row (like kapa) — no thickness/dimensions.
  rollup:   { quantity: "1", extras: [] },
  // Lokobond has one fixed 3mm thickness — no dropdown, but the field is still
  // sent to `calculate()` for tier lookup consistency.
  lokobond: { widthM: "", heightM: "", thicknessMm: "3", quantity: "1", elements: "", extras: [] },
  foamex:   { widthM: "", heightM: "", thicknessMm: "2", quantity: "1", elements: "", extras: [] },
  // Glass is a fixed-price catalog row (like kapa/rollup) — no thickness/dimensions.
  glass:    { quantity: "1", extras: [] },
  perspexBoard: { widthM: "", heightM: "", thicknessMm: "3", quantity: "1", elements: "", extras: [] },
  // PVC carpet is sold off a fixed-width roll, not by thickness — the fixed
  // thicknessMm below is just a price-tier lookup key (same reasoning as
  // lokobond's fixed "3"), never shown as a dropdown, never used in the cost math.
  pvcCarpet: { widthM: "", heightM: "", thicknessMm: "2", quantity: "1", extras: [] },
  // No dimension inputs — the chosen tier already carries height + thickness.
  numbers: { quantity: "1", extras: [] },
  // Graphics is a fixed-price catalog row (like kapa/rollup/glass) — no dimensions.
  graphics: { quantity: "1", extras: [] },
  // Glow signs carry the chosen catalog row's standard size, but the agent can
  // still override it — a non-standard size is priced off the same ₪/מ"ר.
  glow: { widthM: "", heightM: "", quantity: "1", extras: [] },
  // Vista is a fixed-price catalog row — the frame model already fixes the size.
  vista: { quantity: "1", extras: [] },
};

export function categoryOf(pt) {
  if (STICKER_TYPES.includes(pt)) return "sticker";
  if (KAPA_TYPES.includes(pt)) return "kapa";
  if (PERSPEX_BOARD_TYPES.includes(pt)) return "perspexBoard";
  if (ROLLUP_TYPES.includes(pt)) return "rollup";
  if (LOKOBOND_TYPES.includes(pt)) return "lokobond";
  if (FOAMEX_TYPES.includes(pt)) return "foamex";
  if (GLASS_TYPES.includes(pt)) return "glass";
  if (PVC_CARPET_TYPES.includes(pt)) return "pvcCarpet";
  if (NUMBER_TYPES.includes(pt)) return "numbers";
  if (GRAPHICS_TYPES.includes(pt)) return "graphics";
  if (GLOW_TYPES.includes(pt)) return "glow";
  if (VISTA_TYPES.includes(pt)) return "vista";
  return "logo";
}

const fmt = (val) => val != null ? `₪ ${Number(val).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—";

// Clean underline field style — same principle as the "שם לקוח" input at the top
// of the quote: no boxed rounded rectangle, just a bottom rule that turns amber on
// focus. Reused across every input/select in the item row.
export const UNDERLINE = "h-10 bg-transparent border-0 border-b-2 border-slate-300 rounded-none px-1 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-amber-400";
export const UNDERLINE_CENTER = `${UNDERLINE} text-center`;
// Read-only computed value (מחיר יחידה / סה״כ) — same underline, no box.
export const READONLY = "h-10 flex items-center justify-center border-0 border-b-2 border-slate-300 text-base";

// Compact field wrapper used inside the single Morning-style row — label on top,
// control below, fixed-ish width but allowed to grow a bit ("קצת שמנה", not narrow).
export function Field({ label, width = "w-24", required = false, children }) {
  return (
    <div className={`flex flex-col gap-1 ${width} shrink-0`}>
      <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide whitespace-nowrap">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

// Deal chips ("מבצעים") shown under a kapa add-on's quantity field — clicking
// a chip toggles it as the active override for that product (only one active
// per product at a time; clicking the active chip again clears it).
function KapaDealChips({ productKey, deals, active, onToggle }) {
  const relevant = (deals || []).filter((d) => d.product_key === productKey);
  if (!relevant.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {relevant.map((d) => {
        const isActive = active?.[productKey]?.id === d.id;
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onToggle(d)}
            title={d.mode === "override" ? "מחליף את המחיר הרגיל" : "מתווסף למחיר הרגיל"}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              isActive ? "bg-amber-500 border-amber-500 text-white" : "bg-white border-slate-300 text-slate-600 hover:border-amber-400"
            }`}
          >
            {d.qty} ב-{Number(d.price || 0).toLocaleString("he-IL")}₪{d.mode === "override" ? "" : " +"}
          </button>
        );
      })}
    </div>
  );
}

// Thickness options an admin never priced (no signshop_price_tiers row, or one
// with price_per_sqm = 0) must never reach the agent — a hidden "5 מ״מ" that
// silently prices off a raw-cost fallback would show a false, unenforced price.
// Falls back to the full category list when priceTiers hasn't loaded yet
// (empty array) so the dropdown isn't blanked out before data arrives.
function availableThicknesses(category, productType, priceTiers) {
  const all = THICKNESS_OPTIONS_BY_CATEGORY[category] || THICKNESS_OPTIONS;
  if (!priceTiers || !priceTiers.length) return all;
  const priced = all.filter((t) => priceTiers.some((tier) =>
    tier.product_type === productType && String(tier.thickness_mm) === String(t) && (parseFloat(tier.price_per_sqm) || 0) > 0
  ));
  // A product with NO priced thickness at all (never configured in the admin
  // price table) falls back to the full list rather than rendering an empty,
  // broken dropdown — that's a "this SKU needs pricing" admin gap, not
  // something a hidden option list can fix.
  return priced.length ? priced : all;
}

export default function CalculatorForm({ values, onChange, allowedProducts, extrasInfo, basePrice, unitPriceExVat, priceRangeMin, priceRangeMax, paymentKey = 'full', installmentCount = 2, config, priceTiers = [], kapaPriceTiers = [], rollupPriceTiers = [], glassPriceTiers = [], numberPriceTiers = [], graphicsPriceTiers = [], priceMissing = false, priceErrorMessage = null }) {
  // Restrict the catalog to the products this instance is allowed to offer —
  // e.g. the קאפה test section should only ever show the קאפה category.
  const filteredCatalog = allowedProducts && allowedProducts.length
    ? CATALOG.map((cat) => ({ ...cat, subs: cat.subs.filter((pt) => allowedProducts.includes(pt)) })).filter((cat) => cat.subs.length > 0)
    : CATALOG;

  const set = (key, val) => onChange({ ...values, [key]: val });
  // Starts open when the item already carries graphics notes (editing a
  // duplicated/existing quote) — otherwise collapsed, since most lines never
  // need it and a permanently-visible textarea just adds clutter.
  const [graphicsNoteOpen, setGraphicsNoteOpen] = useState(() => !!values.graphicsNote?.trim());
  const [extrasOpen, setExtrasOpen] = useState(false);
  const extrasRef = useRef(null);
  const [expandedParent, setExpandedParent] = useState(() => (filteredCatalog.length === 1 ? filteredCatalog[0].parent : null));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  // The 004 catalog opens as its own full-screen modal rather than as another
  // branch of the מק"ט dropdown — see GlowSignPicker for why.
  const [glowPickerOpen, setGlowPickerOpen] = useState(false);
  const [vistaPickerOpen, setVistaPickerOpen] = useState(false);
  // Live value of the לוקובונד/פיויסי price-per-sqm slider while mid-drag —
  // null when not dragging (falls back to the committed values.customPricePerSqm).
  const [sliderDragValue, setSliderDragValue] = useState(null);
  // Kapa add-on deals ("מבצעים") — loaded once per form mount, filtered per
  // product key when rendering the shelves/legs/colored-shelf chips below.
  const [kapaDeals, setKapaDeals] = useState([]);
  const pickerRef = useRef(null);
  const pickerDropdownRef = useRef(null);
  const formRowsRef = useRef(null);

  // When opening the מק"ט picker for a new item lower on the page, the dropdown
  // (up to 80vh tall) can render mostly below the viewport. Scroll it into view
  // once it's painted so the whole list is visible instead of being cut off.
  useEffect(() => {
    if (pickerOpen && pickerDropdownRef.current) {
      requestAnimationFrame(() => {
        pickerDropdownRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    }
  }, [pickerOpen]);

  // Enter moves focus to the next input/textarea in the row (like Tab) — except
  // inside the free-text description, where Enter should just add a new line.
  const handleEnterAdvances = (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.target.tagName === 'TEXTAREA') return; // let the newline happen
    e.preventDefault();
    if (!formRowsRef.current) return;
    const focusable = Array.from(formRowsRef.current.querySelectorAll('input, textarea'))
      .filter((el) => !el.disabled && el.offsetParent !== null);
    const idx = focusable.indexOf(e.target);
    if (idx >= 0 && idx < focusable.length - 1) {
      focusable[idx + 1].focus();
      if (focusable[idx + 1].select) focusable[idx + 1].select();
    }
  };

  // מוצר חופשי — שורה ראשונה בבורר: ללא מק"ט, מלל חופשי + מחיר ידני, ללא מידות.
  // מוצג רק בבורר המלא של הסוכן (כשאין הגבלת allowedProducts).
  const showFreeProduct = !(allowedProducts && allowedProducts.length);
  const selectFree = () => {
    onChange({ productType: "free_product", quantity: "1", freePrice: "", lineLabel: values.lineLabel || "", extras: [] });
    setExpandedParent(null);
    setPickerOpen(false);
    setPickerSearch("");
  };

  // Choosing a sub-product (תת מק"ט) applies its family defaults and reveals the
  // dry calculator params — the description line is preserved across the change.
  const selectSub = (pt) => {
    // 004 has no meaningful "sub-product" — reaching it from the flat search
    // results must open the artwork catalog, not drop an empty glow line that
    // has no sign, no size and no description on it.
    if (pt === "glow_sign") { setGlowPickerOpen(true); return; }
    if (pt === "vista_item") { setVistaPickerOpen(true); return; }
    const cat = categoryOf(pt);
    const defaults = CATEGORY_DEFAULTS[cat];
    // "Smart" thickness re-selection only applies to families that actually
    // HAVE a thickness dropdown (logo/foamex/perspexBoard — see
    // THICKNESS_OPTIONS_BY_CATEGORY). Everything else (lokobond, pvcCarpet,
    // kapa...) has a fixed thicknessMm that's just an internal price-tier
    // lookup key, never shown/changed by the agent — availableThicknesses()
    // has no real option list for those and would fall back to the generic
    // logo list (3/5/10/19), silently overwriting a fixed default like
    // pvcCarpet's "2" with an unrelated, unpriced thickness.
    let thicknessMm = defaults.thicknessMm;
    if (THICKNESS_OPTIONS_BY_CATEGORY[cat]) {
      // If the category default thickness (e.g. logo's "5") was never priced
      // for THIS product type, land on the first thickness that actually has
      // a price instead of silently opening on an unpriced/hidden one.
      const priced = availableThicknesses(cat, pt, priceTiers);
      thicknessMm = defaults.thicknessMm && priced.includes(defaults.thicknessMm)
        ? defaults.thicknessMm
        : (priced[0] ?? defaults.thicknessMm);
    }
    onChange({ ...defaults, thicknessMm, productType: pt, lineLabel: values.lineLabel || "" });
    setExpandedParent(null);
    setPickerOpen(false);
    setPickerSearch("");
  };
  // Kapa sub-SKU = a fixed-price row from the price list (מחיר קבוע × כמות).
  const selectKapa = (tier) => {
    onChange({ ...CATEGORY_DEFAULTS.kapa, productType: "kapa", kapaTierId: tier.id, lineLabel: values.lineLabel || "" });
    setExpandedParent(null);
    setPickerOpen(false);
    setPickerSearch("");
  };
  // Roll-up sub-SKU = a fixed-price row from the price list (מחיר קבוע × כמות).
  const selectRollup = (tier) => {
    onChange({ ...CATEGORY_DEFAULTS.rollup, productType: tier.product_type, rollupTierId: tier.id, lineLabel: values.lineLabel || "" });
    setExpandedParent(null);
    setPickerOpen(false);
    setPickerSearch("");
  };
  // Glass sub-SKU = a fixed-price row from the price list (מחיר קבוע × כמות).
  const selectGlass = (tier) => {
    onChange({ ...CATEGORY_DEFAULTS.glass, productType: "glass_extra_clear", glassTierId: tier.id, lineLabel: values.lineLabel || "" });
    setExpandedParent(null);
    setPickerOpen(false);
    setPickerSearch("");
  };
  // Numbers sub-SKU = a fixed-price row from the price list (מחיר קבוע לספרה × כמות ספרות).
  const selectNumberTier = (tier) => {
    onChange({ ...CATEGORY_DEFAULTS.numbers, productType: tier.product_type, numberTierId: tier.id, lineLabel: values.lineLabel || "" });
    setExpandedParent(null);
    setPickerOpen(false);
    setPickerSearch("");
  };
  // Graphics sub-SKU = a fixed-price row from the price list (מחיר קבוע × כמות).
  const selectGraphics = (tier) => {
    onChange({ ...CATEGORY_DEFAULTS.graphics, productType: "graphics", graphicsTierId: tier.id, lineLabel: values.lineLabel || "" });
    setExpandedParent(null);
    setPickerOpen(false);
    setPickerSearch("");
  };
  // Glow sign = catalog artwork + its standard size; the price comes from the
  // global ₪/מ"ר, so nothing price-related is copied onto the line. The sign's
  // full name goes into lineLabel so it reaches the quote description without
  // the agent typing it — which is the whole point of the catalog.
  const selectGlowSign = (sign) => {
    onChange({
      ...CATEGORY_DEFAULTS.glow,
      productType: "glow_sign",
      glowSignId: sign.id,
      glowSignName: sign.name,
      glowSignImage: sign.image_file || "",
      widthM: sign.width_cm > 0 ? String(sign.width_cm / 100) : "",
      heightM: sign.height_cm > 0 ? String(sign.height_cm / 100) : "",
      lineLabel: glowSignLabel(sign),
    });
    setExpandedParent(null);
    setPickerOpen(false);
    setPickerSearch("");
  };
  // Vista = משפחה → מוצר → מידה. The line carries the SIZE id (that is where
  // the price lives, read live off the row) plus the product artwork/title.
  const selectVistaItem = (product, size) => {
    onChange({
      ...CATEGORY_DEFAULTS.vista,
      productType: "vista_item",
      vistaSizeId: size.id,
      vistaItemName: size.code && size.code !== "יחידה" ? `${vistaProductLabel(product)} — ${size.code}` : vistaProductLabel(product),
      vistaItemImage: product.image_file || "",
      lineLabel: vistaLineLabel(product, size),
    });
    setExpandedParent(null);
    setPickerOpen(false);
    setPickerSearch("");
  };
  const clearProduct = () => onChange({ productType: "", kapaTierId: null, rollupTierId: null, glassTierId: null, numberTierId: null, graphicsTierId: null, glowSignId: null, glowSignName: "", glowSignImage: "", vistaSizeId: null, vistaItemName: "", vistaItemImage: "", lineLabel: values.lineLabel || "", extras: [] });
  const kapaTier = values.kapaTierId != null ? kapaPriceTiers.find(t => String(t.id) === String(values.kapaTierId)) : null;
  const rollupTier = values.rollupTierId != null ? rollupPriceTiers.find(t => String(t.id) === String(values.rollupTierId)) : null;
  const glassTier = values.glassTierId != null ? glassPriceTiers.find(t => String(t.id) === String(values.glassTierId)) : null;
  const numberTier = values.numberTierId != null ? numberPriceTiers.find(t => String(t.id) === String(values.numberTierId)) : null;
  const graphicsTier = values.graphicsTierId != null ? graphicsPriceTiers.find(t => String(t.id) === String(values.graphicsTierId)) : null;

  // Calculate price multiplier based on payment key
  const installmentSurchargePct = (parseFloat(config?.payment_installment_surcharge_percent) || 2.5) / 100;
  // basePrice שמגיע לכאן = מחיר הנחת מזומן (מחיר הבסיס). תשלום בודד = מזומן = בסיס.
  // תשלומים = בסיס × (1 + (מספר_תשלומים − 1) × 2.5%)
  let priceMultiplier = 1;
  if (paymentKey === 'installments') {
    priceMultiplier = 1 + (installmentCount - 1) * installmentSurchargePct;
  }
  // Catalog/picker prices are stored as cash prices — shown adjusted for the
  // order's current payment method so the picker matches the price the agent
  // sees once the row is picked (no 210-vs-215-style mismatch).
  const paymentAdjustedPrice = (p) => Math.round((parseFloat(p) || 0) * priceMultiplier);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (extrasRef.current && !extrasRef.current.contains(e.target)) {
        setExtrasOpen(false);
      }
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setPickerOpen(false);
        setExpandedParent(null);
        setPickerSearch("");
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const PAINT_KEYS = ['paint_single', 'paint_double'];
  const SPACER_KEYS = ['spacers', 'hidden_spacers'];

  const toggleExtra = (key) => {
    const current = values.extras || [];
    if (current.includes(key)) {
      set('extras', current.filter(k => k !== key));
    } else {
      // mutually exclusive groups
      let filtered = current;
      if (PAINT_KEYS.includes(key)) filtered = filtered.filter(k => !PAINT_KEYS.includes(k));
      if (SPACER_KEYS.includes(key)) filtered = filtered.filter(k => !SPACER_KEYS.includes(k));
      set('extras', [...filtered, key]);
    }
  };

  const isKapa = KAPA_TYPES.includes(values.productType);
  const isRollup = ROLLUP_TYPES.includes(values.productType);
  const isGlass = GLASS_TYPES.includes(values.productType);
  const isNumbers = NUMBER_TYPES.includes(values.productType);
  const isGraphics = GRAPHICS_TYPES.includes(values.productType);
  // Glow signs are area-priced, so they are NOT a fixed-price family — they keep
  // the אורך/גובה fields (pre-filled from the catalog, still editable).
  const isGlow = GLOW_TYPES.includes(values.productType);
  const isVista = VISTA_TYPES.includes(values.productType);
  const isFixedPrice = isKapa || isRollup || isGlass || isNumbers || isGraphics || isVista;
  const category = categoryOf(values.productType);

  useEffect(() => {
    if (!isKapa) return;
    base44.entities.KapaDeal.list().then(setKapaDeals).catch(() => setKapaDeals([]));
  }, [isKapa]);

  // Applies (or clears, on a second click) a deal as the active override for
  // its product key — only one deal can be active per product at a time.
  const toggleKapaDeal = (deal) => {
    const current = values.dealOverrides || {};
    const isActive = current[deal.product_key]?.id === deal.id;
    set("dealOverrides", { ...current, [deal.product_key]: isActive ? null : { id: deal.id, price: deal.price, mode: deal.mode } });
  };
  const isLogo = category === "logo";
  const categoryExtras = EXTRAS_BY_CATEGORY[category] || [];
  const isSticker = STICKER_TYPES.includes(values.productType);
  // Elements (for מ"א calc) apply to logo + foamex — anything with real dimensions
  // that isn't a sticker, lokobond, PVC carpet, or a fixed-price kapa/rollup/glass row.
  const showElementsField = !isSticker && !isFixedPrice && !isGlow && category !== "lokobond" && category !== "pvcCarpet";
  // PVC carpet has one fixed thickness (like lokobond) — no dropdown, the
  // engine only uses thicknessMm as an internal price-tier lookup key.
  const showThicknessField = !isSticker && !isFixedPrice && !isGlow && category !== "lokobond" && category !== "pvcCarpet";

  // If the selected thickness stops being priced out from under the agent —
  // priceTiers loading in after the row was already on "5", or an admin
  // zeroing a price out mid-session — silently reselecting an unpriced
  // thickness is never acceptable. Snap to the first priced option instead.
  useEffect(() => {
    if (!showThicknessField) return;
    const priced = availableThicknesses(category, values.productType, priceTiers);
    if (priced.length && !priced.includes(values.thicknessMm)) {
      set('thicknessMm', priced[0]);
    }
  }, [showThicknessField, category, values.productType, values.thicknessMm, priceTiers]);

  // Agent-adjustable price range — only lokobond/foamex tiers can define an
  // agent_min_price_per_sqm floor below the starting price_per_sqm; other families
  // never populate priceRangeMin/Max, so the slider only ever renders for these two.
  // Whether this family EVER shows the discount slider — kept stable the
  // moment the SKU is picked so the row reserves its space immediately, instead
  // of popping in only once dimensions are typed (which read as a cheap,
  // jumpy UI). `hasPriceRange` is the "real numbers are in" version used to
  // decide whether to render the live slider vs. a same-height placeholder.
  const isPriceRangeFamily = category === "lokobond" || category === "foamex" || category === "perspexBoard" || category === "pvcCarpet";
  const hasPriceRange = isPriceRangeFamily && priceRangeMin != null && priceRangeMax != null && priceRangeMin < priceRangeMax;

  const q = parseInt(values.quantity) || 1;
  // unitPriceExVat/basePrice arrive as the CASH price — the order's default
  // payment method is "up to 2 installments" (not cash), and most clients
  // don't pay cash. Showing the raw cash number here would read as the real
  // price and confuse the agent, so the displayed price always reflects the
  // currently selected payment method (matches what the order sidebar charges).
  const displayUnitPriceExVat = unitPriceExVat != null ? unitPriceExVat * priceMultiplier : null;
  const totalExVat = displayUnitPriceExVat != null ? displayUnitPriceExVat * q : null;

  // Flat, searchable view of every selectable row across all categories — built
  // once per render (catalog is small) so the picker can offer instant search
  // instead of forcing the agent to expand each אב מק"ט by hand.
  const pickerSearchQuery = pickerSearch.trim().toLowerCase();
  const catalogSearchEntries = pickerSearchQuery ? filteredCatalog.flatMap((cat) => {
    const kapaSubs = cat.parent === "008" ? kapaPriceTiers : null;
    const rollupSubs = cat.parent === "009" ? rollupPriceTiers : null;
    const glassSubs = cat.parent === "010" ? glassPriceTiers : null;
    // Only rows an admin has actually priced (> 0) are ever selectable here — a
    // freshly-added height/thickness row defaults to ₪0 in NumberPriceTable.jsx
    // until someone fills it in, and must never be quotable at ₪0 in the meantime.
    const numberSubs = cat.parent === "012" ? numberPriceTiers.filter((t) => Number(t.price_per_unit) > 0) : null;
    const graphicsSubs = cat.parent === "0000" ? graphicsPriceTiers : null;
    if (kapaSubs) {
      return kapaSubs.map((t) => ({ key: `kapa-${t.id}`, image: CATEGORY_IMAGES[cat.parent], code: cat.parent, title: t.description, sub: cat.label, price: paymentAdjustedPrice(t.price), onClick: () => selectKapa(t) }));
    }
    if (rollupSubs) {
      return rollupSubs.map((t) => ({ key: `rollup-${t.id}`, image: CATEGORY_IMAGES[cat.parent], code: PRODUCT_CODES[t.product_type] || cat.parent, title: t.description, sub: cat.label, price: paymentAdjustedPrice(t.price_unit_1), onClick: () => selectRollup(t) }));
    }
    if (glassSubs) {
      return glassSubs.map((t) => ({ key: `glass-${t.id}`, image: CATEGORY_IMAGES[cat.parent], code: cat.parent, title: t.description, sub: cat.label, price: paymentAdjustedPrice(t.selling_price), onClick: () => selectGlass(t) }));
    }
    if (numberSubs) {
      return numberSubs.map((t) => ({ key: `number-${t.id}`, image: CATEGORY_IMAGES[cat.parent], code: PRODUCT_CODES[t.product_type] || cat.parent, title: `${PRODUCT_NAMES[t.product_type]} — ${t.height_cm} ס"מ / ${t.thickness_mm} מ"מ`, sub: cat.label, price: paymentAdjustedPrice(t.price_per_unit), onClick: () => selectNumberTier(t) }));
    }
    if (graphicsSubs) {
      return graphicsSubs.map((t) => ({ key: `graphics-${t.id}`, image: CATEGORY_IMAGES[cat.parent], code: cat.parent, title: t.description, sub: cat.label, price: paymentAdjustedPrice(t.price), onClick: () => selectGraphics(t) }));
    }
    return cat.subs.map((pt) => ({ key: pt, image: CATEGORY_IMAGES[cat.parent], code: PRODUCT_CODES[pt], title: PRODUCT_NAMES[pt], sub: cat.label, price: null, onClick: () => selectSub(pt) }));
  }).filter((entry) => `${entry.title} ${entry.code} ${entry.sub}`.toLowerCase().includes(pickerSearchQuery)) : [];
  const comingSoonSearchEntries = pickerSearchQuery
    ? COMING_SOON_PRODUCTS.filter((label) => label.toLowerCase().includes(pickerSearchQuery)).map((label) => ({ key: `soon-${label}`, title: label, comingSoon: true }))
    : [];

  // ── Morning-style מק"ט picker: click the field → dropdown → אב מק"ט → תת מק"ט ──
  if (!values.productType) {
    return (
      <div className="flex flex-col gap-3" ref={pickerRef}>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-5">
          <Field label='מק"ט' width="w-64">
            <div className="relative">
              <button
                type="button"
                onClick={() => setPickerOpen((o) => !o)}
                className={`flex h-10 w-full items-center justify-between rounded-none border-0 border-b-2 bg-transparent px-1 text-base transition-colors ${pickerOpen ? "border-amber-400" : "border-slate-300 hover:border-slate-500"}`}
              >
                <span className="text-slate-600 truncate">בחר מק"ט / מוצר...</span>
                <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform shrink-0 ${pickerOpen ? "rotate-180" : ""}`} />
              </button>

              {pickerOpen && (
                <div ref={pickerDropdownRef} className="absolute z-50 mt-1 w-[440px] max-w-[92vw] rounded-xl border-2 border-slate-900 bg-white shadow-xl max-h-96 overflow-y-auto">
                {/* max-h-96 (24rem) ≈ search bar + 6 rows visible — the rest scrolls
                    inside the popover instead of the list spilling past the fold. */}
            {/* Quick search — lets an agent type a few letters instead of expanding
                every אב מק"ט by hand to find where an item lives. */}
            <div className="sticky top-0 z-10 bg-white border-b-2 border-slate-200 p-2">
              <input
                type="text"
                autoFocus
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="חיפוש מוצר / מק&quot;ט..."
                className="h-10 w-full rounded-lg border-2 border-slate-300 bg-slate-50 px-3 text-base placeholder:text-slate-400 focus-visible:outline-none focus-visible:border-amber-400"
              />
            </div>
            {pickerSearchQuery ? (
              <div className="divide-y divide-slate-100">
                {catalogSearchEntries.length === 0 && comingSoonSearchEntries.length === 0 ? (
                  <div className="px-4 py-6 text-center text-base text-slate-400">לא נמצאו תוצאות</div>
                ) : (
                  <>
                  {comingSoonSearchEntries.map((entry) => (
                    <div
                      key={entry.key}
                      title="עדיין אין מחיר ועלות מוגדרים למוצר הזה"
                      className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-right opacity-60 cursor-not-allowed"
                    >
                      <span className="text-lg font-semibold text-slate-500">{entry.title}</span>
                      <span className="text-sm font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 shrink-0">בקרוב</span>
                    </div>
                  ))}
                  {catalogSearchEntries.map((entry) => (
                    <button
                      type="button"
                      key={entry.key}
                      onClick={entry.onClick}
                      className="w-full flex items-center justify-between gap-3 px-4 py-2 text-right hover:bg-amber-50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 shrink-0 flex items-center justify-center">
                          {entry.image && (
                            <img src={entry.image} alt={entry.title} className="w-10 h-10 rounded-lg object-cover" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-mono text-slate-400 truncate">{entry.code} · {entry.sub}</div>
                          <div className="text-lg font-semibold text-slate-700">{entry.title}</div>
                        </div>
                      </div>
                      {entry.price != null && <span className="text-lg font-bold text-amber-600 shrink-0">₪{entry.price}</span>}
                    </button>
                  ))}
                  </>
                )}
              </div>
            ) : expandedParent ? (() => {
              const cat = filteredCatalog.find((c) => c.parent === expandedParent);
              if (!cat) return null;
              const kapaSubs = cat.parent === "008" ? kapaPriceTiers : null;
              const rollupSubs = cat.parent === "009" ? rollupPriceTiers : null;
              const glassSubs = cat.parent === "010" ? glassPriceTiers : null;
              const numberSubs = cat.parent === "012" ? numberPriceTiers.filter((t) => Number(t.price_per_unit) > 0) : null;
              const graphicsSubs = cat.parent === "0000" ? graphicsPriceTiers : null;
              const [, accentBg] = (CATEGORY_ACCENT[cat.parent] || "border-slate-300 bg-black").split(" ");
              return (
                <div>
                  {/* חזור — סוגר את תת-הרשימה וחוזר לרשימת המקטים הראשית */}
                  <button
                    type="button"
                    onClick={() => setExpandedParent(null)}
                    className="sticky top-0 z-10 w-full flex items-center gap-2 px-4 py-2.5 text-right border-b-2 border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                    <span className="text-base font-semibold text-slate-600">חזור</span>
                    <span className={`mr-1 text-base font-mono font-semibold px-2 py-0.5 rounded text-white ${accentBg}`}>{cat.parent}</span>
                    <span className="text-xl font-bold text-slate-800 truncate">{cat.label}</span>
                  </button>
                  <div className="divide-y divide-slate-100">
                    {kapaSubs
                      ? kapaSubs.map((t) => (
                          <button
                            type="button"
                            key={t.id}
                            onClick={() => selectKapa(t)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-1.5 text-right hover:bg-amber-50 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {CATEGORY_IMAGES[cat.parent] && (
                                <img src={CATEGORY_IMAGES[cat.parent]} alt={t.description} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                              )}
                              <span className="text-base font-mono text-slate-400 w-14 shrink-0">{cat.parent}</span>
                              <span className="text-lg font-semibold text-slate-700">{t.description}</span>
                            </div>
                            <span className="text-lg font-bold text-amber-600 shrink-0">₪{paymentAdjustedPrice(t.price)}</span>
                          </button>
                        ))
                      : rollupSubs
                      ? rollupSubs.map((t) => (
                          <button
                            type="button"
                            key={t.id}
                            onClick={() => selectRollup(t)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-1.5 text-right hover:bg-amber-50 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {CATEGORY_IMAGES[cat.parent] && (
                                <img src={CATEGORY_IMAGES[cat.parent]} alt={t.description} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                              )}
                              <span className="text-base font-mono text-slate-400 w-14 shrink-0">{cat.parent}</span>
                              <span className="text-lg font-semibold text-slate-700">{t.description}</span>
                            </div>
                            <span className="text-lg font-bold text-amber-600 shrink-0">₪{paymentAdjustedPrice(t.price_unit_1)}</span>
                          </button>
                        ))
                      : glassSubs
                      ? glassSubs.map((t) => (
                          <button
                            type="button"
                            key={t.id}
                            onClick={() => selectGlass(t)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-1.5 text-right hover:bg-amber-50 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {CATEGORY_IMAGES[cat.parent] && (
                                <img src={CATEGORY_IMAGES[cat.parent]} alt={t.description} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                              )}
                              <span className="text-base font-mono text-slate-400 w-14 shrink-0">{cat.parent}</span>
                              <span className="text-lg font-semibold text-slate-700">{t.description}</span>
                            </div>
                            <span className="text-lg font-bold text-amber-600 shrink-0">₪{paymentAdjustedPrice(t.selling_price)}</span>
                          </button>
                        ))
                      : numberSubs
                      ? numberSubs.map((t) => (
                          <button
                            type="button"
                            key={t.id}
                            onClick={() => selectNumberTier(t)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-1.5 text-right hover:bg-amber-50 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-base font-mono text-slate-400 w-14 shrink-0">{PRODUCT_CODES[t.product_type] || cat.parent}</span>
                              <span className="text-lg font-semibold text-slate-700">{PRODUCT_NAMES[t.product_type]} — {t.height_cm} ס"מ / {t.thickness_mm} מ"מ</span>
                            </div>
                            <span className="text-lg font-bold text-amber-600 shrink-0">₪{paymentAdjustedPrice(t.price_per_unit)}</span>
                          </button>
                        ))
                      : graphicsSubs
                      ? graphicsSubs.map((t) => (
                          <button
                            type="button"
                            key={t.id}
                            onClick={() => selectGraphics(t)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-1.5 text-right hover:bg-amber-50 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-base font-mono text-slate-400 w-14 shrink-0">{cat.parent}</span>
                              <span className="text-lg font-semibold text-slate-700">{t.description}</span>
                            </div>
                            <span className="text-lg font-bold text-amber-600 shrink-0">₪{paymentAdjustedPrice(t.price)}</span>
                          </button>
                        ))
                      : cat.subs.map((pt) => (
                          <button
                            type="button"
                            key={pt}
                            onClick={() => selectSub(pt)}
                            className="w-full flex items-center gap-3 px-4 py-1.5 text-right hover:bg-amber-50 transition-colors"
                          >
                            <div className="w-10 h-10 shrink-0 flex items-center justify-center">
                              {CATEGORY_IMAGES[cat.parent] && (
                                <img src={CATEGORY_IMAGES[cat.parent]} alt={PRODUCT_NAMES[pt]} className="w-10 h-10 rounded-lg object-cover" />
                              )}
                            </div>
                            <span className="text-base font-mono text-slate-400 w-14 shrink-0">{PRODUCT_CODES[pt]}</span>
                            <span className="text-lg font-semibold text-slate-700">{PRODUCT_NAMES[pt]}</span>
                          </button>
                        ))}
                  </div>
                </div>
              );
            })() : (
              <>
            {showFreeProduct && (
              <button
                type="button"
                onClick={selectFree}
                className="w-full flex items-center gap-3 px-4 py-3 text-right border-b-2 border-slate-200 bg-amber-50/50 hover:bg-amber-100 transition-colors"
              >
                <span className="text-base font-semibold px-2.5 py-0.5 rounded bg-black text-white">✎</span>
                <span className="text-xl font-bold text-slate-800">מוצר חופשי</span>
                <span className="text-sm text-slate-400">ללא מק"ט — מלל חופשי ומחיר ידני</span>
              </button>
            )}
            {filteredCatalog.map((cat) => {
              const [accentBorder, accentBg] = (CATEGORY_ACCENT[cat.parent] || "border-slate-300 bg-black").split(" ");
              return (
                <button
                  type="button"
                  key={cat.parent}
                  onClick={() => (cat.parent === "004" ? setGlowPickerOpen(true) : cat.parent === "014" ? setVistaPickerOpen(true) : setExpandedParent(cat.parent))}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-right border-r-4 border-b border-slate-100 last:border-b-0 ${accentBorder} bg-white hover:bg-slate-50 transition-colors`}
                >
                  <div className="flex items-center gap-3">
                    {/* Fixed-size slot even when a category has no photo yet (e.g.
                        שילוט פרספקס) — keeps the code badge aligned with rows
                        that do have one, instead of shifting left. */}
                    <div className="w-10 h-10 shrink-0 flex items-center justify-center">
                      {CATEGORY_IMAGES[cat.parent] && (
                        <img src={CATEGORY_IMAGES[cat.parent]} alt={cat.label} className="w-10 h-10 rounded-lg object-cover" />
                      )}
                    </div>
                    <span className={`text-base font-mono font-semibold px-2 py-0.5 rounded text-white ${accentBg}`}>{cat.parent}</span>
                    <span className="text-xl font-bold text-slate-800">{cat.label}</span>
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-400 -rotate-90" />
                </button>
              );
            })}
            {/* בקרוב — מוצרים בלי מחיר/עלות מוגדרים עדיין */}
            <div className="border-t border-slate-100">
              {COMING_SOON_PRODUCTS.map((label) => (
                <div
                  key={label}
                  title="עדיין אין מחיר ועלות מוגדרים למוצר הזה"
                  className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-right opacity-60 cursor-not-allowed"
                >
                  <span className="text-lg font-semibold text-slate-500">{label}</span>
                  <span className="text-sm font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 shrink-0">בקרוב</span>
                </div>
              ))}
            </div>
              </>
            )}
                </div>
              )}
            </div>
          </Field>

          {/* Empty placeholder columns — filled once a מק"ט is chosen */}
          <Field label="אורך (מ')" width="w-24">
            <div className={`${READONLY} text-slate-500`}>—</div>
          </Field>
          <Field label="גובה (מ')" width="w-24">
            <div className={`${READONLY} text-slate-500`}>—</div>
          </Field>
          <Field label="כמות" width="w-16">
            <div className={`${READONLY} text-slate-500`}>1</div>
          </Field>
          <Field label="מחיר יח' (ללא מע״מ)" width="w-24">
            <div className={`${READONLY} text-slate-500`}>—</div>
          </Field>
          <Field label="סה״כ (ללא מע״מ)" width="w-28">
            <div className={`${READONLY} text-slate-500`}>—</div>
          </Field>
        </div>
        <GlowSignPicker open={glowPickerOpen} onClose={() => setGlowPickerOpen(false)} onSelect={selectGlowSign} />
        <VistaPicker open={vistaPickerOpen} onClose={() => setVistaPickerOpen(false)} onSelect={selectVistaItem} />
      </div>
    );
  }

  // ── מוצר חופשי: שם (מלל חופשי) + כמות + מחיר יחידה ידני, ללא מידות/עובי ──
  if (values.productType === "free_product") {
    const qFree = parseInt(values.quantity) || 1;
    const unitFree = parseFloat(values.freePrice) || 0;
    return (
      <div className="flex flex-col gap-3" ref={formRowsRef} onKeyDown={handleEnterAdvances}>
        <div className="flex flex-wrap items-start gap-3">
          <Field label='מק"ט' width="w-56">
            <button
              type="button"
              onClick={clearProduct}
              title='שנה מק"ט'
              className="h-10 w-full px-1 rounded-none border-0 border-b-2 border-slate-300 bg-transparent hover:border-amber-400 transition-colors flex items-center gap-2 text-right overflow-hidden"
            >
              <span className="text-base font-semibold px-2 py-0.5 rounded bg-black text-white shrink-0">✎</span>
              <div className="min-w-0">
                <div className="text-xs font-mono font-bold text-amber-700 truncate">מוצר חופשי</div>
                <div className="text-sm font-semibold text-slate-800 leading-tight truncate">ללא מק"ט</div>
              </div>
            </button>
          </Field>

          <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">שם המוצר</label>
            <Input
              type="text"
              value={values.lineLabel || ""}
              onChange={(e) => set("lineLabel", e.target.value)}
              className={UNDERLINE}
              placeholder="תיאור המוצר החופשי — יופיע בהצעה"
            />
          </div>

          <Field label="כמות" width="w-16">
            <Input
              type="number" min="1"
              value={values.quantity || "1"}
              onChange={(e) => set("quantity", e.target.value)}
              className={UNDERLINE_CENTER}
              dir="ltr" placeholder="1"
            />
          </Field>

          <Field label='מחיר יחידה (ללא מע״מ)' width="w-32">
            <Input
              type="number" min="0" step="0.01"
              value={values.freePrice ?? ""}
              onChange={(e) => set("freePrice", e.target.value.replace(/-/g, ""))}
              className={UNDERLINE_CENTER}
              dir="ltr" placeholder="0"
            />
          </Field>

          <Field label={`סה״כ${qFree > 1 ? ` (×${qFree})` : ""} (ללא מע״מ)`} width="w-32">
            <div className={`${READONLY} border-amber-400 font-bold text-amber-700`}>
              {fmt(unitFree * qFree)}
            </div>
          </Field>
        </div>
      </div>
    );
  }

  // Compact selected-מק"ט trigger — clicking it clears the product, which
  // re-renders the picker above in its place (same mechanism as "no product").
  const skuLabel = isKapa && kapaTier ? kapaTier.description
    : isRollup && rollupTier ? rollupTier.description
    : isGlass && glassTier ? glassTier.description
    : isNumbers && numberTier ? `${PRODUCT_NAMES[numberTier.product_type]} — ${numberTier.height_cm} ס"מ / ${numberTier.thickness_mm} מ"מ`
    : isGraphics && graphicsTier ? graphicsTier.description
    : isGlow && values.glowSignName ? values.glowSignName
    : isVista && values.vistaItemName ? values.vistaItemName
    : PRODUCT_NAMES[values.productType];
  const skuCode = isKapa ? "008"
    : isRollup ? PRODUCT_CODES[values.productType]
    : isGlass ? "010"
    : isGraphics ? "0000"
    : isGlow ? "004"
    : isVista ? "014"
    : PRODUCT_CODES[values.productType];
  const skuImg = isKapa ? CATEGORY_IMAGES["008"]
    : isRollup ? CATEGORY_IMAGES[PRODUCT_CODES[values.productType]]
    : isGlass ? CATEGORY_IMAGES["010"]
    : isGraphics ? CATEGORY_IMAGES["0000"]
    // The chosen artwork itself is the most useful thumbnail here — it is how
    // the agent recognises the line at a glance.
    : isGlow ? glowImageSrc({ image_file: values.glowSignImage })
    : isVista ? vistaImageSrc({ image_file: values.vistaItemImage })
    : CATEGORY_IMAGES[PRODUCT_CODES[values.productType]?.split("-")[0]];

  // Note: this component used to have its own "אישור פרטי מוצר" lock/confirm
  // step (a compact emerald read-only summary, separate from the order-level
  // and מידה-1 locks). It was removed — three independent, stacked "ערוך"
  // buttons for the same product line meant re-opening a confirmed row to
  // tweak its quantity took three separate clicks. The order-level lock
  // (MultiProductCalculator) is the only lock left for a product line.

  return (
    <div className="flex flex-col gap-3" ref={formRowsRef} onKeyDown={handleEnterAdvances}>
      {/* Main Morning-style row: מק"ט + מידות + עובי + כמות + מחיר יחידה + סה"כ, all in one row on wide screens; wraps instead of clipping on narrow ones (overflow-x-auto here would clip the מק"ט dropdown popover) */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-5">
        <Field label='מק"ט' width="w-64">
          <button
            type="button"
            onClick={clearProduct}
            title='שנה מק"ט'
            className="h-10 px-1 rounded-none border-0 border-b-2 border-slate-300 bg-transparent hover:border-amber-400 transition-colors flex items-center gap-2 text-right overflow-hidden"
          >
            {skuImg && <img src={skuImg} alt={skuLabel} className="w-8 h-8 rounded object-cover shrink-0" />}
            <div className="min-w-0">
              <div className="text-xs font-mono font-bold text-amber-700 truncate">מק"ט {skuCode}</div>
              <div className="text-sm font-semibold text-slate-800 leading-tight truncate">{skuLabel}</div>
            </div>
          </button>
        </Field>

        {!isFixedPrice && (
          <>
            <Field label="אורך (מ')" width="w-24" required>
              <Input
                type="number" step="0.01" min="0.01" required
                value={values.widthM}
                onChange={(e) => set("widthM", e.target.value.replace(/-/g, ""))}
                className={`${UNDERLINE_CENTER} ${values.widthM !== "" && !(parseFloat(values.widthM) > 0) ? "border-red-400" : ""}`}
                dir="ltr" placeholder="0.00"
              />
              {values.widthM !== "" && !(parseFloat(values.widthM) > 0) && (
                <p className="text-xs text-red-500 whitespace-nowrap">חובה &gt; 0</p>
              )}
            </Field>
            <Field label="גובה (מ')" width="w-24" required>
              <Input
                type="number" step="0.01" min="0.01" required
                value={values.heightM}
                onChange={(e) => set("heightM", e.target.value.replace(/-/g, ""))}
                className={`${UNDERLINE_CENTER} ${values.heightM !== "" && !(parseFloat(values.heightM) > 0) ? "border-red-400" : ""}`}
                dir="ltr" placeholder="0.00"
              />
              {values.heightM !== "" && !(parseFloat(values.heightM) > 0) && (
                <p className="text-xs text-red-500 whitespace-nowrap">חובה &gt; 0</p>
              )}
            </Field>
          </>
        )}

        {showThicknessField && (
          <Field label='עובי (מ"מ)' width="w-24">
            <Select value={values.thicknessMm} onValueChange={(v) => set("thicknessMm", v)}>
              <SelectTrigger className={UNDERLINE}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableThicknesses(category, values.productType, priceTiers).map((t) => (
                  <SelectItem key={t} value={t}>{t} מ"מ</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field label="כמות" width="w-16">
          <Input
            type="number" min="1"
            value={values.quantity || "1"}
            onChange={(e) => set("quantity", e.target.value)}
            className={UNDERLINE_CENTER}
            dir="ltr" placeholder="1"
          />
        </Field>

        <Field label="מחיר יח' (ללא מע״מ)" width="w-24">
          <div className={`${READONLY} font-semibold ${priceMissing ? "border-red-400 text-red-500" : "text-slate-800"}`}>
            {priceMissing ? "שגיאה" : fmt(displayUnitPriceExVat)}
          </div>
        </Field>

        <Field label={`סה״כ${q > 1 ? ` (×${q})` : ""} (ללא מע״מ)`} width="w-28">
          <div className={`${READONLY} font-bold ${priceMissing ? "border-red-400 text-red-500" : "border-amber-400 text-amber-700"}`}>
            {priceMissing ? "שגיאה" : fmt(totalExVat)}
          </div>
        </Field>
      </div>

      {/* Blocking pricing error — no admin-configured price/cost for this SKU +
          thickness combination. Never silently fall back to a raw-cost estimate. */}
      {priceMissing && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          <span className="font-bold">⚠ שגיאה:</span>
          <span>{priceErrorMessage || 'לא הוגדר מחיר מכירה למוצר/עובי זה. יש להגדיר מחיר באדמין לפני יצירת הצעת מחיר.'}</span>
        </div>
      )}

      {/* Calculated area — unit (אורך×גובה) and total (× כמות) */}
      {!isFixedPrice && parseFloat(values.widthM) > 0 && parseFloat(values.heightM) > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-sky-50 border border-sky-100 px-3 py-2 text-sm text-slate-600">
          <span>שטח יחידה מחושב: <b className="text-slate-800">{(parseFloat(values.widthM) * parseFloat(values.heightM)).toFixed(2)} מ״ר</b></span>
          <span className="text-slate-300">|</span>
          <span>שטח כולל{q > 1 ? ` (×${q})` : ""}: <b className="text-slate-800">{(parseFloat(values.widthM) * parseFloat(values.heightM) * q).toFixed(2)} מ״ר</b></span>
        </div>
      )}

      {/* Agent-adjustable price range (לוקובונד/פיויסי בלבד) — סליידר מחיר גלוי בין
          המחיר ההתחלתי (ברירת מחדל) למחיר המינימלי שהוגדר לסוכן בטבלת המחירים. */}
      {hasPriceRange && (() => {
        const rangeMin = Math.ceil(priceRangeMin);
        const rangeMax = Math.floor(priceRangeMax);
        const committed = values.customPricePerSqm != null && values.customPricePerSqm !== "" ? Math.round(parseFloat(values.customPricePerSqm)) : rangeMax;
        // While actively dragging, only update local state (cheap) instead of
        // calling set() on every pixel — set() bubbles up to the parent order
        // and re-triggers a full price recalculation across every line item,
        // which was causing visible stutter/"jumps" mid-drag. The value only
        // commits (and the order recalculates) once the drag ends.
        const current = sliderDragValue != null ? sliderDragValue : committed;
        const commit = (v) => { setSliderDragValue(null); set("customPricePerSqm", v); };
        return (
          <div className="flex items-center gap-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 select-none">
            <label className="text-xs font-semibold text-amber-800 uppercase tracking-wide whitespace-nowrap shrink-0">מחיר למ"ר (ניתן להנחה)</label>
            <input
              type="range"
              min={rangeMin}
              max={rangeMax}
              step="1"
              value={current}
              onChange={(e) => setSliderDragValue(parseInt(e.target.value))}
              onMouseUp={(e) => commit(e.target.value)}
              onTouchEnd={(e) => commit(e.target.value)}
              onKeyUp={(e) => commit(e.target.value)}
              className="price-range-slider flex-1"
              dir="ltr"
            />
            <span className="text-sm font-bold text-amber-700 shrink-0 w-24 text-left" dir="ltr">₪{Number(current).toLocaleString("he-IL")} / מ"ר</span>
            <span className="text-xs text-amber-500 shrink-0 whitespace-nowrap">(מינימום ₪{rangeMin})</span>
          </div>
        );
      })()}

      {/* Same-height placeholder for the slider above — keeps the row's slot
          reserved from the moment the SKU is picked, so the real slider
          doesn't suddenly pop in once dimensions are typed. */}
      {!hasPriceRange && isPriceRangeFamily && (
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap shrink-0">מחיר למ"ר (ניתן להנחה)</label>
          <div className="flex-1 h-1.5 rounded-full bg-slate-200" />
          <span className="text-xs text-slate-400 shrink-0 whitespace-nowrap">יופיע לאחר הזנת מידות</span>
        </div>
      )}

      {/* Extras row: התקנה/אזור (מדבקות), תוספות (לוגו + כל קטגוריה עם תוספות משלה), מדפים (קאפה), אלמנטים (לוגו/פיויסי) */}
      {(isSticker || isLogo || isKapa || showElementsField || categoryExtras.length > 0) && (
        <div className="flex flex-wrap items-start gap-3">
          {isSticker && (
            <>
              <Field label="התקנה" width="w-28">
                <Select value={values.includeInstallation || "yes"} onValueChange={(v) => set("includeInstallation", v)}>
                  <SelectTrigger className={UNDERLINE}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">עם התקנה</SelectItem>
                    <SelectItem value="no">ללא התקנה</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {values.includeInstallation !== "no" && (
                <Field label="אזור התקנה" width="w-24">
                  <Select value={values.region || "מרכז"} onValueChange={(v) => set("region", v)}>
                    <SelectTrigger className={UNDERLINE}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REGIONS.map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </>
          )}

          {isKapa && (
            <>
              <Field label="מדפים סטנדרטים" width="w-28">
                <Input
                  type="number" min="0"
                  value={values.standardShelves || ""}
                  onChange={(e) => set("standardShelves", e.target.value)}
                  className={UNDERLINE_CENTER}
                  dir="ltr" placeholder="0"
                />
                <KapaDealChips productKey="standardShelf" deals={kapaDeals} active={values.dealOverrides} onToggle={toggleKapaDeal} />
              </Field>
              <Field label="מדפים בעיצוב אישי" width="w-28">
                <Input
                  type="number" min="0"
                  value={values.customShelves || ""}
                  onChange={(e) => set("customShelves", e.target.value)}
                  className={UNDERLINE_CENTER}
                  dir="ltr" placeholder="0"
                />
                <KapaDealChips productKey="customShelf" deals={kapaDeals} active={values.dealOverrides} onToggle={toggleKapaDeal} />
              </Field>
              <Field label="רגליים עשויות קאפה" width="w-36">
                <Input
                  type="number" min="0"
                  value={values.legsQty || ""}
                  onChange={(e) => set("legsQty", e.target.value)}
                  className={UNDERLINE_CENTER}
                  dir="ltr" placeholder="0"
                />
                <KapaDealChips productKey="legs" deals={kapaDeals} active={values.dealOverrides} onToggle={toggleKapaDeal} />
              </Field>
              <Field label="מדף צבעוני ללא חיתוך צורני" width="w-44">
                <Input
                  type="number" min="0"
                  value={values.coloredShelfQty || ""}
                  onChange={(e) => set("coloredShelfQty", e.target.value)}
                  className={UNDERLINE_CENTER}
                  dir="ltr" placeholder="0"
                />
                <KapaDealChips productKey="coloredShelf" deals={kapaDeals} active={values.dealOverrides} onToggle={toggleKapaDeal} />
              </Field>
              {(() => {
                // Same formula as useCalculator.jsx's shelvesSellingPrice/legsSellingPrice/
                // coloredShelfSellingPrice — shown inline here too so the agent sees the
                // price impact right where they set quantities, not only in the final breakdown.
                const itemPrice = (qty, priceKey, productKey) => {
                  const q = parseInt(qty) || 0;
                  const unitPrice = parseFloat(config?.[priceKey]) || 0;
                  const override = values.dealOverrides?.[productKey];
                  if (!override) return q * unitPrice;
                  const dealPrice = parseFloat(override.price) || 0;
                  return override.mode === "override" ? dealPrice : q * unitPrice + dealPrice;
                };
                const shelvesPrice =
                  itemPrice(values.standardShelves, "kapa_shelf_standard_price", "standardShelf") +
                  itemPrice(values.customShelves, "kapa_shelf_custom_price", "customShelf") +
                  itemPrice(values.legsQty, "kapa_legs_price", "legs") +
                  itemPrice(values.coloredShelfQty, "kapa_colored_shelf_price", "coloredShelf");
                if (shelvesPrice <= 0) return null;
                return (
                  <Field label="עלות מדפים ותוספות" width="w-36">
                    <div className="h-9 flex items-center text-base font-semibold text-amber-600">
                      ₪ {shelvesPrice.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </Field>
                );
              })()}
            </>
          )}

          {showElementsField && (
            <Field label="אלמנטים" width="w-20">
              <Input
                type="number" min="1"
                value={values.elements || ""}
                onChange={(e) => set("elements", e.target.value)}
                className={UNDERLINE_CENTER}
                dir="ltr" placeholder="1"
              />
            </Field>
          )}

          {categoryExtras.length > 0 && (
            <div className="flex flex-col gap-1 min-w-[220px] flex-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">תוספות</label>
              <div className="relative" ref={extrasRef}>
                <button
                  type="button"
                  onClick={() => setExtrasOpen(o => !o)}
                  className="flex h-10 w-full items-center justify-between rounded-none border-0 border-b-2 border-slate-300 bg-transparent px-1 py-2 text-base text-slate-700 hover:border-amber-400 transition-colors focus:outline-none"
                >
                  <span className={(values.extras || []).length === 0 ? "text-slate-400" : "text-slate-700"}>
                    {(values.extras || []).length === 0 ? 'בחר תוספות' : `${(values.extras || []).length} נבחרו`}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${extrasOpen ? 'rotate-180' : ''}`} />
                </button>
                {extrasOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-xl border-2 border-black bg-white shadow-lg overflow-hidden">
                    {categoryExtras.map(opt => {
                      const selected = (values.extras || []).includes(opt.key);
                      return (
                        <div
                          key={opt.key}
                          onClick={() => toggleExtra(opt.key)}
                          className={`flex items-center justify-between px-4 py-2.5 text-base cursor-pointer transition-colors ${
                            selected ? "bg-amber-50 text-amber-700" : "text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <span>{opt.label}</span>
                          {selected && <Check className="w-4 h-4 text-amber-500" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* Price breakdown for selected extras */}
              {(values.extras || []).length > 0 && (
                <div className="mt-1 flex flex-col gap-1.5">
                  {(values.extras || []).map(key => {
                    const opt = EXTRAS_OPTIONS.find(o => o.key === key);
                    if (!opt) return null;
                    const price = extrasInfo?.[key];
                    return (
                      <div key={key} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleExtra(key)}
                            className="w-4 h-4 rounded-full bg-amber-100 hover:bg-red-100 flex items-center justify-center transition-colors flex-shrink-0"
                          >
                            <X className="w-2.5 h-2.5 text-amber-600 hover:text-red-500" />
                          </button>
                           <span className="text-sm text-slate-700">{opt.label}</span>
                        </div>
                        {price != null && price > 0 && (
                          <span className="text-sm font-semibold text-amber-600">+{fmt(price * priceMultiplier)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Free-text description — its own row, below the main row(s). Enter here
          just adds a new line (not intercepted by handleEnterAdvances). */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">תיאור (מלל חופשי)</label>
        <Textarea
          rows={2}
          value={values.lineLabel || ""}
          onChange={(e) => set("lineLabel", e.target.value)}
          className="bg-transparent border-0 border-b-2 border-slate-300 rounded-none px-1 text-base font-semibold text-slate-800 resize-y focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-amber-400"
          placeholder="תיאור המוצר..."
        />
      </div>

      {/* Graphics notes — collapsed by default, kept separate from the
          general free-text description above so it prints as its own
          clearly-labeled "גרפיקה:" line in the Morning document instead of
          being buried in the general note (see buildSpecLines). */}
      <div className="space-y-1.5">
        {graphicsNoteOpen ? (
          <>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">הערות גרפיקה</label>
              <button
                type="button"
                onClick={() => setGraphicsNoteOpen(false)}
                className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors"
              >
                אישור
              </button>
            </div>
            <Textarea
              rows={2}
              autoFocus
              value={values.graphicsNote || ""}
              onChange={(e) => set("graphicsNote", e.target.value)}
              className="bg-transparent border-0 border-b-2 border-slate-300 rounded-none px-1 text-base font-semibold text-slate-800 resize-y focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-amber-400"
              placeholder="הערות לגרפיקה..."
            />
          </>
        ) : values.graphicsNote?.trim() ? (
          <button
            type="button"
            onClick={() => setGraphicsNoteOpen(true)}
            className="flex items-start gap-1.5 text-xs text-slate-600 hover:text-amber-700 transition-colors text-right"
          >
            <span className="font-semibold text-amber-600 shrink-0">גרפיקה:</span>
            <span className="truncate">{values.graphicsNote.trim()}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setGraphicsNoteOpen(true)}
            className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors"
          >
            + הערות גרפיקה
          </button>
        )}
      </div>

    </div>
  );
}
