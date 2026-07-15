import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { calculate } from "../calculator/useCalculator";
import OperatingProfitBadge from "./OperatingProfitBadge";

const PRODUCT_TYPE_LABELS = {
  lokobond_diecut: "עם חיתוך צורני",
  lokobond_plain: "ללא חיתוך צורני",
};

const EMPTY = { product_type: "lokobond_plain", area_from: "", price_per_sqm: "", min_price: "", agent_min_price_per_sqm: "" };

export default function LokobondAreaPriceTable({ config }) {
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newRow, setNewRow] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = () => {
    base44.entities.LokobondAreaTier.list().then((records) => {
      setTiers(records.sort((a, b) => a.product_type.localeCompare(b.product_type) || a.area_from - b.area_from));
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (newRow.area_from === "" || newRow.price_per_sqm === "") {
      toast.error("חובה: שטח התחלתי ומחיר למ\"ר");
      return;
    }
    setSaving(true);
    await base44.entities.LokobondAreaTier.create({
      product_type: newRow.product_type,
      area_from: parseFloat(newRow.area_from) || 0,
      price_per_sqm: parseFloat(newRow.price_per_sqm) || 0,
      min_price: parseFloat(newRow.min_price) || 0,
      agent_min_price_per_sqm: parseFloat(newRow.agent_min_price_per_sqm) || 0,
    });
    setNewRow(EMPTY);
    setSaving(false);
    load();
    toast.success("מדרגה נוספה");
  };

  const handleUpdate = async (id, field, value) => {
    const updated = await base44.entities.LokobondAreaTier.update(id, { [field]: parseFloat(value) || 0 });
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)).sort((a, b) => a.product_type.localeCompare(b.product_type) || a.area_from - b.area_from));
  };

  const handleDelete = async (id) => {
    await base44.entities.LokobondAreaTier.delete(id);
    setTiers((prev) => prev.filter((t) => t.id !== id));
    toast.success("מדרגה נמחקה");
  };

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-slate-900 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-right py-2 px-3 font-semibold text-slate-700">סוג</th>
            <th className="text-right py-2 px-3 font-semibold text-slate-700">מ-X מ"ר ומעלה</th>
            <th className="text-right py-2 px-3 font-semibold text-slate-700">מחיר/מ"ר (התחלתי, ₪)</th>
            <th className="text-center py-2 px-3 font-semibold text-slate-700">רווח תפעולי %</th>
            <th className="text-right py-2 px-3 font-semibold text-slate-700">מחיר/מ"ר (מינימלי לסוכן, ₪)</th>
            <th className="text-center py-2 px-3 font-semibold text-slate-700">רווח תפעולי % (מינימלי)</th>
            <th className="text-right py-2 px-3 font-semibold text-slate-700">מחיר מינימום לפריט (₪)</th>
            <th className="py-2 px-2" />
          </tr>
        </thead>
        <tbody>
          {tiers.map((t) => {
            let opPct = null;
            let agentMinOpPct = null;
            try {
              const side = Math.sqrt(Math.max(parseFloat(t.area_from) || 0, 1));
              opPct = config ? calculate({ config, productType: t.product_type, widthM: side, heightM: side, elements: 1, lokobondAreaTiers: tiers, quantity: 1 })?.profitMarginPct : null;
              const agentMinPrice = parseFloat(t.agent_min_price_per_sqm) || 0;
              if (config && agentMinPrice) {
                const tiersAtAgentMin = tiers.map((x) => (x.id === t.id ? { ...x, price_per_sqm: agentMinPrice } : x));
                agentMinOpPct = calculate({ config, productType: t.product_type, widthM: side, heightM: side, elements: 1, lokobondAreaTiers: tiersAtAgentMin, quantity: 1 })?.profitMarginPct;
              }
            } catch { opPct = null; }
            return (
            <tr key={t.id} className="border-t border-slate-400 hover:bg-muted/20 transition-colors">
              <td className="py-2 px-3 text-slate-600">{PRODUCT_TYPE_LABELS[t.product_type] || t.product_type}</td>
              <td className="py-2 px-3">
                <Input
                  type="number" min="0" step="0.1" dir="ltr"
                  defaultValue={t.area_from}
                  onBlur={(e) => handleUpdate(t.id, "area_from", e.target.value)}
                  className="h-8 text-sm w-24"
                />
              </td>
              <td className="py-2 px-3">
                <Input
                  type="number" min="0" step="1" dir="ltr"
                  defaultValue={t.price_per_sqm}
                  onBlur={(e) => handleUpdate(t.id, "price_per_sqm", e.target.value)}
                  className="h-8 text-sm w-24"
                />
              </td>
              <td className="py-2 px-3 text-center"><OperatingProfitBadge pct={opPct} size="sm" /></td>
              <td className="py-2 px-3">
                <Input
                  type="number" min="0" step="1" dir="ltr"
                  defaultValue={t.agent_min_price_per_sqm}
                  onBlur={(e) => handleUpdate(t.id, "agent_min_price_per_sqm", e.target.value)}
                  className="h-8 text-sm w-24"
                />
              </td>
              <td className="py-2 px-3 text-center"><OperatingProfitBadge pct={agentMinOpPct} size="sm" /></td>
              <td className="py-2 px-3">
                <Input
                  type="number" min="0" step="1" dir="ltr"
                  defaultValue={t.min_price}
                  onBlur={(e) => handleUpdate(t.id, "min_price", e.target.value)}
                  className="h-8 text-sm w-24"
                />
              </td>
              <td className="py-2 px-2 text-left">
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(t.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </td>
            </tr>
            );
          })}
          <tr className="border-t border-dashed border-slate-500">
            <td className="py-2 px-3">
              <select
                value={newRow.product_type}
                onChange={(e) => setNewRow((p) => ({ ...p, product_type: e.target.value }))}
                className="h-8 text-sm border border-input rounded-md px-2 bg-background"
              >
                <option value="lokobond_plain">ללא חיתוך צורני</option>
                <option value="lokobond_diecut">עם חיתוך צורני</option>
              </select>
            </td>
            <td className="py-2 px-3">
              <Input
                type="number" min="0" step="0.1" dir="ltr" placeholder="0"
                value={newRow.area_from}
                onChange={(e) => setNewRow((p) => ({ ...p, area_from: e.target.value }))}
                className="h-8 text-sm w-24"
              />
            </td>
            <td className="py-2 px-3">
              <Input
                type="number" min="0" step="1" dir="ltr" placeholder="0"
                value={newRow.price_per_sqm}
                onChange={(e) => setNewRow((p) => ({ ...p, price_per_sqm: e.target.value }))}
                className="h-8 text-sm w-24"
              />
            </td>
            <td className="py-2 px-3" />
            <td className="py-2 px-3">
              <Input
                type="number" min="0" step="1" dir="ltr" placeholder="0"
                value={newRow.agent_min_price_per_sqm}
                onChange={(e) => setNewRow((p) => ({ ...p, agent_min_price_per_sqm: e.target.value }))}
                className="h-8 text-sm w-24"
              />
            </td>
            <td className="py-2 px-3" />
            <td className="py-2 px-3">
              <Input
                type="number" min="0" step="1" dir="ltr" placeholder="0"
                value={newRow.min_price}
                onChange={(e) => setNewRow((p) => ({ ...p, min_price: e.target.value }))}
                className="h-8 text-sm w-24"
              />
            </td>
            <td className="py-2 px-2 text-left">
              <Button size="icon" variant="ghost" className="h-7 w-7 text-primary" onClick={handleAdd} disabled={saving}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground px-3 py-2 bg-muted/20">
        לכל שורה: "מ-X מ"ר ומעלה" מגדיר את תחילת המדרגה. המחשבון בוחר את המדרגה הגבוהה ביותר שהשטח בפועל מגיע אליה. שורה עם 0 = המחיר הבסיסי.
        <br />
        <b>רווח תפעולי %</b> בעמודה זו מחושב עבור הזמנת ייחוס בגודל <b>שטח המדרגה עצמה</b> (ריבוע), ולכן אינו ניתן להשוואה ישירה לאחוז שמופיע בטבלת מחירי המכירה הראשית (שם הייחוס הוא 1 מ"ר קבוע) — הזמנה גדולה יותר "מפזרת" עלויות קבועות-לג'וב (הכנה/אריזה) על יותר שטח, ולכן יכולה להראות אחוז גבוה יותר גם במחיר למ"ר נמוך יותר.
        <br />
        "מחיר/מ"ר (מינימלי לסוכן)" — 0 = אין טווח, המחיר ההתחלתי קבוע. אם מוגדר, הסוכן יוכל להוריד את מחיר המ"ר במחשבון שלו עד לערך הזה בלבד, לא מתחתיו.
      </p>
    </div>
  );
}
