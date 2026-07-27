import CostSectionCard from "./CostSectionCard";
import CostInputField from "./CostInputField";
import glass009 from "@/assets/products/glass-009.png";

const TIME_FIELDS = [
  { key: "glass_pre_print_time_minutes", label: "זמן קדם הדפסה", suffix: "דקות" },
  { key: "glass_print_time_minutes", label: "זמן הדפסה", suffix: "דקות" },
];

export default function GlassTimeCostsSection({ config, onChange }) {
  return (
    <CostSectionCard
      image={glass009}
      title="זמני ייצור — זכוכית אקסטרה קליר"
      description="קדם דפוס והדפסה בלבד — הזכוכית מגיעה חתוכה מראש למידה, אין עלות חיתוך — עלויות השעה נמצאות בכרטיס עלויות עבודה"
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
