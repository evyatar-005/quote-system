import { useEffect, useMemo, useState } from "react";
import { X, Loader2, CheckCircle2, Save, FileText, Receipt } from "lucide-react";
import { PRODUCT_NAMES } from "@/components/calculator/CalculatorForm";
import { base44 } from "@/api/base44Client";
import { convertMorningDocument, getMorningHistory } from "@/api/morningClient";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const fmt = (val) =>
  val != null
    ? `₪ ${Number(val).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";

// "200×100 מ׳" (or null for fixed-price catalog rows — kapa/rollup/glass never
// have widthM/heightM, only a chosen tier) — saved on the item at quote time.
function dimsLabel(it) {
  return it?.widthM && it?.heightM ? `${it.widthM}×${it.heightM} מ׳` : null;
}

const PAYMENT_LABELS = {
  cash: "מזומן",
  full: "מזומן",
};

function paymentTypeLabel(paymentType) {
  if (!paymentType) return null;
  if (paymentType.startsWith("installments")) {
    const count = paymentType.split(":")[1];
    return count ? `${count} תשלומים` : "תשלומים";
  }
  return PAYMENT_LABELS[paymentType] || paymentType;
}

// Parses a JSON column safely — a malformed/legacy value must never crash the modal.
function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

const Row = ({ label, value, className = "" }) => (
  <div className={`flex justify-between items-center py-2 text-sm border-b border-white/20 last:border-b-0 ${className}`}>
    <span className="text-zinc-400">{label}</span>
    <span className="font-semibold text-white">{value}</span>
  </div>
);

// A few product families (kapa/rollup/glass) already return rawMaterialCost as
// a whole-line total; the rest (logo/sticker/lokobond/foamex/lightbox) return
// it per-unit while totalCostAll is whole-line. To split "עלות גולמי" vs "עלות
// תפעולית" on one consistent (whole-line) scale without needing the original
// quantity, we back out the per-unit→whole-line multiplier from the ratio of
// totalCostAll to totalCostPerUnit (both saved on every result already).
const WHOLE_LINE_MATERIAL_FAMILIES = new Set(["kapa", "rollup", "glass"]);
function materialTotalOf(r) {
  if (!r) return 0;
  if (WHOLE_LINE_MATERIAL_FAMILIES.has(r.productFamily)) return r.rawMaterialCost || 0;
  const scale = r.totalCostPerUnit > 0 ? (r.totalCostAll ?? 0) / r.totalCostPerUnit : 1;
  return (r.rawMaterialCost || 0) * scale;
}

// Aggregates an item's main result + any extra rows onto one whole-line basis —
// sellingPriceAll/totalCostAll are always whole-line regardless of family, so
// summing them directly is safe; only the material/operational split needs the
// per-family adjustment above.
function aggregateItem(it) {
  const results = [it.result, ...((it.extraRows || []).map((r) => r.result))].filter(Boolean);
  const sellingTotal = results.reduce((s, r) => s + (r.sellingPriceAll || 0), 0);
  const costTotal = results.reduce((s, r) => s + (r.totalCostAll ?? r.totalCostPerUnit ?? 0), 0);
  const materialTotal = results.reduce((s, r) => s + materialTotalOf(r), 0);
  const operationalTotal = costTotal - materialTotal;
  const profitTotal = sellingTotal - costTotal;
  const marginPct = sellingTotal > 0 ? (profitTotal / sellingTotal) * 100 : 0;
  return { sellingTotal, costTotal, materialTotal, operationalTotal, profitTotal, marginPct };
}

function applyDiscount(amount, discount) {
  if (!discount || !discount.value) return amount;
  const value = parseFloat(discount.value) || 0;
  if (!value) return amount;
  // A percent discount above 100% is meaningless (negative price) and an
  // amount discount can't take the price below 0 either — both branches are
  // clamped the same way now.
  if (discount.type === "percent") {
    const clamped = Math.min(100, Math.max(0, value));
    return amount * (1 - clamped / 100);
  }
  return Math.max(0, amount - value);
}

// Every product family's saved cost total already has the shape:
//   totalCostAll = fixedCost (material + labor + overhead + shipping, all
//   PRICE-INDEPENDENT) + commissionPct × sellingPriceAll (agent + marketing,
//   the only price-DEPENDENT slice). That holds regardless of family-specific
// formula shape, so fixedCost can always be recovered from two saved wholeline
// numbers plus the commission % saved on the quote — no live admin config needed.
function itemFixedCost(agg, commissionPct) {
  return agg.costTotal - commissionPct * agg.sellingTotal;
}

// One result's "price/m² ceiling or floor" override, ignoring its own minimum-
// price floor entirely (per product: מחיר = מחיר/מ"ר הנבחר × השטח הכולל, ללא
// רצפת מינימום) — only meaningful for results that actually carry a saved agent
// price range (lokobond/foamex/perspexBoard families with a PriceTier row).
// Anything else (kapa/rollup/glass/sticker/logo/lightbox) has no such range and
// keeps its originally saved price untouched.
function sqmOverridePriceOf(r, mode) {
  if (r.priceRangeMax == null || !(r.area > 0)) return r.sellingPriceAll || 0;
  const chosenPricePerSqm = mode === "max_sqm" ? r.priceRangeMax : (r.priceRangeMin ?? r.priceRangeMax);
  const shippingAddOn = (r.extrasBreakdown || []).find((e) => e.key === "shipping")?.sellingCost || 0;
  return chosenPricePerSqm * (r.totalArea || 0) + shippingAddOn;
}

// Single source of truth for "what does this item cost/sell for" under whichever
// pricing mode is active. In 'discount' mode this is exactly the old behavior
// (manual per-item discount). In every override mode, cost is RE-derived from
// the new price (fixedCost + commissionPct × newPrice) — commission is a real
// % of the actual selling price, so it must track the overridden price too, not
// stay frozen at the originally saved commission amount.
function pricingForItem(item, mode, targetMarginFrac, commissionPct, itemDiscounts) {
  const agg = aggregateItem(item);
  if (mode === "discount" || commissionPct == null) {
    const price = applyDiscount(agg.sellingTotal, itemDiscounts[item.index ?? 0]);
    return { price, cost: agg.costTotal, profit: price - agg.costTotal, marginPct: price > 0 ? ((price - agg.costTotal) / price) * 100 : 0, original: agg.sellingTotal };
  }
  const fixedCost = itemFixedCost(agg, commissionPct);
  let price;
  if (mode === "target_margin") {
    const denom = 1 - commissionPct - targetMarginFrac;
    price = denom > 0.001 ? fixedCost / denom : agg.sellingTotal;
  } else if (mode === "max_sqm" || mode === "min_sqm") {
    const results = [item.result, ...((item.extraRows || []).map((r) => r.result))].filter(Boolean);
    price = results.reduce((sum, r) => sum + sqmOverridePriceOf(r, mode), 0);
  } else {
    price = agg.sellingTotal;
  }
  const cost = fixedCost + commissionPct * price;
  const profit = price - cost;
  return { price, cost, profit, marginPct: price > 0 ? (profit / price) * 100 : 0, original: agg.sellingTotal, fixedCost };
}

const PRICING_MODE_LABELS = {
  discount: "רגיל (הנחות)",
  max_sqm: "מקסימום מ״ר",
  min_sqm: "מינימום מ״ר",
  target_margin: "אחוז רווח יעד",
};

// Compact label/value pair — a fraction of <Row>'s footprint, so a whole
// section's numbers fit in one narrow grid column instead of spanning the
// full width of the (now much wider) detail panel for a single line.
const MiniRow = ({ label, value }) => (
  <div className="flex justify-between items-baseline gap-2 py-0.5 text-xs">
    <span className="text-zinc-400 truncate">{label}</span>
    <span className="font-semibold text-zinc-100 shrink-0">{value}</span>
  </div>
);

// One boxed column inside the cost-breakdown grid — renders nothing if every
// child row resolved to null (the family didn't populate that field), so an
// empty section never leaves a hollow card in the grid.
function CostCard({ title, children, highlight = false }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <div className={highlight ? "bg-gradient-to-br from-[#C9A84C]/15 to-transparent border border-[#C9A84C]/30 rounded-lg p-3" : "bg-[#0C0C12] border border-white/10 rounded-lg p-3"}>
      <h5 className={`text-[11px] font-semibold mb-1.5 uppercase tracking-wider ${highlight ? "text-[#C9A84C]" : "text-zinc-400"}`}>{title}</h5>
      <div className="divide-y divide-white/5">{rows}</div>
    </div>
  );
}

// Cost breakdown for one product line — the raw fields a given family actually
// populates, laid out as compact side-by-side cards (חומרי גלם / עלויות עבודה
// ותקורה / עמלות) instead of one long single-column list, so the much wider
// detail panel is actually used instead of leaving most of it empty.
// Purely presentational; the money math above never reads from here.
function CostBreakdown({ result }) {
  if (!result) return null;
  return (
    <>
      <CostCard title="חומרי גלם">
        {result.isSticker && result.breakdown?.stickerMaterialCost != null && <MiniRow label="חומר מדבקה" value={fmt(result.breakdown.stickerMaterialCost)} />}
        {result.isSticker && result.breakdown?.stickerInkCost != null && <MiniRow label="דיו מדבקה" value={fmt(result.breakdown.stickerInkCost)} />}
        {result.isSticker && result.breakdown?.stickerWasteAmount != null && <MiniRow label="פחת מדבקה" value={fmt(result.breakdown.stickerWasteAmount)} />}
        {!result.isSticker && result.breakdown?.boardCost != null && <MiniRow label="עלות לוח" value={fmt(result.breakdown.boardCost)} />}
        {!result.isSticker && result.breakdown?.inkCost != null && <MiniRow label="דיו" value={fmt(result.breakdown.inkCost)} />}
        {!result.isSticker && result.breakdown?.dowelCost != null && <MiniRow label="דוץ" value={fmt(result.breakdown.dowelCost)} />}
        {!result.isSticker && result.breakdown?.packagingCost != null && <MiniRow label="אריזה" value={fmt(result.breakdown.packagingCost)} />}
        {!result.isSticker && result.breakdown?.instructionCost != null && <MiniRow label="דף הסבר" value={fmt(result.breakdown.instructionCost)} />}
        {!result.isSticker && result.breakdown?.mountingCost != null && <MiniRow label="לוח התקנה" value={fmt(result.breakdown.mountingCost)} />}
        {result.breakdown?.paperCost != null && <MiniRow label="נייר" value={fmt(result.breakdown.paperCost)} />}
        {result.breakdown?.standCost != null && <MiniRow label="מתקן" value={fmt(result.breakdown.standCost)} />}
        {result.breakdown?.sheetCost != null && <MiniRow label="גיליון זכוכית" value={fmt(result.breakdown.sheetCost)} />}
        {result.breakdown?.spacersCost != null && <MiniRow label="ספייסרים" value={fmt(result.breakdown.spacersCost)} />}
        {result.frameCost != null && <MiniRow label="מסגרת" value={fmt(result.frameCost)} />}
        {result.ledCost != null && <MiniRow label="לדים" value={fmt(result.ledCost)} />}
        {result.transformerCost != null && <MiniRow label="שנאי" value={fmt(result.transformerCost)} />}
        {result.perspexFrontCost != null && <MiniRow label="פרספקס חזית" value={fmt(result.perspexFrontCost)} />}
        {result.rawMaterialBeforeWaste != null && <MiniRow label="לפני פחת" value={fmt(result.rawMaterialBeforeWaste)} />}
        {result.wasteAmount != null && <MiniRow label="פחת (חומר)" value={fmt(result.wasteAmount)} />}
        {result.rawMaterialCost != null && <MiniRow label="סה״כ חומרים" value={fmt(result.rawMaterialCost)} />}
      </CostCard>

      <CostCard title="עלויות עבודה ותקורה">
        {result.breakdown?.printLaborCost != null && <MiniRow label="הדפסה" value={fmt(result.breakdown.printLaborCost)} />}
        {result.breakdown?.preCutLaborCost != null && <MiniRow label="קדם חיתוך" value={fmt(result.breakdown.preCutLaborCost)} />}
        {result.breakdown?.laserLaborCost != null && <MiniRow label="חיתוך לייזר" value={fmt(result.breakdown.laserLaborCost)} />}
        {result.breakdown?.somaLaborCost != null && <MiniRow label="חיתוך סומא" value={fmt(result.breakdown.somaLaborCost)} />}
        {result.breakdown?.cutLaborCost != null && <MiniRow label="חיתוך" value={fmt(result.breakdown.cutLaborCost)} />}
        {result.breakdown?.cleanLaborCost != null && <MiniRow label="ניקוי" value={fmt(result.breakdown.cleanLaborCost)} />}
        {result.breakdown?.packagingLaborCost != null && <MiniRow label="אריזה" value={fmt(result.breakdown.packagingLaborCost)} />}
        {result.breakdown?.paintRoomCost != null && <MiniRow label="חדר צביעה" value={fmt(result.breakdown.paintRoomCost)} />}
        {result.laborCost != null && <MiniRow label="סה״כ עבודה" value={fmt(result.laborCost)} />}
        {result.overheadCost != null && <MiniRow label="תקורה תפעולית" value={fmt(result.overheadCost)} />}
      </CostCard>

      <CostCard title="עמלות">
        {result.breakdown?.salesAgentCommissionCost != null && <MiniRow label="עמלת סוכן מכירות" value={fmt(result.breakdown.salesAgentCommissionCost)} />}
        {result.breakdown?.marketingCommissionCost != null && <MiniRow label="עמלת שיווק" value={fmt(result.breakdown.marketingCommissionCost)} />}
      </CostCard>

      {result.isSticker && (
        <CostCard title="פירוט מדבקה">
          {result.breakdown?.stickerPrintLaborCost != null && <MiniRow label="הדפסה מדבקה" value={fmt(result.breakdown.stickerPrintLaborCost)} />}
          {result.breakdown?.stickerCutLaborCost != null && <MiniRow label="חיתוך מדבקה" value={fmt(result.breakdown.stickerCutLaborCost)} />}
          {result.breakdown?.stickerInstallCost != null && <MiniRow label="עלות התקנה (בפועל)" value={fmt(result.breakdown.stickerInstallCost)} />}
          {result.breakdown?.installationCost != null && <MiniRow label="מחיר התקנה (ללקוח)" value={fmt(result.breakdown.installationCost)} />}
        </CostCard>
      )}

      {result.isKapa && (
        <CostCard title="פירוט קאפה">
          {result.breakdown?.kapaSheetCost != null && <MiniRow label="לוח קאפה" value={fmt(result.breakdown.kapaSheetCost)} />}
          {result.breakdown?.kapaPrePrintLaborCost != null && <MiniRow label="קדם דפוס" value={fmt(result.breakdown.kapaPrePrintLaborCost)} />}
          {result.breakdown?.kapaPrintLaborCost != null && <MiniRow label="הדפסה" value={fmt(result.breakdown.kapaPrintLaborCost)} />}
          {result.breakdown?.kapaPreCutLaborCost != null && <MiniRow label="קדם חיתוך" value={fmt(result.breakdown.kapaPreCutLaborCost)} />}
          {result.breakdown?.kapaCncCutLaborCost != null && <MiniRow label="חיתוך CNC (סומא)" value={fmt(result.breakdown.kapaCncCutLaborCost)} />}
          {result.breakdown?.kapaPackagingLaborCost != null && <MiniRow label="אריזה" value={fmt(result.breakdown.kapaPackagingLaborCost)} />}
        </CostCard>
      )}

      {result.extrasBreakdown?.length > 0 && (
        <CostCard title="תוספות">
          {result.extrasBreakdown.map((extra, idx) => (
            <MiniRow key={idx} label={extra.label} value={fmt(extra.cost)} />
          ))}
        </CostCard>
      )}
    </>
  );
}

const MORNING_ACTIONS = [
  { toType: "dealInvoice", label: "הפוך לחשבון עסקה" },
  { toType: "order", label: "הפוך להזמנה" },
  { toType: "taxInvoice", label: "הפוך לחשבונית מס" },
];

// Manager-only Morning ("חשבונית ירוקה") document actions + audit trail for
// this quote. Kept as its own component so a Morning API hiccup (history
// fetch failing) can only ever blank out this one card, never the rest of
// the modal's pricing UI.
function MorningSection({ quoteId }) {
  const [busyType, setBusyType] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(false);

  const loadHistory = async () => {
    try {
      const data = await getMorningHistory(quoteId);
      setHistory(data);
      setHistoryError(false);
    } catch {
      setHistory(null);
      setHistoryError(true);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [quoteId]);

  const handleConvert = async (toType, label) => {
    setBusyType(toType);
    try {
      await convertMorningDocument(quoteId, toType);
      toast.success(`${label} — בוצע בהצלחה`);
      await loadHistory();
    } catch (err) {
      toast.error(err?.message || "שגיאה בפעולת מורנינג");
    }
    setBusyType(null);
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2 uppercase tracking-wider">מורנינג</h3>
      <div className="bg-[#16161F] rounded-xl p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {MORNING_ACTIONS.map(({ toType, label }) => (
            <button
              key={toType}
              onClick={() => handleConvert(toType, label)}
              disabled={busyType !== null}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-white/15 text-zinc-200 hover:border-[#C9A84C]/50 hover:text-[#C9A84C] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busyType === toType ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              {label}
            </button>
          ))}
        </div>

        <div className="border-t border-white/10 pt-2 space-y-1.5 max-h-40 overflow-y-auto">
          {historyError ? (
            <p className="text-xs text-zinc-500">אין היסטוריית מורנינג להצעה זו.</p>
          ) : !history ? (
            <p className="text-xs text-zinc-500">טוען היסטוריה...</p>
          ) : history.log?.length === 0 ? (
            <p className="text-xs text-zinc-500">אין פעולות מורנינג שבוצעו עדיין.</p>
          ) : (
            history.log.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-white/5 last:border-b-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Receipt className="w-3 h-3 text-zinc-500 shrink-0" />
                  <span className="text-zinc-300 truncate">{entry.action}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-zinc-500">{new Date(entry.created_at).toLocaleString("he-IL")}</span>
                  <Badge variant={entry.success ? "default" : "destructive"} className="text-[10px] px-1.5 py-0">
                    {entry.success ? "הצלחה" : "נכשל"}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const DiscountInput = ({ discount, onChange }) => (
  <div className="flex items-center gap-2">
    <select
      value={discount.type}
      onChange={(e) => onChange({ ...discount, type: e.target.value })}
      className="h-9 rounded-md border border-white/25 bg-[#16161F] px-2 text-sm text-zinc-100 focus:outline-none"
    >
      <option value="amount">סכום (₪)</option>
      <option value="percent">אחוז (%)</option>
    </select>
    <input
      type="number"
      min="0"
      max={discount.type === "percent" ? 100 : undefined}
      step="0.01"
      dir="ltr"
      value={discount.value}
      onChange={(e) => onChange({ ...discount, value: e.target.value })}
      placeholder="0"
      className="h-9 flex-1 rounded-md border border-white/25 bg-[#16161F] px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
    />
  </div>
);

export default function QuoteDetailsModal({ quote, onClose, onSaved }) {
  // Everything needed to render this quote is already in the saved row — no
  // network round-trip, and nothing here can drift from admin price edits made
  // after the quote was issued, because we render the breakdown as computed
  // and saved at quote time, not a live recalculation.
  const lineItems = useMemo(() => safeParse(quote.line_items, []), [quote.line_items]);
  const calcData = useMemo(() => safeParse(quote.calculation_data, null), [quote.calculation_data]);

  // Normalize both saving shapes into one item list: MultiProductCalculator
  // saves { items: [...] }, LightboxCalculator (single product) saves a plain
  // { result, ... } object directly.
  const items = useMemo(
    () => (calcData?.items || (calcData?.result ? [{ index: 0, result: calcData.result, productType: calcData.productType }] : [])).filter((it) => it.result),
    [calcData]
  );

  const [selectedIndex, setSelectedIndex] = useState(items[0]?.index ?? 0);
  const [itemDiscounts, setItemDiscounts] = useState(() => calcData?.itemDiscounts || {});
  const [overallDiscount, setOverallDiscount] = useState(() => calcData?.overallDiscount || { type: "amount", value: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Order-wide pricing mode — a manager-only override that replaces the manual
  // discount flow entirely while active. Only usable on quotes saved after this
  // feature shipped (commissionPct saved on calculation_data); older quotes fall
  // back to 'discount' silently, since the override math needs that % to work.
  const commissionPct = calcData?.commissionPct ?? null;
  const [pricingMode, setPricingMode] = useState(() => calcData?.pricingMode || "discount");
  const [targetMarginPct, setTargetMarginPct] = useState(() => calcData?.targetMarginPct ?? null);
  // Highest margin % that doesn't blow up the target-margin formula's denominator
  // (1 − commissionPct − M) — capped a couple points below the true asymptote so
  // the slider never lands on a division that explodes the price.
  const maxTargetMarginPct = commissionPct != null ? Math.max(1, Math.floor((1 - commissionPct) * 100) - 2) : 90;

  const selectedItem = items.find((it) => (it.index ?? 0) === selectedIndex) || items[0];
  const selectedAgg = selectedItem ? aggregateItem(selectedItem) : null;

  // Live discount for the item currently open in column 3 — only meaningful in
  // 'discount' mode; every keystroke writes straight into itemDiscounts (keyed
  // by item index), and every total downstream recomputes immediately.
  const selectedDiscount = itemDiscounts[selectedIndex] || { type: "amount", value: "" };
  const setSelectedDiscount = (discount) => setItemDiscounts((prev) => ({ ...prev, [selectedIndex]: discount }));

  const targetMarginFrac = (targetMarginPct ?? 0) / 100;
  const selectedPricing = selectedItem ? pricingForItem(selectedItem, pricingMode, targetMarginFrac, commissionPct, itemDiscounts) : null;
  // Kept for the legacy 'discount'-mode display (before/after this item's own discount).
  const selectedPriceAfterDiscount = selectedAgg ? applyDiscount(selectedAgg.sellingTotal, selectedDiscount) : 0;
  const selectedProfitAfterDiscount = selectedAgg ? selectedPriceAfterDiscount - selectedAgg.costTotal : 0;

  // Whole-quote live totals — every item's price/cost under the ACTIVE pricing
  // mode, summed. In override modes this replaces the old discount-based sum
  // entirely (commission tracks the new price, not the originally saved one).
  const itemsBaseTotal = useMemo(() => items.reduce((s, it) => s + aggregateItem(it).sellingTotal, 0), [items]);
  const itemPricings = useMemo(
    () => items.map((it) => pricingForItem(it, pricingMode, targetMarginFrac, commissionPct, itemDiscounts)),
    [items, pricingMode, targetMarginFrac, commissionPct, itemDiscounts]
  );
  const itemsPricedTotal = itemPricings.reduce((s, p) => s + p.price, 0);
  const itemsCostTotal = itemPricings.reduce((s, p) => s + p.cost, 0);
  // Whole-quote raw material total never moves with price (it's the one truly
  // fixed slice) — everything else (labor+overhead+commission) is "operational".
  // profitTotal/marginPct here are the ORIGINAL, as-saved numbers (no pricing
  // mode applied) — kept only as the "before" baseline shown next to the live,
  // mode-adjusted figures below.
  const quoteAgg = useMemo(() => {
    const aggs = items.map(aggregateItem);
    const materialTotal = aggs.reduce((s, a) => s + a.materialTotal, 0);
    const sellingTotal = aggs.reduce((s, a) => s + a.sellingTotal, 0);
    const costTotal = aggs.reduce((s, a) => s + a.costTotal, 0);
    const profitTotal = sellingTotal - costTotal;
    const marginPct = sellingTotal > 0 ? (profitTotal / sellingTotal) * 100 : 0;
    return { materialTotal, profitTotal, marginPct };
  }, [items]);
  const quoteOperationalTotal = itemsCostTotal - quoteAgg.materialTotal;

  const nonItemPortion = (quote.price_before_vat || 0) - itemsBaseTotal; // shipping / surcharge / rounding
  // Manual overall discount only stacks on top in 'discount' mode — override
  // modes are a single, self-contained pricing decision with nothing layered on.
  const subtotalBeforeOverall = nonItemPortion + itemsPricedTotal;
  const finalSubtotal = pricingMode === "discount" ? applyDiscount(subtotalBeforeOverall, overallDiscount) : subtotalBeforeOverall;

  const quoteProfitLive = finalSubtotal - itemsCostTotal;
  const quoteMarginLive = finalSubtotal > 0 ? (quoteProfitLive / finalSubtotal) * 100 : 0;
  const vatMultiplier = quote.price_before_vat > 0 ? (quote.price_with_vat / quote.price_before_vat) : 1.18;
  const finalTotalWithVat = finalSubtotal * vatMultiplier;
  const hasAnyDiscount = pricingMode !== "discount" || overallDiscount.value || Object.values(itemDiscounts).some((d) => d?.value);

  const vatAmount = quote.price_before_vat != null && quote.price_with_vat != null
    ? quote.price_with_vat - quote.price_before_vat
    : null;
  const vatPercent = quote.price_before_vat > 0 && vatAmount != null
    ? Math.round((vatAmount / quote.price_before_vat) * 100)
    : null;

  const handleSave = async () => {
    if (finalSubtotal < 0) {
      toast.error("המחיר הסופי שלילי — הקטן את ההנחה או שנה את מצב התמחור לפני השמירה");
      return;
    }
    setSaving(true);
    try {
      // Per-item ratio (this item's live price ÷ its originally-saved price),
      // built from itemPricings — the same numbers already driving the live
      // preview, so this is correct under every pricing mode, not just a
      // single blended average across the whole quote. Each item's main line
      // + its extra rows (if any) share that one ratio, matching how they
      // were originally flattened together in MultiProductCalculator's
      // buildLineItems (main row, then extra rows, in item order) — a
      // discount/pricing-mode decision is made per item, not per sub-line.
      const scaledLineItems = [];
      let li_i = 0;
      items.forEach((item, i) => {
        const pricing = itemPricings[i];
        const ratio = pricing && pricing.original > 0 ? pricing.price / pricing.original : 1;
        const rowCount = 1 + (item.extraRows || []).filter((r) => r.result).length;
        for (let k = 0; k < rowCount && li_i < lineItems.length; k++, li_i++) {
          const li = lineItems[li_i];
          scaledLineItems.push({ ...li, unitPrice: Math.round((li.unitPrice || 0) * ratio * 100) / 100 });
        }
      });
      // Any lines left over (item/line counts drifted somehow) travel through
      // unscaled rather than being silently dropped.
      for (; li_i < lineItems.length; li_i++) scaledLineItems.push(lineItems[li_i]);

      const notes = `תיקון להצעה ${quote.quote_number}${quote.notes ? ` — ${quote.notes}` : ""}`;

      const revised = await base44.entities.Quote.create({
        client_name: quote.client_name,
        product_category: quote.product_category,
        payment_type: quote.payment_type,
        price_before_vat: Math.round(finalSubtotal * 100) / 100,
        price_with_vat: Math.round(finalTotalWithVat * 100) / 100,
        line_items: JSON.stringify(scaledLineItems),
        calculation_data: JSON.stringify({ ...calcData, itemDiscounts, overallDiscount, pricingMode, targetMarginPct }),
        notes,
        status: "approved",
        parent_quote_number: quote.quote_number,
      });

      // "עריכה ושמירה" = "מאשר" — מסמן את ההצעה המקורית כמאושרת ומודיע לסוכן
      // שיצר אותה שהיא מוכנה להנפקה, עם מספר ההצעה המתוקנת (לא המקורי).
      await base44.quotes.decide(quote.id, "approved", revised.quote_number);

      setSaved(true);
      toast.success("ההצעה המתוקנת נשמרה, והסוכן קיבל התראה");
      setTimeout(() => onSaved?.(), 800);
    } catch {
      toast.error("שגיאה בשמירת ההצעה המתוקנת");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="relative bg-[#111118] border border-white/25 rounded-2xl w-full max-w-[1600px] h-[92vh] flex flex-col"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button only — the client/quote-number/payment header moved
            into the top of the item-list column below, so the rest of the
            modal's height goes to the actual content (pricing/discount/save
            no longer need scrolling to reach). */}
        <button
          onClick={onClose}
          className="absolute left-3 top-3 z-10 p-1.5 rounded-lg hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4 text-zinc-400" />
        </button>

        {/* Main body — item list (right, narrow) + item detail (left, wide).
            Freed from sharing width with the whole-quote overview, which now
            lives in the full-width bar below instead of a third column. */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x lg:divide-x-reverse divide-white/10 overflow-hidden">
          {/* Item picker */}
          <div className="lg:w-60 lg:shrink-0 overflow-y-auto p-2 space-y-1.5">
            <div className="px-1 pb-2 mb-1 border-b border-white/10">
              <h2 className="text-sm font-bold text-white truncate">{quote.client_name}</h2>
              <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                {quote.quote_number}
                {quote.payment_type && ` · ${paymentTypeLabel(quote.payment_type)}`}
              </p>
              {quote.agent_note && (
                <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-md px-2 py-1 mt-1.5 whitespace-pre-wrap">
                  <span className="font-semibold">הערת סוכן: </span>{quote.agent_note}
                </p>
              )}
            </div>
            <h3 className="text-[11px] font-semibold text-zinc-400 mb-1 uppercase tracking-wider px-1">פריטים</h3>
            {items.map((it, i) => {
              const idx = it.index ?? 0;
              const isSelected = idx === selectedIndex;
              const label = it.productType ? (PRODUCT_NAMES[it.productType] || it.productType) : `מוצר ${idx + 1}`;
              const disc = itemDiscounts[idx];
              const pricing = itemPricings[i];
              const priceChanged = pricing && Math.abs(pricing.price - pricing.original) > 0.01;
              return (
                <button
                  key={idx}
                  onClick={() => setSelectedIndex(idx)}
                  className={`w-full text-right rounded-lg p-2 border transition-all ${
                    isSelected ? "border-[#C9A84C]/50 bg-[#C9A84C]/10" : "border-white/15 bg-[#16161F] hover:border-white/25"
                  }`}
                >
                  <div className={`text-xs font-semibold truncate ${isSelected ? "text-[#C9A84C]" : "text-zinc-200"}`}>
                    {items.length > 1 ? `מוצר ${idx + 1}` : "מוצר"}
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate mt-0.5">
                    {label}{dimsLabel(it) ? ` · ${dimsLabel(it)}` : ""}
                  </div>
                  {pricingMode === "discount" && disc?.value ? (
                    <div className="text-[11px] text-emerald-400 mt-1">הנחה: {disc.type === "percent" ? `${disc.value}%` : fmt(disc.value)}</div>
                  ) : pricingMode !== "discount" && priceChanged ? (
                    <div className="text-[11px] text-emerald-400 mt-1">{fmt(pricing.price)}</div>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Selected item detail + discount — now the widest column */}
          <div className="flex-1 overflow-y-auto p-6 pt-10 space-y-4">
            {selectedItem ? (
              <>
                <div className="text-sm font-bold text-white">
                  {items.length > 1 ? `מוצר ${selectedIndex + 1}` : "מוצר"}
                  {selectedItem.productType ? ` — ${PRODUCT_NAMES[selectedItem.productType] || selectedItem.productType}` : ""}
                  {selectedItem.thicknessMm && <span className="text-zinc-400 font-normal"> · עובי {selectedItem.thicknessMm} מ״מ</span>}
                  {dimsLabel(selectedItem) && <span className="text-zinc-400 font-normal"> · מידות {dimsLabel(selectedItem)}</span>}
                  {selectedItem.result?.totalArea != null && (
                    <span className="text-zinc-400 font-normal"> · סה״כ {selectedItem.result.totalArea.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} מ״ר</span>
                  )}
                </div>

                {/* Top stat row — עלות סך הכל / רווח תפעולי (₪) / רווח (%), side
                    by side instead of 3 stacked full-width cards, so the wide
                    panel is used for breadth instead of height. */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-[#16161F] rounded-xl p-3 text-center">
                    <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">עלות סך הכל</div>
                    <div className="text-base font-bold text-white">{fmt(selectedPricing.cost)}</div>
                  </div>
                  <div className="bg-gradient-to-br from-[#C9A84C]/15 to-transparent border border-[#C9A84C]/30 rounded-xl p-3 text-center">
                    <div className="text-[11px] font-semibold text-[#C9A84C] uppercase tracking-wider mb-1">רווח תפעולי אחרי כל ההוצאות</div>
                    <div className="text-base font-bold text-[#C9A84C]">{fmt(selectedPricing.profit)}</div>
                  </div>
                  <div className="bg-gradient-to-br from-[#C9A84C]/15 to-transparent border border-[#C9A84C]/30 rounded-xl p-3 text-center">
                    <div className="text-[11px] font-semibold text-[#C9A84C] uppercase tracking-wider mb-1">רווח באחוזים</div>
                    <div className="text-base font-bold text-[#C9A84C]">{selectedPricing.marginPct.toFixed(1)}%</div>
                  </div>
                </div>
                {pricingMode !== "discount" && Math.abs(selectedPricing.price - selectedPricing.original) > 0.01 && (
                  <div className="text-xs text-zinc-500 -mt-2">מחיר מכירה: {fmt(selectedPricing.price)} (לפני שינוי מצב תמחור: {fmt(selectedPricing.original)})</div>
                )}

                {(() => {
                  // עמלה נגזרת אנליטית מ-commissionPct × המחיר בפועל (תחת מצב
                  // התמחור הפעיל) — לא סכום שדות ה-breakdown הגולמיים, כי חלק
                  // מהמשפחות שומרות אותם ליחידה וחלק לכל השורה (ראו itemFixedCost).
                  const commissionTotal = commissionPct != null ? commissionPct * selectedPricing.price : 0;
                  const operationalOnly = selectedPricing.cost - selectedAgg.materialTotal - commissionTotal;
                  return (
                    // סדר ה-DOM נשאר "לוגי" (עלויות תחילה, סיכום אחרון) — ברשת RTL
                    // הפריט האחרון ב-DOM נופל לעמודה השמאלית ביותר, ולכן כרטיס
                    // הסיכום מסתיים בצד שמאל בלי להפוך את סדר הקריאה של השאר.
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      <CostBreakdown result={selectedItem.result} />
                      <CostCard title="סיכום" highlight>
                        <MiniRow label="עלות גולמית" value={fmt(selectedAgg.materialTotal)} />
                        <MiniRow label="עלות תפעולית" value={fmt(operationalOnly)} />
                        <MiniRow label="עלות עמלות" value={fmt(commissionTotal)} />
                        <MiniRow label="סך הכל עלות" value={fmt(selectedPricing.cost)} />
                        <MiniRow label="רווח" value={fmt(selectedPricing.profit)} />
                        <MiniRow label="רווח באחוזים" value={`${selectedPricing.marginPct.toFixed(1)}%`} />
                      </CostCard>
                    </div>
                  );
                })()}
                {(selectedItem.extraRows || []).filter((r) => r.result).map((row, ri) => (
                  <div key={ri}>
                    <div className="text-xs font-semibold text-zinc-500 mb-2">
                      {row.lineLabel || `שורה נוספת ${ri + 2}`}{dimsLabel(row) ? ` · ${dimsLabel(row)}` : ""}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      <CostBreakdown result={row.result} />
                    </div>
                  </div>
                ))}

                <div className="bg-[#16161F] rounded-xl p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-[#C9A84C] mb-1 uppercase tracking-wider">הנחה לפריט זה</h4>
                  {pricingMode !== "discount" ? (
                    <p className="text-xs text-zinc-500">
                      התמחור לפריט זה נקבע כרגע לפי מצב "{PRICING_MODE_LABELS[pricingMode]}" שנבחר למטה — הנחה פרטנית מושבתת כל עוד המצב הזה פעיל.
                    </p>
                  ) : (
                    <>
                      <DiscountInput discount={selectedDiscount} onChange={setSelectedDiscount} />
                      {selectedDiscount.value ? (
                        <div className="pt-2 space-y-1">
                          <Row label="רווח לפני הנחה" value={fmt(selectedAgg.profitTotal)} />
                          <Row label="רווח אחרי הנחה" value={fmt(selectedProfitAfterDiscount)} className={selectedProfitAfterDiscount < 0 ? "text-red-400" : ""} />
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all ${
                    saved ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-400" : "bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 disabled:opacity-40"
                  }`}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <><CheckCircle2 className="w-4 h-4" /> נשמר!</> : <><Save className="w-4 h-4" /> שמור הצעה מתוקנת</>}
                </button>
                <p className="text-xs text-zinc-500 text-center">שומר הצעה מתוקנת חדשה (מס׳ חדש), הכוללת את כל ההנחות שהוזנו — הפריט הזה וכל השאר.</p>
              </>
            ) : (
              <p className="text-zinc-500 text-sm">אין פריטים עם פירוט עלויות שמור להצעה זו.</p>
            )}
          </div>
        </div>

        {/* Bottom bar — whole-quote overview, full width. Moved out of the
            3-column layout so the item list + item detail above get the full
            width to themselves; this bar just summarizes the numbers. */}
        <div className="shrink-0 border-t border-white/20 bg-[#0C0C12] p-4 sm:p-6 max-h-[42vh] overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr_1fr_1.2fr] gap-4">
            {/* פירוט ההצעה — line items, own internal scroll so it can't push the row taller than the others */}
            <div>
              <h3 className="text-sm font-semibold text-zinc-300 mb-2 uppercase tracking-wider">פירוט ההצעה</h3>
              <div className="bg-[#16161F] rounded-xl p-3 text-sm max-h-40 overflow-y-auto">
                {lineItems.length === 0 ? (
                  <p className="text-zinc-500">אין פירוט שורות שמור להצעה זו.</p>
                ) : (
                  <div className="space-y-1">
                    {lineItems.map((li, idx) => (
                      <div key={idx} className="flex justify-between items-center py-1.5 border-b border-white/10 last:border-b-0 gap-3">
                        <div className="min-w-0">
                          {li.groupLabel && <div className="text-xs text-[#C9A84C] font-semibold mb-0.5">{li.groupLabel}</div>}
                          <div className="text-zinc-200 whitespace-pre-line break-words">{li.description || "—"}</div>
                        </div>
                        <div className="text-left shrink-0">
                          <div className="text-zinc-300">{li.quantity} × {fmt(li.unitPrice)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {quote.notes && (
                <div className="mt-3">
                  <h3 className="text-sm font-semibold text-zinc-300 mb-2 uppercase tracking-wider">הערות</h3>
                  <div className="bg-[#16161F] rounded-xl p-3 text-sm text-zinc-300">{quote.notes}</div>
                </div>
              )}
            </div>

            {/* פרטי תשלום + עלות ורווח */}
            <div className="space-y-3">
              {quote.payment_type && (
                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-2 uppercase tracking-wider">פרטי תשלום</h3>
                  <div className="bg-[#16161F] rounded-xl p-3 text-sm">
                    <Row label="דרך תשלום" value={paymentTypeLabel(quote.payment_type)} />
                  </div>
                </div>
              )}
              {items.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 mb-2 uppercase tracking-wider">עלות ורווח — ההצעה כולה</h3>
                  <div className="bg-[#16161F] rounded-xl p-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-zinc-400">עלות גולמית</div>
                      <div className="font-semibold text-white mt-0.5">{fmt(quoteAgg.materialTotal)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-400">עלות תפעולית</div>
                      <div className="font-semibold text-white mt-0.5">{fmt(quoteOperationalTotal)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-400">רווח (₪){hasAnyDiscount && <span className="text-zinc-600"> · לפני {fmt(quoteAgg.profitTotal)}</span>}</div>
                      <div className={`font-semibold mt-0.5 ${quoteProfitLive < 0 ? "text-red-400" : "text-emerald-400"}`}>{fmt(quoteProfitLive)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-400">רווח תפעולי (%){hasAnyDiscount && <span className="text-zinc-600"> · לפני {quoteAgg.marginPct.toFixed(1)}%</span>}</div>
                      <div className={`font-semibold mt-0.5 ${quoteMarginLive < 0 ? "text-red-400" : "text-emerald-400"}`}>{quoteMarginLive.toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* מצב תמחור — הנחה רגילה, או אחת מ-3 רובריקות תמחור קבועות שמנהל
                המכירות יכול להפעיל על כל ההזמנה בבת אחת. */}
            <div>
              <h3 className="text-sm font-semibold text-zinc-300 mb-2 uppercase tracking-wider">מצב תמחור</h3>
              <div className="bg-[#16161F] rounded-xl p-3 space-y-3">
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(PRICING_MODE_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => {
                        setPricingMode(key);
                        // Seed the slider at the quote's ORIGINAL margin the first
                        // time this mode is opened, so it starts where the deal
                        // already is instead of jumping to 0%.
                        if (key === "target_margin" && targetMarginPct == null) {
                          setTargetMarginPct(Math.min(Math.max(Math.round(quoteAgg.marginPct), 0), maxTargetMarginPct));
                        }
                      }}
                      disabled={key !== "discount" && commissionPct == null}
                      className={`text-xs px-2 py-1.5 rounded-lg border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                        pricingMode === key ? "border-[#C9A84C] bg-[#C9A84C]/15 text-[#C9A84C] font-semibold" : "border-white/15 text-zinc-400 hover:border-white/25"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {commissionPct == null && pricingMode !== "discount" && (
                  <p className="text-xs text-amber-400">הצעה ישנה ללא נתוני עמלות שמורים — מצבי תמחור מתקדמים אינם זמינים עליה.</p>
                )}

                {pricingMode === "discount" && (
                  <>
                    <DiscountInput discount={overallDiscount} onChange={setOverallDiscount} />
                    <p className="text-xs text-zinc-500">מצטברת מעל הנחות הפריטים — מחושבת על הסכום שנשאר אחריהן.</p>
                  </>
                )}

                {(pricingMode === "max_sqm" || pricingMode === "min_sqm") && (
                  <p className="text-xs text-zinc-400">
                    מחשב מחדש כל פריט שיש לו מחיר/מ״ר גמיש (לוקובונד/פיויסי/פרספקס) לפי {pricingMode === "max_sqm" ? "מחיר המ״ר המקסימלי (מחיר רשימה)" : "מחיר המ״ר המינימלי לסוכן"}, ומנטרל את מחיר המינימום של המוצר. פריטים ללא גמישות מחיר נשארים במחיר שנשמר.
                  </p>
                )}

                {pricingMode === "target_margin" && (() => {
                  const sliderValue = targetMarginPct ?? Math.min(Math.max(Math.round(quoteAgg.marginPct), 0), maxTargetMarginPct);
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-400">אחוז רווח תפעולי יעד</span>
                        <span className="font-bold text-[#C9A84C]">{sliderValue}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={maxTargetMarginPct}
                        step={1}
                        value={sliderValue}
                        onChange={(e) => setTargetMarginPct(parseInt(e.target.value))}
                        className="w-full accent-[#C9A84C]"
                        dir="ltr"
                      />
                      <p className="text-xs text-zinc-500">מחשב מחדש את מחיר כל פריט כך שיושג בדיוק אחוז הרווח הזה — עוקף לגמרי את מחירי המ״ר/הטבלאות.</p>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* מחירים — final price, highlighted */}
            <div>
              <h3 className="text-sm font-semibold text-zinc-300 mb-2 uppercase tracking-wider">מחירים</h3>
              <div className="bg-gradient-to-br from-[#C9A84C]/15 via-[#C9A84C]/8 to-transparent border border-[#C9A84C]/30 rounded-xl p-3 space-y-2">
                {hasAnyDiscount && (
                  <Row label="לפני שינוי (ללא מע״מ)" value={fmt(quote.price_before_vat)} className="opacity-60" />
                )}
                <Row label="לפני מע״מ" value={fmt(finalSubtotal)} />
                <Row label={`מע״מ${vatPercent != null ? ` (${vatPercent}%)` : ""}`} value={fmt(finalTotalWithVat - finalSubtotal)} />
                <div className="flex justify-between items-center py-1.5 text-sm pt-2 border-t border-[#C9A84C]/20">
                  <span className="font-semibold text-[#C9A84C]">סה״כ עם מע״מ</span>
                  <span className="font-bold text-lg text-[#C9A84C]">{fmt(finalTotalWithVat)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <MorningSection quoteId={quote.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
