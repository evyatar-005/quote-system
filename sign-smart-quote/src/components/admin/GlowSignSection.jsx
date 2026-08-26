import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";
import { sanitizeDecimal } from "@/lib/utils";

// Glow signs (004) — deliberately NOT a per-row price list.
//
// The whole family is priced off ONE ₪/מ"ר (explicit request): a rate change is
// one field here instead of 130 edits. The catalog below is therefore reference
// data — what the agent picks from — not pricing. It's editable (name/size) and
// each row can be deactivated so it disappears from the agent's picker, but
// there is no price column and there never should be one.
function ConfigPriceField({ configKey, label, hint, config, onConfigChange }) {
  return (
    <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{hint}</p>
      </div>
      <div className="relative w-32 shrink-0">
        <Input
          type="text" inputMode="decimal"
          value={config?.[configKey] ?? ""}
          onChange={(e) => onConfigChange?.(configKey, e.target.value === "" ? null : parseFloat(sanitizeDecimal(e.target.value)) || 0)}
          className="h-11 text-center text-base w-32 bg-background pl-7"
          dir="ltr"
        />
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">₪</span>
      </div>
    </div>
  );
}

export default function GlowSignSection({ config, onConfigChange }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    base44.entities.GlowSign.list()
      .then((records) => setRows(records || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const update = async (id, patch) => {
    const updated = await base44.entities.GlowSign.update(id, patch);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
  };

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)) : rows),
    [rows, q]
  );

  return (
    <div className="space-y-4">
      <ConfigPriceField
        configKey="glow_price_per_sqm"
        label='מחיר למ"ר — כל שילוט פולט אור'
        hint='מחיר אחד לכל המשפחה. כל שלט מתומחר לפי השטח שלו × המחיר הזה. אם לא הוגדר (0) — המחשבון יסרב לתמחר במקום להציג ₪0. נשמר עם "שמור הגדרות" למעלה.'
        config={config}
        onConfigChange={onConfigChange}
      />
      <ConfigPriceField
        configKey="glow_min_price"
        label="מחיר מינימום לשלט"
        hint="רצפת מחיר ליחידה — שלטים קטנים (10×5 ס״מ) מגיעים לשבר של מ״ר ואחרת יתומחרו בכמה שקלים. 0 = ללא מינימום."
        config={config}
        onConfigChange={onConfigChange}
      />

      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-sm font-semibold text-foreground">
            קטלוג השלטים — {rows.length} שלטים
          </p>
          <div className="relative w-56">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש…"
              className="h-9 text-sm pr-8"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : (
          <div className="rounded-xl border-2 border-slate-900 overflow-hidden max-h-[28rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-right py-2 px-3 font-semibold text-slate-700 w-16">תמונה</th>
                  <th className="text-right py-2 px-3 font-semibold text-slate-700">שם השלט</th>
                  <th className="text-right py-2 px-3 font-semibold text-slate-700 w-40">קטגוריה</th>
                  <th className="text-right py-2 px-3 font-semibold text-slate-700 w-40">מידה (ס"מ)</th>
                  <th className="text-right py-2 px-3 font-semibold text-slate-700 w-20">פעיל</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-t border-slate-300 hover:bg-muted/20 transition-colors">
                    <td className="py-1.5 px-3">
                      {r.image_file
                        ? <img src={`/glow-signs/${r.image_file}`} alt={r.name} loading="lazy" className="w-10 h-10 object-contain" />
                        : <span className="text-xs text-slate-300">—</span>}
                    </td>
                    <td className="py-1.5 px-3">
                      <Input
                        type="text" defaultValue={r.name}
                        onBlur={(e) => e.target.value !== r.name && update(r.id, { name: e.target.value })}
                        className="h-8 text-sm w-full"
                      />
                    </td>
                    <td className="py-1.5 px-3">
                      <Input
                        type="text" defaultValue={r.category}
                        onBlur={(e) => e.target.value !== r.category && update(r.id, { category: e.target.value })}
                        className="h-8 text-sm w-36"
                      />
                    </td>
                    <td className="py-1.5 px-3 flex items-center gap-1">
                      <Input
                        type="number" min="0" step="0.5" dir="ltr" defaultValue={r.width_cm}
                        onBlur={(e) => update(r.id, { width_cm: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-sm w-16"
                      />
                      <span className="text-slate-400">×</span>
                      <Input
                        type="number" min="0" step="0.5" dir="ltr" defaultValue={r.height_cm}
                        onBlur={(e) => update(r.id, { height_cm: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-sm w-16"
                      />
                    </td>
                    <td className="py-1.5 px-3">
                      <input
                        type="checkbox"
                        checked={Number(r.active) !== 0}
                        onChange={(e) => update(r.id, { active: e.target.checked ? 1 : 0 })}
                        className="w-4 h-4 accent-amber-500"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          שינוי בקטלוג נכנס לתוקף אצל הסוכנים ברענון הדף (הקטלוג נטען פעם אחת לכל טעינת אתר).
        </p>
      </div>
    </div>
  );
}
