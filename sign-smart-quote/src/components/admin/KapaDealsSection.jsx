import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Loader2, Plus, X } from "lucide-react";

// The 4 kapa add-ons a deal can be defined for — same product keys used by
// CalculatorForm.jsx's kapa quantity fields (standardShelves/customShelves/
// legsQty/coloredShelfQty), just written as the shared dealOverrides keys.
export const KAPA_DEAL_PRODUCTS = [
  { key: "standardShelf", label: "מדפים סטנדרטים" },
  { key: "customShelf", label: "מדפים בעיצוב אישי" },
  { key: "legs", label: "רגליים עשויות קאפה" },
  { key: "coloredShelf", label: "מדף צבעוני ללא חיתוך צורני" },
];

export function kapaDealProductLabel(key) {
  return KAPA_DEAL_PRODUCTS.find((p) => p.key === key)?.label || key;
}

export default function KapaDealsSection() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = () => {
    base44.entities.KapaDeal.list().then((records) => {
      setDeals(records);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async () => {
    setBusy(true);
    const created = await base44.entities.KapaDeal.create({
      product_key: KAPA_DEAL_PRODUCTS[0].key,
      qty: 1,
      price: 0,
      mode: "additive",
    });
    setDeals((prev) => [...prev, created]);
    setBusy(false);
  };

  const handleUpdate = async (id, field, value) => {
    const updated = await base44.entities.KapaDeal.update(id, { [field]: value });
    setDeals((prev) => prev.map((d) => (d.id === id ? { ...d, ...updated } : d)));
  };

  const handleDelete = async (id) => {
    await base44.entities.KapaDeal.delete(id);
    setDeals((prev) => prev.filter((d) => d.id !== id));
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
      {/* פס שחור מפריד בין תוספות המדפים הרגילות לבין המבצעים */}
      <div className="border-t-2 border-black my-4" />
      <h3 className="text-base font-bold text-foreground mb-3">מבצעים</h3>

      <div className="space-y-3">
        {deals.length === 0 && (
          <p className="text-sm text-muted-foreground">אין עדיין מבצעים מוגדרים — הוסף מבצע ראשון למטה.</p>
        )}
        {deals.map((d) => (
          <div key={d.id} className="bg-blue-50/50 border border-blue-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
            <Select value={d.product_key} onValueChange={(v) => handleUpdate(d.id, "product_key", v)}>
              <SelectTrigger className="h-9 w-48 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KAPA_DEAL_PRODUCTS.map((p) => (
                  <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">כמות</span>
              <Input
                type="number" min="1" dir="ltr"
                defaultValue={d.qty}
                onBlur={(e) => handleUpdate(d.id, "qty", parseFloat(e.target.value) || 1)}
                className="h-9 text-sm w-20"
              />
            </div>

            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">מחיר</span>
              <div className="relative">
                <Input
                  type="number" min="0" dir="ltr"
                  defaultValue={d.price}
                  onBlur={(e) => handleUpdate(d.id, "price", parseFloat(e.target.value) || 0)}
                  className="h-9 text-sm w-24 pl-6"
                />
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">₪</span>
              </div>
            </div>

            <Button
              type="button" size="sm" variant={d.mode === "override" ? "default" : "outline"}
              onClick={() => handleUpdate(d.id, "mode", d.mode === "override" ? "additive" : "override")}
              className="h-9 px-3 text-sm"
              title="לחיצה מחליפה בין 'מחליף מחיר' ל'מתווסף למחיר'"
            >
              {d.mode === "override" ? "מחליף מחיר" : "מתווסף למחיר"}
            </Button>

            <Button type="button" size="sm" variant="ghost" onClick={() => handleDelete(d.id)} className="h-9 w-9 p-0 mr-auto">
              <X className="w-4 h-4" />
            </Button>
          </div>
        ))}

        <Button type="button" size="sm" onClick={handleAdd} disabled={busy} className="h-9 px-3 text-sm gap-1">
          <Plus className="w-4 h-4" /> הוסף מבצע
        </Button>
      </div>

      <p className="text-sm text-muted-foreground mt-3">
        "מחליף מחיר" — כשהסוכן בוחר את המבצע, המחיר שלו מחליף לגמרי את מחיר הכמות הרגיל של אותה תוספת. "מתווסף למחיר" — מחיר המבצע מוצג כאפשרות נוספת שנוספת מעל מחיר הכמות הרגיל.
      </p>
    </div>
  );
}
