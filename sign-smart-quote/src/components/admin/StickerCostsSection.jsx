import CostSectionCard from "./CostSectionCard";
import CostInputField from "./CostInputField";
import sticker002 from "@/assets/products/sticker-002.png";

const MATERIALS = [
  {
    title: "מדבקת ויניל",
    installFields: [
      { key: "vinyl_sticker_install_cost_per_sqm", label: 'עלות התקנה (₪/מ"ר)', suffix: "₪" },
      { key: "vinyl_sticker_install_min_cost", label: "מינימום עלות התקנה - מרכז (₪)", suffix: "₪" },
      { key: "vinyl_sticker_install_min_cost_south", label: "מינימום עלות התקנה - דרום (₪)", suffix: "₪" },
    ],
    timeFields: [
      { key: "vinyl_sticker_pre_print_time_minutes", label: 'זמן קדם הדפסה (דקות)', suffix: "דק׳" },
      { key: "vinyl_sticker_print_time_per_sqm", label: 'זמן הדפסה (דקות/מ"ר)', suffix: "דק׳" },
      { key: "vinyl_sticker_pre_cut_time_minutes", label: 'זמן קדם חיתוך (דקות)', suffix: "דק׳" },
      { key: "vinyl_sticker_cut_time_per_sqm", label: 'זמן חיתוך (דקות/מ"ר)', suffix: "דק׳" },
    ],
  },
  {
    title: "מדבקת טקסטורה",
    installFields: [
      { key: "texture_sticker_install_cost_per_sqm", label: 'עלות התקנה (₪/מ"ר)', suffix: "₪" },
      { key: "texture_sticker_install_min_cost", label: "מינימום עלות התקנה - מרכז (₪)", suffix: "₪" },
      { key: "texture_sticker_install_min_cost_south", label: "מינימום עלות התקנה - דרום (₪)", suffix: "₪" },
    ],
    timeFields: [
      { key: "texture_sticker_pre_print_time_minutes", label: 'זמן קדם הדפסה (דקות)', suffix: "דק׳" },
      { key: "texture_sticker_print_time_per_sqm", label: 'זמן הדפסה (דקות/מ"ר)', suffix: "דק׳" },
      { key: "texture_sticker_pre_cut_time_minutes", label: 'זמן קדם חיתוך (דקות)', suffix: "דק׳" },
      { key: "texture_sticker_cut_time_per_sqm", label: 'זמן חיתוך (דקות/מ"ר)', suffix: "דק׳" },
    ],
  },
];

export default function StickerCostsSection({ config, onChange }) {
  return (
    <CostSectionCard
      image={sticker002}
      title="זמני ייצור מדבקות קיר"
      description='מדבקת ויניל ומדבקת טקסטורה — עלויות בלבד. עלות חומר המדבקה נמצאת ב"עלויות חומרי גלם", מחירי מינימום להתקנה ולמכירה יוגדרו ב"קביעת מחיר מכירה"'
    >
      <div className="space-y-6">
        {MATERIALS.map((mat) => (
          <div key={mat.title}>
            <h3 className="text-base font-semibold text-foreground mb-3 pb-2 border-b-2 border-red-500">
              {mat.title}
            </h3>
            <div className="mb-4">
              <p className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">עלויות התקנה</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {mat.installFields.map((f) => (
                  <CostInputField key={f.key} fieldKey={f.key} label={f.label} suffix={f.suffix} value={config[f.key]} onChange={onChange} />
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">זמני עבודה במפעל</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {mat.timeFields.map((f) => (
                  <CostInputField key={f.key} fieldKey={f.key} label={f.label} suffix={f.suffix} value={config[f.key]} onChange={onChange} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </CostSectionCard>
  );
}
