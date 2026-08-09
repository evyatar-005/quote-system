// Shared display vocabulary for the quote list screens (QuotesHistory — the
// manager review queue — and QuotesArchive — the read-only general history).
// Extracted so the two screens can never drift into showing the same status or
// category under different names/colours.

export const fmt = (val) =>
  val != null ? `₪ ${Number(val).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—";

export const STATUS_LABELS = { draft: "טיוטה", sent: "נשלחה", approved: "אושרה", rejected: "נדחתה" };

export const STATUS_COLORS = {
  draft: "bg-slate-100 text-slate-500",
  sent: "bg-blue-50 text-blue-600",
  approved: "bg-emerald-50 text-emerald-600",
  rejected: "bg-red-50 text-red-500",
};

export const CATEGORY_LABELS = { logo: "לוגו", sticker: "מדבקות", kapa: "קאפה", lokobond: "לוקובונד", foamex: "פיוויסי", rollup: "רול אפ", glass: "זכוכית", lightbox: "ארגז מואר" };

// Same muted Printela-brand hues used in the product picker (CalculatorForm),
// so a category reads the same color everywhere in the app.
export const CATEGORY_COLORS = {
  logo: "bg-brand-gold/15 text-brand-gold",
  sticker: "bg-brand-pink/15 text-brand-pink",
  kapa: "bg-brand-teal/15 text-brand-teal",
  lokobond: "bg-brand-green/15 text-brand-green",
  foamex: "bg-brand-purple/15 text-brand-purple",
  rollup: "bg-brand-green/15 text-brand-green",
  glass: "bg-brand-purple/15 text-brand-purple",
  lightbox: "bg-brand-teal/15 text-brand-teal",
};

// Morning document type codes — see docs/morning-api-reference.md / src/services/morning/mappings.js
export const MORNING_TYPE_LABELS = { 10: "הצעת מחיר", 100: "הזמנה", 300: "חשבון עסקה", 305: "חשבונית מס" };

// A quote counts as "became an order" iff Morning issued a type-100 document for
// it. `status` can NOT answer this: an agent using "הנפק הצעת מחיר ללקוח" gets
// status='approved' with no manager involved, and a status='draft' quote can
// still be converted to an order from /my-quotes.
export const MORNING_ORDER_TYPE = 100;

// Local YYYY-MM-DD (not toISOString, which shifts to UTC and can land on the
// wrong calendar day) — used both for <input type="date"> and for comparing
// against created_date.
export function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
