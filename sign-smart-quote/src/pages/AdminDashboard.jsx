import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Save, Settings2, Loader2, Check, LogOut, ChevronDown } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Database, Calculator, Mail } from "lucide-react";
import { toast } from "sonner";
import { Link, useSearchParams } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import NotificationBell from "@/components/NotificationBell";
import MaterialCostsSection from "../components/admin/MaterialCostsSection";
import LaborCostsSection from "../components/admin/LaborCostsSection";
import StickerCostsSection from "../components/admin/StickerCostsSection";
import StickerPriceTable from "../components/admin/StickerPriceTable";
import TimeCostsSection from "../components/admin/TimeCostsSection";
import KapaTimeCostsSection from "../components/admin/KapaTimeCostsSection";
import LokobondTimeCostsSection from "../components/admin/LokobondTimeCostsSection";
import FoamexTimeCostsSection from "../components/admin/FoamexTimeCostsSection";
import PerspexBoardTimeCostsSection from "../components/admin/PerspexBoardTimeCostsSection";
import PvcCarpetTimeCostsSection from "../components/admin/PvcCarpetTimeCostsSection";
import RollupTimeCostsSection from "../components/admin/RollupTimeCostsSection";
import GlassTimeCostsSection from "../components/admin/GlassTimeCostsSection";
import OverheadSection from "../components/admin/OverheadSection";
import AdminCalculatorTest from "../components/admin/AdminCalculatorTest";
import SalesPriceTable from "../components/admin/SalesPriceTable";
import GlobalParamsSection from "../components/admin/GlobalParamsSection";
import LightboxPriceTable from "../components/admin/LightboxPriceTable";
import MinimumPricesSection from "../components/admin/MinimumPricesSection";
import MorningSettingsSection from "../components/admin/MorningSettingsSection";
import GreenApiSettingsSection from "../components/admin/GreenApiSettingsSection";
import MondaySettingsSection from "../components/admin/MondaySettingsSection";
import MondaySyncSection from "../components/admin/MondaySyncSection";
import SmtpSettingsSection from "../components/admin/SmtpSettingsSection";
import ReportsSection from "../components/admin/ReportsSection";
import AboutSection from "../components/admin/AboutSection";
import CollapsibleSection from "../components/admin/CollapsibleSection";
import UsersManagementSection from "../components/admin/UsersManagementSection";
import { ShieldAlert, Users, Receipt, Info, MessageCircle, LayoutGrid, Scissors, PenTool, PieChart, ClipboardList, LineChart } from "lucide-react";

// Formerly the horizontal TabsList atop the content area — now selected from
// the "הגדרות" submenu in the sidebar instead, so this is just the list of
// (value, label, icon, brand hue) driving both the submenu rows and which
// TabsContent panel is active.
const SETTINGS_TABS = [
  { value: "selling-prices", label: "קביעת מחירי מכירה", icon: Calculator, activeClass: "text-brand-gold" },
  { value: "costs", label: "קביעת עלויות", icon: Database, activeClass: "text-brand-teal" },
  { value: "minimum-prices", label: "מחירי מינימום", icon: ShieldAlert, activeClass: "text-brand-pink" },
  { value: "users", label: "משתמשים", icon: Users, activeClass: "text-brand-purple" },
  { value: "morning", label: "מורנינג", icon: Receipt, activeClass: "text-brand-green" },
  { value: "greenapi", label: "GreenAPI", icon: MessageCircle, activeClass: "text-emerald-600" },
  { value: "monday", label: "Monday", icon: LayoutGrid, activeClass: "text-orange-600" },
  { value: "smtp", label: "SMTP", icon: Mail, activeClass: "text-sky-600" },
  { value: "reports", label: "דוחות", icon: PieChart, activeClass: "text-indigo-600" },
];

