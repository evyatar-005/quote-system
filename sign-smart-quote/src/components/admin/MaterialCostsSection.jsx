import { Package } from "lucide-react";
import CostSectionCard from "./CostSectionCard";
import CostInputField from "./CostInputField";
import RollupMaterialCostsTable from "./RollupMaterialCostsTable";

const GROUPS = [
  {
    title: "פרספקס",
    fields: [
      { key: "perspex_cost_per_mm", label: 'פרספקס (₪/מ"מ/מ"ר)', suffix: "₪" },
      { key: "perspex_mirror_cost_per_mm", label: 'פרספקס מראה (₪/מ"מ/מ"ר)', suffix: "₪" },
      { key: "perspex_gold_metallic_cost_per_mm", label: 'פרספקס זהב מטאלי (₪/מ"מ/מ"ר)', suffix: "₪" },
    ],
  },
  {
    title: "PVC",
    fields: [
      { key: "pvc_white_cost_per_mm", label: 'PVC לבן (₪/מ"מ/מ"ר)', suffix: "₪" },
      { key: "pvc_black_cost_per_mm", label: 'PVC שחור (₪/מ"מ/מ"ר)', suffix: "₪" },
    ],
  },
  {
    title: "שילוט לוקובונד",
    fields: [
      { key: "lokobond_cost_per_sqm", label: 'שילוט לוקובונד (₪/מ"ר)', suffix: "₪" },
    ],
  },
  {
    title: "שילוט פיויסי",
    fields: [
      { key: "foamex_white_cost_per_mm", label: 'שילוט פיויסי לבן (₪/מ"מ/מ"ר)', suffix: "₪" },
      { key: "foamex_black_cost_per_mm", label: 'שילוט פיויסי שחור (₪/מ"מ/מ"ר)', suffix: "₪" },
    ],
  },
  {
    title: "שילוט פרספקס",
    fields: [
      { key: "perspex_board_clear_print_cost_per_mm", label: 'פרספקס שקוף הדפסה קדמית (₪/מ"מ/מ"ר)', suffix: "₪" },
      { key: "perspex_board_black_matte_cost_per_mm", label: 'פרספקס שחור מט (₪/מ"מ/מ"ר)', suffix: "₪" },
      { key: "perspex_board_black_glossy_cost_per_mm", label: 'פרספקס שחור מבריק (₪/מ"מ/מ"ר)', suffix: "₪" },
      { key: "perspex_board_white_cost_per_mm", label: 'פרספקס לבן (₪/מ"מ/מ"ר)', suffix: "₪" },
      { key: "perspex_board_milky_cost_per_mm", label: 'פרספקס חלבי (₪/מ"מ/מ"ר)', suffix: "₪" },
      { key: "perspex_board_back_print_cost_per_mm", label: 'פרספקס שקוף הדפסה אחורית (₪/מ"מ/מ"ר)', suffix: "₪" },
    ],
  },
  {
    title: "דיו",
    fields: [
      { key: "ink_cost", label: 'דיו (₪/מ"ר)', suffix: "₪" },
    ],
  },
  {
    title: "חומרים נלווים שונים",
    fields: [
      { key: "dowel_cost_per_sqm", label: 'דוץ (₪/מ"ר)', suffix: "₪" },
      { key: "mounting_board_cost", label: "לוח התקנה (₪/יחידה)", suffix: "₪" },
      { key: "packaging_cost", label: "אריזה (₪/יחידה)", suffix: "₪" },
      { key: "instruction_sheet_cost", label: "דף הסבר (₪/יחידה)", suffix: "₪" },
      { key: "spacers_cost", label: "ספייסרים (₪/יחידה)", suffix: "₪" },
      { key: "spray_paint_cost", label: "ספריי צבע RAL (₪/יחידה)", suffix: "₪" },
      { key: "lightbox_led_waterproof_cost", label: 'לדים מוגני מים לארגז מואר (₪/יחידה)', suffix: "₪" },
    ],
  },
  {
    title: "מדדי צריכה (לא עלות — כמות ליחידת חישוב)",
    fields: [
      { key: "spacers_per_element", label: "מספר ספייסרים לאלמנט", suffix: "" },
      { key: "spray_paint_per_sqm", label: 'מספר ספריי למ"ר', suffix: "" },
    ],
  },
  {
    title: "חומרי מדבקות",
    fields: [
      { key: "orafol_sticker_cost_per_sqm", label: 'מדבקת אורופול (₪/מ"ר)', suffix: "₪" },
      { key: "orafol_application_cost_per_sqm", label: 'אפליקציית אורופול (₪/מ"ר)', suffix: "₪" },
      { key: "hi_media_sticker_cost_per_sqm", label: 'מדבקת הי מדיה (₪/מ"ר)', suffix: "₪" },
      { key: "security_sticker_cost_per_sqm", label: 'מדבקה ביטחונית (₪/מ"ר)', suffix: "₪" },
      { key: "lexan_sticker_cost_per_sqm", label: 'מדבקת לקסן (₪/מ"ר)', suffix: "₪" },
      { key: "reflective_sticker_cost_per_sqm", label: 'מדבקה מחזירת אור (₪/מ"ר)', suffix: "₪" },
    ],
  },
  {
    title: "שטיח פיויסי",
    fields: [
      { key: "pvc_carpet_cost_per_sqm", label: 'עלות חומר (₪/מ"ר)', suffix: "₪" },
      { key: "pvc_carpet_roll_width_m", label: "רוחב גליל (מ׳)", suffix: 'מ׳' },
      { key: "pvc_carpet_waste_multiplier", label: "מכפיל חיוב פחת ללקוח", suffix: "×" },
    ],
  },
  {
    title: "קאפה",
    fields: [
      { key: "kapa_sheet_cost_122x244", label: 'עלות קאפה 1.22/2.44 (₪/יריעה)', suffix: "₪" },
      { key: "kapa_sheet_cost_150x300", label: 'עלות קאפה 1.5/3 (₪/יריעה)', suffix: "₪" },
      { key: "kapa_shelf_standard_cost", label: "עלות מדף סטנדרטי (₪/יחידה)", suffix: "₪" },
      { key: "kapa_shelf_custom_cost", label: "עלות מדף בעיצוב אישי (₪/יחידה)", suffix: "₪" },
      { key: "kapa_legs_cost", label: "עלות רגליים עשויות קאפה (₪/יחידה)", suffix: "₪" },
      { key: "kapa_colored_shelf_cost", label: "עלות מדף צבעוני ללא חיתוך צורני (₪/יחידה)", suffix: "₪" },
    ],
  },
  {
    // תוספת "דבק דו-צדדי" — עלות נקבעת בנפרד לכל מוצר, כמו כל תוספת אחרת
    // (מחיר המכירה המקביל נמצא בלשונית "קביעת מחירי מכירה" של אותו מוצר).
    title: "תוספת דבק דו-צדדי",
    fields: [
      { key: "tape_cost_lokobond", label: "עלות — שילוט לוקובונד (₪/יחידה)", suffix: "₪" },
      { key: "tape_cost_foamex", label: "עלות — שילוט פיויסי (₪/יחידה)", suffix: "₪" },
      { key: "tape_cost_perspex_board", label: "עלות — שילוט פרספקס (₪/יחידה)", suffix: "₪" },
      { key: "tape_cost_kapa", label: "עלות — קאפה (₪/יחידה)", suffix: "₪" },
      { key: "tape_cost_lightbox", label: "עלות — ארגז מואר (₪/יחידה)", suffix: "₪" },
    ],
  },
];

