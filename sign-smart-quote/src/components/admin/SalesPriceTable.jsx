import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DollarSign, Tag, Trash2 } from "lucide-react";
import StickerPriceTable from "./StickerPriceTable";
import PaintSurchargeTable from "./PaintSurchargeTable";
import LightboxSellPriceTable from "./LightboxSellPriceTable";
import KapaPriceTable from "./KapaPriceTable";
import KapaDealsSection from "./KapaDealsSection";
import RollupPriceTable from "./RollupPriceTable";
import LokobondAreaPriceTable from "./LokobondAreaPriceTable";
import GlassPriceTable from "./GlassPriceTable";
import NumberPriceTable from "./NumberPriceTable";
import GraphicsPriceTable from "./GraphicsPriceTable";
import GlowSignSection from "./GlowSignSection";
import VistaItemsSection from "./VistaItemsSection";
import AdminCalculatorTest from "./AdminCalculatorTest";
import LightboxCalculator from "../calculator/LightboxCalculator";
import CollapsibleSection from "./CollapsibleSection";
import PriceTierGrid from "./PriceTierGrid";
import logo001 from "@/assets/products/logo-001.png";
import sticker002 from "@/assets/products/sticker-002.png";
import lightbox003 from "@/assets/products/lightbox-003.png";
import kapa004 from "@/assets/products/kapa-004.png";
import lokobond005 from "@/assets/products/lokobond-005.png";
import foamex006 from "@/assets/products/foamex-006.png";
import rollup007 from "@/assets/products/rollup-007.png";
import glass009 from "@/assets/products/glass-009.png";
import perspexBoard003 from "@/assets/products/perspex-board-003.png";
import numbers012 from "@/assets/products/numbers-012.png";
import pvcCarpet013 from "@/assets/products/pvc-carpet-013.png";
import { sanitizeDecimal } from "@/lib/utils";
import { calculate } from "../calculator/useCalculator";

// Full base cost (חומר גלם + כל העבודות + תקורה) for the operating-profit column,
// taken straight from the engine for a 1 m² reference job (1×1 מ׳, אלמנט אחד) —
// so the % in the table matches the calculator exactly. Commissions (a % of the
// edited selling price) are added inside PriceTierGrid.
const engineBaseCostFn = (cfg, productKey, thickness) => {
  const r = calculate({ config: cfg, productType: productKey, widthM: 1, heightM: 1, thicknessMm: thickness, elements: 1, quantity: 1 });
  return r?.baseCost || 0;
};

// `prefix` = what's common across the family, `variant` = what actually differs
// between rows — split so the manager can scan differences at a glance.
const PRODUCT_TYPES = [
  { key: "pvc_white", sku: "005-1", prefix: "לוגו בחיתוך צורני PVC", variant: "לבן" },
  { key: "pvc_black", sku: "005-2", prefix: "לוגו בחיתוך צורני PVC", variant: "שחור" },
  { key: "perspex_print", sku: "005-3", prefix: "לוגו בחיתוך צורני פרספקס", variant: "שקוף כולל הדפסה" },
  { key: "perspex_print_back", sku: "005-9", prefix: "לוגו בחיתוך צורני פרספקס", variant: "בהדפסה אחורית" },
  { key: "perspex_black", sku: "005-4", prefix: "לוגו בחיתוך צורני פרספקס", variant: "שחור" },
  { key: "perspex_white", sku: "005-5", prefix: "לוגו בחיתוך צורני פרספקס", variant: "לבן" },
  { key: "perspex_milky", sku: "005-6", prefix: "לוגו בחיתוך צורני פרספקס", variant: "חלבי" },
  { key: "perspex_mirror", sku: "005-7", prefix: "לוגו בחיתוך צורני", variant: "צבעי מראה (כסוף, זהב, רוז-גולד)" },
  { key: "perspex_metallic", sku: "005-8", prefix: "לוגו בחיתוך צורני", variant: "צבעי זהב/כסף מטאלי" },
];
const THICKNESSES = ["3", "5", "10", "19"];

