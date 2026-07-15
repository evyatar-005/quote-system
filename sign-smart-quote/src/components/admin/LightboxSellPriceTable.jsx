import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Save, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

const SUB_TYPES = [
  { key: "003-01", label: "003-01 ארגז מואר חד צדדי" },
  { key: "003-02", label: "003-02 ארגז מואר דו צדדי" },
  { key: "003-03", label: "003-03 ארגז מואר עם הדפס לוקובונד אחורי" },
];

export default function LightboxSellPriceTable() {
  const [sizes, setSizes] = useState([]);
  const [prices, setPrices] = useState({}); // key: `${sub_type}_${size_label}` => { base, perSqm, id }
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      base44.entities.LightboxSizeTier.list("width_cm", 100),
      base44.entities.LightboxSellingPrice.list("", 500),
    ]).then(([sizesData, pricesData]) => {
      setSizes(sizesData);
      const map = {};
      pricesData.forEach((r) => {
        const k = `${r.sub_type}_${r.size_label}`;
        map[k] = { base: r.selling_base_price ?? "", perSqm: r.selling_price_per_sqm ?? "", id: r.id };
      });
      setPrices(map);
    });
  }, []);

  const get = (subType, sizeLabel, field) => {
    return prices[`${subType}_${sizeLabel}`]?.[field] ?? "";
  };

  const set = (subType, sizeLabel, field, value) => {
    const k = `${subType}_${sizeLabel}`;
    setPrices((prev) => ({ ...prev, [k]: { ...prev[k], [field]: value } }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    for (const sub of SUB_TYPES) {
      for (const size of sizes) {
        const k = `${sub.key}_${size.size_label}`;
        const entry = prices[k] || {};
        const payload = {
          sub_type: sub.key,
          size_label: size.size_label,
          selling_base_price: entry.base !== "" ? parseFloat(entry.base) || 0 : 0,
          selling_price_per_sqm: entry.perSqm !== "" ? parseFloat(entry.perSqm) || 0 : 0,
        };
        if (entry.id) {
          await base44.entities.LightboxSellingPrice.update(entry.id, payload);
        } else {
          const created = await base44.entities.LightboxSellingPrice.create(payload);
          setPrices((prev) => ({ ...prev, [k]: { ...prev[k], id: created.id } }));
        }
      }
    }
    setSaving(false);
    setSaved(true);
    toast.success("מחירי ארגז מואר נשמרו");
    setTimeout(() => setSaved(false), 2000);
  };

  if (sizes.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">אין מידות מוגדרות לארגז מואר. הגדר מידות בלשונית "קביעת עלויות".</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-2 h-9 px-4 rounded-xl text-sm font-semibold">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saving ? "שומר מחירי ארגז מואר..." : saved ? "מחירי ארגז מואר נשמרו!" : "שמור מחירי ארגז מואר"}
        </Button>
      </div>

      {SUB_TYPES.map((sub) => (
        <div key={sub.key} className="border border-black rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-muted/30 border-b border-border/30">
            <span className="text-base font-semibold">{sub.label}</span>
          </div>
          <div className="overflow-x-auto p-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black">
                  <th className="text-right py-1.5 px-2 text-sm font-semibold text-slate-700">מידה</th>
                  <th className="text-center py-1.5 px-2 text-sm font-semibold text-slate-700">מחיר בסיס (₪)</th>
                  <th className="text-center py-1.5 px-2 text-sm font-semibold text-slate-700">תוספת למ"ר (₪)</th>
                </tr>
              </thead>
              <tbody>
                {sizes.map((size) => (
                  <tr key={size.size_label} className="border-b border-border/20 hover:bg-muted/10">
                    <td className="py-1.5 px-2 text-base font-semibold">{size.size_label} ({size.width_cm}×{size.height_cm})</td>
                    <td className="py-1.5 px-1">
                      <Input
                        type="number" min="0" step="1"
                        value={get(sub.key, size.size_label, "base")}
                        onChange={(e) => set(sub.key, size.size_label, "base", e.target.value)}
                        className="h-8 text-center text-base w-28 mx-auto block"
                        dir="ltr" placeholder="₪"
                      />
                    </td>
                    <td className="py-1.5 px-1">
                      <Input
                        type="number" min="0" step="1"
                        value={get(sub.key, size.size_label, "perSqm")}
                        onChange={(e) => set(sub.key, size.size_label, "perSqm", e.target.value)}
                        className="h-8 text-center text-base w-28 mx-auto block"
                        dir="ltr" placeholder="₪"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="text-sm text-muted-foreground">מחיר = מחיר בסיס + (תוספת למ"ר × שטח)</p>
    </div>
  );
}