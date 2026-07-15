import CostSectionCard from "./CostSectionCard";
import CostInputField from "./CostInputField";
import lokobond005 from "@/assets/products/lokobond-005.png";

const TIME_FIELDS = [
  { key: "lokobond_pre_print_time_minutes", label: 'זמן קדם הדפסה לכל 3 מ"ר', suffix: "דקות" },
  { key: "lokobond_print_time_per_sqm_minutes", label: 'זמן הדפסה למ"ר', suffix: "דקות" },
  { key: "lokobond_packaging_time_minutes", label: 'זמן אריזה לכל 3 מ"ר', suffix: "דקות" },
  { key: "lokobond_pre_cut_time_minutes", label: "זמן קדם חיתוך", suffix: "דקות" },
  { key: "lokobond_clean_time_per_linear_meter_minutes", label: 'זמן ניקוי למ"א', suffix: "דקות" },
];

const CUT_FIELDS = [
  { key: "lokobond_cut_time_per_linear_meter_minutes_diecut", label: 'זמן חיתוך למ"א — עם חיתוך צורני', suffix: "דקות" },
  { key: "lokobond_cut_time_per_linear_meter_minutes_plain", label: 'זמן חיתוך למ"א — ללא חיתוך צורני', suffix: "דקות" },
];

export default function LokobondTimeCostsSection({ config, onChange }) {
  return (
    <CostSectionCard
      image={lokobond005}
      title="זמני ייצור לשילוט לוקובונד"
      description='הדפסה, חיתוך וניקוי (חיתוך וניקוי לפי מ"א, קדם חיתוך פעם אחת ליחידה; קדם דפוס ואריזה מתווספים בכל 3 מ"ר) — עלויות השעה נמצאות בכרטיס עלויות עבודה'
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {TIME_FIELDS.map((field) => (
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

      <div className="mt-4 text-sm font-semibold text-slate-700">זמני חיתוך לפי סוג</div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-2">
        {CUT_FIELDS.map((field) => (
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
    </CostSectionCard>
  );
}