// סדר המק"טים — קבוע, לא לשנות בלי לעדכן בכל הממשקים (מק"ט = הזהות של המוצר
// כלפי הסוכנים והלקוחות). 004 / 007 / 012 הם מוצרים חדשים שטרם הוגדרו —
// הלשוניות שלהם קיימות אבל ריקות עד שיוגדרו זמני עבודה ומחירים.
const ITEMS = [
  { key: "001", sku: "001", label: "שילוט לוקובונד", badgeClass: "bg-cyan-100 text-cyan-700", ringClass: "border-cyan-400/60 bg-cyan-50 shadow-cyan-100", image: lokobond005 },
  { key: "002", sku: "002", label: "שילוט פיויסי", badgeClass: "bg-rose-100 text-rose-700", ringClass: "border-rose-400/60 bg-rose-50 shadow-rose-100", image: foamex006 },
  { key: "003", sku: "003", label: "שילוט פרספקס", badgeClass: "bg-teal-100 text-teal-700", ringClass: "border-teal-400/60 bg-teal-50 shadow-teal-100", image: perspexBoard003 },
  { key: "004", sku: "004", label: "שילוט פולט אור", badgeClass: "bg-yellow-100 text-yellow-700", ringClass: "border-yellow-400/60 bg-yellow-50 shadow-yellow-100", image: null },
  { key: "005", sku: "005", label: "לוגו בחיתוך צורני", badgeClass: "bg-blue-100 text-blue-700", ringClass: "border-blue-400/60 bg-blue-50 shadow-blue-100", image: logo001 },
  { key: "006", sku: "006", label: "מדבקות קיר", badgeClass: "bg-emerald-100 text-emerald-700", ringClass: "border-emerald-400/60 bg-emerald-50 shadow-emerald-100", image: sticker002 },
  { key: "007", sku: "007", label: "מדבקות בחיתוך צורני", badgeClass: "bg-lime-100 text-lime-700", ringClass: "border-lime-400/60 bg-lime-50 shadow-lime-100", image: null },
  { key: "008", sku: "008", label: "קאפה", badgeClass: "bg-purple-100 text-purple-700", ringClass: "border-purple-400/60 bg-purple-50 shadow-purple-100", image: kapa004 },
  { key: "009", sku: "009", label: "רול אפ", badgeClass: "bg-indigo-100 text-indigo-700", ringClass: "border-indigo-400/60 bg-indigo-50 shadow-indigo-100", image: rollup007 },
  { key: "010", sku: "010", label: "זכוכית אקסטרה קליר", badgeClass: "bg-sky-100 text-sky-700", ringClass: "border-sky-400/60 bg-sky-50 shadow-sky-100", image: glass009 },
  { key: "011", sku: "011", label: "ארגז מואר", badgeClass: "bg-amber-100 text-amber-700", ringClass: "border-amber-400/60 bg-amber-50 shadow-amber-100", image: lightbox003 },
  { key: "012", sku: "012", label: "חיתוך מספרים בלייזר", badgeClass: "bg-orange-100 text-orange-700", ringClass: "border-orange-400/60 bg-orange-50 shadow-orange-100", image: numbers012 },
  { key: "013", sku: "013", label: "שטיח פיויסי", badgeClass: "bg-fuchsia-100 text-fuchsia-700", ringClass: "border-fuchsia-400/60 bg-fuchsia-50 shadow-fuchsia-100", image: pvcCarpet013 },
  { key: "014", sku: "014", label: "שילוט משרדי ויסטה", badgeClass: "bg-teal-100 text-teal-700", ringClass: "border-teal-400/60 bg-teal-50 shadow-teal-100", image: null },
  { key: "0000", sku: "0000", label: "גרפיקה", badgeClass: "bg-slate-100 text-slate-700", ringClass: "border-slate-400/60 bg-slate-50 shadow-slate-100", image: null },
];

