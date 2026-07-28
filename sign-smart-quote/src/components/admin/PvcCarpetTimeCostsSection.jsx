import CostSectionCard from "./CostSectionCard";
import CostInputField from "./CostInputField";

const TIME_FIELDS = [
  { key: "pvc_carpet_pre_print_time_minutes", label: 'זמן הכנה לכל 3 מ"ר', suffix: "דקות" },
  { key: "pvc_carpet_print_time_per_sqm_minutes", label: 'זמן עיבוד למ"ר', suffix: "דקות" },
  { key: "pvc_carpet_pre_cut_time_minutes", label: "זמן קדם לחיתוך", suffix: "דקות" },
  { key: "pvc_carpet_cut_time_per_linear_meter_minutes", label: 'זמן חיתוך למ"א', suffix: "דקות" },
  { key: "pvc_carpet_clean_time_per_linear_meter_minutes", label: 'זמן ניקוי למ"א', suffix: "דקות" },
  { key: "pvc_carpet_packaging_time_minutes", label: 'זמן אריזה לכל 3 מ"ר', suffix: "דקות" },
];

export default function PvcCarpetTimeCostsSection({ config, onChange }) {
  return (
    <CostSectionCard
      title="זמני ייצור לשטיח פיויסי"
      description='הכנה, חיתוך וניקוי (חיתוך וניקוי לפי מ"א, קדם חיתוך פעם אחת ליחידה; הכנה ואריזה מתווספים בכל 3 מ"ר) — עלויות השעה נמצאות בכרטיס עלויות עבודה'
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
    </CostSectionCard>
  );
}
