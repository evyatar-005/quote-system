import { useState, useEffect, useMemo } from "react";
import CalculatorForm, { categoryOf, Field, UNDERLINE, UNDERLINE_CENTER, READONLY, PRODUCT_NAMES, PRODUCT_CODES, productImage } from "./CalculatorForm";
import { calculate } from "./useCalculator";
import CostResults from "./CostResults";
import SalesResults from "./SalesResults";
import { Plus, Trash2, Pencil } from "lucide-react";

const round2 = (n) => Math.round(n * 100) / 100;

const fmt = (val) =>
  val != null
    ? `₪ ${Number(val).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";

const STICKER_TYPES = ["vinyl_sticker", "texture_sticker"];
// Families priced by width/height — kapa/rollup/glass are fixed catalog rows
// (no dimensions), so "extra size" rows don't make sense for them.
const DIMENSION_FAMILIES = ["logo", "sticker", "lokobond", "foamex", "perspexBoard"];

let nextRowId = 1;

export default function CalculatorTab({ config, priceTiers, stickerPriceTiers, paintSurchargeTiers = [], kapaPriceTiers = [], rollupPriceTiers = [], lokobondAreaTiers = [], glassPriceTiers = [], numberPriceTiers = [], graphicsPriceTiers = [], vistaSizes = [], defaultForm, initialFormData, allowedProducts, onPriceChange, productCategory, onFormDataChange, enforceMinimumPrice = true, paymentKey = "cash", installmentCount = 2, orderAreaOverride = null }) {
  // initialFormData is the parent's already-known state for this item (e.g.
  // re-expanding a product the agent previously locked/collapsed at the order
  // level). Without seeding from it, this component would remount from a
  // blank defaultForm and silently discard everything the agent had entered —
  // every useState below must be seeded the same way for that reason.
  const [form, setForm] = useState(() => initialFormData || defaultForm);
  const [extraRows, setExtraRows] = useState(() => initialFormData?.extraRows || []);
  // Mirrors the order-level lockedIds pattern (MultiProductCalculator): once
  // there's more than one מידה row, every row except the one being actively
  // edited collapses to a compact summary so the form doesn't just keep
  // growing downward — "add another size" previously left every prior row
  // fully expanded, unlike adding a whole new product (which already collapsed).
  const [mainRowLocked, setMainRowLocked] = useState(false);
  const [lockedRowIds, setLockedRowIds] = useState(() => new Set());

  const isSticker = STICKER_TYPES.includes(form.productType);
  // Same-family "extra size" rows — lets an agent add another size/quantity of
  // the SAME sub-product (e.g. 10 PVC signs, each a different size) inside this
  // one product card, instead of re-picking the SKU from scratch every time.
  const canAddExtraRows = form.productType && DIMENSION_FAMILIES.includes(categoryOf(form.productType));
  const showElementsForRows = ["logo", "foamex", "perspexBoard"].includes(categoryOf(form.productType));

  // Sticker/installation minimum prices are a floor for the WHOLE product, not
  // per size row — an agent splitting one order into 4 מידה rows shouldn't pay
  // the ₪140 sticker minimum (or the ₪600/700 installation minimum) 4 times over.
  // When there are extra rows, each row is calculated WITHOUT its own floor
  // (enforceMinimumPrice: false below), and the shortfall vs. the combined total
  // is topped up once on the main row — see stickerMinAdjust below.
  const stickerHasMultipleRows = isSticker && extraRows.length > 0;

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
      return config ? calculate({ config, priceTiers, stickerPriceTiers, paintSurchargeTiers, kapaPriceTiers, rollupPriceTiers, lokobondAreaTiers, glassPriceTiers, numberPriceTiers, graphicsPriceTiers, vistaSizes, ...form, enforceMinimumPrice: stickerHasMultipleRows ? false : enforceMinimumPrice, orderAreaOverride }) : null;
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [config, priceTiers, stickerPriceTiers, paintSurchargeTiers, kapaPriceTiers, rollupPriceTiers, lokobondAreaTiers, glassPriceTiers, numberPriceTiers, graphicsPriceTiers, vistaSizes, form, enforceMinimumPrice, orderAreaOverride, stickerHasMultipleRows]);

  // Calculate extra rows results (same memoization rationale as `result` above).
  // Each row carries its OWN quantity — a different size can need a different
  // count (e.g. 3 units of size A, 5 of size B), so it's computed as its own
  // independent line, not scaled off the main row's quantity.
  const extraRowResults = useMemo(() => extraRows.map(row => {
    try {
      return config ? calculate({
        config, priceTiers, stickerPriceTiers, paintSurchargeTiers, kapaPriceTiers, rollupPriceTiers, lokobondAreaTiers, glassPriceTiers, numberPriceTiers, graphicsPriceTiers, vistaSizes,
        ...form,
        widthM: row.widthM, heightM: row.heightM, quantity: row.quantity || "1",
        elements: row.elements || "", lineLabel: row.lineLabel,
        enforceMinimumPrice: stickerHasMultipleRows ? false : enforceMinimumPrice, orderAreaOverride,
      }) : null;
    } catch { return null; }
  }), [config, priceTiers, stickerPriceTiers, paintSurchargeTiers, kapaPriceTiers, rollupPriceTiers, lokobondAreaTiers, glassPriceTiers, numberPriceTiers, graphicsPriceTiers, vistaSizes, form, extraRows, enforceMinimumPrice, orderAreaOverride, stickerHasMultipleRows]);

  // Combined-total minimum enforcement for stickers split across multiple מידה
  // rows: sum the raw (unfloored) sticker + installation prices across every
  // row, apply each config minimum ONCE to the sum, and add any shortfall onto
  // the main row only — so the order total reflects one floor per product, not
  // one per row, while each row's own displayed price stays its true raw share.
  const stickerMinAdjust = useMemo(() => {
    if (!stickerHasMultipleRows || !config || !result) return { stickerTopUp: 0, installTopUp: 0 };
    const prefix = form.productType === "vinyl_sticker" ? "vinyl" : "texture";
    const isSouth = form.region === "דרום";
    const minStickerPrice = parseFloat(config[`${prefix}_sticker_min_price`]) || 0;
    const minInstallPrice = parseFloat(config[`${prefix}_sticker_install_min_price${isSouth ? "_south" : ""}`]) || 0;

    const allResults = [result, ...extraRowResults].filter(Boolean);
    const rawStickerSum = allResults.reduce((sum, r) => sum + (r.stickerOnlyPrice || 0), 0);
    const rawInstallSum = allResults.reduce((sum, r) => sum + (r.breakdown?.installationCost || 0), 0);

    return {
      stickerTopUp: Math.max(0, minStickerPrice - rawStickerSum),
      installTopUp: form.includeInstallation === "no" ? 0 : Math.max(0, minInstallPrice - rawInstallSum),
    };
  }, [stickerHasMultipleRows, config, result, extraRowResults, form.productType, form.region, form.includeInstallation]);

  // The main row's result, with the once-per-product minimum shortfall (if any)
  // folded in ex-VAT and re-grossed — this is what gets displayed/saved/summed
  // for the main row instead of the raw, un-floored `result`.
  const adjustedResult = useMemo(() => {
    const topUp = stickerMinAdjust.stickerTopUp + stickerMinAdjust.installTopUp;
    if (!result || topUp <= 0) return result;
    const vatRate = 1 + (parseFloat(config?.vat_percent) || 18) / 100;
    return {
      ...result,
      stickerOnlyPrice: round2(result.stickerOnlyPrice + stickerMinAdjust.stickerTopUp),
      sellingPriceAll: round2(result.sellingPriceAll + topUp),
      sellingPricePerUnit: round2(result.sellingPriceAll + topUp),
      priceWithVat: round2((result.sellingPriceAll + topUp) * vatRate),
    };
  }, [result, stickerMinAdjust, config]);

  const q = parseInt(form.quantity) || 1;
  // Each product reports its CASH price (incl. VAT). The payment surcharge is
  // applied once, at the ORDER level (MultiProductCalculator), so it also covers
  // the shipping. paymentKey/installmentCount arrive as props only for display.
  const priceWithVat = adjustedResult ? adjustedResult.priceWithVat / q : 0;

  // What one extra row contributes to the order total, in CASH — already the
  // full total for that row's own quantity (its own `calculate()` call above),
  // so no further scaling here. The order-level payment multiplier is applied
  // later, in MultiProductCalculator.
  const rowCashPrice = (r) => (r ? r.priceWithVat : 0);

  const extraTotal = extraRowResults.reduce((sum, r) => sum + rowCashPrice(r), 0);

  useEffect(() => {
    if (onPriceChange) {
      // Cash line total: per-unit × quantity, plus any extra sticker rows.
      onPriceChange(adjustedResult ? priceWithVat * q + extraTotal : 0);
    }
    if (onFormDataChange) {
      // `adjustedResult` carries the full cost/profit breakdown for this line
      // (with any once-per-product minimum top-up folded in) — saved verbatim
      // into calculation_data. priceWithPayment holds the CASH row amount; the
      // order applies the payment surcharge on top.
      onFormDataChange({ ...form, result: adjustedResult, extraRows: extraRows.map((row, i) => ({ ...row, result: extraRowResults[i], priceWithPayment: rowCashPrice(extraRowResults[i]) })) });
    }
  }, [adjustedResult, form, extraRows, extraTotal]);

  return (
    <div className="space-y-5">
      {/* Form section — flat (no boxed rubric); sits inside the outer white page card.
          Collapses to a compact summary once locked (see mainRowLocked above) —
          click it anywhere to reopen for editing, same as a locked extra row below. */}
      {mainRowLocked ? (
        <MainRowSummary
          form={form}
          result={adjustedResult}
          quantity={q}
          hasExtraRows={extraRows.length > 0}
          onEdit={() => setMainRowLocked(false)}
        />
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4 gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <h3 className="text-lg font-semibold text-black uppercase tracking-wider shrink-0">פרטי המוצר</h3>
              {extraRows.length > 0 && (
                <div className="relative min-w-0 flex-1 max-w-[12rem] group">
                  <input
                    value={form.sizeLabel || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, sizeLabel: e.target.value }))}
                    placeholder="מידה 1"
                    title="שם מותאם למידה זו"
                    className="w-full text-sm font-bold text-amber-600 uppercase tracking-wider bg-transparent border border-dashed border-black rounded-lg hover:border-amber-400 focus-visible:outline-none focus-visible:border-amber-400 focus-visible:border-solid pl-6 pr-2 py-0.5 transition-colors"
                  />
                  <Pencil className="w-3 h-3 text-black absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none group-focus-within:text-amber-500" />
                </div>
              )}
            </div>
            {extraRows.length > 0 && (
              <button
                onClick={() => setMainRowLocked(true)}
                className="text-lg text-black hover:text-amber-600 transition-colors px-2 py-1 rounded-lg hover:bg-amber-50 shrink-0"
              >
                סיימתי, כווץ
              </button>
            )}
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
            numberPriceTiers={numberPriceTiers}
            graphicsPriceTiers={graphicsPriceTiers}
            vistaSizes={vistaSizes}
            basePrice={adjustedResult ? (adjustedResult.sellingPricePerUnit - (adjustedResult.paintSellingSurcharge || 0)) : null}
            unitPriceExVat={adjustedResult ? adjustedResult.sellingPricePerUnit : null}
            priceRangeMin={result ? result.priceRangeMin : null}
            priceRangeMax={result ? result.priceRangeMax : null}
            priceMissing={!!result?.priceMissing}
            priceErrorMessage={result?.errorMessage}
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
      )}

      {/* Extra size/quantity rows — same SKU as above, different size and/or
          quantity (e.g. 10 PVC signs in different sizes for one client). */}
      {canAddExtraRows && extraRows.map((row, i) => {
        const rowResult = extraRowResults[i];
        const rowPrice = rowResult ? rowResult.sellingPriceAll : null;
        if (lockedRowIds.has(row.id)) {
          const incomplete = !(parseFloat(row.widthM) > 0 && parseFloat(row.heightM) > 0);
          return (
            <div
              key={row.id}
              onClick={() => setLockedRowIds((prev) => { const next = new Set(prev); next.delete(row.id); return next; })}
              className={`flex items-center justify-between gap-4 border-2 rounded-2xl px-4 py-3 bg-white cursor-pointer transition-colors ${
                incomplete ? "border-red-300 hover:border-red-400" : "border-black hover:border-amber-300"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-bold uppercase tracking-wider ${incomplete ? "text-red-500" : "text-amber-600"}`}>
                    {row.sizeLabel?.trim() || `מידה ${i + 2}`}
                  </span>
                  {incomplete && <span className="text-xs text-red-500">— חסרות מידות</span>}
                </div>
                {!incomplete && (
                  <div className="text-lg text-black mt-0.5">
                    {row.widthM}×{row.heightM} מ' <span className="text-slate-300 mx-1">·</span> כמות {row.quantity || 1}
                  </div>
                )}
              </div>
              {rowPrice != null && <span className="text-base font-bold text-amber-600 shrink-0">{fmt(rowPrice)}</span>}
              <span className="text-lg text-black px-2 py-1 shrink-0">ערוך</span>
              <button
                onClick={(e) => { e.stopPropagation(); setExtraRows(prev => prev.filter(r => r.id !== row.id)); }}
                className="flex items-center gap-1 text-sm text-red-500/70 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10 shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        }
        return (
          <div key={row.id} className="border-t-2 border-dashed border-black pt-5 mt-2 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="relative min-w-0 flex-1 max-w-[12rem] group">
                <input
                  value={row.sizeLabel || ""}
                  onChange={(e) => setExtraRows(prev => prev.map(r => r.id === row.id ? { ...r, sizeLabel: e.target.value } : r))}
                  placeholder={`מידה ${i + 2}`}
                  title="שם מותאם למידה זו"
                  className="w-full text-sm font-bold text-amber-600 uppercase tracking-wider bg-transparent border border-dashed border-black rounded-lg hover:border-amber-400 focus-visible:outline-none focus-visible:border-amber-400 focus-visible:border-solid pl-6 pr-2 py-0.5 transition-colors"
                />
                <Pencil className="w-3 h-3 text-black absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none group-focus-within:text-amber-500" />
              </div>
              <button
                onClick={() => setLockedRowIds((prev) => new Set(prev).add(row.id))}
                className="text-lg text-black hover:text-amber-600 transition-colors px-2 py-1 rounded-lg hover:bg-amber-50 shrink-0"
              >
                סיימתי, כווץ
              </button>
              <button
                onClick={() => setExtraRows(prev => prev.filter(r => r.id !== row.id))}
                className="flex items-center gap-1 text-sm text-red-400 hover:text-red-500 transition-colors shrink-0"
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

      {/* Add another size/quantity of the same SKU — 30% width (shortened 70%),
          pinned to the right edge. justify-start, not justify-end: this page
          is dir="rtl", where flex's "end" is the LEFT edge — "start" is right. */}
      {canAddExtraRows && result && (
        <div className="flex justify-start">
        <button
          onClick={() => {
            // Collapse everything already filled in first — same "keep the flow
            // moving forward" behavior as adding a whole new product at the
            // order level, which already did this.
            setMainRowLocked(true);
            setLockedRowIds((prev) => {
              const next = new Set(prev);
              extraRows.forEach((r) => next.add(r.id));
              return next;
            });
            setExtraRows(prev => [...prev, { id: nextRowId++, lineLabel: "", widthM: "", heightM: "", quantity: "1", elements: "" }]);
          }}
          className="w-[30%] flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-dashed border-black text-xl font-semibold text-black hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-all"
        >
          <Plus className="w-4 h-4" />
          הוסף מידה נוספת לאותו מוצר
        </button>
        </div>
      )}


    </div>
  );
}

// Collapsed summary for the main (מידה 1) row, once locked — mirrors the
// order-level collapsed item card (MultiProductCalculator) so both levels of
// the calculator behave the same way once there's more than one row/product
// to keep track of. Red border/text when width or height is still missing,
// so an incomplete row stands out instead of silently looking "done".
function MainRowSummary({ form, result, quantity, hasExtraRows, onEdit }) {
  const pt = form.productType;
  const isFree = pt === "free_product";
  const img = pt ? productImage(pt) : null;
  const sku = pt ? PRODUCT_CODES[pt] : null;
  const name = pt ? (isFree ? (form.lineLabel || "מוצר חופשי") : (PRODUCT_NAMES[pt] || pt)) : "לא נבחר מוצר";
  const w = parseFloat(form.widthM) || 0;
  const h = parseFloat(form.heightM) || 0;
  const unitArea = w > 0 && h > 0 ? w * h : null;
  const incomplete = !isFree && (!pt || (form.widthM !== undefined && !unitArea));
  // Ex-VAT — this row's own priced total (with any once-per-product minimum
  // top-up already folded in), not the incl.-VAT per-unit price × quantity.
  const priceExVat = result ? result.sellingPriceAll : null;

  return (
    <div
      onClick={onEdit}
      className={`flex items-center justify-between gap-4 border-2 rounded-2xl px-4 sm:px-5 py-3.5 bg-white cursor-pointer transition-colors ${
        incomplete ? "border-red-300 hover:border-red-400" : "border-black hover:border-amber-300"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {img && !isFree && (
          <img src={img} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0 border border-black" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {hasExtraRows && (
              <span className={`text-lg font-semibold shrink-0 ${incomplete ? "text-red-500" : "text-black"}`}>
                {form.sizeLabel?.trim() || "מידה 1"}
              </span>
            )}
            <span className={`text-xl font-bold truncate ${incomplete ? "text-red-500" : "text-black"}`}>{name}</span>
            {sku && <span className="text-lg font-mono text-black shrink-0">מק"ט {sku}</span>}
            {incomplete && <span className="text-xs text-red-500">— חסרים פרטים</span>}
          </div>
          {unitArea != null && (
            <div className="text-xl font-bold text-black mt-0.5">
              {w}×{h} מ' <span className="text-slate-300 mx-1">·</span> כמות {quantity}
            </div>
          )}
        </div>
      </div>
      {priceExVat != null && (
        <div className="text-left shrink-0">
          <div className="text-base font-bold text-amber-600">{fmt(priceExVat)}</div>
          <div className="text-base text-black">לפני מע״מ</div>
        </div>
      )}
      <span className="text-lg text-black px-2 py-1 shrink-0">ערוך</span>
    </div>
  );
}