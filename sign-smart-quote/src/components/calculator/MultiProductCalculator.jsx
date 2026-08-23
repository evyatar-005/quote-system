import { useState, useCallback, useEffect, useRef } from "react";
import CalculatorTab from "./CalculatorTab";
import { PRODUCT_NAMES, PRODUCT_CODES, EXTRAS_OPTIONS, categoryOf, productImage } from "./CalculatorForm";
import { base44 } from "@/api/base44Client";
import { issueQuoteToMorning } from "@/api/morningClient";
import { crmLeads } from "@/api/crmClient";
import ClientSearchField from "./ClientSearchField";
import NewClientModal from "./NewClientModal";
import DocumentIssuedModal from "@/components/DocumentIssuedModal";
import { Plus, Trash2, ShoppingCart, BarChart3, Tag, Lightbulb, Shapes, Layers, Save, Send, FileOutput, Loader2, CheckCircle2, Paperclip, FileText, Image as ImageIcon, X, Pencil } from "lucide-react";
import { toast } from "sonner";

// Reference material only (a photo of the wall, a spec PDF) — not a general
// file drop, so kept to the types a manager can actually open at a glance.
const ACCEPTED_ATTACHMENT_MIME = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
]);
const MAX_ATTACHMENTS = 10;

// Drag-and-drop / click-to-browse picker for the "reference files" attached to
// a quote when it's saved/sent — several files at once, held client-side as
// plain File objects until the quote itself is created (see
// uploadPendingAttachments in MultiProductCalculator).
function AttachmentDropZone({ files, onFilesAdded, onRemove }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  return (
    <div className="space-y-1.5 h-full flex flex-col">
      <div
        title="קבצים מצורפים (תמונה / PDF — רקע להצעה, לא מוצג ללקוח)"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onFilesAdded(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`flex-1 flex flex-col items-center justify-center cursor-pointer rounded-lg border-2 border-dashed px-3 py-3 text-center text-xs transition-colors ${
          dragOver ? "border-amber-400 bg-amber-50 text-amber-600" : "border-black text-black hover:border-slate-400"
        }`}
      >
        <Paperclip className="w-4 h-4 mx-auto mb-1" />
        גרור לכאן קבצים, או לחץ לבחירה (אפשר כמה יחד)
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => { onFilesAdded(e.target.files); e.target.value = ""; }}
        />
      </div>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 bg-slate-50 border border-black rounded-md px-2 py-1 text-xs">
              <span className="flex items-center gap-1.5 min-w-0">
                {f.type === "application/pdf"
                  ? <FileText className="w-3.5 h-3.5 shrink-0 text-black" />
                  : <ImageIcon className="w-3.5 h-3.5 shrink-0 text-black" />}
                <span className="truncate text-black">{f.name}</span>
              </span>
              <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(i); }} className="shrink-0 text-black hover:text-red-500">
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Clear break between the three stacked "windows" (document → summary →
// actions) — a numbered badge on a full-width line, not just a gap, so the
// agent's eyes register a hard stop between steps instead of the page
// reading as one long continuous form.
function StepDivider({ step, label }) {
  return (
    <div className="flex items-center gap-3 -my-1">
      <div className="flex-1 h-0.5 bg-black" />
      <div className="flex items-center gap-2.5 shrink-0 bg-black text-white rounded-full pl-5 pr-4 py-2">
        <span className="w-8 h-8 rounded-full bg-amber-400 text-black text-lg font-bold flex items-center justify-center shrink-0">{step}</span>
        <span className="text-lg font-bold">{label}</span>
      </div>
      <div className="flex-1 h-0.5 bg-black" />
    </div>
  );
}

const TAB_ICONS = { logo: Shapes, sticker: Tag, lightbox: Lightbulb, kapa: Layers };

// Product families that carry their own minimum-price floor in the engine —
// mirrors the `productFamily` values returned by useCalculator's calculate().
const MIN_PRICE_FAMILY_BY_PRODUCT_TYPE = {
  pvc_white: "logo", pvc_black: "logo",
  perspex_print: "logo", perspex_print_back: "logo", perspex_black: "logo", perspex_white: "logo", perspex_milky: "logo",
  perspex_mirror: "logo", perspex_metallic: "logo",
  vinyl_sticker: "sticker", texture_sticker: "sticker",
  lokobond_diecut: "lokobond", lokobond_plain: "lokobond",
  foamex_white: "foamex", foamex_black: "foamex",
  perspex_board_clear_print: "perspexBoard", perspex_board_black_matte: "perspexBoard",
  perspex_board_black_glossy: "perspexBoard", perspex_board_white: "perspexBoard", perspex_board_milky: "perspexBoard",
  perspex_board_back_print: "perspexBoard",
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

// "שכפל" (My Quotes tab) reopens a saved quote's builder_state here. item ids
// in the saved snapshot came from a past, unrelated `nextId` sequence — remap
// them to fresh ids from THIS session's counter so a later addItem() can't
// collide with a hydrated id. Runs at most once per mount (guarded by the
// useRef check at the call site), so this is the only place nextId is
// incremented outside the normal addItem() flow.
function hydrateBuilderState(state) {
  if (!state) return null;
  const idMap = {};
  const items = (state.items || []).map((it) => {
    const id = nextId++;
    idMap[it.id] = id;
    return { id, tabKey: it.tabKey };
  });
  const formDataMap = {};
  for (const [oldId, fd] of Object.entries(state.formDataMap || {})) formDataMap[idMap[oldId]] = fd;
  const itemLabels = {};
  for (const [oldId, label] of Object.entries(state.itemLabels || {})) itemLabels[idMap[oldId]] = label;
  return { ...state, items, formDataMap, itemLabels };
}

export default function MultiProductCalculator({ config, priceTiers, stickerPriceTiers, paintSurchargeTiers, kapaPriceTiers, rollupPriceTiers, lokobondAreaTiers, glassPriceTiers, numberPriceTiers, graphicsPriceTiers, defaultForm, allowedProducts, allTabs, initialBuilderState, sourceQuoteNumber, sourceLeadId }) {
  const firstTabKey = allTabs?.[0]?.key;
  // Computed once on mount (never on re-render, which would otherwise burn
  // fresh ids from nextId every time) — see hydrateBuilderState above.
  const hydrationRef = useRef(null);
  if (hydrationRef.current === null) {
    hydrationRef.current = hydrateBuilderState(initialBuilderState) || {};
  }
  const hydration = hydrationRef.current;

  const [items, setItems] = useState(() => hydration.items || [{ id: nextId++, tabKey: null, formData: {} }]);
  const [prices, setPrices] = useState({});
  const [formDataMap, setFormDataMap] = useState(() => hydration.formDataMap || {});
  // Agent-chosen name per product card — shown instead of the default "מוצר N"
  // wherever the product is labeled (the document + eventually Morning's
  // description field), so the agent can call it something meaningful like
  // "לוגו כניסה" instead of a generic index.
  const [itemLabels, setItemLabels] = useState(() => hydration.itemLabels || {});
  // Locked (collapsed-to-summary) product cards — a card auto-locks the moment
  // a NEW product is added after it, so the order reads as a clean list while
  // being filled in; the agent can still reopen any locked card by clicking
  // "ערוך" on its summary row. A duplicated quote opens every card unlocked
  // (empty {}) so the agent immediately sees everything to edit.
  const [lockedIds, setLockedIds] = useState({});
  const [clientName, setClientName] = useState(hydration.clientName || "");
  const [clientPhone, setClientPhone] = useState(hydration.clientPhone || "");
  // Set when a result from ClientSearchField (an existing Morning client) is
  // picked — lets buildQuotePayload skip re-searching/re-creating that client
  // in Morning. Cleared whenever the name is edited by hand afterwards, since
  // that means it's no longer necessarily the same client.
  const [morningClientId, setMorningClientId] = useState(hydration.morningClientId || null);
  const [documentTitle, setDocumentTitle] = useState(hydration.documentTitle || "");
  // Free-text background for the sales manager — visible only in the review
  // screen (QuotesHistory/QuoteDetailsModal), never on the client-facing document.
  const [agentNote, setAgentNote] = useState(hydration.agentNote || "");
  // Reference images/PDFs (e.g. a photo of the client's wall) picked before the
  // quote itself exists — held as plain File objects and only actually
  // uploaded once save/send returns a real quote id (see uploadPendingAttachments).
  const [attachedFiles, setAttachedFiles] = useState([]);
  // Shipping (pre-VAT) — default comes from the admin config (shipping_cost), editable per quote.
  const [shipping, setShipping] = useState(hydration.shipping ?? (config?.shipping_cost != null ? String(config.shipping_cost) : ""));
  const [delivery, setDelivery] = useState(hydration.delivery || "pickup"); // אספקה — order-level: משלוח / איסוף עצמי
  // Payment is order-level: a single "number of installments" for the whole
  // quote (1 = מזומן, no surcharge). Applied on top of all products + shipping.
  const [installmentCount, setInstallmentCount] = useState(hydration.installmentCount ?? 1);
  const [clientAddress, setClientAddress] = useState(hydration.clientAddress || "");
  const [clientVatId, setClientVatId] = useState(hydration.clientVatId || "");
  const [clientEmail, setClientEmail] = useState(hydration.clientEmail || "");
  // Credit days synced to Morning's own paymentTerms field on the client card
  // (0 = מזומן/שוטף) — client-level, distinct from installmentCount below,
  // which is this quote's own cash/installments payment method.
  const [clientPaymentTerms, setClientPaymentTerms] = useState(hydration.clientPaymentTerms ?? 0);
  // Phone/VAT/email/payment-terms are never edited inline on this screen —
  // they only exist as a side effect of registering the client via "שמור
  // לקוח" (NewClientModal) or picking an existing one from ClientSearchField,
  // so the main document form doesn't ask the agent to re-type Morning client
  // details it already has (or will collect through that one explicit action).
  const [showSaveClientModal, setShowSaveClientModal] = useState(false);
  // Assigned by the server on save/send — never typed by the agent — so it's
  // unmistakably a number issued by "ממשק סוכני מכירות" (see quoteCreate in
  // src/routes/entities.js).
  const [savedQuoteNumber, setSavedQuoteNumber] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [issuing, setIssuing] = useState(false);
  // Popup confirming a Morning document was created, with an immediate
  // download link — set from handleIssue below, cleared by closing the modal.
  const [issuedDocument, setIssuedDocument] = useState(null); // { url, label }
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

  // מחיר מינימום למסמך — רצפה על סכום המוצרים בלבד (לפני משלוח), ללא קשר
  // למספר המוצרים בתוכה. המשלוח תמיד מתווסף מעל המינימום ולא "נבלע" בתוכו —
  // אחרת הזמנה שהגיעה בדיוק למינימום המוצרים לא הייתה משלמת על המשלוח בכלל.
  // קאפה לא כפוף למינימום הזמנה: אם יש בהזמנה פריט קאפה (גם בהזמנה מעורבת),
  // הרצפה למסמך לא חלה — מחירי המינימום הפרטניים של שאר הפריטים ממשיכים לחול כרגיל.
  const hasKapaItem = items.some((item) => categoryOf(formDataMap[item.id]?.productType) === "kapa");
  const documentMinimumPrice = hasKapaItem ? 0 : (parseFloat(config?.document_minimum_price) || 0);
  const productsAfterDocMin = total > 0 ? Math.max(total, documentMinimumPrice) : total;

  // Cash base for the whole order (products-after-minimum + shipping), before the surcharge.
  const orderCashBase = productsAfterDocMin + shippingWithVat;
  const grandTotal = orderCashBase * orderMultiplier;
  // How much of grandTotal is the document-minimum top-up on the products
  // alone (shipping is untouched by the minimum, so it cancels out here).
  const docMinTopUpCash = (productsAfterDocMin - total) * orderMultiplier;
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

  // Everything the agent configured on a line, as the customer-facing spec that
  // goes into the Morning income row's description. Until this existed, the
  // document only ever showed the product name + dimensions, so thickness,
  // elements, extras, installation and the agent's free text were all invisible
  // to the customer even though they're exactly what they're paying for.
  // Labels are pulled from the same maps the form renders, so the document says
  // what the agent saw on screen. Empty fields are skipped entirely — a line
  // never shows "0 אלמנטים" or a dangling "תוספות:".
  //
  const buildSpecLines = (formData, heading) => {
    const lines = [];

    // Dimensions · thickness · elements — the compact "measurements" line.
    const head = [];
    if (formData?.widthM && formData?.heightM) head.push(`${formData.widthM}×${formData.heightM} מ׳`);
    // Lokobond and PVC carpet never show a thickness picker — thicknessMm on
    // those is a fixed internal price-tier key, not a customer-facing spec.
    const NO_THICKNESS_SPEC_TYPES = ["lokobond_diecut", "lokobond_plain", "pvc_carpet"];
    if (formData?.thicknessMm && !NO_THICKNESS_SPEC_TYPES.includes(formData?.productType)) {
      head.push(`עובי ${formData.thicknessMm} מ"מ`);
    }
    const elements = parseInt(formData?.elements) || 0;
    if (elements > 0) head.push(elements === 1 ? "אלמנט אחד" : `${elements} אלמנטים`);
    if (head.length) lines.push(head.join(" · "));

    const extras = (formData?.extras || [])
      .map((key) => EXTRAS_OPTIONS.find((o) => o.key === key)?.label)
      .filter(Boolean);
    if (extras.length) lines.push(`תוספות: ${extras.join(", ")}`);

    // Stickers only — region is meaningless (and not asked for) without installation.
    if (formData?.includeInstallation === "yes") {
      lines.push(`כולל התקנה${formData.region ? ` (${formData.region})` : ""}`);
    } else if (formData?.includeInstallation === "no") {
      lines.push("ללא התקנה");
    }

    // Kapa shelves — priced as part of the line, so they belong in its description.
    const standardShelves = parseInt(formData?.standardShelves) || 0;
    const customShelves = parseInt(formData?.customShelves) || 0;
    const shelves = [];
    if (standardShelves > 0) shelves.push(standardShelves === 1 ? "מדף סטנדרטי אחד" : `${standardShelves} מדפים סטנדרטיים`);
    if (customShelves > 0) shelves.push(customShelves === 1 ? "מדף אחד בעיצוב אישי" : `${customShelves} מדפים בעיצוב אישי`);
    const legsQty = parseInt(formData?.legsQty) || 0;
    const coloredShelfQty = parseInt(formData?.coloredShelfQty) || 0;
    if (legsQty > 0) shelves.push(legsQty === 1 ? "רגל אחת עשויה קאפה" : `${legsQty} רגליים עשויות קאפה`);
    if (coloredShelfQty > 0) shelves.push(coloredShelfQty === 1 ? "מדף צבעוני אחד ללא חיתוך צורני" : `${coloredShelfQty} מדפים צבעוניים ללא חיתוך צורני`);
    if (shelves.length) lines.push(shelves.join(", "));

    // The agent's own free text goes last, on one "הערה:" line — deduped
    // against the heading: for free_product the lineLabel IS the product name
    // (already the heading), and agents often repeat the same note in both
    // fields; either way it should only ever print once.
    //
    // The "הערה:" prefix isn't decoration. Morning's PDF honours the newlines,
    // but its web preview (and WhatsApp) collapse them into spaces — without a
    // marker the note runs straight into the spec and reads as part of it.
    // Every other line already self-labels ("עובי", "תוספות:"); this one didn't.
    if (formData?.lineLabel?.trim() && formData?.productType !== "free_product" && formData.lineLabel.trim() !== heading) {
      lines.push(`הערה: ${formData.lineLabel.trim()}`);
    }

    return lines;
  };

  // Product name on the first line, full spec underneath. Fixed-price catalog
  // families (kapa/rollup/glass) are picked as a specific tier row — that
  // row's own description already carries its size/spec (e.g. "קאפה ללא
  // חיתוך צורני במידות..."), so it's used as the title instead of the bare
  // category name, or the size the customer is paying for would be invisible
  // on the document.
  const lineTitle = (formData, fallback) =>
    formData?.result?.kapaDescription || formData?.result?.rollupDescription || formData?.result?.glassDescription || fallback;

  // `itemLabel` is the agent's custom name for the item (the pencil field). Its
  // tooltip promises it "יופיע בהצעת המחיר", and agents use it for real
  // production notes ("לשלב PVC לבן עם צביעה בתנור ראל 705"), so it has to
  // reach Morning. It's appended right onto the title line — directly under
  // the מק"ט in the Morning document — rather than buried in the "הערה:" line
  // at the bottom with the free-text note, since it's the item's own name,
  // not a side comment about it. The auto "מוצר N" default is filtered out by
  // the caller, so this only ever fires for a name the agent actually typed.
  const lineDescription = (title, formData, itemLabel) => {
    const heading = itemLabel?.trim() && itemLabel.trim() !== title ? `${title} — ${itemLabel.trim()}` : title;
    return [heading, ...buildSpecLines(formData, heading)].join("\n");
  };

  // Fixed-price catalog families (kapa/rollup/glass) carry their own per-row
  // SKU on the calc result; everything else uses its static מק"ט from the
  // picker (same code shown next to the product everywhere in the UI). Just
  // the bare code — the product category name already opens the description
  // (`lineTitle` above), so repeating IT in the מק"ט column would show it
  // twice. The agent's own item name (itemLabel) is different: Morning's
  // מק"ט column is the one thing visible in narrow views/exports without
  // opening the row, so it needs to carry the name too, not just the
  // description heading.
  const lineSku = (formData, itemLabel) => {
    if (formData?.productType === "free_product") return null;
    const code = formData?.result?.kapaSku || formData?.result?.rollupSku || formData?.result?.glassSku
      || PRODUCT_CODES[formData?.productType] || null;
    if (!code) return null;
    return itemLabel?.trim() ? `${code} · ${itemLabel.trim()}` : code;
  };

  const buildLineItems = () => {
    const lines = [];
    items.forEach((item, index) => {
      const formData = formDataMap[item.id];
      if (!formData?.productType) return;
      const groupLabel = items.length > 1 ? itemDisplayName(item.id, index) : null;
      // Only a name the agent actually typed — `itemDisplayName` falls back to
      // "מוצר N", which is UI scaffolding and means nothing to the customer.
      // Unlike groupLabel this applies to single-item quotes too: the agent can
      // name the one item, and that note is just as real.
      const itemLabel = itemLabels[item.id]?.trim() || "";
      const isFree = formData.productType === "free_product";
      const sku = lineSku(formData, itemLabel);
      lines.push({
        groupLabel,
        description: lineDescription(
          isFree ? (formData.lineLabel || "מוצר חופשי") : lineTitle(formData, PRODUCT_NAMES[formData.productType] || formData.productType),
          formData,
          itemLabel,
        ),
        freeText: formData.lineLabel || "",
        quantity: parseInt(formData.quantity) || 1,
        unitPrice: formData.result?.sellingPricePerUnit ?? 0,
        sku,
      });
      // Graphics notes as their own zero-price line, right under the product
      // they belong to — a real separate row in the Morning document (not
      // just an extra sentence inside the product's own description block),
      // so it reads as "this note is about the item above" without affecting
      // the product's price. Its own מק"ט carries the parent line's code so
      // it's clear which product the note is about even when rows get
      // reordered or the description is skimmed.
      if (formData.graphicsNote?.trim()) {
        lines.push({
          groupLabel,
          description: `גרפיקה: ${formData.graphicsNote.trim()}`,
          freeText: "",
          quantity: 1,
          unitPrice: 0,
          sku: sku ? `${sku} גרפיקה` : null,
          isNote: true, // skipped as the document-minimum top-up target below
        });
      }
      (formData.extraRows || []).forEach((row) => {
        if (!row.result) return;
        lines.push({
          groupLabel,
          // An extra row is the same configured product at a different size, so
          // it inherits the parent's spec (thickness/extras/installation) and
          // overrides only what the row itself asks for — exactly the merge
          // CalculatorTab feeds to calculate() for this row.
          description: lineDescription(
            `${PRODUCT_NAMES[formData.productType] || formData.productType} — מידה נוספת`,
            { ...formData, widthM: row.widthM, heightM: row.heightM, elements: row.elements || "", lineLabel: row.lineLabel },
            itemLabel,
          ),
          freeText: row.lineLabel || "",
          quantity: parseInt(row.quantity) || 1,
          unitPrice: row.result.sellingPricePerUnit ?? 0,
          sku: lineSku(formData, itemLabel),
        });
      });
    });
    // documentMinimumPrice (grandTotal) is a floor applied on top of the raw
    // per-product prices above. Morning must still see the real charged
    // amount, but the top-up is never called out as its own line — the
    // customer isn't told "minimum order" was applied. Instead it's folded
    // silently into the last product line's unit price. Convert the
    // cash/incl-VAT/incl-installments shortfall back to the same pre-VAT,
    // pre-installment-surcharge basis the other unitPrice values are in.
    // (Only the agent sees the minimum was hit — via the CostResults/
    // SalesResults badges in this app, never in the Morning document.)
    if (docMinTopUpCash > 0.01 && lines.length > 0) {
      const topUpPreVat = docMinTopUpCash / (vatMultiplier * orderMultiplier);
      // Skip note-only rows (graphics notes) — the top-up must land on an
      // actual priced product line, not silently attach a price to what's
      // meant to read as a zero-cost note.
      const pricedLines = lines.filter((l) => !l.isNote);
      const lastLine = pricedLines[pricedLines.length - 1] || lines[lines.length - 1];
      lastLine.unitPrice = (lastLine.unitPrice || 0) + topUpPreVat / (lastLine.quantity || 1);
    }
    // משלוח/איסוף עצמי — תמיד שורה משלו במורנינג, גם כשאיסוף עצמי (מחיר 0),
    // כדי שהמסמך ישקף איך הלקוח מקבל את ההזמנה, וגם שסכום השורות יכלול בפועל
    // את עלות המשלוח (לא רק את מחירי המוצרים). משלוח כולל את כתובת הלקוח
    // בתיאור השורה עצמה, כדי שיהיה ברור לאן נשלחת ההזמנה.
    const shippingDescription = delivery === "shipping"
      ? `משלוח${clientAddress.trim() ? ` לכתובת ${clientAddress.trim()}` : ""}`
      : "איסוף עצמי";
    lines.push({
      groupLabel: null,
      description: shippingDescription,
      freeText: "",
      quantity: 1,
      unitPrice: delivery === "shipping" ? (parseFloat(shipping) || 0) : 0,
      sku: delivery === "shipping" ? "משלוח" : "איסוף עצמי",
    });
    return lines;
  };

  // Full snapshot for "שכפל" (My Quotes tab) to reopen this exact quote here
  // for editing later — deliberately separate from calculation_data below,
  // which is a write-mostly pricing/margin summary for QuoteDetailsModal and
  // was never meant to round-trip back into live form state.
  const buildBuilderState = () => ({
    items: items.map(({ id, tabKey }) => ({ id, tabKey })),
    formDataMap,
    itemLabels,
    clientName, clientPhone, clientAddress, clientVatId, clientEmail, clientPaymentTerms,
    morningClientId,
    documentTitle, agentNote,
    shipping, delivery, installmentCount,
  });

  const buildQuotePayload = (status) => ({
    client_name: clientName.trim(),
    client_phone: clientPhone.trim(),
    client_address: clientAddress.trim(),
    client_vat_id: clientVatId.trim(),
    client_email: clientEmail.trim(),
    client_payment_terms: clientPaymentTerms,
    morning_client_id: morningClientId || undefined,
    product_category: categoryOf(formDataMap[items[0]?.id]?.productType),
    payment_type: installmentCount > 1 ? `installments:${installmentCount}` : "cash",
    price_before_vat: Math.round(grandBeforeVat * 100) / 100,
    price_with_vat: Math.round(grandTotal * 100) / 100,
    line_items: JSON.stringify(buildLineItems()),
    builder_state: JSON.stringify(buildBuilderState()),
    // Opened via "שכפל" from an existing quote — the new row replaces that one
    // everywhere it is counted, and says so on the list via `origin`.
    ...(sourceQuoteNumber ? { parent_quote_number: sourceQuoteNumber, origin: "duplicate" } : { origin: "new" }),
    calculation_data: JSON.stringify({
      items: items.map((item, index) => ({
        index,
        productType: formDataMap[item.id]?.productType,
        widthM: formDataMap[item.id]?.widthM,
        heightM: formDataMap[item.id]?.heightM,
        thicknessMm: formDataMap[item.id]?.thicknessMm,
        quantity: formDataMap[item.id]?.quantity,
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

  // clientPhone is no longer a separately-typed field — it's meant to only
  // ever exist once morningClientId is set, via "שמור לקוח" or picking an
  // existing client — but neither of those actually guarantees a phone was
  // entered (a saved-client Morning record, or "שמור לקוח" itself, can both
  // have no phone on file), and the server hard-requires client_phone to save
  // a quote at all (routes/entities.js quoteCreate). Without checking it here
  // too, a client saved/selected without a phone shows as "valid" and only
  // fails with a raw, unexplained error once the agent tries to send/issue —
  // exactly the bug this line now prevents.
  // Address is only required for actual delivery — pickup orders have nowhere
  // to ship to, so nothing to require here.
  const isQuoteValid = clientName.trim() && morningClientId && clientPhone.trim() && (delivery !== "shipping" || clientAddress.trim()) && documentTitle.trim() && grandTotal > 0;

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

  const addAttachedFiles = (fileList) => {
    const incoming = Array.from(fileList || []).filter((f) => ACCEPTED_ATTACHMENT_MIME.has(f.type));
    if (!incoming.length) return;
    setAttachedFiles((prev) => {
      const merged = [...prev, ...incoming];
      if (merged.length > MAX_ATTACHMENTS) {
        toast.error(`ניתן לצרף עד ${MAX_ATTACHMENTS} קבצים`);
        return merged.slice(0, MAX_ATTACHMENTS);
      }
      return merged;
    });
  };
  const removeAttachedFile = (index) => setAttachedFiles((prev) => prev.filter((_, i) => i !== index));

  // Best-effort — a failed attachment upload must never make the agent think
  // the whole quote (draft/send) failed, since it already saved successfully
  // by this point. Reported as its own toast instead.
  const uploadPendingAttachments = async (quoteId) => {
    if (!attachedFiles.length) return;
    try {
      await base44.quotes.uploadAttachments(quoteId, attachedFiles);
      setAttachedFiles([]);
    } catch {
      toast.error("ההצעה נשמרה, אך העלאת הקבצים המצורפים נכשלה");
    }
  };

  // When the calculator was opened from a CRM lead ("בנה הצעה" on My Day),
  // link the resulting quote back to that lead: it flips the lead to 'quoted'
  // and stamps signshop_quotes.lead_id, which is what later lets the issued
  // PDF get pushed onto the lead's monday row. Fire-and-forget — a CRM
  // hiccup must never make a successfully-saved quote look failed.
  const linkLeadIfAny = (created) => {
    if (!sourceLeadId || !created?.id) return;
    crmLeads.convert(sourceLeadId, created.id)
      .catch((err) => console.error('[calculator] lead link failed:', err.message));
  };

  const handleSave = async () => {
    if (!isQuoteValid) return;
    setSaving(true);
    try {
      const created = await base44.entities.Quote.create(buildQuotePayload("draft"));
      linkLeadIfAny(created);
      setSavedQuoteNumber(created.quote_number);
      await uploadPendingAttachments(created.id);
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
      linkLeadIfAny(created);
      setSavedQuoteNumber(created.quote_number);
      await uploadPendingAttachments(created.id);
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
      linkLeadIfAny(created);
      setSavedQuoteNumber(created.quote_number);
      const result = await issueQuoteToMorning(created);
      if (result.issued) {
        toast.success(`ההצעה ${created.quote_number} הונפקה ללקוח`);
        const url = result.document?.url && (result.document.url.he || result.document.url.origin);
        if (url) setIssuedDocument({ url, label: `הצעת מחיר ${created.quote_number}` });
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
    <div className="flex flex-col gap-6">
      <StepDivider step={1} label="פרטי המסמך והמוצרים" />

      {/* MAIN — the whole document as one white "page", distinct from the gray screen background.
          Sits first: client details and line items are what the agent fills in before there's
          anything to summarize, so the summary/actions below read as the natural next step. */}
      <div className="w-full">
        <div className="bg-white border border-black rounded-2xl shadow-sm p-5 sm:p-6 space-y-8">
          {/* פרטי המסמך — required fields get a clear box + a red/emerald state
              (empty vs. filled) instead of a thin underline, so the two things
              an agent must do first (name a client, title the document) are
              visually unmistakable rather than blending into the page. */}
          <section className="space-y-5">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-5 rounded-full bg-amber-400" />
              <h3 className="text-xl font-bold text-black">פרטי המסמך</h3>
            </div>
            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-lg font-semibold text-black">
                  שם לקוח <span className="text-red-500 font-bold">*</span>
                </label>
                <ClientSearchField
                  value={clientName}
                  onChange={(v) => { setClientName(v); setMorningClientId(null); }}
                  onSelect={(c) => {
                    setClientName(c.name);
                    setClientPhone(c.phone || "");
                    setClientAddress(c.address || "");
                    setClientVatId(c.vatId || "");
                    setClientEmail(c.email || "");
                    setClientPaymentTerms(c.paymentTerms ?? 0);
                    setMorningClientId(c.id);
                  }}
                  placeholder="שם הלקוח — חפש לקוח קיים או הקלד חדש"
                  className={`w-full h-11 rounded-xl border-2 px-3 text-base font-medium placeholder:text-slate-500 placeholder:font-normal focus-visible:outline-none transition-colors ${
                    clientName.trim()
                      ? "border-emerald-300 bg-emerald-50/40 text-black focus-visible:border-emerald-400"
                      : "border-red-300 bg-red-50/40 focus-visible:border-red-400"
                  }`}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-lg font-semibold text-black">
                  כותרת המסמך <span className="text-red-500 font-bold">*</span>
                </label>
                <input
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  placeholder="לדוגמה: שילוט חזית לחנות"
                  className={`w-full h-11 rounded-xl border-2 px-3 text-base font-medium placeholder:text-slate-500 placeholder:font-normal focus-visible:outline-none transition-colors ${
                    documentTitle.trim()
                      ? "border-emerald-300 bg-emerald-50/40 text-black focus-visible:border-emerald-400"
                      : "border-red-300 bg-red-50/40 focus-visible:border-red-400"
                  }`}
                />
              </div>
            </div>

            {/* Phone/VAT/email/payment-terms are never inline fields here —
                they only ever get collected through this one explicit action
                (or by picking an existing client above), never re-typed loose
                on the document form. This is also a required gate for the
                quote (see isQuoteValid), so it gets the same red/emerald
                treatment as the two fields above — never a quiet muted line
                the agent could miss. */}
            {morningClientId && clientPhone.trim() ? (
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 bg-emerald-50 border-2 border-emerald-300 rounded-xl px-3 py-2.5 w-fit">
                <CheckCircle2 className="w-4 h-4" />
                לקוח שמור במורנינג · {clientPhone}
              </div>
            ) : morningClientId ? (
              // A saved/selected client with no phone on file — shows as amber,
              // not the green "valid" state, since the server will reject the
              // quote without one. Reopening "שמור לקוח" lets the phone be added.
              <button
                type="button"
                onClick={() => setShowSaveClientModal(true)}
                className="flex items-center gap-2 text-sm font-bold text-amber-700 bg-amber-100 border-2 border-amber-400 rounded-xl px-4 py-2.5 hover:bg-amber-200 hover:border-amber-500 transition-colors w-fit shadow-sm"
              >
                <Save className="w-4 h-4" />
                חסר מספר טלפון ללקוח — יש להשלים לפני שליחה/הנפקה
              </button>
            ) : clientName.trim() ? (
              <button
                type="button"
                onClick={() => setShowSaveClientModal(true)}
                className="flex items-center gap-2 text-sm font-bold text-amber-700 bg-amber-100 border-2 border-amber-400 rounded-xl px-4 py-2.5 hover:bg-amber-200 hover:border-amber-500 transition-colors w-fit shadow-sm"
              >
                <Save className="w-4 h-4" />
                שמור לקוח — שלב חובה לפני שליחה/הנפקה
              </button>
            ) : (
              <p className="text-sm font-medium text-red-500">יש להזין שם לקוח ואז לשמור אותו (טלפון, ח.פ, אימייל ותנאי תשלום נאספים בשלב הזה)</p>
            )}
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
            <h3 className="text-xl font-bold text-black">פירוט</h3>
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
                const kapaAddonPrice = (qty, priceKey, productKey) => {
                  const n = parseInt(qty) || 0;
                  const unitPrice = parseFloat(config?.[priceKey]) || 0;
                  const override = formData?.dealOverrides?.[productKey];
                  if (!override) return n * unitPrice;
                  const dealPrice = parseFloat(override.price) || 0;
                  return override.mode === "override" ? dealPrice : n * unitPrice + dealPrice;
                };
                const shelvesPrice = categoryOf(pt) === "kapa"
                  ? kapaAddonPrice(formData?.standardShelves, "kapa_shelf_standard_price", "standardShelf") +
                    kapaAddonPrice(formData?.customShelves, "kapa_shelf_custom_price", "customShelf") +
                    kapaAddonPrice(formData?.legsQty, "kapa_legs_price", "legs") +
                    kapaAddonPrice(formData?.coloredShelfQty, "kapa_colored_shelf_price", "coloredShelf")
                  : 0;
                return (
                  // Whole row opens the product for editing — not just the small
                  // "ערוך" text — so re-opening a locked line to tweak, say, the
                  // quantity is a single click anywhere on it.
                  <div
                    key={item.id}
                    onClick={() => toggleItemLock(item.id, false)}
                    className="flex items-center justify-between gap-4 border-2 border-black rounded-2xl px-4 sm:px-5 py-3.5 bg-white cursor-pointer hover:border-amber-300 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {img && !isFree && (
                        <img src={img} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0 border border-black" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xl font-bold text-black truncate">{itemDisplayName(item.id, index)}</span>
                          {sku && <span className="text-lg font-mono text-black shrink-0">מק"ט {sku}</span>}
                        </div>
                        <div className="text-lg text-black font-medium truncate">
                          {pt ? (isFree ? (formData.lineLabel || "מוצר חופשי") : (PRODUCT_NAMES[pt] || pt)) : "לא נבחר מוצר"}
                          {extraCount > 0 ? ` · +${extraCount} מידות נוספות` : ""}
                        </div>
                        {unitArea != null && (
                          <div className="text-xl font-semibold text-black mt-0.5">
                            {w}×{h} מ' <span className="text-slate-300 mx-1">·</span> כמות {q}
                            <span className="text-slate-300 mx-1">·</span>
                            סה"כ {totalArea.toFixed(2)} מ"ר
                          </div>
                        )}
                        {shelvesPrice > 0 && (
                          <div className="text-xs text-amber-600 mt-0.5">עלות מדפים: {fmt(shelvesPrice)}</div>
                        )}
                      </div>
                    </div>
                    <span className="text-base font-bold text-amber-600 shrink-0">{fmt(prices[item.id])}</span>
                    <span className="text-lg text-black px-2 py-1 shrink-0">ערוך</span>
                    {items.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
                        className="flex items-center gap-1 text-sm text-red-500/70 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              }
              return (
                // Each product is its own isolated card — a clear, visibly gray
                // frame fully separates it from the product before/after it (not
                // just a thin divider line), per the "no shared bleed between
                // products" rule. Solid slate-50 (not /50 translucent) + shadow so
                // the frame reads clearly against the white page behind it.
                <div key={item.id} className="relative border-2 border-black rounded-2xl p-4 sm:p-5 bg-slate-50 shadow-sm">
                  <div className="flex items-center justify-between mb-3 gap-3">
                    <div className="relative min-w-0 flex-1 group">
                      <input
                        value={itemLabels[item.id] || ""}
                        onChange={(e) => setItemLabel(item.id, e.target.value)}
                        placeholder={`מוצר ${index + 1} (לחצו כדי לתת שם משלכם)`}
                        title="שם מותאם למוצר זה — יופיע בהצעת המחיר במקום 'מוצר N'"
                        className="w-full text-sm font-semibold text-zinc-600 tracking-wide bg-white border border-dashed border-black rounded-lg hover:border-amber-400 focus-visible:outline-none focus-visible:border-amber-400 focus-visible:border-solid focus-visible:ring-2 focus-visible:ring-amber-100 pl-8 pr-2 py-1.5 transition-colors"
                      />
                      <Pencil className="w-3.5 h-3.5 text-black absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none group-focus-within:text-amber-500" />
                    </div>
                    {items.length > 1 && (
                      <button
                        onClick={() => toggleItemLock(item.id, true)}
                        className="text-lg text-black hover:text-amber-600 transition-colors px-2 py-1 rounded-lg hover:bg-amber-50"
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
                      numberPriceTiers={numberPriceTiers}
                      graphicsPriceTiers={graphicsPriceTiers}
                      defaultForm={EMPTY_ITEM_FORM}
                      initialFormData={formDataMap[item.id]}
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

            {/* Add product — 30% width (shortened 70%), pinned to the right edge.
                justify-start, not justify-end: this page is dir="rtl", where
                flex's "end" is the LEFT edge — "start" is the right one. */}
            <div className="flex justify-start">
            <button
              onClick={addItem}
              className="w-[30%] flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border border-amber-300 bg-amber-50 text-base font-semibold text-amber-600 hover:bg-amber-100 hover:border-amber-400 transition-all"
            >
              <Plus className="w-4 h-4" /> הוסף מוצר נוסף
            </button>
            </div>
          </section>
        </div>
      </div>

      <StepDivider step={2} label="משלוח" />

      {/* משלוח — its own step, separate from both the document above and the
          summary below: pickup needs no address to complete the order, but
          delivery does, so the address field lives here (not in the summary)
          and its required/optional state follows this screen's own choice. */}
      <div className="w-full">
        <div className="bg-white border border-black rounded-2xl shadow-sm p-5 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <div className="space-y-1.5">
              <span className="text-lg text-black font-semibold">אספקה</span>
              <div className="grid grid-cols-2 gap-2">
                {[{ v: "pickup", l: "איסוף עצמי" }, { v: "shipping", l: "משלוח" }].map(({ v, l }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setDelivery(v)}
                    className={`h-11 rounded-md border-2 text-base font-semibold transition-colors ${
                      delivery === v ? "border-amber-400 bg-amber-50 text-amber-700" : "border-black bg-slate-50 text-black hover:bg-slate-100"
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
                    className="flex h-11 w-full rounded-md border-2 border-black bg-slate-50 pl-7 pr-3 text-base font-semibold text-left placeholder:text-slate-500 placeholder:font-normal focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-lg text-black pointer-events-none">₪</span>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-lg font-semibold text-black">
                כתובת {delivery === "shipping" && <span className="text-red-500 font-bold">*</span>}
              </label>
              <input
                value={clientAddress}
                onChange={(e) => setClientAddress(e.target.value)}
                placeholder={delivery === "pickup" ? "לא חובה — נבחר איסוף עצמי" : "רחוב, עיר"}
                className={`w-full h-11 rounded-xl border-2 px-3 text-base font-medium placeholder:text-slate-500 placeholder:font-normal focus-visible:outline-none transition-colors ${
                  delivery === "pickup"
                    ? "border-black bg-white text-black focus-visible:border-amber-400"
                    : clientAddress.trim()
                      ? "border-emerald-300 bg-emerald-50/40 text-black focus-visible:border-emerald-400"
                      : "border-red-300 bg-red-50/40 focus-visible:border-red-400"
                }`}
              />
            </div>
          </div>
        </div>
      </div>

      <StepDivider step={3} label="סיכום ההזמנה" />

      {/* SUMMARY + ACTIONS — moved below the document (was a side panel) so the
          order summary reads as the primary next step after filling in the
          document, not a secondary column competing for attention. Three
          stacked windows top to bottom: document, then summary, then actions —
          not side by side, so the flow reads as one sequence. */}
      <div className="w-full">
        <div className="flex flex-col gap-6">
        <div className="w-full bg-white border-2 border-amber-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-amber-500" />
            <span className="text-lg font-bold text-amber-600">סיכום הזמנה</span>
          </div>

          {/* Order details */}
          <div className="space-y-3 border-b border-slate-100 pb-3">
            <div className="flex justify-between items-center text-base">
              <span className="text-black font-medium">מספר מוצרים</span>
              <span className="font-bold text-black">{items.length}</span>
            </div>

            {/* Payments — the only decision still made here; delivery/address
                already happened a step earlier (see the משלוח step above). */}
            <div className="space-y-1.5">
              <span className="text-lg text-black font-semibold">שיטת תשלום</span>
              <select
                value={installmentCount}
                onChange={(e) => setInstallmentCount(parseInt(e.target.value))}
                className="h-11 w-full rounded-md border-2 border-black bg-white px-2 text-base font-bold text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value={1}>תשלום מזומן / העברה בנקאית / תשלום 1 באשראי</option>
                {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (<option key={n} value={n}>תשלום באשראי עד {n} תשלומים</option>))}
              </select>
              {installmentCount > 1 && (
                <div className="text-sm text-black font-medium">כולל תוספת {(installmentSurchargePctTotal * 100).toFixed(1)}% על מחיר מזומן</div>
              )}
            </div>
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
                    <div key={item.id} className="flex justify-between text-base">
                      <span className="text-black font-medium">{itemDisplayName(item.id, index)} - מחיר</span>
                      <span className="text-black font-semibold">{fmt(itemBeforeVat)}</span>
                    </div>
                  );
                })}
                {delivery === "shipping" && shippingPreVat > 0 && (
                  <div className="flex justify-between text-base">
                    <span className="text-black font-medium">עלות משלוח</span>
                    <span className="text-black font-semibold">{fmt(shippingPreVat * orderMultiplier)}</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-between text-base">
              <span className="text-black font-medium">מחיר לפני מע״מ</span>
              <span className="font-bold text-black">{fmt(grandBeforeVat)}</span>
            </div>
            <div className="flex justify-between text-base">
              <span className="text-black font-medium">מע״מ ({vatPct}%)</span>
              <span className="font-bold text-black">{fmt(vatAmount)}</span>
            </div>
          </div>

          {/* Grand total */}
          <div className="flex justify-between items-center border-t border-amber-200 pt-3">
            <span className="text-xl font-bold text-black">סה״כ כולל מע״מ</span>
            <span className="text-2xl font-bold text-amber-600">{fmt(grandTotal)}</span>
          </div>
        </div>

        <StepDivider step={4} label="שליחה / הנפקה" />

        {/* Save / send */}
        <div className="w-full bg-white border-2 border-black rounded-2xl p-5 shadow-sm space-y-3">

          {/* Background for the manager — shown only in the review screen
              (QuotesHistory/QuoteDetailsModal), never on the client document. */}
          {/* Notes take the right 3/4 of the row (dir="rtl", so first flex-child
              is the right one), attachments the remaining 1/4 on the left —
              side by side instead of stacked, since neither needs full width.
              Notes gets the same solid boxed treatment as the dropzone (was a
              bare thin-border textarea, which read as unstyled/broken next to
              the dropzone's bolder dashed box) so the two sit at equal visual
              weight. */}
          <div className="flex flex-col sm:flex-row gap-4 items-stretch">
            <div className="w-full sm:w-[85%] flex flex-col">
              <textarea
                title="הערה למנהל המכירות (רקע להצעה, לא מוצג ללקוח)"
                value={agentNote}
                onChange={(e) => setAgentNote(e.target.value)}
                placeholder="לדוגמה: הלקוח ביקש הנחה כי הוא מזמין קבוע, סוכם על משלוח מהיר..."
                rows={4}
                className="w-full flex-1 rounded-lg border-2 border-dashed border-black bg-white px-3 py-2.5 text-base placeholder:text-slate-500 focus-visible:outline-none focus-visible:border-amber-400 focus-visible:ring-2 focus-visible:ring-amber-200 resize-none"
              />
            </div>
            <div className="w-full sm:w-[15%] flex flex-col">
              <AttachmentDropZone files={attachedFiles} onFilesAdded={addAttachedFiles} onRemove={removeAttachedFile} />
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || sending || issuing || !isQuoteValid}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
              saved
                ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-600"
                : "bg-white border-black text-black hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
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
        </div>
        </div>
      </div>

      {issuedDocument && (
        <DocumentIssuedModal
          documentUrl={issuedDocument.url}
          documentLabel={issuedDocument.label}
          onClose={() => setIssuedDocument(null)}
        />
      )}

      {showSaveClientModal && (
        <NewClientModal
          initialName={clientName}
          onClose={() => setShowSaveClientModal(false)}
          onCreated={(c) => {
            setClientName(c.name);
            setClientPhone(c.phone || "");
            setClientAddress(c.address || "");
            setClientVatId(c.vatId || "");
            setClientEmail(c.email || "");
            setClientPaymentTerms(c.paymentTerms ?? 0);
            setMorningClientId(c.id);
            setShowSaveClientModal(false);
          }}
        />
      )}
    </div>
  );
}