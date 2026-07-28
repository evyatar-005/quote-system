import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Save, Settings2, Loader2, Check } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Database, Calculator, Mail } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { BarChart3, Menu } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/AuthContext";
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
import SmtpSettingsSection from "../components/admin/SmtpSettingsSection";
import AboutSection from "../components/admin/AboutSection";
import LogoutButton from "@/components/LogoutButton";
import CollapsibleSection from "../components/admin/CollapsibleSection";
import UsersManagementSection from "../components/admin/UsersManagementSection";
import { ShieldAlert, Users, Receipt, Info, MessageCircle, LayoutGrid, Scissors } from "lucide-react";


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
  kapa_pre_cut_time_minutes: null,
  rollup_pre_print_time_minutes: null,
  rollup_print_time_minutes: null,
  rollup_cut_time_minutes: null,
  rollup_packaging_time_minutes: null,
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
          <div className="flex items-center gap-2">
            <Link to="/quotes">
              <Button variant="outline" className="gap-2 h-10 px-4 rounded-xl">
                היסטוריית הצעות
              </Button>
            </Link>
            <Link to="/cutting">
              <Button variant="outline" className="gap-2 h-10 px-4 rounded-xl">
                <Scissors className="w-4 h-4" />
                ניצולת לוחות
              </Button>
            </Link>
            <Link to="/costs">
              <Button variant="outline" className="gap-2 h-10 px-4 rounded-xl">
                <BarChart3 className="w-4 h-4" />
                ממשק סוכן מכירות
              </Button>
            </Link>
            <LogoutButton />
          </div>
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

      {/* Content */}
      <div className="w-full mx-auto px-4 sm:px-8 py-8">
        <Tabs defaultValue="selling-prices" dir="rtl">
          {/* Each tab gets its own muted brand hue (from the Printela palette)
              so the four domains — pricing / costs / minimums / users — read
              as visually distinct areas, not just interchangeable tabs. */}
          <TabsList className="grid w-full grid-cols-4 sm:grid-cols-9 max-w-6xl mb-6">
            <TabsTrigger value="selling-prices" className="gap-2 data-[state=active]:text-brand-gold">
              <Calculator className="w-4 h-4" /> קביעת מחירי מכירה
            </TabsTrigger>
            <TabsTrigger value="costs" className="gap-2 data-[state=active]:text-brand-teal">
              <Database className="w-4 h-4" /> קביעת עלויות
            </TabsTrigger>
            <TabsTrigger value="minimum-prices" className="gap-2 data-[state=active]:text-brand-pink">
              <ShieldAlert className="w-4 h-4" /> מחירי מינימום
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2 data-[state=active]:text-brand-purple">
              <Users className="w-4 h-4" /> משתמשים
            </TabsTrigger>
            <TabsTrigger value="morning" className="gap-2 data-[state=active]:text-brand-green">
              <Receipt className="w-4 h-4" /> מורנינג
            </TabsTrigger>
            <TabsTrigger value="greenapi" className="gap-2 data-[state=active]:text-emerald-600">
              <MessageCircle className="w-4 h-4" /> GreenAPI
            </TabsTrigger>
            <TabsTrigger value="monday" className="gap-2 data-[state=active]:text-orange-600">
              <LayoutGrid className="w-4 h-4" /> Monday
            </TabsTrigger>
            <TabsTrigger value="smtp" className="gap-2 data-[state=active]:text-sky-600">
              <Mail className="w-4 h-4" /> SMTP
            </TabsTrigger>
            <TabsTrigger value="about" className="gap-2 data-[state=active]:text-slate-600">
              <Info className="w-4 h-4" /> אודות
            </TabsTrigger>
          </TabsList>

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
          </TabsContent>

          <TabsContent value="smtp" className="space-y-6 mt-0">
            <SmtpSettingsSection />
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