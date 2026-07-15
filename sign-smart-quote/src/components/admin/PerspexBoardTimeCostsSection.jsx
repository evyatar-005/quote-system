import CostSectionCard from "./CostSectionCard";
import CostInputField from "./CostInputField";

const THICKNESSES = ["3", "5", "10"];

const TIME_FIELDS = [
  { key: "perspex_board_pre_print_time_minutes", label: 'זמן קדם הדפסה לכל 3 מ"ר', suffix: "דקות" },
  { key: "perspex_board_print_time_per_sqm_minutes", label: 'זמן הדפסה למ"ר', suffix: "דקות" },
  { key: "perspex_board_pre_cut_time_minutes", label: "זמן קדם לחיתוך", suffix: "דקות" },
  { key: "perspex_board_packaging_time_minutes", label: 'זמן אריזה לכל 3 מ"ר', suffix: "דקות" },
  { key: "perspex_board_clean_time_per_linear_meter_minutes", label: 'זמן ניקוי למ"א', suffix: "דקות" },
];

const CUT_FIELDS = THICKNESSES.map((t) => ({
  key: `perspex_board_cut_time_per_linear_meter_minutes_${t}`,
  label: `זמן חיתוך למ"א — עובי ${t} מ"מ`,
  suffix: "דקות",
}));

export default function PerspexBoardTimeCostsSection({ config, onChange }) {
  return (
    <CostSectionCard
      title="זמני ייצור לשילוט פרספקס"
      description='הדפסה, חיתוך וניקוי (חיתוך לפי מ"א ולפי עובי; קדם דפוס ואריזה מתווספים בכל 3 מ"ר) — עלויות השעה נמצאות בכרטיס עלויות עבודה'
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

      <div className="mt-4 text-sm font-semibold text-slate-700">זמן חיתוך לפי עובי</div>
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
