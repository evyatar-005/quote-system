// Vista (014 "שילוט משרדי ויסטה") catalog browser — three levels deep.
//
// The glow picker (004) is two levels because a glow sign IS one artwork at one
// size. Vista is not: the catalog is built as משפחה → מוצר → מידה, where one
// product ("Wall Signs - Portrait") ships in a dozen frame heights that don't
// cost the same. Flattening that would either hide the sizes or explode the
// grid into hundreds of near-identical cards, so the modal drills:
//   folders (families) → product cards (catalog artwork) → size rows (+ prices).
import { useEffect, useMemo, useState } from "react";
import { X, Search, ChevronLeft, Folder } from "lucide-react";
import { base44 } from "@/api/base44Client";
import CatalogImageViewer from "@/components/CatalogImageViewer";

// Cached at module scope: static reference data, and the picker is reopened
// once per quote line, many times a day.
let cachedCatalog = null;

export function vistaImageSrc(product) {
  return product?.image_file ? `/vista-pages/${product.image_file}` : null;
}

export function vistaSizeLabel(size) {
  if (!size) return "";
  return Number(size.height_mm) > 0 ? `${size.code} · ${size.height_mm} מ"מ` : size.code;
}

// The quote line keeps the vendor's English product name alongside the Hebrew
// one: the Hebrew is what the agent recognises, the English is what a Vista
// order confirmation and the catalog itself use.
export function vistaProductLabel(product) {
  if (!product) return "";
  return product.name_he ? `${product.name_he} (${product.name})` : product.name;
}

export function vistaLineLabel(product, size) {
  if (!product) return "";
  const s = size && size.code !== "יחידה" ? ` — ${vistaSizeLabel(size)}` : "";
  return `${product.family_he} · ${vistaProductLabel(product)}${s}`;
}

