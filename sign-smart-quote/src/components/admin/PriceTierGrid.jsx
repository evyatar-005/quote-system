import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Save, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { sanitizeDecimal } from "@/lib/utils";

const THICKNESS_BG = ["bg-blue-700", "bg-emerald-700", "bg-amber-700", "bg-purple-700"];
const THICKNESS_BG_LIGHT = ["bg-blue-50/60", "bg-emerald-50/60", "bg-amber-50/60", "bg-purple-50/60"];

// Generic PriceTier (product_type × thickness_mm → price_per_sqm + min_price) grid —
// extracted from the original logo-only table once the same shape repeated for a 3rd
// family (לוקובונד/פיויסי) too. Each instance owns its own PriceTier rows (filtered by
// key, not by a server query — the table has no product_type index worth adding for this).
// Operating profit % = מחיר מכירה בניכוי כל העלויות, בדיוק כמו המחשבון:
// baseCost (חומר גלם + כל עבודות + תקורה) מגיע מהמנוע עצמו עבור הזמנת ייחוס של
// 1 מ"ר, ועמלות הסוכן והשיווק מחושבות כאחוז ממחיר המכירה הנערך בטבלה.
function operatingProfitPct(config, pricePerSqm, baseCost) {
  const agentPct = (parseFloat(config?.sales_agent_commission_percent) || 0) / 100;
  const marketingPct = (parseFloat(config?.marketing_commission_percent) || 0) / 100;
  const commissionCost = pricePerSqm * (agentPct + marketingPct);
  const operatingCost = baseCost + commissionCost;
  return ((pricePerSqm - operatingCost) / pricePerSqm) * 100;
}

