import { useState, useEffect, useMemo } from "react";
import CalculatorForm, { categoryOf, Field, UNDERLINE, UNDERLINE_CENTER, READONLY } from "./CalculatorForm";
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

export default function CalculatorTab({ config, priceTiers, stickerPriceTiers, paintSurchargeTiers = [], kapaPriceTiers = [], rollupPriceTiers = [], lokobondAreaTiers = [], glassPriceTiers = [], defaultForm, initialFormData, allowedProducts, onPriceChange, productCategory, onFormDataChange, enforceMinimumPrice = true, paymentKey = "cash", installmentCount = 2, orderAreaOverride = null }) {
  // initialFormData is the parent's already-known state for this item (e.g.
  // re-expanding a product the agent previously locked/collapsed at the order
  // level). Without seeding from it, this component would remount from a
  // blank defaultForm and silently discard everything the agent had entered —
  // every useState below must be seeded the same way for that reason.
  const [form, setForm] = useState(() => initialFormData || defaultForm);
  const [extraRows, setExtraRows] = useState(() => initialFormData?.extraRows || []);

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
        </div>
        <CalculatorForm
          values={form}
          onChange={(newForm) => {
            setForm(newForm);
            if (onFormDataChange) onFormDataChange(newForm);
          }}
          allowedProducts={allowedProducts}
          priceTiers={priceTiers}
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
      </div>

      {/* Extra size/quantity rows — same SKU as above, different size and/or
          quantity (e.g. 10 PVC signs in different sizes for one client). */}
      {canAddExtraRows && extraRows.map((row, i) => {
        const rowResult = extraRowResults[i];
        const rowPrice = rowResult ? rowResult.sellingPriceAll : null;
        return (
          <div key={row.id} className="border-t-2 border-dashed border-slate-300 pt-5 mt-2 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-amber-600 uppercase tracking-wider">מידה {i + 2}</span>
              <button
                onClick={() => setExtraRows(prev => prev.filter(r => r.id !== row.id))}
                className="flex items-center gap-1 text-sm text-red-400 hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> הסר
              </button>
            </div>
            {/* Same Morning-style single row + underline field styling as מידה 1 above. */}
            <div className="flex flex-wrap items-start gap-x-4 gap-y-5">
              <Field label="אורך (מ')" width="w-24" required>
                <input
                  type="number" step="0.01" min="0" dir="ltr"
                  value={row.widthM}
                  onChange={(e) => setExtraRows(prev => prev.map(r => r.id === row.id ? { ...r, widthM: e.target.value } : r))}
                  placeholder="0.00"
                  className={`${UNDERLINE_CENTER} w-full`}
                />
              </Field>
              <Field label="גובה (מ')" width="w-24" required>
                <input
                  type="number" step="0.01" min="0" dir="ltr"
                  value={row.heightM}
                  onChange={(e) => setExtraRows(prev => prev.map(r => r.id === row.id ? { ...r, heightM: e.target.value } : r))}
                  placeholder="0.00"
                  className={`${UNDERLINE_CENTER} w-full`}
                />
              </Field>
              <Field label="כמות" width="w-20">
                <input
                  type="number" step="1" min="1" dir="ltr"
                  value={row.quantity}
                  onChange={(e) => setExtraRows(prev => prev.map(r => r.id === row.id ? { ...r, quantity: e.target.value } : r))}
                  placeholder="1"
                  className={`${UNDERLINE_CENTER} w-full`}
                />
              </Field>
              {showElementsForRows && (
                <Field label="מספר אלמנטים" width="w-28">
                  <input
                    type="number" step="1" min="0" dir="ltr"
                    value={row.elements}
                    onChange={(e) => setExtraRows(prev => prev.map(r => r.id === row.id ? { ...r, elements: e.target.value } : r))}
                    placeholder={form.elements || "1"}
                    className={`${UNDERLINE_CENTER} w-full`}
                  />
                </Field>
              )}
              <Field label="תיאור / מיקום" width="w-64">
                <input
                  type="text"
                  value={row.lineLabel}
                  onChange={(e) => setExtraRows(prev => prev.map(r => r.id === row.id ? { ...r, lineLabel: e.target.value } : r))}
                  placeholder="לדוגמה: קיר 2, ויטרינה שמאל..."
                  className={`${UNDERLINE} w-full`}
                />
              </Field>
              {rowPrice != null && (
                <Field label="מחיר שורה (ללא מע״מ)" width="w-32">
                  <div className={`${READONLY} font-bold text-amber-600`}>{fmt(rowPrice)}</div>
                </Field>
              )}
            </div>
          </div>
        );
      })}

      {/* Add another size/quantity of the same SKU */}
      {canAddExtraRows && result && (
        <button
          onClick={() => {
            setExtraRows(prev => [...prev, { id: nextRowId++, lineLabel: "", widthM: "", heightM: "", quantity: "1", elements: "" }]);
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