const DEFAULT_CONFIG = {
  config_name: "default",
  pvc_white_cost_per_mm: null,
  pvc_black_cost_per_mm: null,
  perspex_cost_per_mm: null,
  perspex_mirror_cost_per_mm: null,
  perspex_gold_metallic_cost_per_mm: null,
  lokobond_cost_per_sqm: null,
  foamex_white_cost_per_mm: null,
  foamex_black_cost_per_mm: null,
  lokobond_pre_print_time_minutes: null,
  lokobond_print_time_per_sqm_minutes: null,
  lokobond_packaging_time_minutes: null,
  lokobond_clean_time_per_linear_meter_minutes: null,
  lokobond_cut_time_per_linear_meter_minutes_diecut: null,
  lokobond_cut_time_per_linear_meter_minutes_plain: null,
  foamex_pre_print_time_minutes: null,
  foamex_print_time_per_sqm_minutes: null,
  foamex_pre_cut_time_minutes: null,
  foamex_packaging_time_minutes: null,
  foamex_clean_time_per_linear_meter_minutes: null,
  foamex_cut_time_per_linear_meter_minutes_2: null,
  foamex_cut_time_per_linear_meter_minutes_3: null,
  foamex_cut_time_per_linear_meter_minutes_5: null,
  perspex_board_clear_print_cost_per_mm: null,
  perspex_board_black_matte_cost_per_mm: null,
  perspex_board_black_glossy_cost_per_mm: null,
  perspex_board_white_cost_per_mm: null,
  perspex_board_milky_cost_per_mm: null,
  perspex_board_back_print_cost_per_mm: null,
  perspex_board_pre_print_time_minutes: null,
  perspex_board_print_time_per_sqm_minutes: null,
  perspex_board_pre_cut_time_minutes: null,
  perspex_board_packaging_time_minutes: null,
  perspex_board_clean_time_per_linear_meter_minutes: null,
  perspex_board_cut_time_per_linear_meter_minutes_3: null,
  perspex_board_cut_time_per_linear_meter_minutes_5: null,
  perspex_board_cut_time_per_linear_meter_minutes_10: null,
  ink_cost: null,
  mounting_board_cost: null,
  dowel_cost_per_sqm: null,
  packaging_cost: null,
  instruction_sheet_cost: null,
  spacers_cost: null,
  spacers_per_element: null,
  spacers_selling_price_per_element: null,
  spray_paint_cost: null,
  spray_paint_per_sqm: null,
  raw_material_waste_percent: null,
  logo_pre_print_time_minutes: null,
  logo_print_time_per_sqm_minutes: null,
  laser_cut_cost_per_unit: null,
  logo_laser_cut_time_minutes: null,
  soma_cut_cost_per_unit: null,
  logo_soma_cut_time_minutes: null,
  logo_packaging_time_minutes: null,
  packaging_labor_cost: null,
  paint_room_cost: null,
  print_hour_cost: null,
  general_worker_hour_cost: null,
  operational_overhead_percent: null,
  sales_agent_commission_percent: null,
  marketing_commission_percent: null,
  shipping_cost: null,
  vinyl_sticker_material_cost_per_sqm: null,
  vinyl_sticker_ink_cost_per_sqm: null,
  vinyl_sticker_install_cost_per_sqm: null,
  vinyl_sticker_install_min_price: null,
  texture_sticker_material_cost_per_sqm: null,
  texture_sticker_ink_cost_per_sqm: null,
  texture_sticker_install_cost_per_sqm: null,
  texture_sticker_install_min_price: null,
  kapa_sheet_cost_122x244: null,
  kapa_sheet_cost_150x300: null,
  kapa_shelf_standard_price: null,
  kapa_shelf_custom_price: null,
  kapa_shelf_standard_cost: null,
  kapa_shelf_custom_cost: null,
  kapa_legs_price: null,
  kapa_legs_cost: null,
  kapa_colored_shelf_price: null,
  kapa_colored_shelf_cost: null,
  kapa_pre_cut_time_minutes: null,
  rollup_pre_print_time_minutes: null,
  rollup_print_time_minutes: null,
  rollup_cut_time_minutes: null,
  rollup_packaging_time_minutes: null,
  tape_cost_lokobond: null,
  tape_selling_price_lokobond: null,
  tape_cost_foamex: null,
  tape_selling_price_foamex: null,
  tape_cost_perspex_board: null,
  tape_selling_price_perspex_board: null,
  tape_cost_kapa: null,
  tape_selling_price_kapa: null,
  tape_cost_lightbox: null,
  tape_selling_price_lightbox: null,
  document_minimum_price: 350,
  logo_apply_minimum_multi: 1,
  sticker_apply_minimum_multi: 1,
  lokobond_apply_minimum_multi: 1,
  foamex_apply_minimum_multi: 1,
  perspexBoard_apply_minimum_multi: 1,
};