// מוצרים חדשים שטרם הוגדרו — מק"ט שמור, מסכי ניהול קיימים אבל ריקים.
const EMPTY_PRODUCT_KEYS = new Set(["007"]);

// מספרים בחיתוך לייזר (012) — אותם גימורי פרספקס כמו בלוגו (005), אבל
// מתומחר לפי יחידה (ספרה) × גובה, לא לפי מ"ר — ר' NumberPriceTable.
const NUMBER_PRODUCT_TYPES = [
  "numbers_perspex_clear",
  "numbers_perspex_black",
  "numbers_perspex_white",
  "numbers_perspex_milky",
  "numbers_perspex_mirror",
  "numbers_perspex_metallic",
];

const LOKOBOND_PRODUCT_TYPES = [
  { key: "lokobond_plain", sku: "001-1", prefix: "שילוט לוקובונד", variant: "ללא חיתוך צורני" },
  { key: "lokobond_diecut", sku: "001-2", prefix: "שילוט לוקובונד", variant: "עם חיתוך צורני" },
];
const LOKOBOND_THICKNESSES = ["3"];

const FOAMEX_PRODUCT_TYPES = [
  { key: "foamex_white", sku: "002-1", prefix: "שילוט פיויסי", variant: "לבן" },
  { key: "foamex_black", sku: "002-2", prefix: "שילוט פיויסי", variant: "שחור" },
];
const FOAMEX_THICKNESSES = ["2", "3", "5"];

const PERSPEX_BOARD_PRODUCT_TYPES = [
  { key: "perspex_board_clear_print", sku: "003-1", prefix: "שילוט פרספקס", variant: "שקוף הדפסה קדמית" },
  { key: "perspex_board_black_matte", sku: "003-2", prefix: "שילוט פרספקס", variant: "שחור מט" },
  { key: "perspex_board_black_glossy", sku: "003-3", prefix: "שילוט פרספקס", variant: "שחור מבריק" },
  { key: "perspex_board_white", sku: "003-4", prefix: "שילוט פרספקס", variant: "לבן" },
  { key: "perspex_board_milky", sku: "003-5", prefix: "שילוט פרספקס", variant: "חלבי" },
  { key: "perspex_board_back_print", sku: "003-6", prefix: "שילוט פרספקס", variant: "שקוף הדפסה אחורית" },
];
const PERSPEX_BOARD_THICKNESSES = ["3", "5", "10"];

const PVC_CARPET_PRODUCT_TYPES = [
  { key: "pvc_carpet", sku: "013", prefix: "שטיח פיויסי", variant: "" },
];
const PVC_CARPET_THICKNESSES = ["2"];

// מסך ריק זמני למוצר שטרם הוגדר — שומר את המקום ברשימה ובממשק, בלי לחבר
// עדיין למנוע החישוב. יוחלף בלשוניות אמיתיות (זמני ייצור + מחירים) כשיבנה המוצר.
function EmptyProductPlaceholder({ label }) {
  return (
    <div className="mt-5 flex flex-wrap gap-3 items-start">
      <CollapsibleSection title="זמני ייצור">
        <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-muted-foreground">
          "{label}" — טרם הוגדרו זמני ייצור. נמשיך להגדיר בהמשך.
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="טבלת מחירים">
        <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-muted-foreground">
          "{label}" — טרם הוגדרו מחירים. נמשיך להגדיר בהמשך.
        </div>
      </CollapsibleSection>
    </div>
  );
}

