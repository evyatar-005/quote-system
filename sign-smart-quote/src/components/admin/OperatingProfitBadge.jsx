// Small operating-profit % badge, shared by every admin price table so the
// figure looks identical everywhere. `pct` is the engine's profitMarginPct
// (selling price − all costs incl. labor, overhead, sales-agent & marketing
// commissions, ÷ selling price). Green when positive, red when negative.
export default function OperatingProfitBadge({ pct, size = "md" }) {
  if (pct == null || !Number.isFinite(pct)) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const positive = pct >= 0;
  const dims = size === "sm" ? "px-2 h-7 text-sm" : "px-2.5 h-8 text-base";
  return (
    <div
      className={`inline-flex items-center justify-center rounded-md border font-semibold ${dims} ${
        positive ? "bg-emerald-50 border-emerald-200 text-emerald-600" : "bg-red-50 border-red-200 text-red-500"
      }`}
      title="רווח תפעולי — מחיר המכירה בניכוי כל העלויות: חומר גלם, עבודה, תקורה, עמלת סוכן ועמלת שיווק"
    >
      {pct.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%
    </div>
  );
}
