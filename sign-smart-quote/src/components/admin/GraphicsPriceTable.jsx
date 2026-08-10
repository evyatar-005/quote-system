import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

// Graphics (0000) — flat design-work line item. Selling price only, no cost
// model yet (explicit request), so unlike the other fixed-price tables here
// there's no cost column / operating-profit badge.
export default function GraphicsPriceTable() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    base44.entities.GraphicsPriceTier.list().then((records) => {
      setRows(records.sort((a, b) => (a.price || 0) - (b.price || 0)));
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const handleUpdate = async (id, field, value) => {
    const patch = field === "price" ? { price: parseFloat(value) || 0 } : { description: value };
    const updated = await base44.entities.GraphicsPriceTier.update(id, patch);
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
            <th className="text-right py-2 px-3 font-semibold text-slate-700">תיאור</th>
            <th className="text-right py-2 px-3 font-semibold text-slate-700">מחיר מכירה (₪)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-400 hover:bg-muted/20 transition-colors">
              <td className="py-2 px-3">
                <Input
                  type="text"
                  defaultValue={r.description}
                  onBlur={(e) => handleUpdate(r.id, "description", e.target.value)}
                  className="h-8 text-sm w-56"
                />
              </td>
              <td className="py-2 px-3">
                <Input
                  type="number" min="0" step="0.1" dir="ltr"
                  defaultValue={r.price}
                  onBlur={(e) => handleUpdate(r.id, "price", e.target.value)}
                  className="h-8 text-sm w-24"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