// תוספת "דבק דו-צדדי" — מחיר מכירה נקבע בנפרד לכל מוצר (עלות מקבילה בלשונית
// "קביעת עלויות" → MaterialCostsSection), אותה תבנית עיצוב בדיוק כמו תוספת
// הספייסרים (005) ותוספות המדפים (008) למטה.
function TapeSellingPriceField({ configKey, config, onConfigChange }) {
  return (
    <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4 flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-foreground">מחיר תוספת דבק דו-צדדי</p>
        <p className="text-sm text-muted-foreground mt-0.5">
          מחיר זה נוסף למחיר המכירה כשלקוח בוחר "דבק דו-צדדי" ברשימת התוספות. נשמר עם הכפתור "שמור הגדרות" למעלה.
        </p>
      </div>
      <div className="relative w-32 shrink-0">
        <Input
          type="text" inputMode="decimal"
          value={config?.[configKey] ?? ""}
          onChange={(e) => onConfigChange?.(configKey, e.target.value === "" ? null : parseFloat(sanitizeDecimal(e.target.value)) || 0)}
          className="h-11 text-center text-base w-32 bg-background pl-7"
          dir="ltr"
        />
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">₪</span>
      </div>
    </div>
  );
}

export default function SalesPriceTable({ config, onConfigChange }) {
  const [selected, setSelected] = useState(null);

  return (
    <>
    <Card className="shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">קביעת מחירי מכירה</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">הגדר מחירים לכל מוצר לפי מק"ט</p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* משבצות לבחירת פריט — שם + מק"ט מתחת לתמונה, לא מעליה */}
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
          {ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSelected(selected === item.key ? null : item.key)}
              className={`max-w-[140px] overflow-hidden rounded-xl border-2 text-center transition-all flex flex-col ${
                selected === item.key
                  ? `${item.ringClass} shadow-md`
                  : "border-black bg-card hover:border-slate-400 hover:bg-muted/20 shadow-sm"
              }`}
            >
              {item.image ? (
                <img src={item.image} alt={item.label} className="w-full aspect-square object-cover" />
              ) : (
                <div className="w-full aspect-square bg-muted/30" />
              )}
              <div className="flex flex-col items-center gap-0.5 px-2 py-1.5">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${item.badgeClass}`}>{item.sku}</span>
                <span className="text-sm font-bold leading-tight">{item.label}</span>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>

    {/* Rubrics + their content live OUTSIDE the tile-picker card, not nested inside its border */}
    <div className="mt-4">
        {selected && EMPTY_PRODUCT_KEYS.has(selected) && (
          <EmptyProductPlaceholder label={ITEMS.find((i) => i.key === selected)?.label} />
        )}

        {selected === "001" && (
          <div className="mt-5 flex flex-wrap gap-3 items-start">
          <CollapsibleSection title="טבלת מחירי שילוט לוקובונד">
            <PriceTierGrid
              productTypes={LOKOBOND_PRODUCT_TYPES}
              thicknesses={LOKOBOND_THICKNESSES}
              baseCostFn={engineBaseCostFn}
              config={config}
              saveLabel="שמור מחירי שילוט לוקובונד"
              enablePriceRange
            />
            <div className="mt-4">
              <div className="text-sm font-semibold text-slate-700 mb-2">מדרגות מחיר לפי שטח</div>
              <LokobondAreaPriceTable config={config} />
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="תוספת דבק דו-צדדי">
            <TapeSellingPriceField configKey="tape_selling_price_lokobond" config={config} onConfigChange={onConfigChange} />
          </CollapsibleSection>

          <CollapsibleSection title="בדיקת מחשבון" defaultOpen={false}>
            <AdminCalculatorTest config={config} allowedProducts={["lokobond_plain", "lokobond_diecut"]} />
          </CollapsibleSection>
          </div>
        )}

        {selected === "002" && (
          <div className="mt-5 flex flex-wrap gap-3 items-start">
          <CollapsibleSection title="טבלת מחירי שילוט פיויסי">
            <PriceTierGrid
              productTypes={FOAMEX_PRODUCT_TYPES}
              thicknesses={FOAMEX_THICKNESSES}
              baseCostFn={engineBaseCostFn}
              config={config}
              saveLabel="שמור מחירי שילוט פיויסי"
              enablePriceRange
            />
          </CollapsibleSection>

          <CollapsibleSection title="תוספת דבק דו-צדדי">
            <TapeSellingPriceField configKey="tape_selling_price_foamex" config={config} onConfigChange={onConfigChange} />
          </CollapsibleSection>

          <CollapsibleSection title="בדיקת מחשבון" defaultOpen={false}>
            <AdminCalculatorTest config={config} allowedProducts={["foamex_white", "foamex_black"]} />
          </CollapsibleSection>
          </div>
        )}

        {selected === "003" && (
          <div className="mt-5 flex flex-wrap gap-3 items-start">
          <CollapsibleSection title="טבלת מחירי שילוט פרספקס">
            <PriceTierGrid
              productTypes={PERSPEX_BOARD_PRODUCT_TYPES}
              thicknesses={PERSPEX_BOARD_THICKNESSES}
              baseCostFn={engineBaseCostFn}
              config={config}
              saveLabel="שמור מחירי שילוט פרספקס"
              enablePriceRange
            />
          </CollapsibleSection>

          <CollapsibleSection title="תוספת דבק דו-צדדי">
            <TapeSellingPriceField configKey="tape_selling_price_perspex_board" config={config} onConfigChange={onConfigChange} />
          </CollapsibleSection>

          <CollapsibleSection title="בדיקת מחשבון" defaultOpen={false}>
            <AdminCalculatorTest config={config} allowedProducts={["perspex_board_clear_print", "perspex_board_black_matte", "perspex_board_black_glossy", "perspex_board_white", "perspex_board_milky"]} />
          </CollapsibleSection>
          </div>
        )}

        {selected === "013" && (
          <div className="mt-5 flex flex-wrap gap-3 items-start">
          <CollapsibleSection title="טבלת מחירי שטיח פיויסי">
            <PriceTierGrid
              productTypes={PVC_CARPET_PRODUCT_TYPES}
              thicknesses={PVC_CARPET_THICKNESSES}
              baseCostFn={engineBaseCostFn}
              config={config}
              saveLabel="שמור מחירי שטיח פיויסי"
              enablePriceRange
            />
          </CollapsibleSection>
          <CollapsibleSection title="בדיקת מחשבון" defaultOpen={false}>
            <AdminCalculatorTest config={config} allowedProducts={["pvc_carpet"]} />
          </CollapsibleSection>
          </div>
        )}

        {selected === "004" && (
          <div className="mt-5 flex flex-wrap gap-3 items-start">
          <CollapsibleSection title="מחיר וקטלוג — שילוט פולט אור">
            <GlowSignSection config={config} onConfigChange={onConfigChange} />
          </CollapsibleSection>
          <CollapsibleSection title="בדיקת מחשבון" defaultOpen={false}>
            <AdminCalculatorTest config={config} allowedProducts={["glow_sign"]} />
          </CollapsibleSection>
          </div>
        )}

        {selected === "014" && (
          <div className="mt-5 flex flex-wrap gap-3 items-start">
          <CollapsibleSection title="מחירון וקטלוג — שילוט משרדי ויסטה">
            <VistaItemsSection />
          </CollapsibleSection>
          <CollapsibleSection title="בדיקת מחשבון" defaultOpen={false}>
            <AdminCalculatorTest config={config} allowedProducts={["vista_item"]} />
          </CollapsibleSection>
          </div>
        )}

        {selected === "0000" && (
          <div className="mt-5 flex flex-wrap gap-3 items-start">
          <CollapsibleSection title="טבלת מחירי גרפיקה">
            <GraphicsPriceTable />
          </CollapsibleSection>
          <CollapsibleSection title="בדיקת מחשבון" defaultOpen={false}>
            <AdminCalculatorTest config={config} allowedProducts={["graphics"]} />
          </CollapsibleSection>
          </div>
        )}

        {selected === "005" && (
          <div className="mt-5 flex flex-wrap gap-3 items-start">
          <CollapsibleSection title="טבלת מחירי מכירה">
            <PriceTierGrid
              productTypes={PRODUCT_TYPES}
              thicknesses={THICKNESSES}
              baseCostFn={engineBaseCostFn}
              config={config}
              saveLabel="שמור מחירי לוגו"
            />
          </CollapsibleSection>

          <CollapsibleSection title="תוספת צביעה בחדר צבע">
            <PaintSurchargeTable />
          </CollapsibleSection>

          <CollapsibleSection title="תוספת ספייסרים">
            <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">מחיר תוספת ספייסרים לכל 1 אלמנט של הלוגו</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  מחיר זה נוסף למחיר המכירה כשלקוח בוחר "ספייסרים" או "ספייסרים נסתרים" — מוכפל במספר האלמנטים. נשמר עם הכפתור "שמור הגדרות" למעלה.
                </p>
              </div>
              <div className="relative w-32 shrink-0">
                <Input
                  type="text" inputMode="decimal"
                  value={config?.spacers_selling_price_per_element ?? ""}
                  onChange={(e) => onConfigChange?.("spacers_selling_price_per_element", e.target.value === "" ? null : parseFloat(sanitizeDecimal(e.target.value)) || 0)}
                  className="h-11 text-center text-base w-32 bg-background pl-7"
                  dir="ltr"
                />
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">₪</span>
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="בדיקת מחשבון" defaultOpen={false}>
            <AdminCalculatorTest config={config} allowedProducts={PRODUCT_TYPES.map((p) => p.key)} />
          </CollapsibleSection>
          </div>
        )}

        {selected === "006" && (
          <div className="mt-5 flex flex-wrap gap-3 items-start">
          <CollapsibleSection title="טבלת מחירי מדבקות">
            <StickerPriceTable embedded config={config} onConfigChange={onConfigChange} />
          </CollapsibleSection>
          <CollapsibleSection title="בדיקת מחשבון" defaultOpen={false}>
            <AdminCalculatorTest config={config} allowedProducts={["vinyl_sticker", "texture_sticker"]} />
          </CollapsibleSection>
          </div>
        )}

        {selected === "008" && (
          <div className="mt-5 flex flex-wrap gap-3 items-start">
          <CollapsibleSection title="טבלת מחירי קאפה">
            <KapaPriceTable config={config} />
          </CollapsibleSection>

          <CollapsibleSection title="תוספות מדפים">
            <div className="space-y-3">
              <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">מדפים סטנדרטים במידות 30/0.8 מטר</p>
                  <p className="text-sm text-muted-foreground mt-0.5">מחיר ליחידה, נשמר עם הכפתור "שמור הגדרות" למעלה</p>
                </div>
                <div className="relative w-32 shrink-0">
                  <Input
                    type="text" inputMode="decimal"
                    value={config?.kapa_shelf_standard_price ?? ""}
                    onChange={(e) => onConfigChange?.("kapa_shelf_standard_price", e.target.value === "" ? null : parseFloat(sanitizeDecimal(e.target.value)) || 0)}
                    className="h-11 text-center text-base w-32 bg-background pl-7"
                    dir="ltr"
                  />
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">₪</span>
                </div>
              </div>
              <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">מדפים בעיצוב אישי</p>
                  <p className="text-sm text-muted-foreground mt-0.5">מחיר ליחידה, נשמר עם הכפתור "שמור הגדרות" למעלה</p>
                </div>
                <div className="relative w-32 shrink-0">
                  <Input
                    type="text" inputMode="decimal"
                    value={config?.kapa_shelf_custom_price ?? ""}
                    onChange={(e) => onConfigChange?.("kapa_shelf_custom_price", e.target.value === "" ? null : parseFloat(sanitizeDecimal(e.target.value)) || 0)}
                    className="h-11 text-center text-base w-32 bg-background pl-7"
                    dir="ltr"
                  />
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">₪</span>
                </div>
              </div>
              <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">רגליים עשויות קאפה</p>
                  <p className="text-sm text-muted-foreground mt-0.5">מחיר ליחידה, נשמר עם הכפתור "שמור הגדרות" למעלה</p>
                </div>
                <div className="relative w-32 shrink-0">
                  <Input
                    type="text" inputMode="decimal"
                    value={config?.kapa_legs_price ?? ""}
                    onChange={(e) => onConfigChange?.("kapa_legs_price", e.target.value === "" ? null : parseFloat(sanitizeDecimal(e.target.value)) || 0)}
                    className="h-11 text-center text-base w-32 bg-background pl-7"
                    dir="ltr"
                  />
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">₪</span>
                </div>
              </div>
              <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">מדף צבעוני ללא חיתוך צורני</p>
                  <p className="text-sm text-muted-foreground mt-0.5">מחיר ליחידה, נשמר עם הכפתור "שמור הגדרות" למעלה</p>
                </div>
                <div className="relative w-32 shrink-0">
                  <Input
                    type="text" inputMode="decimal"
                    value={config?.kapa_colored_shelf_price ?? ""}
                    onChange={(e) => onConfigChange?.("kapa_colored_shelf_price", e.target.value === "" ? null : parseFloat(sanitizeDecimal(e.target.value)) || 0)}
                    className="h-11 text-center text-base w-32 bg-background pl-7"
                    dir="ltr"
                  />
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">₪</span>
                </div>
              </div>
            </div>
            <KapaDealsSection />
          </CollapsibleSection>

          <CollapsibleSection title="תוספת דבק דו-צדדי">
            <TapeSellingPriceField configKey="tape_selling_price_kapa" config={config} onConfigChange={onConfigChange} />
          </CollapsibleSection>

          <CollapsibleSection title="בדיקת מחשבון" defaultOpen={false}>
            <AdminCalculatorTest config={config} allowedProducts={["kapa"]} />
          </CollapsibleSection>
          </div>
        )}

        {selected === "009" && (
          <div className="mt-5 flex flex-wrap gap-3 items-start">
          <CollapsibleSection title="טבלת מחירי רול אפ">
            <RollupPriceTable config={config} />
          </CollapsibleSection>

          <CollapsibleSection title="בדיקת מחשבון" defaultOpen={false}>
            <AdminCalculatorTest config={config} allowedProducts={["rollup_magnetic", "rollup_regular"]} />
          </CollapsibleSection>
          </div>
        )}

        {selected === "010" && (
          <div className="mt-5 flex flex-wrap gap-3 items-start">
          <CollapsibleSection title="טבלת מחירי זכוכית אקסטרה קליר">
            <GlassPriceTable config={config} />
          </CollapsibleSection>

          <CollapsibleSection title="בדיקת מחשבון" defaultOpen={false}>
            <AdminCalculatorTest config={config} allowedProducts={["glass_extra_clear"]} />
          </CollapsibleSection>
          </div>
        )}

        {selected === "012" && (
          <div className="mt-5 flex flex-wrap gap-3 items-start">
          <CollapsibleSection title="טבלת מחירי מספרים בחיתוך לייזר">
            <NumberPriceTable />
          </CollapsibleSection>
          <CollapsibleSection title="בדיקת מחשבון" defaultOpen={false}>
            <AdminCalculatorTest config={config} allowedProducts={NUMBER_PRODUCT_TYPES} />
          </CollapsibleSection>
          </div>
        )}

        {selected === "011" && (
          <div className="mt-5 flex flex-wrap gap-3 items-start">
          <CollapsibleSection title="טבלת מחירי ארגז מואר">
            <LightboxSellPriceTable />
          </CollapsibleSection>

          <CollapsibleSection title="תוספת דבק דו-צדדי">
            <TapeSellingPriceField configKey="tape_selling_price_lightbox" config={config} onConfigChange={onConfigChange} />
          </CollapsibleSection>

          <CollapsibleSection title="בדיקת מחשבון" defaultOpen={false}>
            {/* ארגז מואר משתמש במנוע חישוב שונה (calculateLightbox) — לא ב-CalculatorForm הרגיל */}
            <LightboxCalculator config={config} />
          </CollapsibleSection>
          </div>
        )}
    </div>
    </>
  );
}
