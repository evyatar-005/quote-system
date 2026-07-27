import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

const PRODUCT_TYPE_LABELS = {
  rollup_magnetic: "רול אפ מגנטי",
  rollup_regular: "רול אפ רגיל",
};

export default function RollupMaterialCostsTable() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.RollupPriceTier.list().then((records) => {
      setRows(records.sort((a, b) => a.sku.localeCompare(b.sku)));
      setLoading(false);
    });
  }, []);

  const handleUpdate = async (id, value) => {
    const stand_cost = parseFloat(value) || 0;
    const updated = await base44.entities.RollupPriceTier.update(id, { stand_cost });
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
            <th className="text-right py-2 px-3 font-semibold text-slate-700">סוג</th>
            <th className="text-right py-2 px-3 font-semibold text-slate-700">תיאור / מידה</th>
            <th className="text-right py-2 px-3 font-semibold text-slate-700">עלות מתקן (₪)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-400 hover:bg-muted/20 transition-colors">
              <td className="py-2 px-3 text-slate-600">{PRODUCT_TYPE_LABELS[r.product_type] || r.product_type}</td>
              <td className="py-2 px-3">{r.description}</td>
              <td className="py-2 px-3">
                <Input
                  type="number" min="0" step="0.1" dir="ltr"
                  defaultValue={r.stand_cost}
                  onBlur={(e) => handleUpdate(r.id, e.target.value)}
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