export default function VistaPicker({ open, onClose, onSelect }) {
  const [catalog, setCatalog] = useState(cachedCatalog || { products: [], sizes: [] });
  const [loading, setLoading] = useState(!cachedCatalog);
  const [family, setFamily] = useState(null);
  const [product, setProduct] = useState(null);
  const [query, setQuery] = useState("");
  // Which product's catalog spread the enlarge overlay is showing, if any.
  const [zoom, setZoom] = useState(null);

  useEffect(() => {
    if (!open || cachedCatalog) return;
    let alive = true;
    setLoading(true);
    Promise.all([base44.entities.VistaProduct.list(), base44.entities.VistaSize.list()])
      .then(([products, sizes]) => {
        cachedCatalog = {
          products: (products || []).filter((p) => Number(p.active) !== 0),
          sizes: (sizes || []).filter((s) => Number(s.active) !== 0),
        };
        if (alive) setCatalog(cachedCatalog);
      })
      .catch(() => { if (alive) setCatalog({ products: [], sizes: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open]);

  // Reset the drill-down every time the modal is reopened, so it never lands
  // the agent inside whatever folder they happened to browse last week.
  useEffect(() => {
    if (open) { setFamily(null); setProduct(null); setQuery(""); }
  }, [open]);

  const sizesByProduct = useMemo(() => {
    const map = new Map();
    for (const s of catalog.sizes) {
      if (!map.has(s.product_id)) map.set(s.product_id, []);
      map.get(s.product_id).push(s);
    }
    for (const list of map.values()) list.sort((a, b) => (a.height_mm || 0) - (b.height_mm || 0));
    return map;
  }, [catalog.sizes]);

  const families = useMemo(() => {
    const counts = new Map();
    for (const p of catalog.products) counts.set(p.family_he, (counts.get(p.family_he) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [catalog.products]);

  const q = query.trim().toLowerCase();
  // A search query deliberately ignores the open folder and searches the whole
  // catalog — an agent typing "directories" wants the product, not "no results
  // in this folder" because they were standing in the wrong one.
  const visibleProducts = useMemo(() => {
    if (q) return catalog.products.filter((p) => (p.name + " " + (p.name_he || "") + " " + p.family + " " + p.family_he).toLowerCase().includes(q));
    if (family) return catalog.products.filter((p) => p.family_he === family);
    return [];
  }, [catalog.products, q, family]);

  const pickSize = (size) => {
    onSelect(product, size);
    onClose();
  };

  if (!open) return null;

  const productSizes = product ? (sizesByProduct.get(product.id) || []) : [];

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 shrink-0">
          <span className="text-base font-mono font-semibold px-2 py-0.5 rounded bg-brand-teal text-white">014</span>
          <h2 className="text-xl font-bold text-slate-800">שילוט משרדי ויסטה</h2>
          {!product && (
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש מוצר…"
                className="w-full pr-8 pl-3 py-1.5 text-base rounded-lg border border-slate-300 focus:border-teal-400 focus:outline-none"
              />
            </div>
          )}
          <button type="button" onClick={onClose} className="mr-auto p-1.5 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center text-slate-400 py-16">טוען קטלוג…</div>
          ) : !catalog.products.length ? (
            <div className="text-center text-slate-400 py-16">קטלוג ויסטה ריק — יש לטעון אותו מהגדרות המנהל.</div>

          /* ── level 3: sizes of the chosen product ── */
          ) : product ? (
            <>
              <button
                type="button"
                onClick={() => setProduct(null)}
                className="flex items-center gap-1 mb-4 text-base font-semibold text-slate-500 hover:text-teal-600"
              >
                <ChevronLeft className="w-4 h-4" />
                חזרה · {product.family_he}
              </button>
              <div className="flex gap-5 items-start flex-wrap">
                <div className="w-64 shrink-0">
                  {vistaImageSrc(product) && (
                    <button
                      type="button"
                      onClick={() => setZoom(product)}
                      className="block w-full rounded-xl border border-slate-200 bg-slate-50 overflow-hidden hover:border-teal-400 transition-colors"
                      title="לחץ להגדלה"
                    >
                      <img src={vistaImageSrc(product)} alt={product.name} className="w-full" />
                      <span className="block text-xs text-slate-500 py-1">לחץ להגדלה 🔍</span>
                    </button>
                  )}
                  <div className="mt-2">
                    <div className="text-lg font-bold text-slate-800">{product.name_he || product.name}</div>
                    <div className="text-sm text-slate-500" dir="ltr">{product.name}</div>
                    <div className="text-sm text-slate-500">
                      {product.family} · עמודים {product.page_from}
                      {product.page_to > product.page_from ? `–${product.page_to}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex-1 min-w-[18rem]">
                  <div className="text-base font-bold text-slate-700 mb-2">בחר מידה ({productSizes.length})</div>
                  {Number(product.sizes_inherited) === 1 && (
                    <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                      ⚠ רשימת המידות נלקחה מהמשפחה ולא מעמוד המוצר עצמו — ייתכן שחלק מהמידות לא קיימות במוצר הזה. כדאי לאמת מול הקטלוג.
                    </div>
                  )}
                  {!productSizes.length ? (
                    <div className="text-slate-400 py-8">אין מידות מוגדרות למוצר הזה.</div>
                  ) : (
                    <div className="rounded-xl border-2 border-slate-200 overflow-hidden divide-y divide-slate-100">
                      {productSizes.map((size) => (
                        <div key={size.id} className="flex items-center gap-2 px-3 py-2 hover:bg-teal-50 transition-colors">
                          {/* The page thumbnail repeats on every row on purpose:
                              the agent is scanning a long size list and should
                              be able to open the drawing from wherever they are,
                              without scrolling back up to the product image. */}
                          <button
                            type="button"
                            onClick={() => setZoom(product)}
                            className="w-12 h-12 shrink-0 rounded border border-slate-200 bg-slate-50 overflow-hidden hover:border-teal-400 transition-colors"
                            title="לחץ להגדלה"
                          >
                            {vistaImageSrc(product)
                              ? <img src={vistaImageSrc(product)} alt="" loading="lazy" className="w-full h-full object-contain" />
                              : <span className="text-xs text-slate-300">—</span>}
                          </button>
                          <button
                            type="button"
                            onClick={() => pickSize(size)}
                            className="flex-1 flex items-center justify-between gap-3 text-right min-w-0"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-base font-mono font-bold text-slate-700 w-20 shrink-0" dir="ltr">{size.code}</span>
                              <span className="text-base text-slate-500">
                                {Number(size.height_mm) > 0 ? `גובה ${size.height_mm} מ"מ` : "יחידה"}
                              </span>
                            </div>
                            <span className={`text-lg font-bold shrink-0 ${Number(size.price) > 0 ? "text-teal-600" : "text-slate-300"}`}>
                              {Number(size.price) > 0 ? `₪${Number(size.price).toLocaleString("he-IL")}` : "ללא מחיר"}
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>

          /* ── level 1: family folders ── */
          ) : !q && !family ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {families.map(([name, count]) => (
                <button
                  type="button"
                  key={name}
                  onClick={() => setFamily(name)}
                  className="flex items-center gap-3 p-4 rounded-xl border-2 border-slate-200 bg-white hover:border-teal-400 hover:bg-teal-50 transition-colors text-right"
                >
                  <Folder className="w-7 h-7 text-teal-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-lg font-bold text-slate-800 truncate">{name}</div>
                    <div className="text-sm text-slate-500">{count} מוצרים</div>
                  </div>
                </button>
              ))}
            </div>

          /* ── level 2: products inside a family ── */
          ) : (
            <>
              {!q && (
                <button
                  type="button"
                  onClick={() => setFamily(null)}
                  className="flex items-center gap-1 mb-4 text-base font-semibold text-slate-500 hover:text-teal-600"
                >
                  <ChevronLeft className="w-4 h-4" />
                  חזרה לקטגוריות · {family}
                </button>
              )}
              {!visibleProducts.length ? (
                <div className="text-center text-slate-400 py-16">לא נמצאו מוצרים תואמים</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {visibleProducts.map((p) => {
                    const sizes = sizesByProduct.get(p.id) || [];
                    const pricedCount = sizes.filter((s) => Number(s.price) > 0).length;
                    return (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => setProduct(p)}
                        className="flex flex-col rounded-xl border-2 border-slate-200 bg-white hover:border-teal-400 hover:shadow-md transition-all overflow-hidden text-right"
                      >
                        <div className="h-40 bg-slate-50 flex items-center justify-center p-2 relative">
                          {vistaImageSrc(p)
                            ? <img src={vistaImageSrc(p)} alt={p.name} loading="lazy" className="max-h-full max-w-full object-contain" />
                            : <span className="text-sm text-slate-300">ללא תמונה</span>}
                          {vistaImageSrc(p) && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); setZoom(p); }}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setZoom(p); } }}
                              className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-white/90 border border-slate-200 text-xs hover:bg-white cursor-pointer"
                              title="לחץ להגדלה"
                            >🔍</span>
                          )}
                        </div>
                        <div className="p-2 border-t border-slate-100">
                          <div className="text-sm font-semibold text-slate-700 leading-tight line-clamp-2">{p.name_he || p.name}</div>
                          <div className="text-xs text-slate-400 leading-tight line-clamp-1" dir="ltr">{p.name}</div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-slate-400">עמוד {p.page_from}</span>
                            <span className={`text-xs font-semibold ${pricedCount ? "text-teal-600" : "text-slate-400"}`}>
                              {Number(p.sizes_inherited) === 1 ? "⚠ " : ""}{sizes.length} מידות{pricedCount ? ` · ${pricedCount} מתומחרות` : ""}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <CatalogImageViewer
        open={!!zoom}
        onClose={() => setZoom(null)}
        title={zoom ? (zoom.name_he || zoom.name) : ""}
        subtitle={zoom ? `${zoom.family} · ${zoom.name}` : ""}
        pageFrom={zoom?.page_from}
        pageTo={zoom?.page_to}
      />
    </div>
  );
}
