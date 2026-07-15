import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import CostSectionCard from "./CostSectionCard";
import lightbox003 from "@/assets/products/lightbox-003.png";

const EMPTY = {
  size_label: "",
  width_cm: "",
  height_cm: "",
  frame_cost: "",
  transformer_cost: "",
};

export default function LightboxPriceTable({ config, onConfigChange }) {
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newRow, setNewRow] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    base44.entities.LightboxSizeTier.list("width_cm", 100).then((data) => {
      setTiers(data);
      setLoading(false);
    });
  }, []);

  const handleAdd = async () => {
    if (!newRow.size_label || !newRow.width_cm || !newRow.height_cm) {
      toast.error("חובה: תווית, רוחב וגובה");
      return;
    }
    setSaving(true);
    const created = await base44.entities.LightboxSizeTier.create({
      ...newRow,
      width_cm: parseFloat(newRow.width_cm),
      height_cm: parseFloat(newRow.height_cm),
      frame_cost: parseFloat(newRow.frame_cost) || 0,
      transformer_cost: parseFloat(newRow.transformer_cost) || 0,
    });
    setTiers((prev) => [...prev, created]);
    setNewRow(EMPTY);
    setSaving(false);
    toast.success("מידה נוספה");
  };

  const handleDelete = async (id) => {
    await base44.entities.LightboxSizeTier.delete(id);
    setTiers((prev) => prev.filter((t) => t.id !== id));
    toast.success("מידה נמחקה");
  };

  const handleUpdate = async (id, field, value) => {
    const updated = await base44.entities.LightboxSizeTier.update(id, { [field]: parseFloat(value) || value });
    setTiers((prev) => prev.map((t) => t.id === id ? { ...t, ...updated } : t));
  };

  const NUM_FIELDS = [
    { key: "frame_cost", label: "מסגרת (₪)" },
    { key: "transformer_cost", label: "שנאי (₪)" },
  ];

  return (
    <CostSectionCard image={lightbox003} title='מחירון ארגז מואר לפי מידה' description='הגדר עלויות ומחיר מכירה לכל מידה סטנדרטית'>
      {/* Per-sqm material costs from config */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {[
          { key: "lightbox_led_qty_per_sqm", label: 'כמות לדים למ"ר' },
          { key: "lightbox_led_waterproof_cost", label: 'מחיר ליחידת לד (₪)' },
        ].map(({ key, label }) => (
          <div key={key}>
            <label className="text-sm font-semibold text-slate-700 block mb-1">{label}</label>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                value={config?.[key] ?? ""}
                onChange={(e) => onConfigChange(key, parseFloat(e.target.value) || null)}
                className="h-8 text-sm"
              />
              <span className="text-xs text-muted-foreground">₪</span>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-slate-700 text-sm font-semibold">
                <th className="text-right pb-2 pr-1">מידה</th>
                <th className="text-right pb-2 px-1">ר (ס"מ)</th>
                <th className="text-right pb-2 px-1">ג (ס"מ)</th>
                <th className="text-right pb-2 px-1">לדים (מחושב)</th>
                {NUM_FIELDS.map((f) => (
                 <th key={f.key} className="text-right pb-2 px-1">{f.label}</th>
                ))}
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <tr key={tier.id} className="border-b border-black hover:bg-muted/20">
                  <td className="py-1 pr-1">
                    <Input
                      defaultValue={tier.size_label}
                      onBlur={(e) => handleUpdate(tier.id, "size_label", e.target.value)}
                      className="h-7 text-base w-20"
                    />
                  </td>
                  <td className="py-1 px-1">
                    <Input
                      type="number"
                      defaultValue={tier.width_cm}
                      onBlur={(e) => handleUpdate(tier.id, "width_cm", e.target.value)}
                      className="h-7 text-base w-16"
                    />
                  </td>
                  <td className="py-1 px-1">
                    <Input
                      type="number"
                      defaultValue={tier.height_cm}
                      onBlur={(e) => handleUpdate(tier.id, "height_cm", e.target.value)}
                      className="h-7 text-base w-16"
                    />
                  </td>
                  <td className="py-1 px-1">
                    <span className="text-base text-slate-700">
                      {(() => {
                        const area = (tier.width_cm / 100) * (tier.height_cm / 100);
                        const qty = parseFloat(config?.lightbox_led_qty_per_sqm) || 0;
                        const price = parseFloat(config?.lightbox_led_waterproof_cost) || 0;
                        return `₪${(area * qty * price).toFixed(2)}`;
                      })()}
                    </span>
                  </td>
                  {NUM_FIELDS.map((f) => (
                    <td key={f.key} className="py-1 px-1">
                      <Input
                        type="number"
                        defaultValue={tier[f.key]}
                        onBlur={(e) => handleUpdate(tier.id, f.key, e.target.value)}
                        className="h-7 text-base w-20"
                      />
                    </td>
                  ))}
                  <td className="py-1 pl-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(tier.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {/* New row */}
              <tr className="border-t border-dashed border-border">
                <td className="py-2 pr-1">
                  <Input placeholder="40×60" value={newRow.size_label} onChange={(e) => setNewRow(p => ({ ...p, size_label: e.target.value }))} className="h-7 text-base w-20" />
                </td>
                <td className="py-2 px-1">
                  <Input type="number" placeholder="40" value={newRow.width_cm} onChange={(e) => setNewRow(p => ({ ...p, width_cm: e.target.value }))} className="h-7 text-base w-16" />
                </td>
                <td className="py-2 px-1">
                  <Input type="number" placeholder="60" value={newRow.height_cm} onChange={(e) => setNewRow(p => ({ ...p, height_cm: e.target.value }))} className="h-7 text-base w-16" />
                </td>
                {NUM_FIELDS.map((f) => (
                  <td key={f.key} className="py-2 px-1">
                    <Input type="number" placeholder="0" value={newRow[f.key]} onChange={(e) => setNewRow(p => ({ ...p, [f.key]: e.target.value }))} className="h-7 text-base w-20" />
                  </td>
                ))}
                <td className="py-2 pl-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-primary" onClick={handleAdd} disabled={saving}>
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </CostSectionCard>
  );
}