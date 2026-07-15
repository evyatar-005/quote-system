import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { calculate } from "../calculator/useCalculator";
import OperatingProfitBadge from "./OperatingProfitBadge";

export default function KapaPriceTable({ config }) {
  const [rows, setRows] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadRows();
  }, []);

  const loadRows = () => {
    base44.entities.KapaPriceTier.list().then((records) => {
      setRows(records.sort((a, b) => a.sku.localeCompare(b.sku)));
    });
  };

  const handleEditStart = (row) => {
    setEditingId(row.id);
    setEditValues({ description: row.description, price: String(row.price || "") });
  };

  const handleEditSave = async (id) => {
    if (!editValues.price) {
      toast.error("יש להזין מחיר");
      return;
    }
    setSaving(true);
    await base44.entities.KapaPriceTier.update(id, {
      description: editValues.description,
      price: parseFloat(editValues.price),
    });
    setEditingId(null);
    setEditValues({});
    loadRows();
    setSaving(false);
    toast.success("עודכן");
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-base">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">מק"ט</th>
            <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">תיאור הקאפה</th>
            <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">מחיר יחידה (₪)</th>
            <th className="text-center py-2 px-3 text-sm font-semibold text-slate-700">רווח תפעולי %</th>
            <th className="py-2 px-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            let opPct = null;
            try { opPct = config ? calculate({ config, productType: "kapa", kapaTierId: r.id, kapaPriceTiers: rows, quantity: 1 })?.profitMarginPct : null; } catch { opPct = null; }
            return (
            <tr key={r.id} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
              <td className="py-2 px-3 font-mono font-semibold text-sm">{r.sku}</td>
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
                    type="number" min="0" step="10" dir="ltr"
                    value={editValues.price}
                    onChange={(e) => setEditValues({ ...editValues, price: e.target.value })}
                    className="h-8 text-sm w-28"
                  />
                ) : (
                  <span onClick={() => handleEditStart(r)} className="cursor-pointer hover:underline font-semibold">₪ {Number(r.price || 0).toLocaleString("he-IL")}</span>
                )}
              </td>
              <td className="py-2 px-3 text-center"><OperatingProfitBadge pct={opPct} size="sm" /></td>
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
