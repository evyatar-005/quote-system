import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { Loader2, Settings2, BarChart3, Tag, Lightbulb, Sparkles, Layers, Rows3, LogOut, ChevronDown } from "lucide-react";
import MultiProductCalculator from "../components/calculator/MultiProductCalculator.jsx";
import NotificationBell from "@/components/NotificationBell";
import printellaLogo from "@/assets/printella-logo.png";
import { useAuth } from "@/lib/AuthContext";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

const LOGO_FORM = {
  productType: "pvc_white",
  widthM: "",
  heightM: "",
  thicknessMm: "5",
  quantity: "1",
  region: "מרכז",
  elements: "",
  extras: [],
};

const STICKER_FORM = {
  productType: "vinyl_sticker",
  widthM: "",
  heightM: "",
  thicknessMm: "",
  quantity: "1",
  region: "מרכז",
  elements: "",
  extras: [],
  includeInstallation: "no",
};

const TEXTURE_FORM = {
  productType: "texture_sticker",
  widthM: "",
  heightM: "",
  thicknessMm: "",
  quantity: "1",
  region: "מרכז",
  elements: "",
  extras: [],
  includeInstallation: "yes",
};

const LIGHTBOX_FORM = {
  productType: "pvc_white",
  widthM: "",
  heightM: "",
  thicknessMm: "5",
  quantity: "1",
  region: "מרכז",
  elements: "",
  extras: [],
};

const KAPA_FORM = {
  productType: "kapa",
  widthM: "",
  heightM: "",
  quantity: "1",
  cutType: "straight",
  standardShelves: "",
  customShelves: "",
  extras: [],
};

const LOKOBOND_FORM = {
  productType: "lokobond_diecut",
  widthM: "",
  heightM: "",
  thicknessMm: "3",
  quantity: "1",
  elements: "",
  extras: [],
};

const FOAMEX_FORM = {
  productType: "foamex_white",
  widthM: "",
  heightM: "",
  thicknessMm: "2",
  quantity: "1",
  elements: "",
  extras: [],
};

const ROLLUP_FORM = {
  productType: "rollup_magnetic",
  quantity: "1",
  extras: [],
};

export default function CostsDashboard() {
  const { user, logout } = useAuth();
  const [config, setConfig] = useState(null);
  const [priceTiers, setPriceTiers] = useState([]);
  const [stickerPriceTiers, setStickerPriceTiers] = useState([]);
  const [paintSurchargeTiers, setPaintSurchargeTiers] = useState([]);
  const [kapaPriceTiers, setKapaPriceTiers] = useState([]);
  const [rollupPriceTiers, setRollupPriceTiers] = useState([]);
  const [lokobondAreaTiers, setLokobondAreaTiers] = useState([]);
  const [glassPriceTiers, setGlassPriceTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    Promise.all([
      base44.entities.PricingConfig.filter({ config_name: "default" }),
      base44.entities.PriceTier.list(),
      base44.entities.StickerPriceTier.list(),
      base44.entities.PaintSurchargeTier.list(),
      base44.entities.KapaPriceTier.list(),
      base44.entities.RollupPriceTier.list(),
      base44.entities.LokobondAreaTier.list(),
      base44.entities.GlassPriceTier.list(),
    ]).then(([configs, tiers, stickerTiers, paintTiers, kapaTiers, rollupTiers, lokobondAreaTiers, glassTiers]) => {
      if (configs.length > 0) setConfig(configs[0]);
      setPriceTiers(tiers);
      setStickerPriceTiers(stickerTiers);
      setPaintSurchargeTiers(paintTiers);
      setKapaPriceTiers(kapaTiers);
      setRollupPriceTiers(rollupTiers);
      setLokobondAreaTiers(lokobondAreaTiers);
      setGlassPriceTiers(glassTiers);
      setLoading(false);
    }).catch((err) => {
      console.error("[CostsDashboard] failed to load pricing data:", err);
      setLoadError(true);
      setLoading(false);
    });
  }, [reloadKey]);

  const [activeTab, setActiveTab] = useState("logo");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 border border-amber-200 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-amber-600" />
          </div>
          <p className="text-slate-500 text-base">טוען נתונים...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm px-4">
          <p className="text-slate-700 text-base font-semibold">טעינת הנתונים נכשלה</p>
          <p className="text-slate-500 text-sm">ייתכן שהחיבור לשרת נפל, או שההתחברות שלך פגה. נסה שוב.</p>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700"
          >
            נסה שוב
          </button>
        </div>
      </div>
    );
  }

  const TABS = [
    { key: "logo", icon: BarChart3, label: "לוגו בחיתוך צורני", code: "001", form: LOGO_FORM, allowedProducts: ["pvc_white", "pvc_black", "perspex_print", "perspex_black", "perspex_white", "perspex_milky", "perspex_mirror", "perspex_metallic"] },
    { key: "sticker", icon: Tag, label: "מדבקות קיר", code: "002", form: STICKER_FORM, allowedProducts: ["vinyl_sticker", "texture_sticker"] },
    { key: "kapa", icon: Layers, label: "קאפה", code: "004", form: KAPA_FORM, allowedProducts: ["kapa"] },
    { key: "lokobond", icon: Lightbulb, label: "שילוט לוקובונד", code: "005", form: LOKOBOND_FORM, allowedProducts: ["lokobond_diecut", "lokobond_plain"] },
    { key: "foamex", icon: Sparkles, label: "שילוט פיויסי", code: "006", form: FOAMEX_FORM, allowedProducts: ["foamex_white", "foamex_black"] },
    { key: "rollup", icon: Rows3, label: "רול אפ", code: "007", form: ROLLUP_FORM, allowedProducts: ["rollup_magnetic", "rollup_regular"] },
  ];

  const currentTab = TABS.find(t => t.key === activeTab);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-8 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src={printellaLogo}
              alt="Printella"
              className="h-24 object-contain"
            />
            <NotificationBell />
          </div>
          <div className="flex flex-col items-end gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-amber-600 transition-colors px-3 py-1.5 rounded-lg border border-black hover:border-amber-300">
                  <Settings2 className="w-3.5 h-3.5" /> הגדרות מנהל
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {user?.role === "admin" && (
                  <DropdownMenuItem asChild>
                    <Link to="/" className="flex items-center gap-2 cursor-pointer w-full">
                      <Settings2 className="w-4 h-4" /> הגדרות מנהל
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={logout} className="flex items-center gap-2 cursor-pointer">
                  <LogOut className="w-4 h-4" /> התנתקות
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {user?.full_name && <span className="text-xs text-slate-400">{user.full_name}</span>}
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-8 py-6">
        {!config && (
          <div className="text-center py-20 text-slate-500 text-base">
            לא הוגדרו פרמטרים עדיין.
            <Link to="/" className="text-amber-600 underline block mt-2">עבור להגדרות</Link>
          </div>
        )}

        {config && (
          <MultiProductCalculator
            config={config}
            priceTiers={priceTiers}
            stickerPriceTiers={stickerPriceTiers}
            paintSurchargeTiers={paintSurchargeTiers}
            kapaPriceTiers={kapaPriceTiers}
            rollupPriceTiers={rollupPriceTiers}
            lokobondAreaTiers={lokobondAreaTiers}
            glassPriceTiers={glassPriceTiers}
            allTabs={TABS}
          />
        )}
      </div>
    </div>
  );
}