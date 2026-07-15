import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Rows3 } from "lucide-react";
import { toast } from "sonner";
import { calculate } from "../calculator/useCalculator";
import OperatingProfitBadge from "./OperatingProfitBadge";

const PRODUCT_TYPE_LABELS = {
  rollup_magnetic: "רול אפ מגנטי",
  rollup_regular: "רול אפ רגיל",
};

export default function RollupPriceTable({ config }) {
  const [rows, setRows] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadRows();
  }, []);

  const loadRows = () => {
    base44.entities.RollupPriceTier.list().then((records) => {
      setRows(records.sort((a, b) => a.sku.localeCompare(b.sku)));
    });
  };

  const handleEditStart = (row) => {
    setEditingId(row.id);
    setEditValues({
      description: row.description,
      price_unit_1: String(row.price_unit_1 ?? ""),
      price_unit_2: String(row.price_unit_2 ?? ""),
      price_unit_3_plus: String(row.price_unit_3_plus ?? ""),
    });
  };

  const handleEditSave = async (id) => {
    if (!editValues.price_unit_1) {
      toast.error("יש להזין מחיר ליחידה 1");
      return;
    }
    setSaving(true);
    await base44.entities.RollupPriceTier.update(id, {
      description: editValues.description,
      price_unit_1: parseFloat(editValues.price_unit_1) || 0,
      price_unit_2: parseFloat(editValues.price_unit_2) || 0,
      price_unit_3_plus: parseFloat(editValues.price_unit_3_plus) || 0,
    });
    setEditingId(null);
    setEditValues({});
    loadRows();
    setSaving(false);
    toast.success("עודכן");
  };

  return (
    <div className="rounded-xl border-2 border-slate-900 overflow-hidden">
      <div className="flex items-center gap-3 p-4 bg-muted/30 border-b border-slate-900">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
          <Rows3 className="w-5 h-5" />
        </div>
        <div>
          <div className="text-base font-semibold">מחירי מכירה — רול אפ</div>
          <p className="text-sm text-muted-foreground mt-0.5">מחיר ליחידה בהזמנה של 1 / 2 / 3 ומעלה — לפי הכמות הכוללת בהזמנה, לכל מידה</p>
        </div>
      </div>
      <table className="w-full text-base">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">סוג</th>
            <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">תיאור / מידה</th>
            <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">מחיר יח' 1 (₪)</th>
            <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">מחיר יח' 2 (₪)</th>
            <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">מחיר יח' 3+ (₪)</th>
            <th className="py-2 px-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const opPctFor = (qty) => {
              try { return config ? calculate({ config, productType: r.product_type, rollupTierId: r.id, rollupPriceTiers: rows, quantity: qty })?.profitMarginPct : null; } catch { return null; }
            };
            const [p1, p2, p3] = [opPctFor(1), opPctFor(2), opPctFor(3)];
            return (
            <tr key={r.id} className="border-t border-slate-400 hover:bg-muted/20 transition-colors">
              <td className="py-2 px-3 text-sm text-slate-600">{PRODUCT_TYPE_LABELS[r.product_type] || r.product_type}</td>
              <td className="py-2 px-3">
                {editingId === r.id ? (
                  <Input
                    value={editValues.description}
                    onChange={(e) => setEditValues({ ...editValues, description: e.target.value })}
                    className="h-8 text-sm"
                  />
                ) : (
                  <span onClick={() => handleEditStart(r)} className="cursor-pointer hover:underline">{r.description}</span>
                )}
              </td>
              <td className="py-2 px-3">
                {editingId === r.id ? (
                  <Input
                    type="number" min="0" step="1" dir="ltr"
                    value={editValues.price_unit_1}
                    onChange={(e) => setEditValues({ ...editValues, price_unit_1: e.target.value })}
                    className="h-8 text-sm w-24"
                  />
                ) : (
                  <span onClick={() => handleEditStart(r)} className="cursor-pointer hover:underline font-semibold">₪ {Number(r.price_unit_1 || 0).toLocaleString("he-IL")}</span>
                )}
                <div className="mt-1"><OperatingProfitBadge pct={p1} size="sm" /></div>
              </td>
              <td className="py-2 px-3">
                {editingId === r.id ? (
                  <Input
                    type="number" min="0" step="1" dir="ltr"
                    value={editValues.price_unit_2}
                    onChange={(e) => setEditValues({ ...editValues, price_unit_2: e.target.value })}
                    className="h-8 text-sm w-24"
                  />
                ) : (
                  <span onClick={() => handleEditStart(r)} className="cursor-pointer hover:underline font-semibold">₪ {Number(r.price_unit_2 || 0).toLocaleString("he-IL")}</span>
                )}
                <div className="mt-1"><OperatingProfitBadge pct={p2} size="sm" /></div>
              </td>
              <td className="py-2 px-3">
                {editingId === r.id ? (
                  <Input
                    type="number" min="0" step="1" dir="ltr"
                    value={editValues.price_unit_3_plus}
                    onChange={(e) => setEditValues({ ...editValues, price_unit_3_plus: e.target.value })}
                    className="h-8 text-sm w-24"
                  />
                ) : (
                  <span onClick={() => handleEditStart(r)} className="cursor-pointer hover:underline font-semibold">₪ {Number(r.price_unit_3_plus || 0).toLocaleString("he-IL")}</span>
                )}
                <div className="mt-1"><OperatingProfitBadge pct={p3} size="sm" /></div>
              </td>
              <td className="py-2 px-2 text-left">
                {editingId === r.id && (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => handleEditSave(r.id)} disabled={saving} className="h-7 px-1 text-sm font-medium">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "שמור"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-7 px-1 text-sm font-medium">בטל</Button>
                  </div>
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
