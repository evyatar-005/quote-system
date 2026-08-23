// Shared line-item / economics helpers for the quote analytics screens
// (QuotesAnalytics — per-agent, ProductAnalytics — per-product). Kept in one
// place so "what counts as a line" and "how is profit derived" can never
// drift between the two.
import { CATEGORY_LABELS } from "@/lib/quoteLabels";
import { PRODUCT_NAMES, PRODUCT_CODES, categoryOf } from "@/components/calculator/CalculatorForm";

// tabKey values MultiProductCalculator's TABS actually offers (CostsDashboard.jsx)
// — the only ones categoryOf() can map a saved productType onto that the live
// calculator can reopen. Anything else (e.g. a family only reachable from a
// different calculator entirely) can't be reconstructed into this shape.
const RECONSTRUCTABLE_TAB_KEYS = new Set(["logo", "sticker", "kapa", "lokobond", "foamex", "rollup"]);

export const safeParse = (json, fallback) => {
  try {
    return json ? JSON.parse(json) : fallback;
  } catch {
    return fallback;
  }
};

// free_product is a real productType the calculator writes, but it is not in
// PRODUCT_NAMES (it has no catalogue entry — the agent types its own price and
// name), so it used to fall through to the raw English slug on every
// analytics screen.
const EXTRA_PRODUCT_LABELS = { free_product: "מוצר חופשי" };
export const productLabel = (t) => PRODUCT_NAMES[t] || CATEGORY_LABELS[t] || EXTRA_PRODUCT_LABELS[t] || t;
export const productSku = (t) => PRODUCT_CODES[t] || "";
// "005-1" sorts before "005-10" and after "003-6" — compare the numeric parts,
// not the raw string, so the מק"ט order matches the catalogue.
export const compareSku = (a, b) =>
  productSku(a).localeCompare(productSku(b), "en", { numeric: true }) ||
  productLabel(a).localeCompare(productLabel(b), "he");

// Every priced line in a quote — parent items plus their extra-size rows.
// `quantity` lives on the item/row itself, not inside `result`, so it's
// carried through explicitly (defaults to 1, matching how the calculator
// treats a blank/omitted quantity).
export function linesOf(quote) {
  const calc = safeParse(quote.calculation_data, null);
  const items = calc?.items || (calc?.result ? [{ productType: calc.productType, result: calc.result, quantity: calc.quantity }] : []);
  const out = [];
  for (const it of items) {
    if (it?.result) out.push({ productType: it.productType, result: it.result, quantity: parseFloat(it.quantity) || 1 });
    for (const er of it?.extraRows || []) {
      if (er?.result) out.push({ productType: it.productType, result: er.result, quantity: parseFloat(er.quantity) || 1 });
    }
  }
  return out;
}

// Cost is the only figure we can trust from the saved line items; REVENUE
// must come from the quote's own price_before_vat. The two do not match on
// most real quotes — the quote total also carries the document minimum
// price, shipping, and any manager discount, none of which live on a line.
// Summing line prices would understate what the agent actually sold.
export function economicsOf(quote) {
  const lines = linesOf(quote);
  if (!lines.length) return null; // no saved breakdown → cannot cost it
  const cost = lines.reduce((s, l) => s + (l.result.totalCostAll || 0), 0);
  const revenue = quote.price_before_vat || 0;
  return { cost, revenue, profit: revenue - cost };
}

// Shipping is never its own DB column — it's a synthetic line pushed onto
// `line_items` (not `calculation_data`, which linesOf/economicsOf read) at
// save time, sku==="משלוח" (see buildLineItems in MultiProductCalculator.jsx).
// Used to derive "סכום עסקה" (deal amount excluding shipping only — VAT,
// document-minimum top-up and manager discounts all stay in) from
// economicsOf's revenue, which otherwise includes shipping.
export function shippingOf(quote) {
  const items = safeParse(quote.line_items, []);
  const line = Array.isArray(items) ? items.find((it) => it?.sku === "משלוח") : null;
  if (!line) return 0;
  return (parseFloat(line.unitPrice) || 0) * (parseFloat(line.quantity) || 1);
}

// Per-product rollup across a set of quotes, at the LINE level — deliberately
// excludes VAT, shipping and installation, none of which live on a line (see
// linesOf/economicsOf above). Used by the product-analytics charts, where
// "which product earned most" must not be diluted by quote-level extras that
// have no product to attach to.
// How far the quote's REAL pre-VAT total moved from the sum of its saved line
// prices — i.e. the manager's discount (and the document-minimum top-up),
// neither of which is written back onto the individual lines. Without this,
// a discounted deal still reports its full pre-discount price per product, so
// every product's revenue and profit read high. Mirrors the priceRatio logic
// CostBreakdown already uses in QuoteDetailsModal.jsx.
function discountRatioOf(quote, lines) {
  const linesTotal = lines.reduce((s, l) => s + (l.result.sellingPriceAll || 0), 0);
  if (!(linesTotal > 0)) return 1;
  const realTotal = (quote.price_before_vat || 0) - shippingOf(quote);
  if (!(realTotal > 0)) return 1;
  return realTotal / linesTotal;
}

