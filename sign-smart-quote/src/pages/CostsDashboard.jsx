import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link, useLocation } from "react-router-dom";
import { Loader2, BarChart3, Tag, Lightbulb, Sparkles, Layers, Rows3 } from "lucide-react";
import MultiProductCalculator from "../components/calculator/MultiProductCalculator.jsx";
import NotificationBell from "@/components/NotificationBell";
import AgentSidebar from "@/components/layout/AgentSidebar";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import printellaLogo from "@/assets/printella-logo.png";
import { useAuth } from "@/lib/AuthContext";

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
  const { user } = useAuth();
  const location = useLocation();
  // Populated by MyQuotes.jsx's "שכפל" action (navigate('/costs', {state:...}))
  // — a full builder_state snapshot to reopen in the calculator, plus the
  // source quote number so the save sets parent_quote_number. Read once; a
  // page refresh loses router state and simply starts a blank quote, which is
  // the correct fallback (nothing here is persisted until the agent saves).
  // "בנה הצעה" from the lead workspace opens this in a NEW TAB (window.open),
  // not a same-tab navigate — the agent keeps the WhatsApp thread open on
  // the original tab and works the quote alongside it. A new tab has no
  // access to router `state` (it's a fresh browsing context), so that flow
  // passes the client fields as URL query params instead; read those as a
  // fallback when state isn't present. See LeadWorkspacePanel.jsx.
  const query = new URLSearchParams(location.search);
  const queryLeadId = query.get('sourceLeadId');
  const queryBuilderState = queryLeadId ? {
    clientName: query.get('clientName') || '',
    clientPhone: query.get('clientPhone') || '',
    clientEmail: query.get('clientEmail') || '',
  } : null;

  const initialBuilderState = location.state?.builderState || queryBuilderState;
  const sourceQuoteNumber = location.state?.sourceQuoteNumber || null;
  // Set when the calculator was opened from a CRM lead ("בנה הצעה" on My Day)
  // — links the saved quote back to that lead. Same read-once router-state
  // convention as the duplicate flow above (or the query-param fallback for
  // the new-tab flow — see comment above).
  const sourceLeadId = location.state?.sourceLeadId || queryLeadId || null;
  // Flagged when the lead workspace didn't have full client details to hand
  // over (e.g. no email on file) — shown as an on-screen note so the agent
  // knows to complete/verify before saving, per direct request.
  const missingClientDetails = !!queryLeadId && (!query.get('clientPhone') || !query.get('clientEmail'));
  const [config, setConfig] = useState(null);
  const [priceTiers, setPriceTiers] = useState([]);
  const [stickerPriceTiers, setStickerPriceTiers] = useState([]);
  const [paintSurchargeTiers, setPaintSurchargeTiers] = useState([]);
  const [kapaPriceTiers, setKapaPriceTiers] = useState([]);
  const [rollupPriceTiers, setRollupPriceTiers] = useState([]);
  const [lokobondAreaTiers, setLokobondAreaTiers] = useState([]);
  const [glassPriceTiers, setGlassPriceTiers] = useState([]);
  const [numberPriceTiers, setNumberPriceTiers] = useState([]);
  const [graphicsPriceTiers, setGraphicsPriceTiers] = useState([]);
  const [vistaSizes, setVistaSizes] = useState([]);
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
      base44.entities.NumberPriceTier.list(),
      base44.entities.GraphicsPriceTier.list(),
      base44.entities.VistaSize.list(),
    ]).then(([configs, tiers, stickerTiers, paintTiers, kapaTiers, rollupTiers, lokobondAreaTiers, glassTiers, numberTiers, graphicsTiers, vistaSizeRows]) => {
      if (configs.length > 0) setConfig(configs[0]);
      setPriceTiers(tiers);
      setStickerPriceTiers(stickerTiers);
      setPaintSurchargeTiers(paintTiers);
      setKapaPriceTiers(kapaTiers);
      setRollupPriceTiers(rollupTiers);
      setLokobondAreaTiers(lokobondAreaTiers);
      setGlassPriceTiers(glassTiers);
      setNumberPriceTiers(numberTiers);
      setGraphicsPriceTiers(graphicsTiers);
      setVistaSizes(vistaSizeRows || []);
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
    { key: "logo", icon: BarChart3, label: "לוגו בחיתוך צורני", code: "001", form: LOGO_FORM, allowedProducts: ["pvc_white", "pvc_black", "perspex_print", "perspex_print_back", "perspex_black", "perspex_white", "perspex_milky", "perspex_mirror", "perspex_metallic"] },
    { key: "sticker", icon: Tag, label: "מדבקות קיר", code: "002", form: STICKER_FORM, allowedProducts: ["vinyl_sticker", "texture_sticker"] },
    { key: "kapa", icon: Layers, label: "קאפה", code: "004", form: KAPA_FORM, allowedProducts: ["kapa"] },
    { key: "lokobond", icon: Lightbulb, label: "שילוט לוקובונד", code: "005", form: LOKOBOND_FORM, allowedProducts: ["lokobond_diecut", "lokobond_plain"] },
    { key: "foamex", icon: Sparkles, label: "שילוט פיויסי", code: "006", form: FOAMEX_FORM, allowedProducts: ["foamex_white", "foamex_black"] },
    { key: "rollup", icon: Rows3, label: "רול אפ", code: "007", form: ROLLUP_FORM, allowedProducts: ["rollup_magnetic", "rollup_regular"] },
  ];

  const currentTab = TABS.find(t => t.key === activeTab);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" dir="rtl">
      {/* Header — no more top-right pills/dropdown here; AgentSidebar below is
          the single, always-visible navigation, same pattern as ManagerSidebar
          on the manager screens. */}
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
          {user?.full_name && <span className="text-sm font-semibold text-slate-700">{user.full_name}</span>}
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-8 py-6 flex flex-col lg:flex-row gap-8 items-start">
        {/* A manager browsing the agent calculator still gets their full
            manager menu (review queue, analytics, settings, …) — not the
            cut-down agent one, which would otherwise hide things they have
            every right to see just because of which screen they're on. */}
        {user?.role === "admin" ? <ManagerSidebar /> : <AgentSidebar />}
        <div className="flex-1 min-w-0 w-full">
          {missingClientDetails && (
            <div className="mb-4 px-4 py-2.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-sm">
              חסרים פרטים על הלקוח (טלפון/אימייל) — הליד נפתח ישירות מתוך "הלידים שלי" בטאב נפרד; יש להשלים את הפרטים לפני השמירה.
            </div>
          )}

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
              numberPriceTiers={numberPriceTiers}
              graphicsPriceTiers={graphicsPriceTiers}
              vistaSizes={vistaSizes}
              allTabs={TABS}
              initialBuilderState={initialBuilderState}
              sourceQuoteNumber={sourceQuoteNumber}
              sourceLeadId={sourceLeadId}
            />
          )}
        </div>
      </div>
    </div>
  );
}