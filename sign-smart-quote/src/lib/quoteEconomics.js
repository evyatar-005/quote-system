// Shared line-item / economics helpers for the quote analytics screens
// (QuotesAnalytics — per-agent, ProductAnalytics — per-product). Kept in one
// place so "what counts as a line" and "how is profit derived" can never
// drift between the two.
import { CATEGORY_LABELS } from "@/lib/quoteLabels";
import { PRODUCT_NAMES, PRODUCT_CODES } from "@/components/calculator/CalculatorForm";

export const safeParse = (json, fallback) => {
  try {
    return json ? JSON.parse(json) : fallback;
  } catch {
    return fallback;
  }
};

export const productLabel = (t) => PRODUCT_NAMES[t] || CATEGORY_LABELS[t] || t;
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

// Per-product rollup across a set of quotes, at the LINE level — deliberately
// excludes VAT, shipping and installation, none of which live on a line (see
// linesOf/economicsOf above). Used by the product-analytics charts, where
// "which product earned most" must not be diluted by quote-level extras that
// have no product to attach to.
export function aggregateProducts(quotes) {
  const map = {};
  for (const q of quotes) {
    for (const l of linesOf(q)) {
      const t = l.productType || "—";
      if (!map[t]) map[t] = { type: t, name: productLabel(t), sku: productSku(t), revenue: 0, cost: 0, units: 0, lines: 0 };
      const p = map[t];
      p.revenue += l.result.sellingPriceAll || 0;
      p.cost += l.result.totalCostAll || 0;
      p.units += l.quantity || 1;
      p.lines += 1;
    }
  }
  return Object.values(map).map((p) => {
    const profit = p.revenue - p.cost;
    return {
      ...p,
      profit,
      marginPct: p.revenue > 0 ? (profit / p.revenue) * 100 : 0,
      avgPrice: p.units > 0 ? p.revenue / p.units : 0,
      label: p.sku ? `${p.sku} · ${p.name}` : p.name,
    };
  });
}
