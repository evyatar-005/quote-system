import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Loader2, Search, ChevronDown, ChevronLeft } from "lucide-react";
import CatalogImageViewer from "@/components/CatalogImageViewer";

// Vista (014) — משפחה → מוצר → מידה.
//
// The price sits on the SIZE row, not the product: one product ships in a dozen
// frame heights that don't cost the same, so a single price per product would
// be wrong for every size but one. A size left at ₪0 still shows in the agent's
// catalog but refuses to quote — the same never-price-silently rule as
// everywhere else here.
export default function VistaItemsSection() {
  const [products, setProducts] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("");
  const [openProduct, setOpenProduct] = useState(null);
  const [zoom, setZoom] = useState(null);

  useEffect(() => {
    Promise.all([base44.entities.VistaProduct.list(), base44.entities.VistaSize.list()])
      .then(([p, z]) => { setProducts(p || []); setSizes(z || []); })
      .catch(() => { setProducts([]); setSizes([]); })
      .finally(() => setLoading(false));
  }, []);

  const updateProduct = async (id, patch) => {
    const updated = await base44.entities.VistaProduct.update(id, patch);
    setProducts((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
  };
  const updateSize = async (id, patch) => {
    const updated = await base44.entities.VistaSize.update(id, patch);
    setSizes((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
  };

  const sizesByProduct = useMemo(() => {
    const map = new Map();
    for (const s of sizes) {
      if (!map.has(s.product_id)) map.set(s.product_id, []);
      map.get(s.product_id).push(s);
    }
    for (const list of map.values()) list.sort((a, b) => (a.height_mm || 0) - (b.height_mm || 0));
    return map;
  }, [sizes]);

  const families = useMemo(() => {
    const counts = new Map();
    for (const p of products) counts.set(p.family_he, (counts.get(p.family_he) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [products]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => products.filter((p) => {
    if (family && p.family_he !== family) return false;
    if (!q) return true;
    return (p.name + " " + (p.name_he || "") + " " + p.family + " " + p.family_he).toLowerCase().includes(q);
  }), [products, q, family]);

  const pricedSizes = sizes.filter((s) => Number(s.price) > 0).length;

  return (
    <div className="space-y-3">
      <div className="bg-teal-50/60 border border-teal-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-foreground">
          קטלוג ויסטה — {products.length} מוצרים, {sizes.length} מידות, {pricedSizes} מתומחרות
        </p>
        <p className="text-sm text-muted-foreground mt-0.5">
          המחיר נקבע לכל <b>מידה</b> בנפרד (מחיר ליחידה), כי אותו מוצר מגיע בכמה גבהים במחירים שונים.
          מידה בלי מחיר מוצגת לסוכן אבל המחשבון יסרב לתמחר אותה במקום להציג ₪0.
        </p>
        <p className="text-sm text-amber-800 mt-1">
          ⚠ = רשימת המידות של המוצר נלקחה מהמשפחה ולא מעמוד הקטלוג שלו (העמוד מצויר, בלי שכבת טקסט לקריאה).
          {" "}{products.filter((r) => Number(r.sizes_inherited) === 1).length} מוצרים כאלה — כדאי לאמת אותם מול ה-PDF ולמחוק מידות שלא קיימות.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative w-56">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש מוצר…"
            className="h-9 text-sm pr-8"
          />
        </div>
        <select
          value={family}
          onChange={(e) => setFamily(e.target.value)}
          className="h-9 text-sm rounded-md border border-slate-300 bg-background px-2"
        >
          <option value="">כל המשפחות</option>
          {families.map(([name, count]) => (
            <option key={name} value={name}>{name} ({count})</option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">מוצגים {visible.length}</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : (
        <div className="rounded-xl border-2 border-slate-900 overflow-hidden max-h-[32rem] overflow-y-auto divide-y divide-slate-200">
          {visible.map((p) => {
            const rows = sizesByProduct.get(p.id) || [];
            const priced = rows.filter((s) => Number(s.price) > 0).length;
            const isOpen = openProduct === p.id;
            return (
              <div key={p.id}>
                <div className="flex items-center gap-3 px-3 py-2 bg-white hover:bg-muted/20 transition-colors">
                  <button
                    type="button"
                    onClick={() => setOpenProduct(isOpen ? null : p.id)}
                    className="p-1 rounded hover:bg-slate-100 shrink-0"
                    title={isOpen ? "סגור מידות" : "הצג מידות"}
                  >
                    {isOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronLeft className="w-4 h-4 text-slate-500" />}
                  </button>
                  {p.image_file
                    ? (
                      <button
                        type="button"
                        onClick={() => setZoom(p)}
                        className="w-12 h-12 shrink-0 rounded bg-slate-50 border border-transparent hover:border-teal-400 transition-colors overflow-hidden"
                        title="לחץ להגדלה"
                      >
                        <img src={`/vista-pages/${p.image_file}`} alt={p.name} loading="lazy" className="w-full h-full object-contain" />
                      </button>
                    )
                    : <span className="w-12 h-12 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <Input
                      type="text"
                      defaultValue={p.name_he || ""}
                      placeholder={p.name}
                      onBlur={(e) => e.target.value !== (p.name_he || "") && updateProduct(p.id, { name_he: e.target.value })}
                      className="h-8 text-sm w-full"
                    />
                    <div className="text-xs text-slate-400 mt-0.5" dir="ltr">{p.name}</div>
                  </div>
                  <span className="text-sm text-slate-600 w-36 shrink-0">{p.family_he}</span>
                  <span className="text-xs text-slate-400 w-16 shrink-0">עמוד {p.page_from}</span>
                  <span
                    className={`text-xs font-semibold w-32 shrink-0 ${priced ? "text-teal-600" : "text-slate-400"}`}
                    title={Number(p.sizes_inherited) === 1 ? "רשימת המידות נלקחה מהמשפחה, לא מעמוד המוצר — יש לאמת מול הקטלוג" : ""}
                  >
                    {Number(p.sizes_inherited) === 1 && <span className="text-amber-600">⚠ </span>}
                    {rows.length} מידות{priced ? ` · ${priced} מתומחרות` : ""}
                  </span>
                  <input
                    type="checkbox"
                    checked={Number(p.active) !== 0}
                    onChange={(e) => updateProduct(p.id, { active: e.target.checked ? 1 : 0 })}
                    className="w-4 h-4 accent-teal-500 shrink-0"
                    title="מוצר פעיל"
                  />
                </div>

                {isOpen && (
                  <div className="bg-slate-50/70 px-3 py-2">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-500">
                          <th className="text-right font-semibold py-1 w-12">תמונה</th>
                          <th className="text-right font-semibold py-1 w-28">דגם</th>
                          <th className="text-right font-semibold py-1 w-32">גובה (מ"מ)</th>
                          <th className="text-right font-semibold py-1 w-32">מחיר ליחידה (₪)</th>
                          <th className="text-right font-semibold py-1 w-16">פעיל</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((z) => (
                          <tr key={z.id}>
                            <td className="py-1 w-12">
                              {p.image_file && (
                                <button
                                  type="button"
                                  onClick={() => setZoom(p)}
                                  className="w-9 h-9 rounded bg-white border border-slate-200 hover:border-teal-400 transition-colors overflow-hidden"
                                  title="לחץ להגדלה"
                                >
                                  <img src={`/vista-pages/${p.image_file}`} alt="" loading="lazy" className="w-full h-full object-contain" />
                                </button>
                              )}
                            </td>
                            <td className="py-1 font-mono font-semibold text-slate-700" dir="ltr">{z.code}</td>
                            <td className="py-1">
                              <Input
                                type="number" min="0" step="0.1" dir="ltr"
                                defaultValue={z.height_mm}
                                onBlur={(e) => updateSize(z.id, { height_mm: parseFloat(e.target.value) || 0 })}
                                className="h-7 text-sm w-24"
                              />
                            </td>
                            <td className="py-1">
                              <Input
                                type="number" min="0" step="1" dir="ltr"
                                defaultValue={z.price}
                                onBlur={(e) => updateSize(z.id, { price: parseFloat(e.target.value) || 0 })}
                                className={`h-7 text-sm w-24 ${Number(z.price) > 0 ? "" : "border-amber-300 bg-amber-50/40"}`}
                              />
                            </td>
                            <td className="py-1">
                              <input
                                type="checkbox"
                                checked={Number(z.active) !== 0}
                                onChange={(e) => updateSize(z.id, { active: e.target.checked ? 1 : 0 })}
                                className="w-4 h-4 accent-teal-500"
                              />
                            </td>
                            <td />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        התמונות הן עמודי הקטלוג המקוריים של Vista System 2026 — לחיצה על תמונה פותחת אותה בגדול,
        עם מעבר בין כל עמודי המוצר. שינוי נכנס לתוקף אצל הסוכנים ברענון הדף.
      </p>

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
