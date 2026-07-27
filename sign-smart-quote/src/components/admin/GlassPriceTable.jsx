import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { calculate } from "../calculator/useCalculator";
import OperatingProfitBadge from "./OperatingProfitBadge";

export default function GlassPriceTable({ config }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    base44.entities.GlassPriceTier.list().then((records) => {
      setRows(records.sort((a, b) => (a.width_cm * a.height_cm) - (b.width_cm * b.height_cm)));
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const handleUpdate = async (id, field, value) => {
    const updated = await base44.entities.GlassPriceTier.update(id, { [field]: parseFloat(value) || 0 });
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
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
            <th className="text-right py-2 px-3 font-semibold text-slate-700">מידה</th>
            <th className="text-right py-2 px-3 font-semibold text-slate-700">עלות (₪)</th>
            <th className="text-right py-2 px-3 font-semibold text-slate-700">מחיר מכירה (₪)</th>
            <th className="text-center py-2 px-3 font-semibold text-slate-700">רווח תפעולי %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            let opPct = null;
            try { opPct = config ? calculate({ config, productType: "glass_extra_clear", glassTierId: r.id, glassPriceTiers: rows, quantity: 1 })?.profitMarginPct : null; } catch { opPct = null; }
            return (
            <tr key={r.id} className="border-t border-slate-400 hover:bg-muted/20 transition-colors">
              <td className="py-2 px-3 text-slate-700 font-semibold">{r.description}</td>
              <td className="py-2 px-3">
                <Input
                  type="number" min="0" step="0.1" dir="ltr"
                  defaultValue={r.cost_price}
                  onBlur={(e) => handleUpdate(r.id, "cost_price", e.target.value)}
                  className="h-8 text-sm w-24"
                />
              </td>
              <td className="py-2 px-3">
                <Input
                  type="number" min="0" step="0.1" dir="ltr"
                  defaultValue={r.selling_price}
                  onBlur={(e) => handleUpdate(r.id, "selling_price", e.target.value)}
                  className="h-8 text-sm w-24"
                />
              </td>
              <td className="py-2 px-3 text-center"><OperatingProfitBadge pct={opPct} size="sm" /></td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
