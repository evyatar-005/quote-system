import CostSectionCard from "./CostSectionCard";
import CostInputField from "./CostInputField";
import rollupMagnetic007 from "@/assets/products/rollup-magnetic-007.png";

const TIME_FIELDS = [
  { key: "rollup_pre_print_time_minutes", label: "קדם הדפסה", suffix: "דקות" },
  { key: "rollup_print_time_minutes", label: "זמן הדפסה", suffix: "דקות" },
  { key: "rollup_cut_time_minutes", label: "זמן חיתוך", suffix: "דקות" },
  { key: "rollup_packaging_time_minutes", label: "זמן אריזה", suffix: "דקות" },
];

export default function RollupTimeCostsSection({ config, onChange }) {
  return (
    <CostSectionCard
      image={rollupMagnetic007}
      title="זמני ייצור — רול אפ"
      description="מידע פנימי בלבד למנהל — לא משפיע על חישוב המחיר"
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
