import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

// Finishes mirror the perspex options already offered in the לוגו family
// (005) — laser-cut numbers use the exact same material/finish set, just a
// different pricing axis (per-digit-by-height instead of per-m²).
const NUMBER_FINISHES = [
  { key: "numbers_perspex_clear", label: "פרספקס שקוף" },
  { key: "numbers_perspex_black", label: "פרספקס שחור" },
  { key: "numbers_perspex_white", label: "פרספקס לבן" },
  { key: "numbers_perspex_milky", label: "פרספקס חלבי" },
  { key: "numbers_perspex_mirror", label: "פרספקס מראה" },
  { key: "numbers_perspex_metallic", label: "פרספקס מטאלי" },
];

// Unlike every other price table in this app, heights and thicknesses here
// are NOT a fixed list baked into the code — the sales manager adds them
// herself as agents request new sizes, so this component owns its own
// add-row/add-column UI instead of iterating a hardcoded array.
export default function NumberPriceTable() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFinish, setActiveFinish] = useState(NUMBER_FINISHES[0].key);
  const [newHeight, setNewHeight] = useState({});
  const [newThickness, setNewThickness] = useState({});
  const [busy, setBusy] = useState(false);

  const load = () => {
    base44.entities.NumberPriceTier.list().then((records) => {
      setRows(records);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, []);

  const rowsForFinish = rows.filter((r) => r.product_type === activeFinish);
  const heights = [...new Set(rowsForFinish.map((r) => r.height_cm))].sort((a, b) => a - b);

  const handleUpdate = async (id, field, value) => {
    const updated = await base44.entities.NumberPriceTier.update(id, { [field]: parseFloat(value) || 0 });
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
  };

  const handleDelete = async (id) => {
    await base44.entities.NumberPriceTier.delete(id);
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleAddHeight = async (finish) => {
    const h = parseFloat(newHeight[finish]);
    if (!h) {
      toast.error('יש להזין גובה בס"מ');
      return;
    }
    if (heights.includes(h)) {
      toast.error("גובה זה כבר קיים — הוסיפי עובי חדש בתוכו במקום");
      return;
    }
    setBusy(true);
    const created = await base44.entities.NumberPriceTier.create({
      product_type: finish,
      height_cm: h,
      thickness_mm: "3",
      price_per_unit: 0,
      min_price: 0,
    });
    setRows((prev) => [...prev, created]);
    setNewHeight((prev) => ({ ...prev, [finish]: "" }));
    setBusy(false);
    toast.success(`נוסף גובה ${h} ס"מ`);
  };

  const handleAddThickness = async (finish, height) => {
    const key = `${finish}_${height}`;
    const t = (newThickness[key] || "").trim();
    if (!t) {
      toast.error('יש להזין עובי במ"מ');
      return;
    }
    const exists = rows.some((r) => r.product_type === finish && r.height_cm === height && r.thickness_mm === t);
    if (exists) {
      toast.error("עובי זה כבר קיים לגובה הזה");
      return;
    }
    setBusy(true);
    const created = await base44.entities.NumberPriceTier.create({
      product_type: finish,
      height_cm: height,
      thickness_mm: t,
      price_per_unit: 0,
      min_price: 0,
    });
    setRows((prev) => [...prev, created]);
    setNewThickness((prev) => ({ ...prev, [key]: "" }));
    setBusy(false);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {NUMBER_FINISHES.map((f) => (
          <Button
            key={f.key}
            type="button"
            size="sm"
            variant={activeFinish === f.key ? "default" : "outline"}
            onClick={() => setActiveFinish(f.key)}
            className="h-8 px-3 text-sm"
          >
            {f.label}
          </Button>
        ))}
      </div>

      <div className="space-y-4">
        {heights.length === 0 && (
          <p className="text-sm text-muted-foreground">אין עדיין גבהים מוגדרים לגימור הזה — הוסיפי גובה ראשון למטה.</p>
        )}
        {heights.map((h) => {
          const thicknessRows = rowsForFinish
            .filter((r) => r.height_cm === h)
            .sort((a, b) => parseFloat(a.thickness_mm) - parseFloat(b.thickness_mm));
          const draftKey = `${activeFinish}_${h}`;
          return (
            <div key={h} className="rounded-xl border border-border overflow-hidden">
              <div className="bg-muted/50 py-2 px-3 font-semibold text-sm">גובה ספרה: {h} ס"מ</div>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">עובי (מ"מ)</th>
                    <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">מחיר לספרה (₪)</th>
                    <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">מינימום לספרה (₪)</th>
                    <th className="py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {thicknessRows.map((r) => (
                    <tr key={r.id} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
                      <td className="py-2 px-3 font-semibold">{r.thickness_mm} מ"מ</td>
                      <td className="py-2 px-3">
                        <Input
                          type="number" min="0" step="1" dir="ltr"
                          defaultValue={r.price_per_unit}
                          onBlur={(e) => handleUpdate(r.id, "price_per_unit", e.target.value)}
                          className="h-9 text-sm w-28"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          type="number" min="0" step="1" dir="ltr"
                          defaultValue={r.min_price}
                          onBlur={(e) => handleUpdate(r.id, "min_price", e.target.value)}
                          className="h-9 text-sm w-28"
                        />
                      </td>
                      <td className="py-2 px-2 text-left">
                        <Button type="button" size="sm" variant="ghost" onClick={() => handleDelete(r.id)} className="h-7 w-7 p-0">
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-border/30 bg-muted/10">
                    <td className="py-2 px-3">
                      <Input
                        type="text" dir="ltr" placeholder="עובי חדש"
                        value={newThickness[draftKey] || ""}
                        onChange={(e) => setNewThickness((prev) => ({ ...prev, [draftKey]: e.target.value }))}
                        className="h-9 text-sm w-28"
                      />
                    </td>
                    <td colSpan={2}></td>
                    <td className="py-2 px-2 text-left">
                      <Button type="button" size="sm" onClick={() => handleAddThickness(activeFinish, h)} disabled={busy} className="h-7 px-2 text-sm gap-1">
                        <Plus className="w-3.5 h-3.5" /> הוסף עובי
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}

        <div className="flex items-center gap-2 pt-2">
          <Input
            type="number" min="0" step="1" dir="ltr" placeholder='גובה חדש (ס"מ)'
            value={newHeight[activeFinish] || ""}
            onChange={(e) => setNewHeight((prev) => ({ ...prev, [activeFinish]: e.target.value }))}
            className="h-9 text-sm w-32"
          />
          <Button type="button" size="sm" onClick={() => handleAddHeight(activeFinish)} disabled={busy} className="h-9 px-3 text-sm gap-1">
            <Plus className="w-4 h-4" /> הוסף גובה חדש
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground mt-4">
        מחיר לספרה בודדת × כמות הספרות בהזמנה = מחיר מכירה. אם לא הוגדר מחיר לשילוב גובה+עובי מסוים, המחשבון יציג שגיאה במקום לתמחר בשקט.
      </p>
    </div>
  );
}
