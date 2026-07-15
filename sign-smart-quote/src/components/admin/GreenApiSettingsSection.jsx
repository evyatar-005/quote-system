import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { getGreenApiConfig, saveGreenApiConfig } from "@/api/greenApiClient";
import CostSectionCard from "./CostSectionCard";

export default function GreenApiSettingsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [instanceId, setInstanceId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [tokenMasked, setTokenMasked] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getGreenApiConfig();
        setInstanceId(cfg.instance_id || "");
        setTokenMasked(cfg.api_token_masked || "");
        setApiUrl(cfg.api_url || "");
        setMediaUrl(cfg.media_url || "");
      } catch {
        toast.error("שגיאה בטעינת הגדרות GreenAPI");
      }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveGreenApiConfig({
        instance_id: instanceId,
        api_token: apiToken,
        api_url: apiUrl,
        media_url: mediaUrl,
      });
      setApiToken("");
      setTokenMasked(result?.api_token_masked || tokenMasked);
      toast.success("הגדרות GreenAPI נשמרו בהצלחה");
    } catch (err) {
      toast.error(err?.message || "שגיאה בשמירת הגדרות GreenAPI");
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <CostSectionCard
      icon={<MessageCircle className="w-5 h-5" />}
      title="הגדרות GreenAPI (וואטסאפ)"
      description="שליחה אוטומטית של מסמכים שנוצרו במורנינג לוואטסאפ של הלקוח"
      defaultOpen
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">Instance ID</label>
          <Input
            dir="ltr"
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
            placeholder="Instance ID"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">API Token</label>
          <Input
            type="password"
            dir="ltr"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder={tokenMasked ? `נוכחי: ${tokenMasked}` : "לא הוגדר עדיין"}
          />
          <p className="text-xs text-muted-foreground">השדה נשאר ריק אם לא מזינים ערך חדש — כך שהטוקן הקיים לא נמחק</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">API URL</label>
          <Input
            dir="ltr"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://XXXX.api.greenapi.com"
          />
          <p className="text-xs text-muted-foreground">מוצג בקונסולת GreenAPI, ליד פרטי ה-Instance</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">Media URL (אופציונלי)</label>
          <Input
            dir="ltr"
            value={mediaUrl}
            onChange={(e) => setMediaUrl(e.target.value)}
            placeholder="אם ריק — יישלח דרך API URL"
          />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? "שומר..." : "שמור"}
      </Button>
    </CostSectionCard>
  );
}