export default function AdminDashboard() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [configId, setConfigId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Lets other screens' sidebar deep-link straight into a settings tab
  // (e.g. "/?tab=about") instead of only ever landing on selling-prices.
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "selling-prices");

  useEffect(() => {
    loadConfig();
    loadDefaultPaintTiers();
  }, []);

  const loadDefaultPaintTiers = async () => {
    const existing = await base44.entities.PaintSurchargeTier.list();
    if (existing.length === 0) {
      const defaults = [
        { paint_type: 'single_color', area_from: 0.33, surcharge: 850, tier_description: 'מ-0.33 מ"ר' },
        { paint_type: 'dual_color', area_from: 0.33, surcharge: 1100, tier_description: 'מ-0.33 מ"ר' },
      ];
      await base44.entities.PaintSurchargeTier.bulkCreate(defaults);
    }
  };

  const loadConfig = async () => {
    setLoading(true);
    const configs = await base44.entities.PricingConfig.filter({ config_name: "default" });
    if (configs.length > 0) {
      setConfig({ ...DEFAULT_CONFIG, ...configs[0] });
      setConfigId(configs[0].id);
    }
    setLoading(false);
  };

  const handleFieldChange = (key, value) => {
    if (typeof key === 'object') return;
    setConfig((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const { id, created_date, updated_date, created_by, ...data } = config;
    if (configId) {
      await base44.entities.PricingConfig.update(configId, data);
    } else {
      const created = await base44.entities.PricingConfig.create(data);
      setConfigId(created.id);
    }
    setSaving(false);
    setSaved(true);
    toast.success("ההגדרות נשמרו בהצלחה");
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-black">
        <div className="w-full mx-auto px-4 sm:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Settings2 className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">ממשק מנהל</h1>
              <p className="text-sm text-muted-foreground">הגדרת עלויות ומחירונים</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gap-2 h-10 px-6 rounded-xl font-semibold shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : saved ? (
                <Check className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saving ? "שומר..." : saved ? "נשמר!" : "שמור הגדרות"}
            </Button>
          </div>
        </div>
      </div>

      {/* Content — nav sidebar sits first in DOM order, which under dir="rtl"
          places it on the screen's right side (RTL's "start" edge) without
          needing an explicit order/reverse class. */}
      <div className="w-full mx-auto px-4 sm:px-8 py-8 flex flex-col lg:flex-row gap-8 items-start">
        <aside className="w-full lg:w-56 shrink-0 lg:sticky lg:top-24 space-y-6">
          <NavGroup title="מכירות">
            <NavItem to="/quotes" icon={ClipboardList} label="הצעות לבדיקה" />
            <NavItem to="/quotes-archive" icon={LineChart} label="אנליטיקה" />
          </NavGroup>
          <NavGroup title="תפעול">
            <NavItem to="/cutting" icon={Scissors} label="ניצולת לוחות" />
            <NavItem to="/cutfile" icon={PenTool} label="קו חיתוך אוטומטי" />
          </NavGroup>
          <NavGroup title="ממשקים שונים">
            <NavItem to="/costs" icon={BarChart3} label="ממשק סוכן מכירות" />
            <SettingsNavItem activeTab={activeTab} onSelect={setActiveTab} />
            <LogoutNavItem />
            <AboutNavItem active={activeTab === "about"} onSelect={setActiveTab} />
          </NavGroup>
        </aside>

        <div className="flex-1 min-w-0 w-full">
        <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl">
          <TabsContent value="selling-prices" className="space-y-6 mt-0">
            <SalesPriceTable config={config} onConfigChange={handleFieldChange} />
          </TabsContent>

          <TabsContent value="minimum-prices" className="space-y-6 mt-0">
            <MinimumPricesSection config={config} onChange={handleFieldChange} />
          </TabsContent>

          <TabsContent value="users" className="space-y-6 mt-0">
            <UsersManagementSection />
          </TabsContent>

          <TabsContent value="morning" className="space-y-6 mt-0">
            <MorningSettingsSection />
          </TabsContent>

          <TabsContent value="greenapi" className="space-y-6 mt-0">
            <GreenApiSettingsSection />
          </TabsContent>

          <TabsContent value="monday" className="space-y-6 mt-0">
            <MondaySettingsSection />
            <MondaySyncSection />
          </TabsContent>

          <TabsContent value="smtp" className="space-y-6 mt-0">
            <SmtpSettingsSection />
          </TabsContent>

          <TabsContent value="reports" className="space-y-6 mt-0">
            <ReportsSection />
          </TabsContent>

          <TabsContent value="about" className="space-y-6 mt-0">
            <AboutSection />
          </TabsContent>

          <TabsContent value="costs" className="space-y-6 mt-0">
            <h2 className="text-2xl font-bold text-slate-800">חומר גלם</h2>
            <MaterialCostsSection config={config} onChange={handleFieldChange} />
            <hr className="border-t-2 border-slate-900" />

            <h2 className="text-2xl font-bold text-slate-800">לייבור</h2>
            <LaborCostsSection config={config} onChange={handleFieldChange} />
            <hr className="border-t-2 border-slate-900" />

            <h2 className="text-2xl font-bold text-slate-800">פריטים</h2>
            <TimeCostsSection config={config} onChange={handleFieldChange} />
            <StickerCostsSection config={config} onChange={handleFieldChange} />
            <LightboxPriceTable config={config} onConfigChange={handleFieldChange} />
            <KapaTimeCostsSection config={config} onChange={handleFieldChange} />
            <LokobondTimeCostsSection config={config} onChange={handleFieldChange} />
            <FoamexTimeCostsSection config={config} onChange={handleFieldChange} />
            <PerspexBoardTimeCostsSection config={config} onChange={handleFieldChange} />
            <PvcCarpetTimeCostsSection config={config} onChange={handleFieldChange} />
            <RollupTimeCostsSection config={config} onChange={handleFieldChange} />
            <GlassTimeCostsSection config={config} onChange={handleFieldChange} />
            <hr className="border-t-2 border-slate-900" />

            <h2 className="text-2xl font-bold text-slate-800">עמלות ומשלוחים</h2>
            <OverheadSection config={config} onChange={handleFieldChange} />
            <GlobalParamsSection config={config} onChange={handleFieldChange} />
            <hr className="border-t-2 border-slate-900" />

            <CollapsibleSection title="בדיקת מחשבון">
              <AdminCalculatorTest config={config} />
            </CollapsibleSection>
          </TabsContent>
        </Tabs>
        </div>
      </div>

      {/* Bottom save bar on mobile */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 p-4 bg-background/80 backdrop-blur-xl border-t border-black">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="w-full gap-2 h-12 rounded-xl font-semibold shadow-lg shadow-primary/20"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saved ? (
            <Check className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saving ? "שומר..." : saved ? "נשמר!" : "שמור הגדרות"}
        </Button>
      </div>
    </div>
  );
}

// One labelled group of nav items in the sidebar — a subtitle plus its rows,
// with no visual chrome of its own so the groups read as a single flowing
// list broken up by section, not as separate boxes.
function NavGroup({ title, children }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function NavItem({ to, icon: Icon, label }) {
  return (
    <Link to={to}>
      <Button variant="ghost" className="w-full justify-start gap-2 h-10 px-3 rounded-xl font-normal">
        {Icon && <Icon className="w-4 h-4" />}
        {label}
      </Button>
    </Link>
  );
}

// The former horizontal TabsList, now a collapsible submenu in the sidebar —
// closed by default so the settings sub-items don't dominate the group;
// opens to reveal every SETTINGS_TABS row, each selecting that tab's panel
// via the same activeTab state the Tabs component is controlled by.
function SettingsNavItem({ activeTab, onSelect }) {
  const [open, setOpen] = useState(false);
  const active = SETTINGS_TABS.find((t) => t.value === activeTab);

  return (
    <div>
      <Button
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        className="w-full justify-start gap-2 h-10 px-3 rounded-xl font-normal"
      >
        <Settings2 className="w-4 h-4" />
        <span className="flex-1 text-right">הגדרות</span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
      {open && (
        <div className="mt-1 mr-3 pr-3 border-r border-slate-200 space-y-1">
          {SETTINGS_TABS.map(({ value, label, icon: Icon, activeClass }) => (
            <Button
              key={value}
              variant="ghost"
              onClick={() => onSelect(value)}
              className={`w-full justify-start gap-2 h-9 px-3 rounded-xl font-normal text-sm ${
                value === active?.value ? `${activeClass} font-semibold` : ""
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

// Styled to match NavItem exactly (icon + label, full width) rather than
// reusing LogoutButton — that component also shows the signed-in user's
// name next to the button, which wraps awkwardly in the sidebar's narrow
// column at desktop widths (its "hidden sm:inline" is keyed off viewport
// width, not this column's width).
function LogoutNavItem() {
  const { logout } = useAuth();
  return (
    <Button variant="ghost" onClick={logout} className="w-full justify-start gap-2 h-10 px-3 rounded-xl font-normal">
      <LogOut className="w-4 h-4" />
      התנתקות
    </Button>
  );
}

// Pulled out of the הגדרות submenu and placed after Logout — "אודות" isn't a
// config screen an admin edits, so it doesn't belong grouped with the ones
// that are. Still drives the same activeTab state as every other panel, just
// via its own top-level row instead of the collapsible settings list.
function AboutNavItem({ active, onSelect }) {
  return (
    <Button
      variant="ghost"
      onClick={() => onSelect("about")}
      className={`w-full justify-start gap-2 h-10 px-3 rounded-xl font-normal ${active ? "text-slate-600 font-semibold" : ""}`}
    >
      <Info className="w-4 h-4" />
      אודות
    </Button>
  );
}