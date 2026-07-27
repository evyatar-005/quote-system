import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ShieldAlert } from "lucide-react";
import CostSectionCard from "./CostSectionCard";

const PRODUCT_TOGGLES = [
  { key: "logo_apply_minimum_multi", label: "לוגו בחיתוך צורני (PVC / פרספקס)" },
  { key: "sticker_apply_minimum_multi", label: "מדבקות (ויניל / טקסטורה)" },
  { key: "lokobond_apply_minimum_multi", label: "לוקובונד" },
  { key: "foamex_apply_minimum_multi", label: "פיוויסי (Foamex)" },
  { key: "perspexBoard_apply_minimum_multi", label: "שילוט פרספקס" },
];

export default function MinimumPricesSection({ config, onChange }) {
  return (
    <CostSectionCard
      icon={<ShieldAlert className="w-5 h-5" />}
      title="מחירי מינימום"
      description="הגנה על הזמנות קטנות — מחיר מינימום למסמך כולו, ובחירה האם כל מוצר שומר על המחיר המינימום שלו גם כשיש עוד מוצרים באותה הצעה"
      defaultOpen
    >
      <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-semibold text-slate-700">מחיר מינימום למסמך</p>
            <p className="text-sm text-muted-foreground mt-0.5">סכום מינימלי לכל הצעת מחיר, ללא קשר למספר המוצרים בתוכה</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min="0"
              step="10"
              dir="ltr"
              value={config.document_minimum_price ?? ""}
              onChange={(e) => onChange("document_minimum_price", e.target.value === "" ? null : parseFloat(e.target.value))}
              className="h-9 text-center text-sm w-28 bg-background"
              placeholder="350"
            />
            <span className="text-sm text-muted-foreground w-5">₪</span>
          </div>
        </div>
      </div>

      <div className="p-3 bg-muted/30 rounded-lg">
        <p className="text-sm text-muted-foreground leading-relaxed">
          לחלק מהמוצרים יש מחיר מינימום משלהם (למשל לוגו PVC 3 מ"מ, לפי מדרגת המחיר שהוגדרה לו). כברירת מחדל, המחיר
          המינימום הזה נשמר גם אם המוצר הוא חלק מהזמנה עם עוד מוצרים. כיבוי המתג עבור מוצר מסוים אומר שבהזמנה
          מרובת מוצרים המחיר שלו יכול לרדת מתחת למינימום הרגיל שלו — רק מחיר המינימום של כל המסמך עדיין יחול.
        </p>
      </div>

      <div className="border border-border/30 rounded-xl divide-y divide-border/30">
        {PRODUCT_TOGGLES.map(({ key, label }) => {
          const enabled = config[key] !== 0 && config[key] !== "0";
          return (
            <div key={key} className="flex items-center justify-between py-3 px-4">
              <div>
                <p className="text-sm font-semibold text-slate-700">{label}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {enabled ? "שומר על מחיר המינימום שלו גם בהזמנה מרובת מוצרים" : "מחיר המינימום שלו לא נאכף כשיש מוצרים נוספים בהזמנה"}
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={(v) => onChange(key, v ? 1 : 0)} />
            </div>
          );
        })}
      </div>
    </CostSectionCard>
  );
}
