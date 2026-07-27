import CostSectionCard from "./CostSectionCard";
import CostInputField from "./CostInputField";
import logo001 from "@/assets/products/logo-001.png";

const THICKNESSES = ["3", "5", "10", "19"];

const TIME_FIELDS = [
  { key: "logo_pre_print_time_minutes", label: 'זמן קדם הדפסה ליחידה', suffix: "דקות" },
  { key: "logo_print_time_per_sqm_minutes", label: 'זמן הדפסה למ"ר', suffix: "דקות" },
  { key: "logo_pre_cut_time_minutes", label: "זמן קדם חיתוך", suffix: "דקות" },
  { key: "logo_packaging_time_minutes", label: "זמן אריזה", suffix: "דקות" },
];

const LASER_CUT_FIELDS = THICKNESSES.map((t) => ({
  key: `logo_laser_cut_time_minutes_${t}`,
  label: `זמן חיתוך לייזר ${t} מ"מ / מ"ר`,
  suffix: "דקות",
}));

const SOMA_CUT_FIELDS = THICKNESSES.map((t) => ({
  key: `logo_soma_cut_time_minutes_${t}`,
  label: `זמן חיתוך סומא ${t} מ"מ / מ"ר`,
  suffix: "דקות",
}));

export default function TimeCostsSection({ config, onChange }) {
  return (
    <CostSectionCard
      image={logo001}
      title="זמני ייצור — לוגו בחיתוך צורני"
      description="הדפסה, חיתוך ואריזה, ייחודי למקטע לוגו בחיתוך צורני — עלויות השעה נמצאות בכרטיס עלויות עבודה"
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

      <div className="mt-4 text-sm font-semibold text-slate-700">זמן חיתוך לייזר לפי עובי</div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-2">
        {LASER_CUT_FIELDS.map((field) => (
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

      <div className="mt-4 text-sm font-semibold text-slate-700">זמן חיתוך סומא לפי עובי</div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-2">
        {SOMA_CUT_FIELDS.map((field) => (
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

      <div className="grid grid-cols-2 gap-4 mt-3">
        <div className="bg-muted/40 rounded-lg px-4 py-2 flex justify-between items-center">
          <span className="text-sm font-semibold text-slate-700">עלות לדקת הדפסה</span>
          <span className="text-sm font-semibold">{config.print_hour_cost ? `₪ ${(config.print_hour_cost / 60).toFixed(3)}` : "—"}</span>
        </div>
        <div className="bg-muted/40 rounded-lg px-4 py-2 flex justify-between items-center">
          <span className="text-sm font-semibold text-slate-700">עלות לדקת עובד כללי</span>
          <span className="text-sm font-semibold">{config.general_worker_hour_cost ? `₪ ${(config.general_worker_hour_cost / 60).toFixed(3)}` : "—"}</span>
        </div>
      </div>
    </CostSectionCard>
  );
}