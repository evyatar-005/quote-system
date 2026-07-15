import { useState, useEffect, useMemo } from "react";
import CalculatorForm, { categoryOf, PRODUCT_NAMES, PRODUCT_CODES, productImage } from "./CalculatorForm";
import { calculate } from "./useCalculator";
import CostResults from "./CostResults";
import SalesResults from "./SalesResults";
import { Plus, Trash2 } from "lucide-react";

const fmt = (val) =>
  val != null
    ? `₪ ${Number(val).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";

const STICKER_TYPES = ["vinyl_sticker", "texture_sticker"];
// Families priced by width/height — kapa/rollup/glass are fixed catalog rows
// (no dimensions), so "extra size" rows don't make sense for them.
const DIMENSION_FAMILIES = ["logo", "sticker", "lokobond", "foamex", "perspexBoard"];

let nextRowId = 1;

export default function CalculatorTab({ config, priceTiers, stickerPriceTiers, paintSurchargeTiers = [], kapaPriceTiers = [], rollupPriceTiers = [], lokobondAreaTiers = [], glassPriceTiers = [], defaultForm, allowedProducts, onPriceChange, productCategory, onFormDataChange, enforceMinimumPrice = true, paymentKey = "cash", installmentCount = 2, orderAreaOverride = null }) {
  const [form, setForm] = useState(defaultForm);
  const [extraRows, setExtraRows] = useState([]);
  // Locks the base "מידה 1" fields once another size row is added — same flow
  // as locking a whole product card at the order level: keeps the card from
  // reading as several open editable rows at once. "ערוך" reopens it.
  const [baseLocked, setBaseLocked] = useState(false);

  const isSticker = STICKER_TYPES.includes(form.productType);
  // Same-family "extra size" rows — lets an agent add another size/quantity of
  // the SAME sub-product (e.g. 10 PVC signs, each a different size) inside this
  // one product card, instead of re-picking the SKU from scratch every time.
  const canAddExtraRows = form.productType && DIMENSION_FAMILIES.includes(categoryOf(form.productType));
  const showElementsForRows = ["logo", "foamex", "perspexBoard"].includes(categoryOf(form.productType));

  // Memoize the calculated result so its identity stays stable across renders that
  // don't change the inputs (e.g. the parent passing fresh inline callbacks). A new
  // object every render would re-trigger the effect below → setState in the parent →
  // re-render → infinite loop ("Maximum update depth exceeded").
  const result = useMemo(() => {
    if (form.productType === "free_product") {
      // מוצר חופשי — אין מק"ט ואין מידות: המחיר מוזן ידנית ע"י הסוכן (ליחידה, ללא מע"מ).
      const unitExVat = parseFloat(form.freePrice) || 0;
      if (!(unitExVat > 0)) return null;
      const qty = parseInt(form.quantity) || 1;
      const vat = 1 + (parseFloat(config?.vat_percent) || 18) / 100;
      const r2 = (n) => Math.round(n * 100) / 100;
      return {
        isFreeProduct: true,
        isSticker: false,
        productFamily: "free",
        sellingPricePerUnit: r2(unitExVat),
        sellingPriceAll: r2(unitExVat * qty),
        priceWithVat: r2(unitExVat * qty * vat),
      };
    }
    try {
      return config ? calculate({ config, priceTiers, stickerPriceTiers, paintSurchargeTiers, kapaPriceTiers, rollupPriceTiers, lokobondAreaTiers, glassPriceTiers, ...form, enforceMinimumPrice, orderAreaOverride }) : null;
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [config, priceTiers, stickerPriceTiers, paintSurchargeTiers, kapaPriceTiers, rollupPriceTiers, lokobondAreaTiers, glassPriceTiers, form, enforceMinimumPrice, orderAreaOverride]);

  // Calculate extra rows results (same memoization rationale as `result` above).
  // Each row carries its OWN quantity — a different size can need a different
  // count (e.g. 3 units of size A, 5 of size B), so it's computed as its own
  // independent line, not scaled off the main row's quantity.
  const extraRowResults = useMemo(() => extraRows.map(row => {
    try {
      return config ? calculate({
        config, priceTiers, stickerPriceTiers, paintSurchargeTiers, kapaPriceTiers, rollupPriceTiers, lokobondAreaTiers, glassPriceTiers,
        ...form,
        widthM: row.widthM, heightM: row.heightM, quantity: row.quantity || "1",
        elements: row.elements || "", lineLabel: row.lineLabel,
        enforceMinimumPrice, orderAreaOverride,
      }) : null;
    } catch { return null; }
  }), [config, priceTiers, stickerPriceTiers, paintSurchargeTiers, kapaPriceTiers, rollupPriceTiers, lokobondAreaTiers, glassPriceTiers, form, extraRows, enforceMinimumPrice, orderAreaOverride]);

  const q = parseInt(form.quantity) || 1;
  // Each product reports its CASH price (incl. VAT). The payment surcharge is
  // applied once, at the ORDER level (MultiProductCalculator), so it also covers
  // the shipping. paymentKey/installmentCount arrive as props only for display.
  const priceWithVat = result ? result.priceWithVat / q : 0;

  // What one extra row contributes to the order total, in CASH — already the
  // full total for that row's own quantity (its own `calculate()` call above),
  // so no further scaling here. The order-level payment multiplier is applied
  // later, in MultiProductCalculator.
  const rowCashPrice = (r) => (r ? r.priceWithVat : 0);

  const extraTotal = extraRowResults.reduce((sum, r) => sum + rowCashPrice(r), 0);

  useEffect(() => {
    if (onPriceChange) {
      // Cash line total: per-unit × quantity, plus any extra sticker rows.
      onPriceChange(result ? priceWithVat * q + extraTotal : 0);
    }
    if (onFormDataChange) {
      // `result` carries the full cost/profit breakdown for this line — saved
      // verbatim into calculation_data. priceWithPayment holds the CASH row
      // amount; the order applies the payment surcharge on top.
      onFormDataChange({ ...form, result, extraRows: extraRows.map((row, i) => ({ ...row, result: extraRowResults[i], priceWithPayment: rowCashPrice(extraRowResults[i]) })) });
    }
  }, [result, form, extraRows, extraTotal]);

  return (
    <div className="space-y-5">
      {/* Form section — flat (no boxed rubric); sits inside the outer white page card */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
            פרטי המוצר{extraRows.length > 0 ? " — מידה 1" : ""}
          </h3>
          {baseLocked && (
            <button
              onClick={() => setBaseLocked(false)}
              className="text-sm text-slate-500 hover:text-amber-600 transition-colors px-2 py-1 rounded-lg hover:bg-amber-50"
            >
              ערוך
            </button>
          )}
        </div>
        {baseLocked ? (() => {
          const isFree = form.productType === "free_product";
          const img = form.productType ? productImage(form.productType) : null;
          const sku = form.productType ? PRODUCT_CODES[form.productType] : null;
          const w = parseFloat(form.widthM) || 0;
          const h = parseFloat(form.heightM) || 0;
          const unitArea = w > 0 && h > 0 ? w * h : null;
          const totalArea = unitArea != null ? unitArea * q : null;
          return (
            <div className="flex items-center justify-between gap-4 border-2 border-slate-200 rounded-2xl px-4 py-3.5 bg-white">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {img && !isFree && (
                  <img src={img} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0 border border-slate-200" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-700 truncate">
                      {isFree ? (form.lineLabel || "מוצר חופשי") : (PRODUCT_NAMES[form.productType] || form.productType)}
                    </span>
                    {sku && <span className="text-xs font-mono text-slate-400 shrink-0">מק"ט {sku}</span>}
                  </div>
                  {unitArea != null && (
                    <div className="text-base font-semibold text-slate-600 mt-0.5">
                      {w}×{h} מ' <span className="text-slate-300 mx-1">·</span> כמות {form.quantity || 1}
                      <span className="text-slate-300 mx-1">·</span>
                      סה"כ {totalArea.toFixed(2)} מ"ר
                    </div>
                  )}
                </div>
              </div>
              <span className="text-base font-bold text-amber-600 shrink-0">{result ? fmt(priceWithVat * q) : "—"}</span>
            </div>
          );
        })() : (
        <CalculatorForm
          values={form}
          onChange={(newForm) => {
            setForm(newForm);
            if (onFormDataChange) onFormDataChange(newForm);
          }}
          allowedProducts={allowedProducts}
          kapaPriceTiers={kapaPriceTiers}
          rollupPriceTiers={rollupPriceTiers}
          glassPriceTiers={glassPriceTiers}
          basePrice={result ? (result.sellingPricePerUnit - (result.paintSellingSurcharge || 0)) : null}
          unitPriceExVat={result ? result.sellingPricePerUnit : null}
          priceRangeMin={result ? result.priceRangeMin : null}
          priceRangeMax={result ? result.priceRangeMax : null}
          paymentKey={paymentKey}
          installmentCount={installmentCount}
          config={config}
          extrasInfo={(() => {
            if (!result?.extrasBreakdown) return {};
            const info = {};
            result.extrasBreakdown.forEach(e => {
              if ((e.key === 'paint_single' || e.key === 'paint_double') && result.paintSellingSurcharge > 0) {
                info[e.key] = result.paintSellingSurcharge;
              } else if (e.type === 'material' && e.sellingCost != null) {
                info[e.key] = e.sellingCost;
              }
            });
            return info;
          })()}
        />
        )}
      </div>

      {/* Extra size/quantity rows — same SKU as above, different size and/or
          quantity (e.g. 10 PVC signs in different sizes for one client). */}
      {canAddExtraRows && extraRows.map((row, i) => {
        const rowResult = extraRowResults[i];
        const rowPrice = rowResult ? rowCashPrice(rowResult) : null;
        return (
          <div key={row.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider">מידה {i + 2}</span>
              <button
                onClick={() => setExtraRows(prev => prev.filter(r => r.id !== row.id))}
                className="flex items-center gap-1 text-sm text-red-400 hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> הסר
              </button>
            </div>
            <div className="space-y-1.5">
              <label className="text-base font-semibold text-slate-700">תיאור / מיקום</label>
              <input
                type="text"
                value={row.lineLabel}
                onChange={(e) => setExtraRows(prev => prev.map(r => r.id === row.id ? { ...r, lineLabel: e.target.value } : r))}
                placeholder="לדוגמה: קיר 2, ויטרינה שמאל..."
                className="flex h-10 w-full rounded-md border border-black bg-white px-3 py-1 text-base placeholder:text-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-base font-semibold text-slate-700">אורך (מ') <span className="text-red-500">*</span></label>
                <input
                  type="number" step="0.01" min="0" dir="ltr"
                  value={row.widthM}
                  onChange={(e) => setExtraRows(prev => prev.map(r => r.id === row.id ? { ...r, widthM: e.target.value } : r))}
                  placeholder="0.00"
                  className="flex h-10 w-full rounded-md border border-black bg-white px-3 py-1 text-base placeholder:text-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-base font-semibold text-slate-700">גובה (מ') <span className="text-red-500">*</span></label>
                <input
                  type="number" step="0.01" min="0" dir="ltr"
                  value={row.heightM}
                  onChange={(e) => setExtraRows(prev => prev.map(r => r.id === row.id ? { ...r, heightM: e.target.value } : r))}
                  placeholder="0.00"
                  className="flex h-10 w-full rounded-md border border-black bg-white px-3 py-1 text-base placeholder:text-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-base font-semibold text-slate-700">כמות</label>
                <input
                  type="number" step="1" min="1" dir="ltr"
                  value={row.quantity}
                  onChange={(e) => setExtraRows(prev => prev.map(r => r.id === row.id ? { ...r, quantity: e.target.value } : r))}
                  placeholder="1"
                  className="flex h-10 w-full rounded-md border border-black bg-white px-3 py-1 text-base placeholder:text-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>
            {showElementsForRows && (
              <div className="space-y-1.5">
                <label className="text-base font-semibold text-slate-700">מספר אלמנטים</label>
                <input
                  type="number" step="1" min="0" dir="ltr"
                  value={row.elements}
                  onChange={(e) => setExtraRows(prev => prev.map(r => r.id === row.id ? { ...r, elements: e.target.value } : r))}
                  placeholder={form.elements || "1"}
                  className="flex h-10 w-full rounded-md border border-black bg-white px-3 py-1 text-base placeholder:text-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            )}
            {rowPrice && (
              <div className="flex justify-between items-center text-base bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                <span className="text-slate-500">מחיר שורה זו (כולל מע״מ, לכמות שהוזנה)</span>
                <span className="font-bold text-amber-600 text-lg">{fmt(rowPrice)}</span>
              </div>
            )}
          </div>
        );
      })}

      {/* Add another size/quantity of the same SKU */}
      {canAddExtraRows && result && (
        <button
          onClick={() => {
            setExtraRows(prev => [...prev, { id: nextRowId++, lineLabel: "", widthM: "", heightM: "", quantity: "1", elements: "" }]);
            setBaseLocked(true);
          }}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-dashed border-black text-base font-semibold text-slate-500 hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-all"
        >
          <Plus className="w-4 h-4" />
          הוסף מידה נוספת לאותו מוצר
        </button>
      )}


    </div>
  );
}