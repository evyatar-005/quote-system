import { Input } from "@/components/ui/input";
import { Settings } from "lucide-react";
import CostSectionCard from "./CostSectionCard";

function Field({ label, value, onChange, suffix = "%" }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min="0"
          step="0.5"
          dir="ltr"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
          className="h-8 text-center text-sm w-24 bg-background"
          placeholder={suffix}
        />
        <span className="text-sm text-muted-foreground w-5">{suffix}</span>
      </div>
    </div>
  );
}

export default function GlobalParamsSection({ config, onChange }) {
  return (
    <CostSectionCard
      icon={<Settings className="w-5 h-5" />}
      title="פרמטרים גורפים לכל המוצרים"
      description='תנאי תשלום — מוחלים על המחיר הסופי כולל מע"מ'
    >
        <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4 space-y-0">
          <p className="text-sm font-semibold text-blue-700 mb-3">תנאי תשלום</p>
          <Field
            label='מחיר רגיל (אשראי) — תוספת ברירת מחדל על מחיר כולל מע"מ'
            value={config.payment_default_surcharge_percent}
            onChange={(v) => onChange("payment_default_surcharge_percent", v)}
          />
          <Field
            label='הנחת מזומן — מבטלת את התוספת ברירת מחדל (חזרה למחיר בסיס)'
            value={0}
            onChange={() => {}}
          />
          <Field
            label="2-3 תשלומים — תוספת נוספת מעל מחיר האשראי"
            value={config.payment_installment_surcharge_percent}
            onChange={(v) => onChange("payment_installment_surcharge_percent", v)}
          />
        </div>
        <div className="mt-3 p-3 bg-muted/30 rounded-lg">
          <p className="text-sm text-muted-foreground leading-relaxed">
            <strong>דוגמה:</strong> מחיר ₪1,000 כולל מע"מ →{" "}
            <span className="text-foreground font-semibold">מזומן: ₪1,000</span> |{" "}
            <span className="text-foreground font-semibold">ברירת מחדל: ₪{(1000 * (1 + (config.payment_default_surcharge_percent || 5) / 100)).toFixed(0)}</span> |{" "}
            <span className="text-foreground font-semibold">תשלומים: ₪{(1000 * (1 + (config.payment_default_surcharge_percent || 5) / 100) * (1 + (config.payment_installment_surcharge_percent || 2.5) / 100)).toFixed(0)}</span>
          </p>
        </div>
        <div className="mt-4 bg-blue-50/50 border border-blue-200 rounded-xl p-4 space-y-0">
          <p className="text-sm font-semibold text-blue-700 mb-3">משלוח</p>
          <Field
            label="עלות משלוח — נוספת אוטומטית להצעת המחיר בכל המוצרים"
            value={config.shipping_cost}
            onChange={(v) => onChange("shipping_cost", v)}
            suffix="₪"
          />
        </div>
    </CostSectionCard>
  );
}