import { useState, useCallback, useEffect } from "react";
import CalculatorTab from "./CalculatorTab";
import { PRODUCT_NAMES, PRODUCT_CODES, categoryOf, productImage } from "./CalculatorForm";
import { base44 } from "@/api/base44Client";
import { issueQuoteToMorning } from "@/api/morningClient";
import ClientSearchField from "./ClientSearchField";
import { Plus, Trash2, ShoppingCart, BarChart3, Tag, Lightbulb, Shapes, Layers, Save, Send, FileOutput, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const TAB_ICONS = { logo: Shapes, sticker: Tag, lightbox: Lightbulb, kapa: Layers };

// Product families that carry their own minimum-price floor in the engine —
// mirrors the `productFamily` values returned by useCalculator's calculate().
const MIN_PRICE_FAMILY_BY_PRODUCT_TYPE = {
  pvc_white: "logo", pvc_black: "logo",
  perspex_print: "logo", perspex_black: "logo", perspex_white: "logo", perspex_milky: "logo",
  perspex_mirror: "logo", perspex_metallic: "logo",
  vinyl_sticker: "sticker", texture_sticker: "sticker",
  lokobond_diecut: "lokobond", lokobond_plain: "lokobond",
  foamex_white: "foamex", foamex_black: "foamex",
  perspex_board_clear_print: "perspexBoard", perspex_board_black_matte: "perspexBoard",
  perspex_board_black_glossy: "perspexBoard", perspex_board_white: "perspexBoard", perspex_board_milky: "perspexBoard",
};

// Whether this line item's own minimum price should still be enforced now that
// the order may contain other products too — driven by the admin toggle per
// product family (config.<family>_apply_minimum_multi). Defaults to enforcing
// (matches the engine's own default) unless the admin explicitly switched it off.
function getEnforceMinimumPrice(config, formData, itemCount) {
  if (itemCount <= 1) return true;
  const family = MIN_PRICE_FAMILY_BY_PRODUCT_TYPE[formData?.productType];
  if (!family) return true;
  const toggle = config?.[`${family}_apply_minimum_multi`];
  return toggle !== 0 && toggle !== "0";
}

const fmt = (val) =>
  val != null
    ? `₪ ${Number(val).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";

// Bulk-discount families with an area-tier table (currently only לוקובונד —
// the "from X מ"ר ומעלה" mechanism doesn't exist for other families yet): the
// threshold is checked against the TOTAL area across every line item of the
// same family in this order (regardless of thickness/diecut-vs-plain) — not
// just the single line's own quantity. A client ordering several smaller
// lokobond signs that together pass the threshold still earns the discount.
const AREA_TIER_FAMILIES = ["lokobond"];
function familyOrderArea(formDataMap, family) {
  let total = 0;
  for (const fd of Object.values(formDataMap)) {
    if (!fd?.productType || categoryOf(fd.productType) !== family) continue;
    const w = parseFloat(fd.widthM) || 0;
    const h = parseFloat(fd.heightM) || 0;
    const q = parseInt(fd.quantity) || 1;
    total += w * h * q;
  }
  return total;
}

let nextId = 1;

// Every line item starts with no product chosen — the cascade selector (מק"ט →
// אב מק"ט → תת מק"ט) inside CalculatorForm reveals the dry params once a
// sub-product is picked.
const EMPTY_ITEM_FORM = { productType: "", widthM: "", heightM: "", quantity: "1", extras: [], lineLabel: "" };

export default function MultiProductCalculator({ config, priceTiers, stickerPriceTiers, paintSurchargeTiers, kapaPriceTiers, rollupPriceTiers, lokobondAreaTiers, glassPriceTiers, defaultForm, allowedProducts, allTabs }) {
  const firstTabKey = allTabs?.[0]?.key;
  const [items, setItems] = useState([{ id: nextId++, tabKey: null, formData: {} }]);
  const [prices, setPrices] = useState({});
  const [formDataMap, setFormDataMap] = useState({});
  // Agent-chosen name per product card — shown instead of the default "מוצר N"
  // wherever the product is labeled (the document + eventually Morning's
  // description field), so the agent can call it something meaningful like
  // "לוגו כניסה" instead of a generic index.
  const [itemLabels, setItemLabels] = useState({});
  // Locked (collapsed-to-summary) product cards — a card auto-locks the moment
  // a NEW product is added after it, so the order reads as a clean list while
  // being filled in; the agent can still reopen any locked card by clicking
  // "ערוך" on its summary row.
  const [lockedIds, setLockedIds] = useState({});
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  // Set when a result from ClientSearchField (an existing Morning client) is
  // picked — lets buildQuotePayload skip re-searching/re-creating that client
  // in Morning. Cleared whenever the name is edited by hand afterwards, since
  // that means it's no longer necessarily the same client.
  const [morningClientId, setMorningClientId] = useState(null);
  const [documentTitle, setDocumentTitle] = useState("");
  // Free-text background for the sales manager — visible only in the review
  // screen (QuotesHistory/QuoteDetailsModal), never on the client-facing document.
  const [agentNote, setAgentNote] = useState("");
  // Shipping (pre-VAT) — default comes from the admin config (shipping_cost), editable per quote.
  const [shipping, setShipping] = useState(config?.shipping_cost != null ? String(config.shipping_cost) : "");
  const [delivery, setDelivery] = useState("pickup"); // אספקה — order-level: משלוח / איסוף עצמי
  // Payment is order-level: a single "number of installments" for the whole
  // quote (1 = מזומן, no surcharge). Applied on top of all products + shipping.
  const [installmentCount, setInstallmentCount] = useState(2);
  const [clientAddress, setClientAddress] = useState("");
  // Assigned by the server on save/send — never typed by the agent — so it's
  // unmistakably a number issued by "ממשק סוכני מכירות" (see quoteCreate in
  // src/routes/entities.js).
  const [savedQuoteNumber, setSavedQuoteNumber] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [issuing, setIssuing] = useState(false);
  // Auto today's date (client-side) — shown top-left like a Morning quote.
  const quoteDate = new Date().toLocaleDateString("he-IL");

  const addItem = () => {
    setItems((prev) => {
      // Lock every existing item once a new one is added — keeps the flow of
      // writing an order moving forward instead of leaving every card open.
      setLockedIds((prevLocked) => {
        const next = { ...prevLocked };
        prev.forEach((it) => { next[it.id] = true; });
        return next;
      });
      return [...prev, { id: nextId++, tabKey: firstTabKey }];
    });
  };

  const toggleItemLock = (id, locked) => {
    setLockedIds((prev) => ({ ...prev, [id]: locked }));
  };

  const setItemTab = (id, tabKey) => {
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, tabKey } : item));
  };

  const removeItem = (id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setPrices((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setItemLabels((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setLockedIds((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const setItemLabel = (id, label) => {
    setItemLabels((prev) => ({ ...prev, [id]: label }));
  };

  const itemDisplayName = (id, index) => itemLabels[id]?.trim() || `מוצר ${index + 1}`;

  const handlePriceChange = useCallback((id, price) => {
    setPrices((prev) => ({ ...prev, [id]: price }));
  }, []);

  const handleFormDataChange = useCallback((id, formData) => {
    setFormDataMap((prev) => ({ ...prev, [id]: formData }));
  }, []);

  // Each product reports its CASH price (incl. VAT); payment is applied once here.
  const total = Object.values(prices).reduce((sum, p) => sum + (p || 0), 0);
  // Single VAT source for this whole document — admin config, not a hardcoded rate.
  const vatMultiplier = 1 + (parseFloat(config?.vat_percent) || 18) / 100;

  // Order-level payment surcharge: (installments − 1) × per-installment %. It is
  // applied to the whole order base (all products + shipping), so it covers the
  // shipping too.
  const instSurchargePct = (parseFloat(config?.payment_installment_surcharge_percent) || 2.5) / 100;
  const installmentSurchargePctTotal = (installmentCount - 1) * instSurchargePct; // 0 when 1 payment
  const orderMultiplier = 1 + installmentSurchargePctTotal;
  const paymentKey = installmentCount > 1 ? "installments" : "cash";

  const shippingPreVat = delivery === "shipping" ? (parseFloat(shipping) || 0) : 0;
  const shippingWithVat = shippingPreVat * vatMultiplier;          // cash, incl. VAT
  const shippingFinal = shippingWithVat * orderMultiplier;         // incl. payment surcharge

  // Cash base for the whole order (products + shipping), before the surcharge.
  const orderCashBase = total + shippingWithVat;
  const grandTotalBeforeDocMin = orderCashBase * orderMultiplier;
  // מחיר מינימום למסמך — רצפה על ההזמנה כולה, ללא קשר למספר המוצרים בתוכה.
  const documentMinimumPrice = parseFloat(config?.document_minimum_price) || 0;
  const grandTotal = grandTotalBeforeDocMin > 0 ? Math.max(grandTotalBeforeDocMin, documentMinimumPrice) : grandTotalBeforeDocMin;
  const grandBeforeVat = grandTotal / vatMultiplier;
  const vatAmount = grandTotal - grandBeforeVat;

  // Quote validity — always 14 days from today.
  const validUntilDate = new Date();
  validUntilDate.setDate(validUntilDate.getDate() + 14);
  const validUntil = validUntilDate.toLocaleDateString("he-IL");

  const vatPct = Math.round((vatMultiplier - 1) * 100);

  // Discount-room alert — true when at least one line's result carries a real
  // agent price range (priceRangeMin < priceRangeMax): the customer's order
  // crossed an m² tier (or the item's own PriceTier row) that opened up a lower
  // "agent minimum" price, below the starting list price for that tier.
  const discountRoomItems = items
    .map((item, index) => ({ index, result: formDataMap[item.id]?.result }))
    .filter(({ result }) => result?.priceRangeMin != null && result?.priceRangeMax != null && result.priceRangeMin < result.priceRangeMax);
  const hasDiscountRoom = discountRoomItems.length > 0;

  // Flattens every line (main product + its extra sticker rows, if any) into
  // the { description, quantity, unitPrice, groupLabel } shape QuoteDetailsModal
  // already knows how to render.
  // "200×100 ס״מ" (or "" if the line has no real dimensions — fixed-price
  // catalog rows like kapa/rollup/glass never set widthM/heightM).
  const dimsSuffix = (fd) => fd?.widthM && fd?.heightM ? ` (${fd.widthM}×${fd.heightM} מ׳)` : "";

  const buildLineItems = () => {
    const lines = [];
    items.forEach((item, index) => {
      const formData = formDataMap[item.id];
      if (!formData?.productType) return;
      const groupLabel = items.length > 1 ? itemDisplayName(item.id, index) : null;
      const isFree = formData.productType === "free_product";
      lines.push({
        groupLabel,
        description: (isFree ? (formData.lineLabel || "מוצר חופשי") : (PRODUCT_NAMES[formData.productType] || formData.productType)) + dimsSuffix(formData),
        freeText: formData.lineLabel || "",
        quantity: parseInt(formData.quantity) || 1,
        unitPrice: formData.result?.sellingPricePerUnit ?? 0,
      });
      (formData.extraRows || []).forEach((row) => {
        if (!row.result) return;
        lines.push({
          groupLabel,
          description: `${PRODUCT_NAMES[formData.productType] || formData.productType} — מידה נוספת${dimsSuffix(row)}`,
          freeText: row.lineLabel || "",
          quantity: parseInt(row.quantity) || 1,
          unitPrice: row.result.sellingPricePerUnit ?? 0,
        });
      });
    });
    return lines;
  };

  const buildQuotePayload = (status) => ({
    client_name: clientName.trim(),
    client_phone: clientPhone.trim(),
    client_address: clientAddress.trim(),
    morning_client_id: morningClientId || undefined,
    product_category: categoryOf(formDataMap[items[0]?.id]?.productType),
    payment_type: installmentCount > 1 ? `installments:${installmentCount}` : "cash",
    price_before_vat: Math.round(grandBeforeVat * 100) / 100,
    price_with_vat: Math.round(grandTotal * 100) / 100,
    line_items: JSON.stringify(buildLineItems()),
    calculation_data: JSON.stringify({
      items: items.map((item, index) => ({
        index,
        productType: formDataMap[item.id]?.productType,
        widthM: formDataMap[item.id]?.widthM,
        heightM: formDataMap[item.id]?.heightM,
        thicknessMm: formDataMap[item.id]?.thicknessMm,
        result: formDataMap[item.id]?.result,
        extraRows: formDataMap[item.id]?.extraRows,
      })),
      // Saved once, at quote time, so the manager's review screen can recompute
      // a target-margin or max/min-per-sqm price later using ONLY this saved
      // data — never live admin config (which may have since changed).
      commissionPct: ((parseFloat(config?.sales_agent_commission_percent) || 0) + (parseFloat(config?.marketing_commission_percent) || 0)) / 100,
    }),
    notes: documentTitle.trim(),
    agent_note: agentNote.trim(),
    status,
  });

  const isQuoteValid = clientName.trim() && clientPhone.trim() && grandTotal > 0;

  // Warn on refresh/tab-close/back-button while there's real unsaved work —
  // nothing here is persisted anywhere until one of the three buttons below is
  // clicked, so a stray refresh would otherwise silently discard the whole quote.
  // Stops warning once something has actually been saved (savedQuoteNumber set);
  // further edits after that point aren't tracked separately (a stronger dirty
  // flag would need a full autosave feature, which this doesn't attempt).
  useEffect(() => {
    const hasUnsavedWork = (clientName.trim() || grandTotal > 0) && !savedQuoteNumber;
    if (!hasUnsavedWork) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [clientName, clientPhone, grandTotal, savedQuoteNumber]);

  const handleSave = async () => {
    if (!isQuoteValid) return;
    setSaving(true);
    try {
      const created = await base44.entities.Quote.create(buildQuotePayload("draft"));
      setSavedQuoteNumber(created.quote_number);
      setSaved(true);
      toast.success(`הטיוטה נשמרה בהצלחה — מס׳ ${created.quote_number}`);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      toast.error("שגיאה בשמירת הטיוטה");
    }
    setSaving(false);
  };

  // שיגור: יוצר את ההצעה בסטטוס "נשלחה" כדי שתופיע מסומנת לבדיקה בממשק
  // "היסטוריית הצעות" (QuotesHistory) של המנהל, בלי לעבור דרך טיוטה. מספר
  // ההצעה נקבע ע"י השרת בלבד (quoteCreate) — לעולם לא מוקלד ע"י הסוכן.
  const handleSend = async () => {
    if (!isQuoteValid) return;
    setSending(true);
    try {
      const created = await base44.entities.Quote.create(buildQuotePayload("sent"));
      setSavedQuoteNumber(created.quote_number);
      setSent(true);
      toast.success(`ההצעה שוגרה לבדיקה — מס׳ ${created.quote_number}`);
      setTimeout(() => setSent(false), 3000);
    } catch {
      toast.error("שגיאה בשיגור ההצעה");
    }
    setSending(false);
  };

  // הנפקה ישירה ללקוח דרך מורנינג — בלי לעבור דרך בדיקת מנהל מכירות. ה-API
  // של מורנינג עדיין לא מחובר בפועל (ראה src/api/morningClient.js); ההצעה
  // עדיין נשמרת אצלנו כ"אושרה" כדי שתופיע בהיסטוריה, וברגע שיהיה חיבור אמיתי
  // רק issueQuoteToMorning עצמה תצטרך להשתנות.
  const handleIssue = async () => {
    if (!isQuoteValid) return;
    setIssuing(true);
    try {
      const created = await base44.entities.Quote.create(buildQuotePayload("approved"));
      setSavedQuoteNumber(created.quote_number);
      const result = await issueQuoteToMorning(created);
      if (result.issued) {
        toast.success(`ההצעה ${created.quote_number} הונפקה ללקוח`);
      } else {
        toast.message(`ההצעה ${created.quote_number} נשמרה`, {
          description: "החיבור למורנינג עדיין לא מוגדר — ההנפקה בפועל תתחיל לעבוד ברגע שיהיה חשבון/מפתח API של מורנינג.",
        });
      }
    } catch {
      toast.error("שגיאה בהנפקת ההצעה");
    }
    setIssuing(false);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* MAIN — the whole document as one white "page", distinct from the gray screen background */}
      <div className="order-1 lg:order-2 flex-1 min-w-0 w-full">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 sm:p-6 space-y-8">
          {/* פרטי המסמך */}
          <section className="space-y-5">
            <h3 className="text-lg font-bold text-slate-800">פרטי המסמך</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-600">שם לקוח <span className="text-red-500">*</span></label>
                <ClientSearchField
                  value={clientName}
                  onChange={(v) => { setClientName(v); setMorningClientId(null); }}
                  onSelect={(c) => {
                    setClientName(c.name);
                    setClientPhone(c.phone || "");
                    setClientAddress(c.address || "");
                    setMorningClientId(c.id);
                  }}
                  placeholder="שם הלקוח — חפש לקוח קיים או הקלד חדש"
                  className="w-full h-9 bg-transparent border-0 border-b-2 border-slate-300 px-0.5 py-1 text-base placeholder:text-slate-300 focus-visible:outline-none focus-visible:border-amber-400"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-600">טלפון לקוח <span className="text-red-500">*</span></label>
                <input
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="050-1234567"
                  dir="ltr"
                  className="w-full h-9 bg-transparent border-0 border-b-2 border-slate-300 px-0.5 py-1 text-base placeholder:text-slate-300 focus-visible:outline-none focus-visible:border-amber-400"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-600">כותרת המסמך</label>
                <input
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  placeholder="לדוגמה: שילוט חזית לחנות"
                  className="w-full h-9 bg-transparent border-0 border-b-2 border-slate-300 px-0.5 py-1 text-base placeholder:text-slate-300 focus-visible:outline-none focus-visible:border-amber-400"
                />
              </div>
            </div>
          </section>

          {/* התראה לסוכן — נפתח מרווח מיקוח כי ההזמנה עברה מכסת מ"ר */}
          {hasDiscountRoom && (
            <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 px-5 py-4 flex items-start gap-3">
              <span className="text-2xl leading-none">💡</span>
              <div>
                <p className="text-base font-bold text-amber-800">
                  שים לב: לטובת סגירת ההצעה, הלקוח עבר מכסת מ"ר שמאפשרת לך לתת עוד הנחה
                </p>
                <p className="text-sm text-amber-700 mt-1">
                  {discountRoomItems.length === 1
                    ? `ב${itemDisplayName(items[discountRoomItems[0].index]?.id, discountRoomItems[0].index)} אפשר להוריד את המחיר למ"ר עד ל-₪${discountRoomItems[0].result.priceRangeMin.toLocaleString("he-IL")} (מחיר רשימה: ₪${discountRoomItems[0].result.priceRangeMax.toLocaleString("he-IL")}).`
                    : `ב${discountRoomItems.map(d => itemDisplayName(items[d.index]?.id, d.index)).join(", ")} אפשר להוריד את המחיר למ"ר עד למחיר המינימלי שהוגדר לסוכן.`}
                </p>
              </div>
            </div>
          )}

          {/* פירוט — רשימת הפריטים */}
          <section className="space-y-5 border-t border-slate-100 pt-7">
            <h3 className="text-lg font-bold text-slate-800">פירוט</h3>
            {items.map((item, index) => {
              const isLocked = !!lockedIds[item.id];
              const formData = formDataMap[item.id];
              if (isLocked) {
                // Collapsed summary — a quiet, read-only row so a filled-in
                // order reads as a clean list; click "ערוך" to reopen it.
                const pt = formData?.productType;
                const isFree = pt === "free_product";
                const img = pt ? productImage(pt) : null;
                const sku = pt ? PRODUCT_CODES[pt] : null;
                const w = parseFloat(formData?.widthM) || 0;
                const h = parseFloat(formData?.heightM) || 0;
                const q = parseInt(formData?.quantity) || 1;
                const unitArea = w > 0 && h > 0 ? w * h : null;
                const totalArea = unitArea != null ? unitArea * q : null;
                const extraCount = (formData?.extraRows || []).length;
                return (
                  <div key={item.id} className="flex items-center justify-between gap-4 border-2 border-slate-200 rounded-2xl px-4 sm:px-5 py-3.5 bg-white">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {img && !isFree && (
                        <img src={img} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0 border border-slate-200" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-700 truncate">{itemDisplayName(item.id, index)}</span>
                          {sku && <span className="text-xs font-mono text-slate-400 shrink-0">מק"ט {sku}</span>}
                        </div>
                        <div className="text-xs text-slate-400 truncate">
                          {pt ? (isFree ? (formData.lineLabel || "מוצר חופשי") : (PRODUCT_NAMES[pt] || pt)) : "לא נבחר מוצר"}
                          {extraCount > 0 ? ` · +${extraCount} מידות נוספות` : ""}
                        </div>
                        {unitArea != null && (
                          <div className="text-base font-semibold text-slate-600 mt-0.5">
                            {w}×{h} מ' <span className="text-slate-300 mx-1">·</span> כמות {q}
                            <span className="text-slate-300 mx-1">·</span>
                            סה"כ {totalArea.toFixed(2)} מ"ר
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="text-base font-bold text-amber-600 shrink-0">{fmt(prices[item.id])}</span>
                    <button
                      onClick={() => toggleItemLock(item.id, false)}
                      className="text-sm text-slate-500 hover:text-amber-600 transition-colors px-2 py-1 rounded-lg hover:bg-amber-50 shrink-0"
                    >
                      ערוך
                    </button>
                    {items.length > 1 && (
                      <button
                        onClick={() => removeItem(item.id)}
                        className="flex items-center gap-1 text-sm text-red-500/70 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              }
              return (
                // Each product is its own isolated card — a clear border fully
                // separates it from the product before/after it (not just a thin
                // divider line), per the "no shared bleed between products" rule.
                <div key={item.id} className="relative border-2 border-slate-300 rounded-2xl p-4 sm:p-5 bg-slate-50/50">
                  <div className="flex items-center justify-between mb-3 gap-3">
                    <input
                      value={itemLabels[item.id] || ""}
                      onChange={(e) => setItemLabel(item.id, e.target.value)}
                      placeholder={`מוצר ${index + 1}`}
                      title="שם מותאם למוצר זה — יופיע בהצעת המחיר במקום 'מוצר N'"
                      className="min-w-0 flex-1 text-sm font-semibold text-zinc-500 uppercase tracking-wider bg-transparent border-0 border-b border-transparent hover:border-slate-300 focus-visible:outline-none focus-visible:border-amber-400 px-0.5 py-0.5"
                    />
                    {items.length > 1 && (
                      <button
                        onClick={() => toggleItemLock(item.id, true)}
                        className="text-sm text-slate-500 hover:text-amber-600 transition-colors px-2 py-1 rounded-lg hover:bg-amber-50"
                      >
                        סיימתי, כווץ
                      </button>
                    )}
                    {items.length > 1 && (
                      <button
                        onClick={() => removeItem(item.id)}
                        className="flex items-center gap-1 text-sm text-red-500/70 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> הסר
                      </button>
                    )}
                  </div>
                  <div className="overflow-visible">
                    <CalculatorTab
                      config={config}
                      priceTiers={priceTiers}
                      stickerPriceTiers={stickerPriceTiers}
                      paintSurchargeTiers={paintSurchargeTiers}
                      kapaPriceTiers={kapaPriceTiers}
                      rollupPriceTiers={rollupPriceTiers}
                      lokobondAreaTiers={lokobondAreaTiers}
                      glassPriceTiers={glassPriceTiers}
                      defaultForm={EMPTY_ITEM_FORM}
                      enforceMinimumPrice={getEnforceMinimumPrice(config, formDataMap[item.id], items.length)}
                      orderAreaOverride={(() => {
                        const cat = categoryOf(formDataMap[item.id]?.productType);
                        return AREA_TIER_FAMILIES.includes(cat) ? familyOrderArea(formDataMap, cat) : null;
                      })()}
                      onPriceChange={(price) => handlePriceChange(item.id, price)}
                      onFormDataChange={(formData) => handleFormDataChange(item.id, formData)}
                      paymentKey={paymentKey}
                      installmentCount={installmentCount}
                    />
                  </div>
                </div>
              );
            })}

            {/* Add product */}
            <button
              onClick={addItem}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border border-amber-300 bg-amber-50 text-base font-semibold text-amber-600 hover:bg-amber-100 hover:border-amber-400 transition-all"
            >
              <Plus className="w-4 h-4" /> הוסף מוצר נוסף
            </button>
          </section>
        </div>
      </div>

      {/* SIDEBAR — live order summary (sits on the right in RTL) */}
      <div className="order-2 lg:order-1 w-full lg:w-72 lg:flex-shrink-0 space-y-4 lg:sticky lg:top-4">
        <div className="bg-white border border-amber-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-amber-500" />
            <span className="text-base font-semibold text-amber-600">סיכום הזמנה</span>
          </div>

          {/* Dates */}
          <div className="space-y-2 text-sm border-b border-slate-100 pb-3">
            <div className="flex justify-between">
              <span className="text-slate-400">תאריך ההצעה</span>
              <span className="font-semibold text-slate-700" dir="ltr">{quoteDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">בתוקף עד (14 יום)</span>
              <span className="font-semibold text-slate-700" dir="ltr">{validUntil}</span>
            </div>
          </div>

          {/* Client details */}
          <div className="space-y-2 border-b border-slate-100 pb-3">
            <div className="text-sm font-semibold text-slate-600">פרטי הלקוח</div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">שם:</span>
              <span className="font-semibold text-slate-700">{clientName || "—"}</span>
            </div>
            <div className="space-y-1">
              <label className="text-sm text-slate-400">כתובת</label>
              <input
                value={clientAddress}
                onChange={(e) => setClientAddress(e.target.value)}
                placeholder="רחוב, עיר"
                className="w-full h-9 bg-transparent border-0 border-b-2 border-slate-300 px-0.5 py-1 text-sm placeholder:text-slate-300 focus-visible:outline-none focus-visible:border-amber-400"
              />
            </div>
          </div>

          {/* Order details */}
          <div className="space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">מספר מוצרים</span>
              <span className="font-semibold text-slate-700">{items.length}</span>
            </div>

            {/* Delivery */}
            <div className="space-y-1.5">
              <span className="text-sm text-slate-400">אספקה</span>
              <div className="grid grid-cols-2 gap-2">
                {[{ v: "pickup", l: "איסוף עצמי" }, { v: "shipping", l: "משלוח" }].map(({ v, l }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setDelivery(v)}
                    className={`h-10 rounded-md border text-sm transition-colors ${
                      delivery === v ? "border-amber-400 bg-amber-50 text-amber-700 font-semibold" : "border-black bg-slate-50 text-slate-600 hover:border-black"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {delivery === "shipping" && (
                <div className="relative">
                  <input
                    type="text" inputMode="decimal" dir="ltr"
                    value={shipping}
                    onChange={(e) => setShipping(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
                    placeholder="מחיר משלוח (לפני מע״מ)"
                    className="flex h-10 w-full rounded-md border border-black bg-slate-50 pl-7 pr-3 text-sm text-left placeholder:text-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">₪</span>
                </div>
              )}
            </div>

            {/* Payments */}
            <div className="space-y-1.5 text-sm">
              <span className="text-slate-400">מספר תשלומים</span>
              <select
                value={installmentCount}
                onChange={(e) => setInstallmentCount(parseInt(e.target.value))}
                className="h-9 w-full rounded-md border border-black bg-white px-2 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value={1}>תשלום מזומן / העברה בנקאית</option>
                {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (<option key={n} value={n}>תשלום באשראי עד {n} תשלומים</option>))}
              </select>
            </div>
            {installmentCount > 1 && (
              <div className="text-xs text-slate-400 text-left">כולל תוספת {(installmentSurchargePctTotal * 100).toFixed(1)}% על מחיר מזומן</div>
            )}
          </div>

          {/* Prices */}
          <div className="space-y-2 border-t border-slate-100 pt-3">
            {/* Per-item breakdown (before VAT) — only worth showing once there's
                more than one product, so the total below doesn't look opaque. */}
            {items.length > 1 && (
              <div className="space-y-1 pb-2 border-b border-slate-100">
                {items.map((item, index) => {
                  const itemBeforeVat = ((prices[item.id] || 0) * orderMultiplier) / vatMultiplier;
                  return (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-slate-400">{itemDisplayName(item.id, index)} - מחיר</span>
                      <span className="text-slate-600">{fmt(itemBeforeVat)}</span>
                    </div>
                  );
                })}
                {delivery === "shipping" && shippingPreVat > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">עלות משלוח</span>
                    <span className="text-slate-600">{fmt(shippingPreVat * orderMultiplier)}</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">מחיר לפני מע״מ</span>
              <span className="font-semibold text-slate-700">{fmt(grandBeforeVat)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">מע״מ ({vatPct}%)</span>
              <span className="font-semibold text-slate-700">{fmt(vatAmount)}</span>
            </div>
          </div>

          {/* Grand total */}
          <div className="flex justify-between items-center border-t border-amber-200 pt-3">
            <span className="text-base font-bold text-slate-800">סה״כ כולל מע״מ</span>
            <span className="text-2xl font-bold text-amber-600">{fmt(grandTotal)}</span>
          </div>
        </div>

        {/* Save / send */}
        <div className="bg-white border-2 border-slate-300 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <span className="text-slate-500">מס׳ הצעת מחיר</span>
            <span className="font-semibold text-slate-700" dir="ltr">
              {savedQuoteNumber || "נקבע אוטומטית עם השמירה"}
            </span>
          </div>

          {/* Background for the manager — shown only in the review screen
              (QuotesHistory/QuoteDetailsModal), never on the client document. */}
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-600">הערה למנהל המכירות (רקע להצעה, לא מוצג ללקוח)</label>
            <textarea
              value={agentNote}
              onChange={(e) => setAgentNote(e.target.value)}
              placeholder="לדוגמה: הלקוח ביקש הנחה כי הוא מזמין קבוע, סוכם על משלוח מהיר..."
              rows={2}
              className="w-full rounded-lg border border-black bg-white px-3 py-2 text-sm placeholder:text-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving || sending || issuing || !isQuoteValid}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
              saved
                ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-600"
                : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            }`}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <><CheckCircle2 className="w-4 h-4" /> נשמרה טיוטה!</> : <><Save className="w-4 h-4" /> שמור כטיוטה</>}
          </button>

          <button
            onClick={handleSend}
            disabled={saving || sending || issuing || !isQuoteValid}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              sent
                ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-600"
                : "bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 disabled:opacity-40 disabled:cursor-not-allowed"
            }`}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : sent ? <><CheckCircle2 className="w-4 h-4" /> ההצעה שוגרה!</> : <><Send className="w-4 h-4" /> שגר לבדיקה</>}
          </button>

          <button
            onClick={handleIssue}
            disabled={saving || sending || issuing || !isQuoteValid}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {issuing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><FileOutput className="w-4 h-4" /> הנפק הצעת מחיר ללקוח</>}
          </button>
          <p className="text-xs text-slate-400 text-center -mt-1">מנפיק ישירות ללקוח דרך מורנינג, בלי לעבור בדיקת מנהל מכירות</p>

          {!isQuoteValid && (
            <p className="text-xs text-slate-400 text-center">יש להזין שם לקוח ולפחות מוצר אחד עם מחיר</p>
          )}
        </div>
      </div>
    </div>
  );
}