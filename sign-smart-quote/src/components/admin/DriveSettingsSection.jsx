import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, HardDrive, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { drive } from "@/api/driveClient";
import CostSectionCard from "./CostSectionCard";

// CRM Phase 5 §7 — Google Drive marketing-materials folder config. API key
// only (no service account) — the folder is meant to be world-readable
// ("anyone with the link"), see CLAUDE.md for the reasoning.
export default function DriveSettingsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [apiKeyInput, setApiKeyInput] = useState("");

  useEffect(() => {
    (async () => {
      try { setCfg(await drive.getConfig()); }
      catch { toast.error("טעינת הגדרות Drive נכשלה"); }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await drive.updateConfig({
        api_key: apiKeyInput || undefined,
        root_folder_id: cfg.root_folder_id,
        max_send_mb: Number(cfg.max_send_mb),
        cache_ttl_sec: Number(cfg.cache_ttl_sec),
      });
      setApiKeyInput("");
      setCfg(await drive.getConfig());
      toast.success("ההגדרות נשמרו");
    } catch (err) {
      toast.error(err.message || "השמירה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const { count } = await drive.test();
      toast.success(`חיבור תקין — נמצאו ${count} קבצים/תיקיות בשורש`);
    } catch (err) {
      toast.error(err.message || "הבדיקה נכשלה");
    } finally {
      setTesting(false);
    }
  };

  if (loading || !cfg) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <CostSectionCard
      icon={<HardDrive className="w-5 h-5" />}
      title="חומרי שיווק — Google Drive"
      description='תיקייה משותפת "כל מי שיש לו קישור" ששולחת קבצים ישירות בווצאפ ללקוח (לא קישור)'
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-sm font-semibold text-slate-600">מפתח API (מוגבל ל-Drive API)</label>
          <Input
            dir="ltr"
            type="password"
            placeholder={cfg.api_key_masked || "הדבק מפתח API"}
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
          />
          {cfg.configured && <p className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> מוגדר</p>}
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-sm font-semibold text-slate-600">מזהה תיקיית השורש (מה-URL בדרייב)</label>
          <Input dir="ltr" value={cfg.root_folder_id} onChange={(e) => setCfg((p) => ({ ...p, root_folder_id: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">גודל קובץ מרבי לשליחה (MB)</label>
          <Input type="number" min={1} value={cfg.max_send_mb} onChange={(e) => setCfg((p) => ({ ...p, max_send_mb: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">רענון מטמון רשימת קבצים (שניות)</label>
          <Input type="number" min={30} value={cfg.cache_ttl_sec} onChange={(e) => setCfg((p) => ({ ...p, cache_ttl_sec: e.target.value }))} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "שומר..." : "שמור"}
        </Button>
        <Button variant="outline" onClick={test} disabled={testing || !cfg.configured} className="gap-2">
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          בדוק חיבור
        </Button>
      </div>
    </CostSectionCard>
  );
}
