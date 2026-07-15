import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FlaskConical, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import CalculatorForm from "../calculator/CalculatorForm";
import CostResults from "../calculator/CostResults";
import SalesResults from "../calculator/SalesResults";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, TrendingUp, Percent } from "lucide-react";
import { calculate } from "../calculator/useCalculator";

const DEFAULT_FORM = () => ({ productType: "", widthM: "", heightM: "", thicknessMm: "5", quantity: "1", region: "מרכז" });

export default function AdminCalculatorTest({ config, allowedProducts }) {
  const [form, setForm] = useState(() => DEFAULT_FORM(allowedProducts));
  const [priceTiers, setPriceTiers] = useState([]);
  const [stickerPriceTiers, setStickerPriceTiers] = useState([]);
  const [paintSurchargeTiers, setPaintSurchargeTiers] = useState([]);
  const [kapaPriceTiers, setKapaPriceTiers] = useState([]);
  const [rollupPriceTiers, setRollupPriceTiers] = useState([]);
  const [lokobondAreaTiers, setLokobondAreaTiers] = useState([]);
  const [glassPriceTiers, setGlassPriceTiers] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadTiers = async () => {
    setRefreshing(true);
    const [price, sticker, paint, kapa, rollup, lokobondArea, glass] = await Promise.all([
      base44.entities.PriceTier.list(),
      base44.entities.StickerPriceTier.list(),
      base44.entities.PaintSurchargeTier.list(),
      base44.entities.KapaPriceTier.list(),
      base44.entities.RollupPriceTier.list(),
      base44.entities.LokobondAreaTier.list(),
      base44.entities.GlassPriceTier.list(),
    ]);
    setPriceTiers(price);
    setStickerPriceTiers(sticker);
    setPaintSurchargeTiers(paint);
    setKapaPriceTiers(kapa);
    setRollupPriceTiers(rollup);
    setLokobondAreaTiers(lokobondArea);
    setGlassPriceTiers(glass);
    setRefreshing(false);
  };

  useEffect(() => {
    loadTiers();
    const onFocus = () => loadTiers();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    // עריכת מחירים ובדיקת המחשבון נמצאות באותו עמוד/טאב, אז focus/visibility
    // לא תמיד נדלקים — פולינג קל שומר את הנתונים כאן מסונכרנים עם השרת
    const interval = setInterval(loadTiers, 4000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(interval);
    };
  }, []);

  let result = null;
  try { result = config ? calculate({ config, priceTiers, stickerPriceTiers, paintSurchargeTiers, kapaPriceTiers, rollupPriceTiers, lokobondAreaTiers, glassPriceTiers, ...form }) : null; } catch(e) { console.error('calculate error:', e); }

  // Recalculate whenever tiers or form changes
  useEffect(() => {
    if (result) console.log('Calculation result:', result);
  }, [result, priceTiers, stickerPriceTiers, paintSurchargeTiers, kapaPriceTiers, rollupPriceTiers, lokobondAreaTiers, glassPriceTiers, form, config]);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">בדיקת מחשבון</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">הזן מידות ובדוק את תוצאת המחיר לפי ההגדרות הנוכחיות</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex justify-end">
          <Button onClick={loadTiers} disabled={refreshing} size="sm" variant="outline" className="gap-2 h-7">
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="text-sm font-semibold">עדכן</span>
          </Button>
        </div>
        <CalculatorForm values={form} onChange={setForm} allowedProducts={allowedProducts} kapaPriceTiers={kapaPriceTiers} rollupPriceTiers={rollupPriceTiers} glassPriceTiers={glassPriceTiers} unitPriceExVat={result ? result.sellingPricePerUnit : null} priceRangeMin={result ? result.priceRangeMin : null} priceRangeMax={result ? result.priceRangeMax : null} />
        
        <div className="space-y-4">
          {/* מחיר למ"ר - למדבקות בלבד */}
          {result && result.isSticker && result.totalArea > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-blue-800">מחיר ללקוח למ"ר</div>
                  <div className="text-sm text-blue-500 mt-0.5">מחיר מדבקה בלבד ÷ שטח כולל</div>
                </div>
                <div className="text-2xl font-bold text-blue-700">
                  ₪ {Number(result.stickerOnlyPrice / result.totalArea).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  <span className="text-base font-normal text-blue-500 mr-1">/ מ"ר</span>
                </div>
              </div>
              {result.breakdown?.installationCost > 0 && (
                <div className="grid grid-cols-2 gap-2 border-t border-blue-200 pt-2">
                  <div className="flex items-center justify-between bg-white/60 rounded-lg px-3 py-2">
                    <span className="text-sm font-semibold text-blue-800">מחיר התקנה למ"ר</span>
                    <span className="text-sm font-bold text-blue-700">₪ {Number(result.breakdown.installationCost / result.totalArea).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex items-center justify-between bg-white/60 rounded-lg px-3 py-2">
                    <span className="text-sm font-semibold text-blue-800">מחיר התקנה כולל (סה"כ)</span>
                    <span className="text-sm font-bold text-blue-700">₪ {Number(result.breakdown.installationCost).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* סיכום קצר — מציג את הסך הכל האמיתי של העסקה (לפי הכמות), לא רק מחיר ליחידה */}
          {result ? (() => {
            const q = parseInt(form.quantity) || 1;
            const totalProfit = (result.sellingPriceAll ?? result.sellingPricePerUnit * q) - (result.totalCostAll ?? result.totalCostPerUnit * q);
            return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="bg-card rounded-lg border border-black p-3 text-center">
                <div className="text-sm font-semibold text-muted-foreground mb-1">מחיר מכירה — סה"כ עסקה{q > 1 ? ` (×${q})` : ""}</div>
                <div className="text-2xl font-bold text-emerald-600">₪ {Number(result.sellingPriceAll ?? result.sellingPricePerUnit * q).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                {q > 1 && (
                  <div className="text-sm text-muted-foreground mt-1">₪{Number(result.sellingPricePerUnit).toLocaleString("he-IL")} ליחידה</div>
                )}
                {result.paintSellingSurcharge > 0 && (
                  <div className="text-sm text-amber-600 mt-1">כולל תוספת צביעה: ₪{Number(result.paintSellingSurcharge).toLocaleString("he-IL")}</div>
                )}
                {result.spacersSellingSurcharge > 0 && (
                  <div className="text-sm text-amber-600 mt-1">כולל תוספת ספייסרים: ₪{Number(result.spacersSellingSurcharge).toLocaleString("he-IL")}</div>
                )}
              </div>
              <div className="bg-card rounded-lg border border-black p-3 text-center">
                <div className="text-sm font-semibold text-muted-foreground mb-1">עלות ייצור — סה"כ עסקה</div>
                <div className="text-2xl font-bold">₪ {Number(result.totalCostAll ?? result.totalCostPerUnit * q).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                {q > 1 && (
                  <div className="text-sm text-muted-foreground mt-1">₪{Number(result.totalCostPerUnit).toLocaleString("he-IL")} ליחידה</div>
                )}
              </div>
              <div className="bg-card rounded-lg border border-black p-3 text-center">
                <div className="text-sm font-semibold text-muted-foreground mb-1">רווח — סה"כ עסקה</div>
                <div className={`text-2xl font-bold ${totalProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>₪ {Number(totalProfit).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                {q > 1 && (
                  <div className="text-sm text-muted-foreground mt-1">₪{Number(result.profitPerUnit).toLocaleString("he-IL")} ליחידה</div>
                )}
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                <div className="text-sm font-semibold text-muted-foreground mb-1">רווח תפעולי %</div>
                <div className={`text-2xl font-bold ${result.profitMarginPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>{Number(result.profitMarginPct).toLocaleString("he-IL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</div>
              </div>
            </div>
            );
          })() : (
            <></>
          )}

          {/* מחיר מינימום למסמך — שכבה נוספת מעל מחיר המינימום לפריט. כאן מדמים
              מסמך שמכיל רק את הפריט הזה, כדי שיהיה ברור שהשכבות מצטרפות: קודם
              נבדק מחיר המינימום של הפריט עצמו (בטבלת המחירים), ורק אחר כך המחיר
              הסופי של כל המסמך מושווה למחיר המינימום למסמך. בהזמנה אמיתית עם כמה
              מוצרים ההשוואה הזו מתבצעת על סכום כל השורות, לא על שורה בודדת. */}
          {result && (() => {
            const q = parseInt(form.quantity) || 1;
            const orderTotalExVat = result.sellingPriceAll ?? result.sellingPricePerUnit * q;
            const documentMinimumPrice = parseFloat(config?.document_minimum_price) || 0;
            if (!documentMinimumPrice) return null;
            const docMinApplied = orderTotalExVat > 0 && orderTotalExVat < documentMinimumPrice;
            const finalOrderTotal = orderTotalExVat > 0 ? Math.max(orderTotalExVat, documentMinimumPrice) : orderTotalExVat;
            return (
              <div className={`rounded-lg border p-3 flex items-center justify-between gap-3 ${docMinApplied ? "bg-amber-50 border-amber-300" : "bg-slate-50 border-black"}`}>
                <div>
                  <div className="text-sm font-semibold text-slate-700">מחיר מינימום למסמך: ₪{documentMinimumPrice.toLocaleString("he-IL")}</div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    {docMinApplied
                      ? "המוצר הזה לבדו לא מגיע למחיר המינימום של המסמך — אם זו כל ההזמנה, המחיר יעלה למינימום."
                      : "בהנחה שזו כל ההזמנה — המחיר כבר מעל מחיר המינימום למסמך, אין השפעה."}
                  </div>
                </div>
                <div className={`text-xl font-bold ${docMinApplied ? "text-amber-700" : "text-emerald-600"}`}>
                  ₪ {Number(finalOrderTotal).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
            );
          })()}

          {!result && (
            <div className="flex items-center justify-center h-16 text-sm text-muted-foreground">הזן מידות כדי לראות תוצאות</div>
          )}

          {/* סיכומי עלויות ורווחיות */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <CostResults result={result} quantity={form.quantity} config={config} />
            <SalesResults result={result} quantity={form.quantity} config={config} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}