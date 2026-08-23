import { TrendingUp, DollarSign } from "lucide-react";

const fmt = (val) => val != null ? `₪ ${Number(val).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
const fmtN = (val, suffix = "") => val != null ? `${Number(val).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}` : "—";

function Row({ label, value, bold, muted, highlight, yellow, calc }) {
  return (
    <div className={`relative group flex justify-between items-baseline gap-4 py-1 px-2 transition-colors ${
      highlight
        ? "bg-[#C9A84C]/10 border border-[#C9A84C]/25 my-0.5"
        : yellow
        ? "bg-[#C9A84C]/8 border border-[#C9A84C]/15 my-0.5"
        : bold
        ? "mt-1 pt-2 border-t border-white/25"
        : "border-b border-white/25"
    }`}>
      <span className={`text-base font-semibold ${
        muted ? "text-zinc-200"
        : highlight ? "text-[#C9A84C]"
        : yellow ? "text-[#C9A84C]/80"
        : bold ? "text-white"
        : "text-zinc-100"
      }`}>{label}</span>
      <span className={`tabular-nums whitespace-nowrap ${highlight && bold ? "text-xl" : bold ? "text-lg" : "text-base"} ${
        bold ? "font-bold" : "font-semibold"
      } ${
        highlight ? "text-[#C9A84C]"
        : yellow ? "text-[#C9A84C]/80"
        : bold ? "text-white"
        : "text-zinc-50"
      }`}>{value}</span>
      {calc && (
        <div className="absolute bottom-full right-0 mb-1 z-50 hidden group-hover:block">
          <div className="bg-[#1A1A25] border border-white/25 text-zinc-300 text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap max-w-xs">{calc}</div>
        </div>
      )}
    </div>
  );
}

export default function SalesResults({ result, quantity, config }) {
  if (!result) {
    return <div className="flex items-center justify-center h-40 text-base text-muted-foreground">הזן מידות כדי לראות את מחיר המכירה</div>;
  }

  const q = parseInt(quantity) || 1;
  const overhead = (parseFloat(config?.operational_overhead_percent) || 0);
  const salesAgent = (parseFloat(config?.sales_agent_commission_percent) || 0);
  const marketing = (parseFloat(config?.marketing_commission_percent) || 0);

  // Some families (logo) already bake paint/spacers surcharges into sellingPricePerUnit;
  // others (kapa shelves) keep them separate. Normalize to a true base price + a single
  // addons total so "מחיר כללי" never double-counts what's already inside sellingPricePerUnit.
  const bakedInAddons = (result.paintSellingSurcharge || 0) + (result.spacersSellingSurcharge || 0);
  // Every priced kapa extra (מדפים סטנדרטיים/בעיצוב אישי, רגליים, מדף צבעוני,
  // דבק דו-צדדי) — summed rather than looked up by a single 'shelves' key,
  // which stopped matching once standard/custom shelves became their own
  // entries, and which never covered legs/colored shelf at all. Shipping is
  // order-level, not part of a product's price.
  const shelvesSellingPrice = result.isKapa
    ? (result.extrasBreakdown || [])
        .filter(ex => typeof ex.sellingCost === 'number' && ex.sellingCost > 0 && ex.key !== 'shipping')
        .reduce((sum, ex) => sum + ex.sellingCost, 0)
    : 0;
  // PVC carpet folds a waste charge (cost of the offcut × admin multiplier) into
  // sellingPricePerUnit — pulled back out here so it shows as its own addon line
  // instead of silently disappearing into "מחיר מכירה", same treatment as kapa's shelves.
  const pvcCarpetWasteCharge = result.productFamily === 'pvcCarpet' ? (result.breakdown?.wasteCharge || 0) : 0;
  const baseSellingPrice = result.sellingPricePerUnit - bakedInAddons - pvcCarpetWasteCharge;
  const addonsPrice = bakedInAddons + shelvesSellingPrice + pvcCarpetWasteCharge;
  const totalSellingPrice = baseSellingPrice + addonsPrice;
  const activeAddons = [
    result.paintSellingSurcharge > 0 && 'צביעה',
    result.spacersSellingSurcharge > 0 && 'ספייסרים',
    shelvesSellingPrice > 0 && 'מדפים',
    pvcCarpetWasteCharge > 0 && 'חיוב פחת',
  ].filter(Boolean);

  // Gross profit/margin — material cost only, vs. the full price incl. addons
  // (what the product actually leaves after just the raw materials it consumes).
  const grossProfit = totalSellingPrice - result.rawMaterialCost;
  const grossMarginPct = totalSellingPrice > 0 ? (grossProfit / totalSellingPrice) * 100 : 0;

  // kapa/rollup compute their raw material/labor/overhead/commission costs as a
  // batch total already (quantity baked in upstream, then divided back down for
  // totalCostPerUnit) — every other family computes them per single unit and only
  // multiplies by quantity at the very end. Multiplying by q a second time here
  // would double-count kapa/rollup, so only the families that need it get it.
  const subFieldsAlreadyBatchTotal = result.isKapa || result.productFamily === 'rollup';
  const subMult = subFieldsAlreadyBatchTotal ? 1 : q;

  const baseSellingPriceCalc = result.productFamily === 'lokobond'
    ? (result.breakdown.matchedAreaTierPricePerSqm != null
        ? `מדרגת שטח (מ-${result.breakdown.matchedAreaTierAreaFrom} מ"ר): ${result.breakdown.matchedAreaTierPricePerSqm} ₪/מ"ר × ${result.area} מ"ר`
        : `${result.breakdown.flatTierPricePerSqm ?? "?"} ₪/מ"ר × ${result.area} מ"ר (מינימום ${result.breakdown.flatTierMinPrice ?? 0} ₪)`)
    : result.productFamily === 'pvcCarpet'
    ? `${result.effectivePricePerSqm ?? "?"} ₪/מ"ר × ${result.area} מ"ר (מחיר גליל בפועל, ללא חיוב פחת)`
    : "מחיר בסיס, ללא תוספות";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

      <div className="bg-[#111118] rounded-2xl border border-white/20 p-4 space-y-0">
         <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/25">
           <DollarSign className="w-4 h-4 text-emerald-400" />
           <span className="text-lg font-semibold text-zinc-100">סיכום עלויות{q > 1 ? ` — סה"כ עסקה (×${q})` : ""}</span>
         </div>
         <Row label="עלות גלם" value={fmt(result.rawMaterialCost * subMult)} muted calc="סך כל חומרי הגלם וההפסד בתהליך" />
         <Row label="עלות לייבור" value={fmt(result.laborCost * subMult)} muted calc="סה״ך זמני עבודה בהנחת עלות שעתית" />
         {result.isSticker && result.breakdown.stickerInstallCost > 0 && <Row label="עלות התקנה" value={fmt(result.breakdown.stickerInstallCost * subMult)} muted calc={`עלות התקנה למ"ר × שטח, רצפת מינימום`} />}
         <Row label="עלות תקורות" value={fmt(result.overheadCost * subMult)} muted calc={`(עלות גלם + לייבור${result.isSticker ? ' + התקנה' : ''}) × ${overhead}%`} />
         {result.breakdown.salesAgentCommissionCost > 0 && <Row label="עמלת סוכן" value={fmt(result.breakdown.salesAgentCommissionCost * subMult)} muted calc={`מחיר מכירה × ${salesAgent}%`} />}
         {result.breakdown.marketingCommissionCost > 0 && <Row label="עמלת שיווק" value={fmt(result.breakdown.marketingCommissionCost * subMult)} muted calc={`מחיר מכירה × ${marketing}%`} />}
         <Row label="עלות כוללת" value={fmt(result.totalCostPerUnit * q)} bold calc={q > 1 ? `₪${fmtN(result.totalCostPerUnit)} ליחידה × ${q}` : "גלם + לייבור + תקורות + עמלות"} />
         {q > 1 && <Row label={`מחיר מכירה (×${q})`} value={fmt(result.sellingPriceAll)} bold />}
       </div>

      <div className="bg-[#111118] rounded-2xl border border-white/20 p-4 space-y-0">
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/25">
          <TrendingUp className="w-4 h-4 text-blue-400" />
          <span className="text-lg font-semibold text-zinc-100">רווחיות{q > 1 ? ` — סה"כ עסקה (×${q})` : ""}</span>
        </div>
        <Row
          label="מחיר מכירה"
          value={fmt(baseSellingPrice * q)}
          bold
          calc={q > 1 ? `₪${fmtN(baseSellingPrice)} ליחידה × ${q} = ${fmtN(baseSellingPrice * q)}` : baseSellingPriceCalc}
        />
        {/* Label names the actual addon(s) instead of a generic "תוספות" whenever
            there's exactly one kind active — e.g. pvc carpet's waste charge
            should read "חיוב פחת", not an unlabeled catch-all, so it's obvious
            at a glance why the price is above the plain מ"ר rate. */}
        <Row
          label={activeAddons.length === 1 ? activeAddons[0] : "מחיר תוספות"}
          value={fmt(addonsPrice * subMult)}
          muted={!addonsPrice}
          yellow={addonsPrice > 0}
          calc={activeAddons.length ? activeAddons.join(' + ') : 'ללא תוספות'}
        />
        <Row label="מחיר כללי" value={fmt(baseSellingPrice * q + addonsPrice * subMult)} highlight bold calc={q > 1 ? `₪${fmtN(totalSellingPrice)} ליחידה × ${q}` : "מחיר מכירה + מחיר תוספות"} />
        <Row label="רווח" value={fmt(result.profitPerUnit * q)} muted calc={q > 1 ? `₪${fmtN(result.profitPerUnit)} ליחידה × ${q}` : "מחיר מכירה - עלות כוללת"} />
        <Row label="אחוז רווח גולמי" value={fmtN(grossMarginPct, "%")} bold calc="(מחיר כללי - עלות גלם) ÷ מחיר כללי — חומרי גלם בלבד" />
        <Row label="אחוז רווח תפעולי" value={fmtN(result.profitMarginPct, "%")} bold calc="(רווח ÷ מחיר מכירה) × 100 — כולל לייבור/תקורות/עמלות" />
      </div>

    </div>
  );
}