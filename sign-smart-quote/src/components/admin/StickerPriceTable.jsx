import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sticker } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { calculate } from "../calculator/useCalculator";
import OperatingProfitBadge from "./OperatingProfitBadge";

const PRODUCT_TYPES = [
  { key: "vinyl_sticker", label: "מדבקת ויניל" },
  { key: "texture_sticker", label: "מדבקת טקסטורה" },
];

function StickerTable({ productType, config, onConfigChange }) {
  const prefix = productType === 'vinyl_sticker' ? 'vinyl' : 'texture';
  const priceKey = `${prefix}_sticker_price_per_sqm`;
  const minPriceKey = `${prefix}_sticker_min_price`;
  const installPriceKey = `${prefix}_sticker_install_price_per_sqm`;
  const minPriceCenterKey = `${prefix}_sticker_install_min_price`;
  const minPriceSouthKey = `${prefix}_sticker_install_min_price_south`;

  // Operating profit for the sticker itself (1 מ"ר, מדבקה בלבד ללא התקנה), min
  // price disabled so the % reflects the per-m² rate, not the minimum charge.
  let opPct = null;
  try { opPct = config ? calculate({ config, productType, widthM: 1, heightM: 1, stickerPriceTiers: [], includeInstallation: "no", quantity: 1, enforceMinimumPrice: false })?.profitMarginPct : null; } catch { opPct = null; }

  return (
    <div className="space-y-4">
      {/* מחיר מכירה */}
      <div className="bg-muted/30 rounded-xl p-4 border border-black space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">מחיר מכירה למדבקה</p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">רווח תפעולי (מדבקה בלבד, למ"ר):</span>
            <OperatingProfitBadge pct={opPct} size="sm" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-slate-700">מחיר מ"ר מדבקה (₪/מ"ר)</Label>
            <Input
              type="number" min="0" step="10"
              value={config?.[priceKey] ?? ""}
              onChange={(e) => onConfigChange?.(priceKey, e.target.value === "" ? null : parseFloat(e.target.value) || 0)}
              className="h-9 bg-background" dir="ltr" placeholder="₪/מ׳ר"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-slate-700">מחיר מינימום לייצור מדבקה (₪)</Label>
            <Input
              type="number" min="0" step="10"
              value={config?.[minPriceKey] ?? ""}
              onChange={(e) => onConfigChange?.(minPriceKey, e.target.value === "" ? null : parseFloat(e.target.value) || 0)}
              className="h-9 bg-background" dir="ltr" placeholder="₪"
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">מחיר המדבקה = מחיר למ"ר × שטח, ולא יירד מתחת למחיר המינימום</p>
      </div>

      {/* מחיר התקנה */}
      <div className="bg-amber-50/50 rounded-xl p-4 border border-amber-200 space-y-3">
        <p className="text-sm font-semibold">מחיר מכירה להתקנה</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-slate-700">מחיר מ"ר התקנה (₪/מ"ר)</Label>
            <Input
              type="number" min="0" step="10"
              value={config?.[installPriceKey] ?? ""}
              onChange={(e) => onConfigChange?.(installPriceKey, e.target.value === "" ? null : parseFloat(e.target.value) || 0)}
              className="h-9 bg-background" dir="ltr" placeholder="₪/מ׳ר"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-slate-700">מחיר מינימום התקנה - מרכז (₪)</Label>
            <Input
              type="number" min="0" step="10"
              value={config?.[minPriceCenterKey] ?? ""}
              onChange={(e) => onConfigChange?.(minPriceCenterKey, e.target.value === "" ? null : parseFloat(e.target.value) || 0)}
              className="h-9 bg-background" dir="ltr" placeholder="₪"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-slate-700">מחיר מינימום התקנה - דרום (₪)</Label>
            <Input
              type="number" min="0" step="10"
              value={config?.[minPriceSouthKey] ?? ""}
              onChange={(e) => onConfigChange?.(minPriceSouthKey, e.target.value === "" ? null : parseFloat(e.target.value) || 0)}
              className="h-9 bg-background" dir="ltr" placeholder="₪"
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground -mt-2">מחיר ההתקנה = מחיר למ"ר × שטח, ולא יירד מתחת למחיר המינימום לאזור</p>
      </div>
    </div>
  );
}

export default function StickerPriceTable({ embedded = false, config, onConfigChange }) {
  const content = (
    <Tabs defaultValue="vinyl_sticker" dir="rtl">
      <TabsList className="mb-4">
        {PRODUCT_TYPES.map((p) => (
          <TabsTrigger key={p.key} value={p.key}>{p.label}</TabsTrigger>
        ))}
      </TabsList>
      {PRODUCT_TYPES.map((p) => (
        <TabsContent key={p.key} value={p.key}>
          <StickerTable productType={p.key} config={config} onConfigChange={onConfigChange} />
        </TabsContent>
      ))}
    </Tabs>
  );

  if (embedded) return <div className="pt-2">{content}</div>;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-pink-500/10 flex items-center justify-center text-pink-600">
            <Sticker className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">תמחור מדבקות קיר ללקוח</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">הזן מ"ר, מחיר מדבקה ומחירי התקנה לאזורים שונים</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}