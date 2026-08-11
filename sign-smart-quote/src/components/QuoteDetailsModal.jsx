import { useEffect, useMemo, useRef, useState } from "react";
import { X, Loader2, CheckCircle2, Save, FileText, Receipt, Paperclip, Image as ImageIcon, ChevronRight, ChevronLeft } from "lucide-react";
import { PRODUCT_NAMES } from "@/components/calculator/CalculatorForm";
import { base44 } from "@/api/base44Client";
import { convertMorningDocument, getMorningHistory } from "@/api/morningClient";
import { MORNING_TYPE_LABELS, formatDocNumber } from "@/lib/quoteLabels";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const fmt = (val) =>
  val != null
    ? `₪ ${Number(val).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";

// "200×100 מ׳" for agent-measured products, or "עד 1.2×2.4 מ׳" for kapa (a
// fixed-tier catalog row with no agent-entered width/height — the tier's own
// nominal size is the only physical size on record, and it's an upper bound,
// not an exact cut measurement, hence "עד"). null if neither is available
// (rollup/glass — no dims shown for those yet).
function dimsLabel(it) {
  if (it?.widthM && it?.heightM) return `${it.widthM}×${it.heightM} מ׳`;
  const kw = it?.result?.breakdown?.kapaWidthM;
  const kh = it?.result?.breakdown?.kapaHeightM;
  if (kw && kh) return `עד ${kw}×${kh} מ׳`;
  return null;
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
  <div className={`flex justify-between items-center py-2 text-sm border-b border-zinc-200 last:border-b-0 ${className}`}>
    <span className="text-zinc-600">{label}</span>
    <span className="font-semibold text-zinc-900">{value}</span>
  </div>
);

// Reference images/PDFs the agent attached when saving/sending this quote —
// e.g. a photo of the client's wall — so the manager can see what it's
// actually for. Images are fetched as thumbnails right away (this list is
// only ever a handful of files); PDFs stay a click-to-open row since there's
// no cheap inline preview for them.
function QuoteAttachments({ quoteId }) {
  const [attachments, setAttachments] = useState([]);
  const [thumbUrls, setThumbUrls] = useState({});

  useEffect(() => {
    if (!quoteId) return;
    let cancelled = false;
    base44.quotes.listAttachments(quoteId).then((rows) => {
      if (!cancelled) setAttachments(rows);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [quoteId]);

  useEffect(() => {
    let cancelled = false;
    const urls = [];
    attachments.filter((a) => a.mime_type.startsWith("image/")).forEach((a) => {
      base44.quotes.fetchAttachmentBlob(quoteId, a.id).then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        setThumbUrls((prev) => ({ ...prev, [a.id]: url }));
      }).catch(() => {});
    });
    // Blob URLs are only valid for this component's lifetime — release them
    // once the modal moves to a different quote / unmounts.
    return () => { cancelled = true; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [attachments, quoteId]);

  const openAttachment = async (att) => {
    try {
      const url = thumbUrls[att.id] || URL.createObjectURL(await base44.quotes.fetchAttachmentBlob(quoteId, att.id));
      window.open(url, "_blank");
    } catch {
      toast.error("שגיאה בפתיחת הקובץ");
    }
  };

  if (!attachments.length) return null;

  return (
    <div className="mt-1.5 space-y-1.5">
      <p className="text-[11px] text-zinc-500 flex items-center gap-1">
        <Paperclip className="w-3 h-3" /> קבצים מצורפים ({attachments.length})
      </p>
      <div className="flex flex-wrap gap-1.5">
        {attachments.map((att) => (
          att.mime_type.startsWith("image/") ? (
            <button
              key={att.id}
              onClick={() => openAttachment(att)}
              title={att.original_name}
              className="w-14 h-14 rounded-md overflow-hidden border border-zinc-200 hover:border-[#C9A84C]/60 bg-zinc-50 shrink-0"
            >
              {thumbUrls[att.id]
                ? <img src={thumbUrls[att.id]} alt={att.original_name} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-4 h-4 text-zinc-400" /></div>}
            </button>
          ) : (
            <button
              key={att.id}
              onClick={() => openAttachment(att)}
              title={att.original_name}
              className="flex items-center gap-1 px-2 py-1.5 rounded-md border border-zinc-200 hover:border-[#C9A84C]/60 bg-zinc-50 text-[11px] text-zinc-700 max-w-[9rem]"
            >
              <FileText className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
              <span className="truncate">{att.original_name}</span>
            </button>
          )
        ))}
      </div>
    </div>
  );
}

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
// Sized a step up from the original (text-xs → text-sm, more row padding) —
// the cost/commission/summary cards are now the main content of this area
// (the old עלות/רווח/% tiles above them were removed), so they get the space.
const MiniRow = ({ label, value }) => (
  <div className="flex justify-between items-baseline gap-2 py-1 text-sm">
    <span className="text-zinc-600 truncate">{label}</span>
    <span className="font-semibold text-zinc-900 shrink-0">{value}</span>
  </div>
);

// Same shape as MiniRow but visually emphasized — used for the headline
// numbers inside the "סיכום" card (סך הכל עלות / רווח / רווח באחוזים) so they
// read at a glance instead of blending into the rest of the summary's rows.
const EmphasizedRow = ({ label, value, color = "gold" }) => {
  const textClass = color === "green" ? "text-emerald-600" : "text-[#8C6D1F]";
  const labelOpacity = color === "green" ? "" : "/80";
  return (
    <div className="flex justify-between items-baseline gap-2 py-1.5 text-base">
      <span className={`${textClass}${labelOpacity} font-semibold truncate`}>{label}</span>
      <span className={`font-bold ${textClass} text-lg shrink-0`}>{value}</span>
    </div>
  );
};

// The "total" row inside a חומרי גלם / עלויות עבודה ותקורה / עמלות card —
// boxed as its own small gold sub-card instead of just another list row, so
// the one number that summarizes the whole card stands out immediately.
const CardTotalRow = ({ label, value }) => (
  <div className="flex justify-between items-baseline gap-2 mt-1.5 px-2.5 py-1.5 rounded-md bg-[#C9A84C]/15 border border-[#C9A84C]/30">
    <span className="text-xs font-semibold text-[#8C6D1F]">{label}</span>
    <span className="text-sm font-bold text-[#8C6D1F] shrink-0">{value}</span>
  </div>
);

// One boxed column inside the cost-breakdown grid — renders nothing if every
// child row resolved to null (the family didn't populate that field), so an
// empty section never leaves a hollow card in the grid.
function CostCard({ title, children, highlight = false }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <div className={highlight ? "bg-gradient-to-br from-[#C9A84C]/15 to-transparent border border-[#C9A84C]/30 rounded-lg p-4" : "bg-zinc-100 border border-zinc-200 rounded-lg p-4"}>
      <h5 className={`text-xs font-semibold mb-2 uppercase tracking-wider ${highlight ? "text-[#8C6D1F]" : "text-zinc-600"}`}>{title}</h5>
      <div className="divide-y divide-zinc-200">{rows}</div>
    </div>
  );
}

// Cost breakdown for one product line — the raw fields a given family actually
// populates, laid out as compact side-by-side cards (חומרי גלם / עלויות עבודה
// ותקורה / עמלות) instead of one long single-column list, so the much wider
// detail panel is actually used instead of leaving most of it empty.
// Purely presentational; the money math above never reads from here.
// livePrice/liveCost override the saved result's own totals for the "עלות
// למ״ר"/"מחיר ללקוח למ״ר" split below — pass the manager's LIVE, discount-
// adjusted price/cost (selectedPricing) for the item currently open so those
// two numbers react immediately to a discount instead of showing the
// as-saved price forever. Omit (extra-size rows, which have no discount of
// their own) to fall back to the result's own as-saved totals.
// `priceRatio` is how far this item's price moved from what was saved (live
// price ÷ original price) under the manager's discount / pricing mode. Only the
// commissions and the price itself scale with it — material, labour, overhead
// and third-party installation are all price-INDEPENDENT and stay as saved.
function CostBreakdown({ result, priceRatio = 1 }) {
  if (!result) return null;
  // The engine fills every family's breakdown with the same key set, using a
  // literal 0 for fields that don't apply — so `!= null` alone can't tell
  // "this family has no such cost" from "this cost happens to be zero".
  // Gate family-specific rows on the family itself instead.
  const isStickerResult = !!result.isSticker;
  const isKapaResult = result.productFamily === "kapa" || !!result.isKapa;
  return (
    <>
      <CostCard title="חומרי גלם">
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
        {/* קאפה/מדבקה — הועברו לכאן מהכרטיסים הנפרדים "פירוט קאפה"/"פירוט
            מדבקה" שהיו קודם: אלה עלויות חומר גלם לכל דבר, לא קטגוריה משלהן. */}
        {isKapaResult && result.breakdown?.kapaSheetCost != null && <MiniRow label="לוח קאפה" value={fmt(result.breakdown.kapaSheetCost)} />}
        {isStickerResult && result.breakdown?.stickerMaterialCost != null && <MiniRow label="חומר מדבקה" value={fmt(result.breakdown.stickerMaterialCost)} />}
        {isStickerResult && result.breakdown?.stickerInkCost != null && <MiniRow label="דיו מדבקה" value={fmt(result.breakdown.stickerInkCost)} />}
        {isStickerResult && result.breakdown?.stickerWasteAmount != null && <MiniRow label="פחת מדבקה" value={fmt(result.breakdown.stickerWasteAmount)} />}
        {!isStickerResult && result.rawMaterialBeforeWaste != null && <MiniRow label="לפני פחת" value={fmt(result.rawMaterialBeforeWaste)} />}
        {!isStickerResult && result.wasteAmount != null && <MiniRow label="פחת (חומר)" value={fmt(result.wasteAmount)} />}
        {/* שטיח פיויסי בלבד — פחת הגליל מתורגם לחיוב נפרד ללקוח (עלות פחת ×
            מכפיל שהוגדר באדמין), לא רק נספג כעלות פנימית. חשוב שהמנהל יראה
            את הסכום הזה בנפרד — הוא חלק מהמחיר שהלקוח משלם, לא רק עלות. */}
        {result.breakdown?.wasteCharge > 0 && <MiniRow label="חיוב פחת מהלקוח" value={fmt(result.breakdown.wasteCharge)} />}
        {result.rawMaterialCost != null && <CardTotalRow label="סה״כ חומרים" value={fmt(result.rawMaterialCost)} />}
      </CostCard>

      <CostCard title="עלויות עבודה ותקורה">
        {/* Every row here is gated on `!= null`, but the engine returns 0 (not
            undefined) for fields belonging to OTHER families — a sticker's
            breakdown carries printLaborCost/laserLaborCost/… as a literal 0
            (see the STICKER PATH in useCalculator.jsx). Without the family
            gate below, a sticker rendered five irrelevant "0.00" labour rows
            (הדפסה / חיתוך לייזר / חיתוך סומא / אריזה / חדר צביעה) next to its
            real ones. CostResults.jsx already branches by family this way. */}
        {!isStickerResult && !isKapaResult && (
          <>
            {result.breakdown?.printLaborCost != null && <MiniRow label="הדפסה" value={fmt(result.breakdown.printLaborCost)} />}
            {result.breakdown?.preCutLaborCost != null && <MiniRow label="קדם חיתוך" value={fmt(result.breakdown.preCutLaborCost)} />}
            {result.breakdown?.laserLaborCost != null && <MiniRow label="חיתוך לייזר" value={fmt(result.breakdown.laserLaborCost)} />}
            {result.breakdown?.somaLaborCost != null && <MiniRow label="חיתוך סומא" value={fmt(result.breakdown.somaLaborCost)} />}
            {result.breakdown?.cutLaborCost != null && <MiniRow label="חיתוך" value={fmt(result.breakdown.cutLaborCost)} />}
            {result.breakdown?.cleanLaborCost != null && <MiniRow label="ניקוי" value={fmt(result.breakdown.cleanLaborCost)} />}
            {result.breakdown?.packagingLaborCost != null && <MiniRow label="אריזה" value={fmt(result.breakdown.packagingLaborCost)} />}
            {result.breakdown?.paintRoomCost != null && <MiniRow label="חדר צביעה" value={fmt(result.breakdown.paintRoomCost)} />}
          </>
        )}
        {/* קאפה/מדבקה — ראו הערה מקבילה למעלה; אלה עלויות עבודה/התקנה. */}
        {isKapaResult && (
          <>
            {result.breakdown?.kapaPrePrintLaborCost != null && <MiniRow label="קדם דפוס (קאפה)" value={fmt(result.breakdown.kapaPrePrintLaborCost)} />}
            {result.breakdown?.kapaPrintLaborCost != null && <MiniRow label="הדפסה (קאפה)" value={fmt(result.breakdown.kapaPrintLaborCost)} />}
            {result.breakdown?.kapaPreCutLaborCost != null && <MiniRow label="קדם חיתוך (קאפה)" value={fmt(result.breakdown.kapaPreCutLaborCost)} />}
            {result.breakdown?.kapaCncCutLaborCost != null && <MiniRow label="חיתוך CNC (סומא)" value={fmt(result.breakdown.kapaCncCutLaborCost)} />}
            {result.breakdown?.kapaPackagingLaborCost != null && <MiniRow label="אריזה (קאפה)" value={fmt(result.breakdown.kapaPackagingLaborCost)} />}
          </>
        )}
        {isStickerResult && (
          <>
            {result.breakdown?.stickerPrintLaborCost != null && <MiniRow label="הדפסה (מדבקה)" value={fmt(result.breakdown.stickerPrintLaborCost)} />}
            {result.breakdown?.stickerCutLaborCost != null && <MiniRow label="חיתוך (מדבקה)" value={fmt(result.breakdown.stickerCutLaborCost)} />}
            {/* עלות התקנה moved to the "עמלות" card and מחיר התקנה (ללקוח) to
                "סיכום" — installation is a big share of a sticker's price and
                was too easy to miss buried among the labour minutiae. */}
          </>
        )}
        {result.laborCost != null && <MiniRow label="סה״כ עבודה" value={fmt(result.laborCost)} />}
        {result.overheadCost != null && <MiniRow label="תקורה תפעולית" value={fmt(result.overheadCost)} />}
        {(result.laborCost != null || result.overheadCost != null) && (
          <CardTotalRow label="סה״כ עבודה לאחר תקורה" value={fmt((result.laborCost || 0) + (result.overheadCost || 0))} />
        )}
      </CostCard>

      {(() => {
        // Every family now carries a real totalArea (kapa uses its tier's
        // nominal size — see useCalculator.jsx) — this only stays null for a
        // family that genuinely has no physical size concept at all.
        const area = result.totalArea;
        const hasArea = area != null && area > 0;
        // Commissions are a straight % of the selling price, so a discount has
        // to move them too — showing the originally-saved shekel amount next to
        // a discounted price overstated the cost and understated the profit.
        const agentCommission = result.breakdown?.salesAgentCommissionCost != null
          ? result.breakdown.salesAgentCommissionCost * priceRatio : null;
        const marketingCommission = result.breakdown?.marketingCommissionCost != null
          ? result.breakdown.marketingCommissionCost * priceRatio : null;
        const commissionDelta = ((agentCommission || 0) + (marketingCommission || 0))
          - ((result.breakdown?.salesAgentCommissionCost || 0) + (result.breakdown?.marketingCommissionCost || 0));
        // The only price-dependent slice of the cost is the commission, so the
        // live cost is the saved cost plus however much the commission moved.
        const costAll = (result.totalCostAll ?? result.totalCostPerUnit ?? 0) + commissionDelta;
        const priceAll = (result.sellingPriceAll ?? 0) * priceRatio;
        const costPerSqm = hasArea ? costAll / area : null;
        const pricePerSqm = hasArea ? priceAll / area : null;
        const commissionTotal = (agentCommission || 0)
          + (marketingCommission || 0)
          + (isStickerResult ? (result.breakdown?.stickerInstallCost || 0) : 0);
        const commissionRows = [
          agentCommission != null && <MiniRow key="agent" label="עמלת סוכן מכירות" value={fmt(agentCommission)} />,
          marketingCommission != null && <MiniRow key="marketing" label="עמלת שיווק" value={fmt(marketingCommission)} />,
          // Installation is a paid-out third-party cost, not shop labour —
          // sits with the commissions rather than buried in the labour card.
          isStickerResult && result.breakdown?.stickerInstallCost != null && (
            <MiniRow key="install" label="עלות התקנה (בפועל)" value={fmt(result.breakdown.stickerInstallCost)} />
          ),
        ].filter(Boolean);
        if (!commissionRows.length && !hasArea) return null;
        return (
          <CostCard title="עמלות">
            <div className="divide-y divide-zinc-200">
              <div className="space-y-0.5 pb-1.5">
                {commissionRows}
                {commissionRows.length > 0 && <CardTotalRow label="סך הכל עמלות" value={fmt(commissionTotal)} />}
              </div>
              <div className="space-y-0.5 pt-1.5">
                {hasArea ? (
                  <>
                    <MiniRow label='עלות למ״ר' value={fmt(costPerSqm)} />
                    <MiniRow label='מחיר ללקוח למ״ר' value={fmt(pricePerSqm)} />
                  </>
                ) : (
                  <p className="text-xs text-zinc-500">מוצר קטלוגי — ללא מ״ר</p>
                )}
              </div>
            </div>
          </CostCard>
        );
      })()}

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
function MorningSection({ quoteId, readOnly = false, morningDoc, onOpenMorningDoc }) {
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
      <h3 className="text-sm font-semibold text-zinc-700 mb-2 uppercase tracking-wider">מורנינג</h3>
      <div className="bg-zinc-50 rounded-xl p-3 space-y-3">
        {/* Same document (quote/order/invoice) the list rows in
            QuotesArchive/QuotesHistory already link to — surfaced here too so
            a manager who opened this modal doesn't have to close it and hunt
            for the row's own link just to see the actual Morning document. */}
        {morningDoc?.document_url && (
          <div className="flex items-center justify-between gap-2 text-xs bg-zinc-100 border border-zinc-200 rounded-lg px-2.5 py-2">
            <span className="text-zinc-700">
              {MORNING_TYPE_LABELS[morningDoc.morning_document_type] || "מסמך"} #{formatDocNumber(morningDoc.morning_document_number || morningDoc.morning_document_id)}
            </span>
            <button
              onClick={() => onOpenMorningDoc?.(morningDoc.document_url)}
              className="flex items-center gap-1 text-[#8C6D1F] hover:underline shrink-0"
            >
              <FileText className="w-3.5 h-3.5" /> פתח מסמך
            </button>
          </div>
        )}

        {/* readOnly (the general-history archive screen) keeps the audit trail
            below but hides these — they issue REAL Morning documents. */}
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            {MORNING_ACTIONS.map(({ toType, label }) => (
              <button
                key={toType}
                onClick={() => handleConvert(toType, label)}
                disabled={busyType !== null}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 text-zinc-800 hover:border-[#C9A84C]/50 hover:text-[#8C6D1F] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busyType === toType ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="border-t border-zinc-200 pt-2 space-y-1.5 max-h-40 overflow-y-auto">
          {historyError ? (
            <p className="text-xs text-zinc-500">אין היסטוריית מורנינג להצעה זו.</p>
          ) : !history ? (
            <p className="text-xs text-zinc-500">טוען היסטוריה...</p>
          ) : history.log?.length === 0 ? (
            <p className="text-xs text-zinc-500">אין פעולות מורנינג שבוצעו עדיין.</p>
          ) : (
            history.log.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-zinc-100 last:border-b-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Receipt className="w-3 h-3 text-zinc-500 shrink-0" />
                  <span className="text-zinc-700 truncate">{entry.action}</span>
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
      className="h-9 rounded-md border border-zinc-300 bg-zinc-50 px-2 text-sm text-zinc-900 focus:outline-none"
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
      className="h-9 flex-1 rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
    />
  </div>
);

const CompactField = ({ label, value, onChange, suffix, max }) => (
  <div>
    <label className="text-[10px] text-zinc-500 block mb-0.5 truncate">{label}</label>
    <div className="relative">
      <input
        type="number"
        min="0"
        max={max}
        step="0.01"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="h-8 w-full rounded-md border border-zinc-300 bg-zinc-50 pr-2 pl-6 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
      />
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 pointer-events-none">{suffix}</span>
    </div>
  </div>
);

const round2 = (n) => Math.round(n * 100) / 100;

// The ₪/מ״ר field needs its own local text buffer — it's DERIVED from
// `discount` (converted back to a price on every render), and without a
// buffer the input value gets recomputed out from under the user on every
// keystroke (rounding making "45" render back as "44.99", or a price ABOVE
// the original snapping to "" and back to the original number — see below).
// `itemKey` (pass the item's index) forces a fresh buffer when the agent
// switches to a different item, so stale text never leaks across items.
function PricePerSqmField({ discount, onChange, area, originalPrice, itemKey }) {
  const derivedPrice = discount.type === "amount" && discount.value
    ? (originalPrice - (parseFloat(discount.value) || 0)) / area
    : discount.type === "percent" && discount.value
    ? (originalPrice * (1 - (parseFloat(discount.value) || 0) / 100)) / area
    : originalPrice / area;

  const [text, setText] = useState(() => String(round2(derivedPrice)));
  const lastKey = useRef(itemKey);
  const lastPushed = useRef(text);

  // Re-sync the buffer from the derived price only when it changed for a
  // reason OTHER than this field's own last edit — switching items, or the
  // ₪/% discount fields being edited instead. Comparing against lastPushed
  // (not just "did derivedPrice change") is what stops our OWN edit from
  // immediately overwriting itself once the parent re-renders.
  useEffect(() => {
    const switchedItem = lastKey.current !== itemKey;
    const derivedStr = String(round2(derivedPrice));
    if (switchedItem || derivedStr !== lastPushed.current) {
      setText(derivedStr);
      lastPushed.current = derivedStr;
      lastKey.current = itemKey;
    }
  }, [derivedPrice, itemKey]);

  const handleChange = (v) => {
    setText(v);
    if (v === "" || !(area > 0)) {
      lastPushed.current = v;
      onChange({ type: "amount", value: "" });
      return;
    }
    const newTotal = (parseFloat(v) || 0) * area;
    // NOT clamped to ≥0 — applyDiscount treats a NEGATIVE amount-discount as
    // a markup (amount - (-x) = amount + x), which is exactly how typing a
    // ₪/מ״ר price ABOVE the original is meant to raise the price instead of
    // getting silently clamped back down to the original.
    const discountAmount = round2(originalPrice - newTotal);
    lastPushed.current = v;
    onChange({ type: "amount", value: discountAmount ? String(discountAmount) : "" });
  };

  return <CompactField label='מחיר למ״ר' suffix="₪" value={text} onChange={handleChange} />;
}

// Three always-visible compact fields for one item, instead of the previous
// single type-toggle-dropdown + value: a direct ₪/מ״ר price override (only
// where the item has a real area), a ₪ discount, and a % discount. All three
// still write into the SAME `discount` object underneath ({type, value}) — a
// price-per-sqm edit is just converted to the equivalent amount discount —
// so pricingForItem/applyDiscount elsewhere never need to know this exists.
function ItemPricingFields({ discount, onChange, area, originalPrice, itemKey }) {
  const hasArea = area != null && area > 0;

  return (
    <div className={`grid gap-2 ${hasArea ? "grid-cols-3" : "grid-cols-2"}`}>
      {hasArea && (
        <PricePerSqmField discount={discount} onChange={onChange} area={area} originalPrice={originalPrice} itemKey={itemKey} />
      )}
      <CompactField
        label="הנחה בסכום"
        suffix="₪"
        value={discount.type === "amount" ? discount.value : ""}
        onChange={(v) => onChange({ type: "amount", value: v })}
      />
      <CompactField
        label="הנחה באחוזים"
        suffix="%"
        max={100}
        value={discount.type === "percent" ? discount.value : ""}
        onChange={(v) => onChange({ type: "percent", value: v })}
      />
    </div>
  );
}

// `readOnly` powers the general-history archive screen (QuotesArchive): same
// rich breakdown, but every control that WRITES is hidden — the pricing-mode
// override, the discount inputs, the save button (which creates a revised quote
// and approves the original), and the Morning document actions. It is a
// clarity/misclick guard, not a security boundary: both screens are admin-only,
// and an admin can do all of this from /quotes anyway.
export default function QuoteDetailsModal({ quote, onClose, onSaved, readOnly = false, morningDoc, onOpenMorningDoc }) {
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

  // One screen per product, plus a final summary screen — the whole modal used
  // to be a 3-column wall of numbers, which managers found unreadable. `step`
  // indexes items[] first (0..items.length-1), and the last step is the summary
  // (prices / pricing mode / Morning / save).
  const [step, setStep] = useState(0);
  // Each screen starts at its top — otherwise the scroll position of the
  // previous (usually longer) screen carries over and the next one opens
  // halfway down.
  const contentRef = useRef(null);
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [step]);
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

  // line_items is a FLAT list (main row of item 0, its extra rows, main row of
  // item 1, …) — the same order buildLineItems produces in the calculator and
  // that handleSave below relies on. Slicing it back per item is what lets each
  // product screen show the very rows the agent typed (description, free text,
  // quantity, unit price) instead of a bare cost breakdown.
  const rowsByItem = useMemo(() => {
    const out = [];
    let li = 0;
    items.forEach((item) => {
      const results = [item.result, ...(item.extraRows || []).map((r) => r.result)].filter(Boolean);
      const sources = [item, ...(item.extraRows || []).filter((r) => r.result)];
      out.push(
        results.map((result, k) => ({
          result,
          source: sources[k],
          line: lineItems[li++] || null,
          isExtra: k > 0,
        }))
      );
    });
    return out;
  }, [items, lineItems]);

  const stepCount = items.length + 1;
  const isSummary = step >= items.length;
  const selectedItem = items[Math.min(step, items.length - 1)] || null;
  const selectedIndex = selectedItem?.index ?? 0;
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
        // Required by the server on every Quote create (routes/entities.js
        // quoteCreate) — omitting it here made every "שמור הצעה מתוקנת" 400,
        // always, unconditionally. The rest of the client fields travel along
        // too so the revised quote keeps the same Morning client details.
        client_phone: quote.client_phone,
        client_address: quote.client_address,
        client_vat_id: quote.client_vat_id,
        client_email: quote.client_email,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-2" onClick={onClose}>
      <div
        className="relative bg-white border border-zinc-300 rounded-2xl w-full max-w-[98vw] h-[95vh] shadow-2xl flex flex-col"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button — sits over the sticky header below. */}
        <button
          onClick={onClose}
          className="absolute left-3 top-3 z-10 p-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
        >
          <X className="w-4 h-4 text-zinc-600" />
        </button>

        {/* Sticky header — who the quote is for + which screen you're on.
            Everything else is one screen at a time (see `step`). */}
        <div className="shrink-0 border-b border-zinc-200 px-4 pt-3 pb-2 pl-12">
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1">
              <h2 className="text-base font-bold text-zinc-900">
                {quote.quote_number}
                <span className="text-zinc-400 font-normal"> · </span>
                {quote.client_name}
              </h2>
              {quote.payment_type && (
                <span className="text-[11px] text-zinc-500">{paymentTypeLabel(quote.payment_type)}</span>
              )}
              <QuoteAttachments quoteId={quote.id} />
            </div>
            {quote.agent_note && (
              <p className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/25 rounded-md px-2 py-1 mt-1.5 whitespace-pre-wrap">
                <span className="font-semibold">הערת סוכן: </span>{quote.agent_note}
              </p>
            )}
            {/* Step chips — the old right-hand item list, flattened into one
                thin row. Tapping a chip jumps straight to that screen; the
                arrows at the bottom walk through them in order. */}
            <div className="flex gap-1.5 mt-2 overflow-x-auto pb-0.5">
              {items.map((it, i) => {
                const idx = it.index ?? 0;
                const isCurrent = !isSummary && i === step;
                const label = it.productType ? (PRODUCT_NAMES[it.productType] || it.productType) : `מוצר ${idx + 1}`;
                const disc = itemDiscounts[idx];
                const pricing = itemPricings[i];
                const priceChanged = pricing && Math.abs(pricing.price - pricing.original) > 0.01;
                const changed = pricingMode === "discount" ? !!disc?.value : priceChanged;
                return (
                  <button
                    key={idx}
                    onClick={() => setStep(i)}
                    title={label}
                    // An edited product stays green wherever you are in the
                    // flow, so it's obvious at a glance which ones you already
                    // touched — the current-screen ring is drawn on top of it.
                    className={`shrink-0 rounded-full px-3 py-1 text-[11px] border transition-all ${
                      changed
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold"
                        : isCurrent
                        ? "border-[#C9A84C] bg-[#C9A84C]/15 text-[#8C6D1F] font-semibold"
                        : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
                    } ${isCurrent ? "ring-2 ring-offset-1 ring-[#C9A84C]" : ""}`}
                  >
                    מוצר {idx + 1}
                    {changed && <span className="font-semibold"> · נערך</span>}
                  </button>
                );
              })}
              <button
                onClick={() => setStep(items.length)}
                className={`shrink-0 rounded-full px-3 py-1 text-[11px] border transition-all ${
                  isSummary
                    ? "border-[#C9A84C] bg-[#C9A84C]/15 text-[#8C6D1F] font-semibold"
                    : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
                }`}
              >
                סיכום ומחירים
              </button>
            </div>
        </div>

        {/* One screen at a time: a product, or the closing summary. */}
        <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            {!isSummary && (selectedItem ? (
              <>
                {(() => {
                  const rows = rowsByItem[Math.min(step, items.length - 1)] || [];
                  const totalArea = rows.reduce((s, r) => s + (r.result?.totalArea || 0), 0);
                  // A saved description is multi-line: product name first, then
                  // the spec the calculator built (measurements, extras,
                  // installation, "הערה: …"). The table prints the first line
                  // and has its own מידות/מ״ר columns, so only what's LEFT —
                  // minus a spec line that just repeats the dimensions — belongs
                  // in the notes box. Printing the whole description in both
                  // places is what duplicated every note.
                  const notes = rows.flatMap((r) => {
                    const dims = dimsLabel(r.source);
                    const rest = String(r.line?.description || "")
                      .split("\n")
                      .map((t) => t.trim())
                      .filter(Boolean)
                      .slice(1)
                      .filter((t) => t !== dims);
                    const free = String(r.line?.freeText || "").trim();
                    return [...rest, ...(free && !rest.includes(free) ? [free] : [])];
                  });
                  // The LIVE per-row price: the saved unitPrice scaled by the
                  // same ratio the whole item's price moved under the active
                  // pricing mode / discount, so the table never contradicts the
                  // סיכום card next to it.
                  const ratio = selectedPricing.original > 0 ? selectedPricing.price / selectedPricing.original : 1;
                  return (
                    <>
                      <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1">
                        <span className="text-base font-bold text-zinc-900">
                          {items.length > 1 ? `מוצר ${selectedIndex + 1}` : "מוצר"}
                          {selectedItem.productType ? ` — ${PRODUCT_NAMES[selectedItem.productType] || selectedItem.productType}` : ""}
                        </span>
                        {selectedItem.thicknessMm && <span className="text-xs text-zinc-600">עובי {selectedItem.thicknessMm} מ״מ</span>}
                        <span className="mr-auto text-sm font-semibold text-[#8C6D1F] bg-[#C9A84C]/15 border border-[#C9A84C]/40 rounded-lg px-2.5 py-0.5">
                          סה״כ {totalArea.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} מ״ר
                        </span>
                      </div>

                      {/* The item's rows exactly as the agent built them in the
                          calculator — main row first, then any extra sizes. */}
                      <div className="overflow-x-auto rounded-xl border border-zinc-200">
                        <table className="w-full text-sm">
                          <thead className="bg-zinc-100 text-[11px] uppercase tracking-wider text-zinc-500">
                            <tr>
                              <th className="text-right font-semibold px-3 py-2">מוצר</th>
                              <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">מידות</th>
                              <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">מ״ר</th>
                              <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">כמות</th>
                              <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">מחיר למ״ר (ללא מע״מ)</th>
                              <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">מחיר ליח׳ (ללא מע״מ)</th>
                              <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">סה״כ (ללא מע״מ)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-200">
                            {rows.map((r, ri) => {
                              const qty = Number(r.line?.quantity ?? r.source?.quantity ?? 1) || 1;
                              const lineTotal = (r.result?.sellingPriceAll || 0) * ratio;
                              return (
                                <tr key={ri} className="text-zinc-800">
                                  {/* First line of the description only — the
                                      product name. The spec lines under it are
                                      shown once, in the notes box below. */}
                                  <td className="px-3 py-2">
                                    {String(r.line?.description || "").split("\n")[0].trim()
                                      || (r.isExtra
                                        ? r.source?.lineLabel || `שורה נוספת ${ri + 1}`
                                        : PRODUCT_NAMES[selectedItem.productType] || selectedItem.productType)}
                                  </td>
                                  <td className="px-3 py-2 whitespace-nowrap text-zinc-600">{dimsLabel(r.source) || "—"}</td>
                                  <td className="px-3 py-2 whitespace-nowrap text-zinc-600">
                                    {r.result?.totalArea != null
                                      ? r.result.totalArea.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-2 whitespace-nowrap">{qty}</td>
                                  {/* מחיר למ״ר ללקוח — נגזר מהמחיר החי חלקי השטח
                                      הכולל של השורה, ולכן זז יחד עם ההנחה. שורות
                                      ללא שטח (מוצרי יחידה) מציגות "—". */}
                                  <td className="px-3 py-2 whitespace-nowrap text-zinc-600">
                                    {r.result?.totalArea > 0 ? fmt(lineTotal / r.result.totalArea) : "—"}
                                  </td>
                                  <td className="px-3 py-2 whitespace-nowrap">{fmt(lineTotal / qty)}</td>
                                  <td className="px-3 py-2 whitespace-nowrap font-semibold">{fmt(lineTotal)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="bg-zinc-50 border-t border-zinc-200">
                            <tr className="text-zinc-900 font-bold">
                              <td className="px-3 py-2" colSpan={4}>סה״כ למוצר (ללא מע״מ)</td>
                              <td className="px-3 py-2 whitespace-nowrap font-normal text-zinc-600">
                                {totalArea > 0 ? `${fmt(selectedPricing.price / totalArea)} למ״ר` : ""}
                              </td>
                              <td className="px-3 py-2" />
                              <td className="px-3 py-2 whitespace-nowrap">{fmt(selectedPricing.price)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      {/* תיאור והערות גרפיקה — free text the agent typed per
                          line. Lives on line_items only, so this is the one
                          place a reviewing manager can see it. */}
                      {notes.length > 0 && (
                        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 space-y-1">
                          <div className="font-semibold text-zinc-500">תיאור והערות גרפיקה</div>
                          {notes.map((t, ni) => (
                            <p key={ni} className="whitespace-pre-wrap leading-snug">• {t}</p>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* The old עלות סך הכל / רווח תפעולי / רווח (%) tiles that used
                    to live here were removed — those same three numbers are
                    now emphasized inside the "סיכום" card below instead, and
                    this freed-up space goes to the cost/commission cards. */}
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
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <CostBreakdown result={selectedItem.result} priceRatio={selectedPricing.original > 0 ? selectedPricing.price / selectedPricing.original : 1} />
                      <CostCard title="סיכום" highlight>
                        <EmphasizedRow label="מחיר מכירה" value={fmt(selectedPricing.price)} color="green" />
                        {/* Installation can be the majority of a sticker's price
                            (e.g. ₪600 of a ₪950 line) — surfaced right under the
                            selling price so it's never mistaken for a material cost. */}
                        {selectedItem.result?.isSticker && selectedItem.result?.breakdown?.installationCost > 0 && (
                          <MiniRow label="מתוכו מחיר התקנה (ללקוח)" value={fmt(selectedItem.result.breakdown.installationCost)} />
                        )}
                        <MiniRow label="עלות גולמית" value={fmt(selectedAgg.materialTotal)} />
                        <MiniRow label="עלות תפעולית" value={fmt(operationalOnly)} />
                        <MiniRow label="עלות עמלות" value={fmt(commissionTotal)} />
                        <EmphasizedRow label="סך הכל עלות" value={fmt(selectedPricing.cost)} />
                        <EmphasizedRow label="רווח" value={fmt(selectedPricing.profit)} />
                        <EmphasizedRow label="רווח באחוזים" value={`${selectedPricing.marginPct.toFixed(1)}%`} />
                      </CostCard>
                    </div>
                  );
                })()}
                {(selectedItem.extraRows || []).filter((r) => r.result).map((row, ri) => (
                  <div key={ri}>
                    <div className="text-xs font-semibold text-zinc-500 mb-2">
                      {row.lineLabel || `שורה נוספת ${ri + 2}`}{dimsLabel(row) ? ` · ${dimsLabel(row)}` : ""}
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <CostBreakdown result={row.result} priceRatio={selectedPricing.original > 0 ? selectedPricing.price / selectedPricing.original : 1} />
                    </div>
                  </div>
                ))}

                {/* Per-item discount entry + the save button are write controls —
                    hidden in readOnly (the archive screen). */}
                {!readOnly && (
                <div className="bg-zinc-50 rounded-xl p-3">
                  {pricingMode !== "discount" ? (
                    <p className="text-xs text-zinc-500">
                      התמחור לפריט זה נקבע כרגע לפי מצב "{PRICING_MODE_LABELS[pricingMode]}" שנבחר למטה — הנחה פרטנית מושבתת כל עוד המצב הזה פעיל.
                    </p>
                  ) : (
                    <>
                      {/* All three fields operate on the pre-VAT price (agg.sellingTotal,
                          the same base VAT is later multiplied onto) — spelled out once
                          here instead of cramming "(לפני מע״מ)" into every tiny label. */}
                      <p className="text-[10px] text-zinc-500 mb-1.5">כל הנחה/מחיר כאן — לפני מע״מ</p>
                      <ItemPricingFields
                        discount={selectedDiscount}
                        onChange={setSelectedDiscount}
                        area={selectedItem.result?.totalArea}
                        originalPrice={selectedAgg.sellingTotal}
                        itemKey={selectedIndex}
                      />
                      {selectedDiscount.value ? (
                        <div className="pt-2 flex justify-between text-xs">
                          <span className="text-zinc-500">רווח: {fmt(selectedAgg.profitTotal)} ← <span className={selectedProfitAfterDiscount < 0 ? "text-red-600" : "text-zinc-700"}>{fmt(selectedProfitAfterDiscount)}</span></span>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
                )}

              </>
            ) : (
              <p className="text-zinc-500 text-sm">אין פריטים עם פירוט עלויות שמור להצעה זו.</p>
            ))}

            {/* Closing screen — whole-quote numbers, pricing mode, Morning and
                the save button. The per-product screens never show these, so a
                manager reads one product at a time and decides here. */}
            {isSummary && (
            <div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* "פירוט ההצעה" (the line-items list) was removed — it duplicated
                the פריטים sidebar (same product names) and the price/quantity
                now shown in the item header above. הערות stays — it's the
                only thing here with nowhere else to live. */}
            {quote.notes && (
              <div>
                <h3 className="text-sm font-semibold text-zinc-700 mb-2 uppercase tracking-wider">הערות</h3>
                <div className="bg-zinc-50 rounded-xl p-3 text-sm text-zinc-700">{quote.notes}</div>
              </div>
            )}

            {/* פרטי תשלום + עלות ורווח */}
            <div className="space-y-3">
              {quote.payment_type && (
                <div>
                  <h3 className="text-sm font-semibold text-zinc-700 mb-2 uppercase tracking-wider">פרטי תשלום</h3>
                  <div className="bg-zinc-50 rounded-xl p-3 text-sm">
                    <Row label="דרך תשלום" value={paymentTypeLabel(quote.payment_type)} />
                  </div>
                </div>
              )}
              {items.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-zinc-700 mb-2 uppercase tracking-wider">עלות ורווח — ההצעה כולה</h3>
                  <div className="bg-zinc-50 rounded-xl p-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-zinc-600">עלות גולמית</div>
                      <div className="font-semibold text-zinc-900 mt-0.5">{fmt(quoteAgg.materialTotal)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-600">עלות תפעולית</div>
                      <div className="font-semibold text-zinc-900 mt-0.5">{fmt(quoteOperationalTotal)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-600">רווח (₪){hasAnyDiscount && <span className="text-zinc-400"> · לפני {fmt(quoteAgg.profitTotal)}</span>}</div>
                      <div className={`font-semibold mt-0.5 ${quoteProfitLive < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmt(quoteProfitLive)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-600">רווח תפעולי (%){hasAnyDiscount && <span className="text-zinc-400"> · לפני {quoteAgg.marginPct.toFixed(1)}%</span>}</div>
                      <div className={`font-semibold mt-0.5 ${quoteMarginLive < 0 ? "text-red-600" : "text-emerald-600"}`}>{quoteMarginLive.toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* מצב תמחור — הנחה רגילה, או אחת מ-3 רובריקות תמחור קבועות שמנהל
                המכירות יכול להפעיל על כל ההזמנה בבת אחת.
                Hidden in readOnly: these controls only exist to CHANGE the price.
                The totals above still render the quote exactly as saved, because
                pricingMode/discounts are initialised from calculation_data. */}
            {!readOnly && (
            <div>
              <h3 className="text-sm font-semibold text-zinc-700 mb-2 uppercase tracking-wider">מצב תמחור</h3>
              <div className="bg-zinc-50 rounded-xl p-3 space-y-3">
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
                        pricingMode === key ? "border-[#C9A84C] bg-[#C9A84C]/15 text-[#8C6D1F] font-semibold" : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {commissionPct == null && pricingMode !== "discount" && (
                  <p className="text-xs text-amber-600">הצעה ישנה ללא נתוני עמלות שמורים — מצבי תמחור מתקדמים אינם זמינים עליה.</p>
                )}

                {pricingMode === "discount" && (
                  <>
                    <DiscountInput discount={overallDiscount} onChange={setOverallDiscount} />
                    <p className="text-xs text-zinc-500">מצטברת מעל הנחות הפריטים (לפני מע״מ) — מחושבת על הסכום שנשאר אחריהן.</p>
                  </>
                )}

                {(pricingMode === "max_sqm" || pricingMode === "min_sqm") && (
                  <p className="text-xs text-zinc-600">
                    מחשב מחדש כל פריט שיש לו מחיר/מ״ר גמיש (לוקובונד/פיויסי/פרספקס) לפי {pricingMode === "max_sqm" ? "מחיר המ״ר המקסימלי (מחיר רשימה)" : "מחיר המ״ר המינימלי לסוכן"}, ומנטרל את מחיר המינימום של המוצר. פריטים ללא גמישות מחיר נשארים במחיר שנשמר.
                  </p>
                )}

                {pricingMode === "target_margin" && (() => {
                  const sliderValue = targetMarginPct ?? Math.min(Math.max(Math.round(quoteAgg.marginPct), 0), maxTargetMarginPct);
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-600">אחוז רווח תפעולי יעד</span>
                        <span className="font-bold text-[#8C6D1F]">{sliderValue}%</span>
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
            )}

            {/* מחירים — final price, highlighted */}
            <div>
              <h3 className="text-sm font-semibold text-zinc-700 mb-2 uppercase tracking-wider">מחירים</h3>
              <div className="bg-gradient-to-br from-[#C9A84C]/15 via-[#C9A84C]/8 to-transparent border border-[#C9A84C]/30 rounded-xl p-3 space-y-2">
                {hasAnyDiscount && (
                  <Row label="לפני שינוי (ללא מע״מ)" value={fmt(quote.price_before_vat)} className="opacity-60" />
                )}
                <Row label="לפני מע״מ" value={fmt(finalSubtotal)} />
                <Row label={`מע״מ${vatPercent != null ? ` (${vatPercent}%)` : ""}`} value={fmt(finalTotalWithVat - finalSubtotal)} />
                <div className="flex justify-between items-center py-1.5 text-sm pt-2 border-t border-[#C9A84C]/20">
                  <span className="font-semibold text-[#8C6D1F]">סה״כ עם מע״מ</span>
                  <span className="font-bold text-lg text-[#8C6D1F]">{fmt(finalTotalWithVat)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <MorningSection quoteId={quote.id} readOnly={readOnly} morningDoc={morningDoc} onOpenMorningDoc={onOpenMorningDoc} />
          </div>

          {!readOnly && (
            <button
              onClick={handleSave}
              disabled={saving}
              title="שומר הצעה מתוקנת חדשה (מס׳ חדש), הכוללת את כל ההנחות שהוזנו בכל המסכים"
              className={`mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                saved ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-600" : "bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 disabled:opacity-40"
              }`}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <><CheckCircle2 className="w-4 h-4" /> נשמר!</> : <><Save className="w-4 h-4" /> שמור הצעה מתוקנת</>}
            </button>
          )}
            </div>
            )}
        </div>

        {/* Footer navigation — one step back/forward through the screens. */}
        <div className="shrink-0 border-t border-zinc-200 bg-zinc-100 px-4 py-3 flex items-center justify-between gap-3">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200 text-sm text-zinc-700 hover:border-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" /> הקודם
          </button>
          <span className="text-xs text-zinc-500">
            {isSummary ? "סיכום ומחירים" : `מוצר ${selectedIndex + 1}`} · {step + 1}/{stepCount}
          </span>
          <button
            onClick={() => setStep((s) => Math.min(stepCount - 1, s + 1))}
            disabled={step >= stepCount - 1}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200 text-sm text-zinc-700 hover:border-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {step === stepCount - 2 ? "סיכום ומחירים" : "הבא"} <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
