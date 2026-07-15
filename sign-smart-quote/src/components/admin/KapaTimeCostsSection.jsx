import CostSectionCard from "./CostSectionCard";
import CostInputField from "./CostInputField";
import kapa004 from "@/assets/products/kapa-004.png";

const FLAT_FIELDS = [
  { key: "kapa_pre_print_time_minutes", label: "קדם דפוס", suffix: "דקות" },
  { key: "kapa_pre_cut_time_minutes", label: "קדם חיתוך", suffix: "דקות" },
  { key: "kapa_packaging_time_minutes", label: "זמן אריזה", suffix: "דקות" },
];

// Small/large stacked in one column each — same "one below the other" pattern
// as the cut-time fields below, so sizes stay visually grouped.
const PRINT_FIELDS = [
  { key: "kapa_print_time_small_minutes", label: 'זמן הדפסה למידה הקטנה (122×244)' },
  { key: "kapa_print_time_large_minutes", label: 'זמן הדפסה למידה הגדולה (150×300)' },
];

const SMALL_CUT_FIELDS = [
  { key: "kapa_cut_time_small_straight_minutes", label: 'זמן חיתוך למידה הקטנה — ללא חיתוך צורני' },
  { key: "kapa_cut_time_small_diecut_minutes", label: 'זמן חיתוך למידה הקטנה — עם חיתוך צורני' },
];

const LARGE_CUT_FIELDS = [
  { key: "kapa_cut_time_large_straight_minutes", label: 'זמן חיתוך למידה הגדולה — ללא חיתוך צורני' },
  { key: "kapa_cut_time_large_diecut_minutes", label: 'זמן חיתוך למידה הגדולה — עם חיתוך צורני' },
];

export default function KapaTimeCostsSection({ config, onChange }) {
  return (
    <CostSectionCard
      image={kapa004}
      title="זמני ייצור — קאפה"
      description="קדם דפוס, הדפסה, חיתוך ואריזה — עלויות השעה נמצאות בכרטיס עלויות עבודה"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          {PRINT_FIELDS.map((field) => (
            <CostInputField
              key={field.key}
              fieldKey={field.key}
              label={field.label}
              suffix="דקות"
              value={config[field.key]}
              onChange={onChange}
            />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {FLAT_FIELDS.map((field) => (
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

      <div className="mt-4 text-sm font-semibold text-slate-700">זמני חיתוך לפי מידה וסוג חיתוך</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        <div className="space-y-4">
          {SMALL_CUT_FIELDS.map((field) => (
            <CostInputField
              key={field.key}
              fieldKey={field.key}
              label={field.label}
              suffix="דקות"
              value={config[field.key]}
              onChange={onChange}
            />
          ))}
        </div>
        <div className="space-y-4">
          {LARGE_CUT_FIELDS.map((field) => (
            <CostInputField
              key={field.key}
              fieldKey={field.key}
              label={field.label}
              suffix="דקות"
              value={config[field.key]}
              onChange={onChange}
            />
          ))}
        </div>
      </div>
    </CostSectionCard>
  );
}
