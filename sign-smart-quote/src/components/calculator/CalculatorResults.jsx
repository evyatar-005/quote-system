import { TrendingUp, Package, Wrench, BarChart3, DollarSign, Receipt } from "lucide-react";

const fmt = (val) => val != null ? `₪ ${Number(val).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
const fmtN = (val, suffix = "") => val != null ? `${Number(val).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}` : "—";

function ResultRow({ label, value, highlight, muted, bold }) {
  return (
    <div className={`flex justify-between items-center py-2 px-3 rounded-lg ${highlight ? "bg-primary/8 border border-primary/20" : muted ? "" : "border-b border-border/30"}`}>
      <span className={`text-sm font-semibold ${muted ? "text-slate-600" : "text-foreground"}`}>{label}</span>
      <span className={`${highlight && bold ? "text-xl" : bold ? "text-base" : "text-sm"} font-${bold ? "bold" : "semibold"} ${highlight ? "text-primary" : ""}`}>{value}</span>
    </div>
  );
}

export default function CalculatorResults({ result, quantity }) {
  if (!result) {
    return (
      <div className="flex items-center justify-center h-40 text-base text-muted-foreground">
        הזן מידות כדי לראות את חישוב המחיר
      </div>
    );
  }

  const q = parseInt(quantity) || 1;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

      {/* Dimensions */}
      <div className="bg-card rounded-xl border border-black p-4 space-y-1">
        <div className="flex items-center gap-2 mb-3">
          <Package className="w-4 h-4 text-blue-500" />
          <span className="text-base font-semibold">שטח ומידות</span>
        </div>
        <ResultRow label="שטח ליחידה" value={fmtN(result.area, " מ²")} muted />
        <ResultRow label={`שטח כולל (x${q})`} value={fmtN(result.totalArea, " מ²")} muted />
      </div>

      {/* Raw material */}
      <div className="bg-card rounded-xl border border-black p-4 space-y-1">
        <div className="flex items-center gap-2 mb-3">
          <Package className="w-4 h-4 text-blue-600" />
          <span className="text-base font-semibold">עלות גלם (ליחידה)</span>
        </div>
        <ResultRow label="לוח PVC" value={fmt(result.breakdown.boardCost)} muted />
        <ResultRow label="דיו" value={fmt(result.breakdown.inkCost)} muted />
        <ResultRow label="עלות גלם כוללת" value={fmt(result.rawMaterialCost)} bold />
      </div>

      {/* Labor */}
      <div className="bg-card rounded-xl border border-black p-4 space-y-1">
        <div className="flex items-center gap-2 mb-3">
          <Wrench className="w-4 h-4 text-orange-500" />
          <span className="text-base font-semibold">עלות עבודה (ליחידה)</span>
        </div>
        <ResultRow label="הדפסה" value={fmt(result.breakdown.printLaborCost)} muted />
        <ResultRow label="חיתוך" value={fmt(result.breakdown.laserLaborCost)} muted />
        <ResultRow label="אריזה" value={fmt(result.breakdown.packagingLaborCost)} muted />
        {result.breakdown.paintRoomCost > 0 && <ResultRow label="חדר צבע" value={fmt(result.breakdown.paintRoomCost)} muted />}
        <ResultRow label="עלות עבודה כוללת" value={fmt(result.laborCost)} bold />
      </div>

      {/* Overhead */}
      <div className="bg-card rounded-xl border border-black p-4 space-y-1">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-purple-500" />
          <span className="text-base font-semibold">תקורה תפעולית</span>
        </div>
        <ResultRow label="עלות תקורה" value={fmt(result.overheadCost)} muted />
        <ResultRow label="עלות כוללת ליחידה" value={fmt(result.totalCostPerUnit)} bold />
        {q > 1 && <ResultRow label={`עלות כוללת (x${q})`} value={fmt(result.totalCostAll)} bold />}
      </div>

      {/* Profit */}
      <div className="bg-card rounded-xl border border-black p-4 space-y-1">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-emerald-500" />
          <span className="text-base font-semibold">מחיר מכירה ורווח</span>
        </div>
        <ResultRow label="מחיר מכירה ליחידה" value={fmt(result.sellingPricePerUnit)} bold />
        {q > 1 && <ResultRow label={`מחיר מכירה (x${q})`} value={fmt(result.sellingPriceAll)} muted />}
        <ResultRow label="רווח ליחידה" value={fmt(result.profitPerUnit)} muted />
        <ResultRow label="רווחיות" value={fmtN(result.profitMarginPct, "%")} muted />
      </div>

      {/* Final price with VAT */}
      <div className="bg-primary/5 rounded-xl border-2 border-primary/30 p-4 space-y-1">
        <div className="flex items-center gap-2 mb-3">
          <Receipt className="w-4 h-4 text-primary" />
          <span className="text-base font-semibold text-primary">מחיר סופי ללקוח</span>
        </div>
        <ResultRow label="לפני מע׳׳מ" value={fmt(result.sellingPriceAll)} muted />
        <ResultRow label='כולל מע"מ (18%)' value={fmt(result.priceWithVat)} highlight bold />
      </div>

    </div>
  );
}