export default function PriceTierGrid({ productTypes, thicknesses, baseCostFn, config, saveLabel = "שמור מחירים", enablePriceRange = false }) {
  const [tiers, setTiers] = useState({});
  const [tierIds, setTierIds] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    base44.entities.PriceTier.list().then((records) => {
      const map = {};
      const ids = {};
      records.forEach((r) => {
        const key = `${r.product_type}_${r.thickness_mm}`;
        map[key] = { price_per_sqm: r.price_per_sqm ?? "", min_price: r.min_price ?? "", agent_min_price_per_sqm: r.agent_min_price_per_sqm ?? "" };
        ids[key] = r.id;
      });
      setTiers(map);
      setTierIds(ids);
    });
  }, []);

  const get = (product, thickness, field) => {
    const key = `${product}_${thickness}`;
    return tiers[key]?.[field] ?? "";
  };

  const set = (product, thickness, field, value) => {
    const key = `${product}_${thickness}`;
    setTiers((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    for (const product of productTypes) {
      for (const thickness of thicknesses) {
        const key = `${product.key}_${thickness}`;
        const data = tiers[key];
        if (!data) continue;
        const payload = {
          product_type: product.key,
          thickness_mm: thickness,
          price_per_sqm: data.price_per_sqm !== "" ? parseFloat(data.price_per_sqm) : null,
          min_price: data.min_price !== "" ? parseFloat(data.min_price) : null,
          agent_min_price_per_sqm: data.agent_min_price_per_sqm !== "" ? parseFloat(data.agent_min_price_per_sqm) : 0,
        };
        if (tierIds[key]) {
          await base44.entities.PriceTier.update(tierIds[key], payload);
        } else {
          const created = await base44.entities.PriceTier.create(payload);
          setTierIds((prev) => ({ ...prev, [key]: created.id }));
        }
      }
    }
    setSaving(false);
    setSaved(true);
    toast.success("מחירי המכירה נשמרו");
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={handleSave} disabled={saving} className="gap-2 h-9 px-4 rounded-xl">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saving ? "שומר..." : saved ? "נשמר!" : saveLabel}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-base border-separate border-spacing-0">
          <thead>
            <tr className="border-b-4 border-slate-800">
              <th className="text-right py-3 px-4 text-sm font-bold text-white bg-slate-800 border-l-4 border-slate-800">סוג מוצר</th>
              {thicknesses.map((t, i) => (
                <th
                  key={t}
                  className={`text-center py-3 px-3 text-sm font-bold text-white ${THICKNESS_BG[i % THICKNESS_BG.length]} ${i > 0 ? "border-r-4 border-slate-800" : ""}`}
                  colSpan={enablePriceRange ? 5 : 3}
                >
                  עובי {t} מ"מ
                </th>
              ))}
            </tr>
            <tr className="border-b-4 border-slate-800">
              <th className="py-2 px-4 bg-slate-100 border-l-4 border-slate-800"></th>
              {thicknesses.map((t, i) => (
                <>
                  <th key={`${t}-sqm`} className={`py-2 px-3 text-center text-sm font-semibold text-slate-700 ${THICKNESS_BG_LIGHT[i % THICKNESS_BG_LIGHT.length]} ${i > 0 ? "border-r-4 border-slate-800" : ""}`}>מחיר/מ"ר (התחלתי)</th>
                  <th key={`${t}-margin`} className={`py-2 px-3 text-center text-sm font-semibold text-slate-700 ${THICKNESS_BG_LIGHT[i % THICKNESS_BG_LIGHT.length]}`}>רווח תפעולי %</th>
                  {enablePriceRange && (
                    <>
                      <th key={`${t}-agentmin`} className={`py-2 px-3 text-center text-sm font-semibold text-slate-700 ${THICKNESS_BG_LIGHT[i % THICKNESS_BG_LIGHT.length]}`}>מחיר/מ"ר (מינימלי לסוכן)</th>
                      <th key={`${t}-agentmargin`} className={`py-2 px-3 text-center text-sm font-semibold text-slate-700 ${THICKNESS_BG_LIGHT[i % THICKNESS_BG_LIGHT.length]}`}>רווח תפעולי % (מינימלי)</th>
                    </>
                  )}
                  <th key={`${t}-min`} className={`py-2 px-3 text-center text-sm font-semibold text-slate-700 ${THICKNESS_BG_LIGHT[i % THICKNESS_BG_LIGHT.length]}`}>מינימום לפריט</th>
                </>
              ))}
            </tr>
          </thead>
          <tbody>
            {productTypes.map((product, rowIdx) => (
              <>
              <tr
                key={product.key}
                className={`hover:bg-muted/30 transition-colors ${rowIdx % 2 === 1 ? "bg-muted/10" : ""}`}
              >
                <td className="py-4 pr-3 pl-4 font-semibold border-l-4 border-slate-800 bg-slate-50 align-middle whitespace-nowrap text-right">
                  <div className="inline-flex items-center gap-3">
                    <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded bg-black text-white shrink-0">{product.sku}</span>
                    <div className="flex flex-col items-start leading-tight">
                      <span className="text-base">{product.prefix}</span>
                      <span className="text-base font-bold">{product.variant}</span>
                    </div>
                  </div>
                </td>
                {thicknesses.map((t, i) => (
                  <>
                    <td key={`${t}-sqm`} className={`py-3 px-2 align-middle ${THICKNESS_BG_LIGHT[i % THICKNESS_BG_LIGHT.length]} ${i > 0 ? "border-r-4 border-slate-800" : ""}`}>
                      <div className="relative w-28">
                        <Input
                          type="text" inputMode="decimal"
                          value={get(product.key, t, "price_per_sqm")}
                          onChange={(e) => set(product.key, t, "price_per_sqm", sanitizeDecimal(e.target.value))}
                          className="h-11 text-center text-base w-28 bg-background pl-6"
                          dir="ltr"
                        />
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">₪</span>
                      </div>
                    </td>
                    <td key={`${t}-margin`} className={`py-3 px-2 align-middle ${THICKNESS_BG_LIGHT[i % THICKNESS_BG_LIGHT.length]}`}>
                      {(() => {
                        const pricePerSqm = parseFloat(get(product.key, t, "price_per_sqm"));
                        if (!pricePerSqm) {
                          return (
                            <div className="w-20 h-11 flex items-center justify-center rounded-md border border-dashed border-slate-400 mx-auto text-sm text-muted-foreground">—</div>
                          );
                        }
                        const baseCost = baseCostFn(config, product.key, t);
                        const opPct = operatingProfitPct(config, pricePerSqm, baseCost);
                        const positive = opPct >= 0;
                        return (
                          <div className={`w-20 h-11 flex items-center justify-center rounded-md border mx-auto text-base font-semibold ${positive ? "bg-emerald-50 border-emerald-200 text-emerald-600" : "bg-red-50 border-red-200 text-red-500"}`}>
                            {opPct.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%
                          </div>
                        );
                      })()}
                    </td>
                    {enablePriceRange && (
                      <>
                        <td key={`${t}-agentmin`} className={`py-3 px-2 align-middle ${THICKNESS_BG_LIGHT[i % THICKNESS_BG_LIGHT.length]}`}>
                          <div className="relative w-28">
                            <Input
                              type="text" inputMode="decimal"
                              value={get(product.key, t, "agent_min_price_per_sqm")}
                              onChange={(e) => set(product.key, t, "agent_min_price_per_sqm", sanitizeDecimal(e.target.value))}
                              className="h-11 text-center text-base w-28 bg-background pl-6"
                              dir="ltr"
                            />
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">₪</span>
                          </div>
                        </td>
                        <td key={`${t}-agentmargin`} className={`py-3 px-2 align-middle ${THICKNESS_BG_LIGHT[i % THICKNESS_BG_LIGHT.length]}`}>
                          {(() => {
                            const agentMinPrice = parseFloat(get(product.key, t, "agent_min_price_per_sqm"));
                            if (!agentMinPrice) {
                              return (
                                <div className="w-20 h-11 flex items-center justify-center rounded-md border border-dashed border-slate-400 mx-auto text-sm text-muted-foreground">—</div>
                              );
                            }
                            const baseCost = baseCostFn(config, product.key, t);
                            const opPct = operatingProfitPct(config, agentMinPrice, baseCost);
                            const positive = opPct >= 0;
                            return (
                              <div className={`w-20 h-11 flex items-center justify-center rounded-md border mx-auto text-base font-semibold ${positive ? "bg-emerald-50 border-emerald-200 text-emerald-600" : "bg-red-50 border-red-200 text-red-500"}`}>
                                {opPct.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%
                              </div>
                            );
                          })()}
                        </td>
                      </>
                    )}
                    <td key={`${t}-min`} className={`py-3 px-2 align-middle ${THICKNESS_BG_LIGHT[i % THICKNESS_BG_LIGHT.length]}`}>
                      <div className="relative w-28">
                        <Input
                          type="text" inputMode="decimal"
                          value={get(product.key, t, "min_price")}
                          onChange={(e) => set(product.key, t, "min_price", sanitizeDecimal(e.target.value))}
                          className="h-11 text-center text-base w-28 bg-background pl-6"
                          dir="ltr"
                        />
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">₪</span>
                      </div>
                    </td>
                  </>
                ))}
              </tr>
              {rowIdx < productTypes.length - 1 && (
                <tr key={`${product.key}-gap`} aria-hidden="true">
                  <td colSpan={thicknesses.length * (enablePriceRange ? 5 : 3) + 1} className="p-0">
                    <div className="h-3 bg-muted/50 border-y-2 border-slate-400" />
                  </td>
                </tr>
              )}
              </>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground mt-3">מחיר/מ"ר × שטח המוצר = מחיר מכירה. מחיר מינימום יופעל אם התוצאה נמוכה ממנו.</p>
      {enablePriceRange && (
        <p className="text-sm text-muted-foreground mt-1">"מחיר/מ"ר (מינימלי לסוכן)" — 0 = אין טווח, המחיר ההתחלתי קבוע. אם מוגדר, הסוכן יוכל להוריד את מחיר המ"ר במחשבון שלו עד לערך הזה בלבד, לא מתחתיו.</p>
      )}
      <p className="text-sm text-muted-foreground mt-1">רווח תפעולי % = מחיר המכירה בניכוי כל העלויות (חומר גלם, כל עבודות ההכנה/הדפסה/חיתוך/אריזה, תקורה, עמלת סוכן ועמלת שיווק) — בדיוק כמו במחשבון, עבור הזמנת ייחוס של <b>1 מ"ר</b> (1×1 מ׳, אלמנט אחד). בהזמנה בפועל האחוז עשוי להשתנות מעט לפי המידות. שים לב: עלויות הכנה/אריזה קבועות-לג'וב "נבלעות" ביחידת השטח היחידה כאן — לכן האחוז בטבלה זו <b>אינו ניתן להשוואה ישירה</b> לאחוז שמופיע בטבלאות אחרות (כמו מדרגות שטח) שמשתמשות בהזמנת ייחוס גדולה יותר.</p>
    </>
  );
}
