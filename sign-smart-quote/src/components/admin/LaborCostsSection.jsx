import { Wrench } from "lucide-react";
import CostSectionCard from "./CostSectionCard";
import CostInputField from "./CostInputField";

const LABOR_FIELDS = [
  { key: "paint_room_cost", label: 'עלות עבודה בחדר צבע (₪/מ"ר)', suffix: "₪" },
  { key: "print_hour_cost", label: "עלות שעת דפס", suffix: "₪" },
  { key: "general_worker_hour_cost", label: "עלות שעת עובד כללי", suffix: "₪" },
];

export default function LaborCostsSection({ config, onChange }) {
  return (
    <CostSectionCard
      icon={<Wrench className="w-5 h-5" />}
      title="עלויות עבודה"
      description="שעות עבודה וחדר צבע"
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {LABOR_FIELDS.map((field) => (
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