// Per-product rollup across a set of quotes, at the LINE level — deliberately
// excludes VAT, shipping and installation, none of which live on a line (see
// linesOf/economicsOf above). Used by the product-analytics charts, where
// "which product earned most" must not be diluted by quote-level extras that
// have no product to attach to.
//
// `costedRevenue`/`costedProfit` cover only the lines that actually carry a
// saved cost. A line with no cost (free_product, and graphics-style rows that
// never had a cost breakdown) would otherwise report profit == revenue, i.e. a
// fake 100% margin, and silently inflate every profit figure on the screen.
// Margin is therefore computed on the costed subset only, and `costMissing`
// lets the UI say so instead of printing a number it can't stand behind.
export function aggregateProducts(quotes) {
  const map = {};
  for (const q of quotes) {
    const lines = linesOf(q);
    const ratio = discountRatioOf(q, lines);
    for (const l of lines) {
      const t = l.productType || "—";
      if (!map[t]) {
        map[t] = { type: t, name: productLabel(t), sku: productSku(t), revenue: 0, cost: 0, units: 0, lines: 0, costMissing: 0, costedRevenue: 0 };
      }
      const p = map[t];
      const lineRevenue = (l.result.sellingPriceAll || 0) * ratio;
      p.revenue += lineRevenue;
      p.units += l.quantity || 1;
      p.lines += 1;

      // Only the commission slice of cost moves with price; material, labour
      // and overhead are price-independent (same rule as CostBreakdown).
      const savedCost = l.result.totalCostAll;
      if (savedCost == null || savedCost === 0) {
        p.costMissing += 1;
        continue;
      }
      const commissions = (l.result.breakdown?.salesAgentCommissionCost || 0) + (l.result.breakdown?.marketingCommissionCost || 0);
      p.cost += savedCost + commissions * (ratio - 1);
      p.costedRevenue += lineRevenue;
    }
  }
  return Object.values(map).map((p) => {
    const costedProfit = p.costedRevenue - p.cost;
    return {
      ...p,
      // Whole-product profit stays unknown while any line lacks a cost — the
      // costed part alone is what the margin is honest about.
      profit: costedProfit,
      costedProfit,
      marginPct: p.costedRevenue > 0 ? (costedProfit / p.costedRevenue) * 100 : 0,
      hasCost: p.costedRevenue > 0,
      avgPrice: p.units > 0 ? p.revenue / p.units : 0,
      label: p.sku ? `${p.sku} · ${p.name}` : p.name,
    };
  });
}

// Revisions/duplicates ("שכפול") are saved as NEW quote rows carrying
// parent_quote_number — so an original that was sent for review and then
// re-issued with a manager's discount exists twice in the table, and any
// naive sum counts the same real deal two (or more) times.
//
// A quote is superseded iff some other quote names it as its parent; the one
// nothing points at is the live, current version of that deal. Returns only
// those, collapsing a revision chain of any depth to its latest link.
//
// `allQuotes` must be the FULL set, not a date/agent-filtered slice — a
// revision created outside the current filter still supersedes its parent
// inside it, and passing only the slice would silently resurrect the old row.
export function latestRevisionsOnly(quotes, allQuotes = quotes) {
  const superseded = new Set(
    allQuotes.map((q) => q.parent_quote_number).filter(Boolean)
  );
  return quotes.filter((q) => !superseded.has(q.quote_number));
}

// "שכפל" (MyQuotes.jsx) reopens a saved quote by restoring its builder_state —
// the full per-item form snapshot. Quotes saved out of QuoteDetailsModal's
// "שמור הצעה מתוקנת" before v1.0.85 never got one (fixed going forward in
// 2f89980), so duplicating one of those permanently opens to an empty product
// list with nothing to edit — builder_state was simply never written, there is
// no correct copy to recover.
//
// This rebuilds a best-effort builder_state from calculation_data instead,
// which every such quote DOES have (QuoteDetailsModal is what reads it to
// render the review screen). It recovers what calculation_data actually
// stores per item — productType/widthM/heightM/thicknessMm/quantity and any
// extra-size rows — but NOT things the live calculator form also tracks that
// calculation_data never saved (תוספות, אלמנטים, התקנה/אזור, שם פריט מותאם
// אישית). The agent needs to re-check those on each item after reopening;
// this is a recovery of dimensions and product selection, not a perfect
// restore. Returns null (never a half-broken shape) if any item's family
// isn't one the live calculator can actually reopen — see
// RECONSTRUCTABLE_TAB_KEYS above.
export function reconstructBuilderState(quote) {
  const calc = safeParse(quote.calculation_data, null);
  const items = calc?.items;
  if (!Array.isArray(items) || !items.length) return null;

  const builtItems = [];
  const formDataMap = {};
  let nextId = 1;

  for (const it of items) {
    const tabKey = categoryOf(it.productType);
    if (!RECONSTRUCTABLE_TAB_KEYS.has(tabKey)) return null;
    const id = nextId++;
    builtItems.push({ id, tabKey });
    formDataMap[id] = {
      productType: it.productType || "",
      widthM: it.widthM ?? "",
      heightM: it.heightM ?? "",
      thicknessMm: it.thicknessMm ?? "",
      quantity: it.quantity ?? "1",
      extras: [],
      lineLabel: "",
      extraRows: (it.extraRows || []).map((r) => ({
        id: r.id ?? Math.random(),
        lineLabel: r.lineLabel || "",
        widthM: r.widthM ?? "",
        heightM: r.heightM ?? "",
        quantity: r.quantity ?? "1",
        elements: r.elements || "",
      })),
    };
  }

  const installments = /^installments:(\d+)$/.exec(quote.payment_type || "");

  return {
    items: builtItems,
    formDataMap,
    itemLabels: {},
    clientName: quote.client_name || "",
    clientPhone: quote.client_phone || "",
    clientAddress: quote.client_address || "",
    clientVatId: quote.client_vat_id || "",
    clientEmail: quote.client_email || "",
    clientPaymentTerms: "",
    documentTitle: quote.notes || "",
    agentNote: quote.agent_note || "",
    // Not recoverable from calculation_data (shipping cost is folded into a
    // line total, not stored separately) — safe defaults the agent can change.
    shipping: "0",
    delivery: "pickup",
    installmentCount: installments ? parseInt(installments[1], 10) : 1,
  };
}
