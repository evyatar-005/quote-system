import { Percent } from "lucide-react";
import CostSectionCard from "./CostSectionCard";
import CostInputField from "./CostInputField";

const OVERHEAD_FIELDS = [
  { key: "operational_overhead_percent", label: "אחוז תקורה תפעולית", suffix: "%" },
  { key: "sales_agent_commission_percent", label: "עמלת סוכן מכירות", suffix: "%" },
  { key: "marketing_commission_percent", label: "עמלת שיווק / קמפיינים", suffix: "%" },
];

export default function OverheadSection({ config, onChange }) {
  return (
    <CostSectionCard
      icon={<Percent className="w-5 h-5" />}
      title="אחוזים ועמלות"
      description='תקורה ועמלות — אחוז פחת חומרי גלם נמצא ב"עלויות חומרי גלם"'
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {OVERHEAD_FIELDS.map((field) => (
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