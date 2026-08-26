// Glow-sign (004 "שילוט פולט אור") artwork browser.
//
// Unlike every other family in the מק"ט picker, this one is a 130-row artwork
// catalog — a flat dropdown list of Hebrew sign texts is unusable for an agent
// who is looking for a *picture*. So picking a glow sign opens this large
// floating modal instead: category folders on the right, artwork grid on the
// left, and choosing a card drops the sign's name + standard size straight onto
// the quote line (the price then comes from the one global ₪/מ"ר).
import { useEffect, useMemo, useState } from "react";
import { X, Search, ChevronLeft, Folder } from "lucide-react";
import { base44 } from "@/api/base44Client";

// Cached at module scope: the catalog is static reference data, so re-opening
// the picker (once per quote line, many times a day) shouldn't re-fetch it.
let cachedSigns = null;

export function glowImageSrc(sign) {
  return sign?.image_file ? `/glow-signs/${sign.image_file}` : null;
}

export function glowSignLabel(sign) {
  if (!sign) return "";
  const size = sign.width_cm > 0 && sign.height_cm > 0
    ? ` ${sign.width_cm}×${sign.height_cm} ס"מ`
    : "";
  return `${sign.name}${size}`;
}

export default function GlowSignPicker({ open, onClose, onSelect }) {
  const [signs, setSigns] = useState(cachedSigns || []);
  const [loading, setLoading] = useState(!cachedSigns);
  const [category, setCategory] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || cachedSigns) return;
    let alive = true;
    setLoading(true);
    base44.entities.GlowSign.list()
      .then((rows) => {
        cachedSigns = (rows || []).filter((r) => Number(r.active) !== 0);
        if (alive) setSigns(cachedSigns);
      })
      .catch(() => { if (alive) setSigns([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open]);

  // Reset the drill-down every time the modal is reopened, so it never lands the
  // agent inside whatever folder they happened to browse last week.
  useEffect(() => {
    if (open) { setCategory(null); setQuery(""); }
  }, [open]);

  const categories = useMemo(() => {
    const counts = new Map();
    for (const s of signs) counts.set(s.category, (counts.get(s.category) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [signs]);

  const q = query.trim().toLowerCase();
  // A search query deliberately ignores the open folder and searches the whole
  // catalog — an agent typing "מטפה" wants the sign, not "no results in this
  // folder" because they were standing in the wrong one.
  const visible = useMemo(() => {
    if (q) return signs.filter((s) => s.name.toLowerCase().includes(q));
    if (category) return signs.filter((s) => s.category === category);
    return [];
  }, [signs, q, category]);

  if (!open) return null;

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
          <span className="text-base font-mono font-semibold px-2 py-0.5 rounded bg-brand-gold text-white">004</span>
          <h2 className="text-xl font-bold text-slate-800">שילוט פולט אור</h2>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש שלט…"
              className="w-full pr-8 pl-3 py-1.5 text-base rounded-lg border border-slate-300 focus:border-amber-400 focus:outline-none"
            />
          </div>
          <button type="button" onClick={onClose} className="mr-auto p-1.5 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center text-slate-400 py-16">טוען קטלוג…</div>
          ) : !signs.length ? (
            <div className="text-center text-slate-400 py-16">קטלוג השלטים ריק — יש לטעון אותו מהגדרות המנהל.</div>
          ) : !q && !category ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {categories.map(([name, count]) => (
                <button
                  type="button"
                  key={name}
                  onClick={() => setCategory(name)}
                  className="flex items-center gap-3 p-4 rounded-xl border-2 border-slate-200 bg-white hover:border-amber-400 hover:bg-amber-50 transition-colors text-right"
                >
                  <Folder className="w-7 h-7 text-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-lg font-bold text-slate-800 truncate">{name}</div>
                    <div className="text-sm text-slate-500">{count} שלטים</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <>
              {!q && (
                <button
                  type="button"
                  onClick={() => setCategory(null)}
                  className="flex items-center gap-1 mb-4 text-base font-semibold text-slate-500 hover:text-amber-600"
                >
                  <ChevronLeft className="w-4 h-4" />
                  חזרה לקטגוריות · {category}
                </button>
              )}
              {!visible.length ? (
                <div className="text-center text-slate-400 py-16">לא נמצאו שלטים תואמים</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {visible.map((sign) => (
                    <button
                      type="button"
                      key={sign.id}
                      onClick={() => { onSelect(sign); onClose(); }}
                      className="flex flex-col rounded-xl border-2 border-slate-200 bg-white hover:border-amber-400 hover:shadow-md transition-all overflow-hidden text-right"
                    >
                      <div className="h-28 bg-slate-50 flex items-center justify-center p-2">
                        {glowImageSrc(sign)
                          ? <img src={glowImageSrc(sign)} alt={sign.name} loading="lazy" className="max-h-full max-w-full object-contain" />
                          : <span className="text-sm text-slate-300">ללא תמונה</span>}
                      </div>
                      <div className="p-2 border-t border-slate-100">
                        <div className="text-sm font-semibold text-slate-700 leading-tight line-clamp-3">{sign.name}</div>
                        <div className="text-sm text-slate-500 mt-1">
                          {sign.width_cm > 0 && sign.height_cm > 0
                            ? `${sign.width_cm}×${sign.height_cm} ס"מ`
                            : "מידה לפי הזמנה"}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