export default function MaterialCostsSection({ config, onChange }) {
  return (
    <CostSectionCard
      icon={<Package className="w-5 h-5" />}
      title="עלויות חומרי גלם"
      description="עלות חומר לפי סוג וחומרים נלווים ליחידה"
    >
      <div className="space-y-6">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="text-xl font-bold text-foreground mb-3 pb-2 border-b-2 border-red-500">
              {group.title}
            </h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {group.fields.map((field) => (
                <CostInputField
                  key={field.key}
                  fieldKey={field.key}
                  label={field.label}
                  suffix={field.suffix}
                  value={config[field.key]}
                  onChange={onChange}
                />
              ))}
            </div>
          </div>
        ))}
        <div>
          <h3 className="text-xl font-bold text-foreground mb-3 pb-2 border-b-2 border-red-500">
            רול אפ
          </h3>
          <p className="text-sm text-muted-foreground mb-2">
            עלות נייר — שיעור אחיד לכל הגדלים, לפי סוג נייר
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-4">
            <CostInputField
              fieldKey="rollup_magnetic_paper_cost_per_sqm"
              label='נייר מגנטי — רול אפ מגנטי (₪/מ"ר)'
              suffix="₪"
              value={config.rollup_magnetic_paper_cost_per_sqm}
              onChange={onChange}
            />
            <CostInputField
              fieldKey="rollup_synthetic_paper_cost_per_sqm"
              label='נייר סינטטי — רול אפ רגיל (₪/מ"ר)'
              suffix="₪"
              value={config.rollup_synthetic_paper_cost_per_sqm}
              onChange={onChange}
            />
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            עלות מתקן (סטנד) — משתנה לפי מידה, לכל שורה עלות משלה
          </p>
          <RollupMaterialCostsTable />
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-black">
        <div className="max-w-xs">
          <CostInputField
            fieldKey="raw_material_waste_percent"
            label="אחוז פחת חומרי גלם"
            suffix="%"
            value={config.raw_material_waste_percent}
            onChange={onChange}
          />
          <p className="text-sm text-muted-foreground mt-1">
            מוסף כאחוז על סך כל עלויות הגלם
          </p>
        </div>
      </div>
    </CostSectionCard>
  );
}
