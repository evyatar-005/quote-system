import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, BarChart3 } from "lucide-react";
import { calculateLightbox } from "./useCalculator";

const fmt = (val) =>
  val != null
    ? `₪ ${Number(val).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";

function PriceCard({ label, value, highlight }) {
  return (
    <div className={`rounded-2xl border p-5 text-center ${highlight
      ? "bg-gradient-to-b from-[#C9A84C]/10 to-[#C9A84C]/5 border-[#C9A84C]/30"
      : "bg-[#111118] border-white/20"}`}>
      <div className="text-sm text-zinc-400 mb-2 font-semibold uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold ${highlight ? "text-[#C9A84C]" : "text-white"}`}>{value}</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between items-center py-1.5 text-sm border-b border-white/20 last:border-b-0">
      <span className="font-semibold text-zinc-300">{label}</span>
      <span className="text-sm font-semibold text-zinc-100">{value}</span>
    </div>
  );
}

// Admin-only price preview (rendered from SalesPriceTable) — always priced at
// the cash rate. The agent-facing save/issue flow for this product family is
// MultiProductCalculator; this component no longer has one of its own (the
// dead SaveQuoteForm branch that used to live here was removed).
export default function LightboxCalculator({ config }) {
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTier, setSelectedTier] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const paymentKey = "cash";
  const [delivery, setDelivery] = useState("pickup");

  useEffect(() => {
    base44.entities.LightboxSizeTier.list("width_cm", 100).then((data) => {
      setTiers(data);
      if (data.length > 0) setSelectedTier(data[0]);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-[#C9A84C]" />
      </div>
    );
  }

  if (tiers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <BarChart3 className="w-8 h-8 text-zinc-600" />
        <p className="text-base text-zinc-500">לא הוגדרו מידות לארגז מואר. הגדר מידות בממשק המנהל.</p>
      </div>
    );
  }

  const result = calculateLightbox(selectedTier, config, quantity, delivery);
  // Single VAT source for this whole document — admin config, not a hardcoded rate.
  const vatMultiplier = 1 + (parseFloat(config?.vat_percent) || 18) / 100;
  const basePrice = result ? result.priceWithVat : 0;
  const getPrice = () => basePrice;

  return (
    <div className="space-y-5">
      {/* Size Selector */}
      <div className="bg-[#111118] border border-white/20 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-4">בחר מידה</h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-4">
          {tiers.map((tier) => (
            <button
              key={tier.id}
              onClick={() => setSelectedTier(tier)}
              className={`p-3 rounded-xl border text-center transition-all ${
                selectedTier?.id === tier.id
                  ? "border-[#C9A84C]/40 bg-[#C9A84C]/5 text-[#C9A84C]"
                  : "border-white/20 bg-[#16161F] text-zinc-400 hover:border-white/25"
              }`}
            >
              <div className="text-base font-semibold">{tier.size_label}</div>
              <div className="text-sm text-zinc-600 mt-0.5">{tier.width_cm}×{tier.height_cm}</div>
            </button>
          ))}
        </div>

        {/* Quantity */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-base text-zinc-400">כמות:</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setQuantity(q => Math.max(1, q - 1))} className="w-8 h-8 rounded-lg bg-[#16161F] border border-white/20 text-white hover:bg-white/5">−</button>
            <span className="w-8 text-center text-white font-semibold">{quantity}</span>
            <button onClick={() => setQuantity(q => q + 1)} className="w-8 h-8 rounded-lg bg-[#16161F] border border-white/20 text-white hover:bg-white/5">+</button>
          </div>
        </div>

        {/* Delivery */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-base text-zinc-400">אספקה:</span>
          <div className="flex items-center gap-2">
            {[["shipping", "משלוח"], ["pickup", "איסוף עצמי"]].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setDelivery(val)}
                className={`px-3 h-8 rounded-lg border text-sm font-semibold transition-all ${
                  delivery === val ? "border-[#C9A84C]/50 bg-[#C9A84C]/10 text-[#C9A84C]" : "border-white/20 bg-[#16161F] text-zinc-400 hover:border-white/25"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>


      </div>

      {result && (
        <>
          {/* Price Cards */}
          <div className="grid grid-cols-2 gap-3">
            <PriceCard label='מחיר ללא מע"מ (הנחת מזומן)' value={fmt(getPrice() / vatMultiplier)} />
            <PriceCard label='מחיר עם מע"מ (הנחת מזומן)' value={fmt(getPrice())} highlight />
          </div>

          {/* Cost Breakdown */}
          <div className="bg-[#111118] border border-white/20 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-4">פירוט עלויות</h3>
            <div className="space-y-1">
              <Row label="מסגרת" value={fmt(result.frameCost)} />
              <Row label="לדים" value={fmt(result.ledCost)} />
              <Row label="שנאי" value={fmt(result.transformerCost)} />
              <Row label="פרספקס חזית (3מ״מ)" value={fmt(result.perspexFrontCost)} />
              <Row label="עבודה" value={fmt(result.laborCost)} />
              <Row label="תקורה" value={fmt(result.overheadCost)} />
              <Row label="עמלות" value={fmt(result.salesCommission + result.marketingCommission)} />
              <div className="border-t border-white/25 mt-2 pt-2">
                <Row label="עלות כוללת" value={fmt(result.totalCost)} />
                <Row label="מחיר מכירה (ללא מע״מ)" value={fmt(result.sellingPriceAll)} />
                <Row label="רווח" value={fmt(result.profitPerUnit * quantity)} />
                <Row label="שולי רווח" value={`${result.profitMarginPct.toFixed(1)}%`} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}