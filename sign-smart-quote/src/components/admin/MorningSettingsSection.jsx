import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Receipt } from "lucide-react";
import { toast } from "sonner";
import { getMorningConfig, saveMorningConfig } from "@/api/morningClient";
import CostSectionCard from "./CostSectionCard";

export default function MorningSettingsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [secretMasked, setSecretMasked] = useState("");
  const [sandbox, setSandbox] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookSecretMasked, setWebhookSecretMasked] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getMorningConfig();
        setClientId(cfg.client_id || "");
        setSecretMasked(cfg.client_secret_masked || "");
        setSandbox(!!cfg.sandbox);
        setBaseUrl(cfg.base_url || "");
        setWebhookSecretMasked(cfg.webhook_secret_masked || "");
      } catch {
        toast.error("שגיאה בטעינת הגדרות מורנינג");
      }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Blank secret means "keep the existing one" — the backend never
      // overwrites a stored secret with an empty value per the API contract,
      // so the admin doesn't have to re-paste it just to toggle sandbox mode.
      const result = await saveMorningConfig({
        client_id: clientId,
        client_secret: clientSecret,
        sandbox,
        base_url: baseUrl,
        webhook_secret: webhookSecret,
      });
      setClientSecret("");
      setWebhookSecret("");
      setSecretMasked(result?.client_secret_masked || secretMasked);
      setWebhookSecretMasked(result?.webhook_secret_masked || webhookSecretMasked);
      toast.success("הגדרות מורנינג נשמרו בהצלחה");
    } catch (err) {
      toast.error(err?.message || "שגיאה בשמירת הגדרות מורנינג");
    }
    setSaving(false);
  };

  const webhookUrl = `${window.location.origin}/api/morning/webhooks/payment-received`;
  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl)
      .then(() => toast.success("הקישור הועתק"))
      .catch(() => toast.error("ההעתקה נכשלה — יש להעתיק ידנית"));
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
      icon={<Receipt className="w-5 h-5" />}
      title="הגדרות מורנינג"
      description="חיבור למורנינג (חשבונית ירוקה) — הנפקת מסמכים חשבונאיים על בסיס הצעות מחיר"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">Client ID</label>
          <Input
            dir="ltr"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client ID"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">Client Secret</label>
          <Input
            type="password"
            dir="ltr"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={secretMasked ? `סיסמה נוכחית: ${secretMasked}` : "לא הוגדר עדיין"}
          />
          <p className="text-xs text-muted-foreground">השדה נשאר ריק אם לא מזינים ערך חדש — כך שהסיסמה הקיימת לא נמחקת</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">Base URL (אופציונלי)</label>
          <Input
            dir="ltr"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.greeninvoice.co.il"
          />
        </div>
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-semibold text-slate-700">סביבת בדיקות (Sandbox)</p>
            <p className="text-sm text-muted-foreground mt-0.5">כשמופעל, המסמכים מונפקים בסביבת הבדיקות של מורנינג ולא מול לקוחות אמיתיים</p>
          </div>
          <Switch checked={sandbox} onCheckedChange={setSandbox} />
        </div>
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-slate-700">התראה על תשלום שהתקבל</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            כדי לקבל התראה במערכת (וכפתור להנפקת הזמנה) ברגע שלקוח משלם דרך קישור תשלום, יש להגדיר
            Webhook בממשק של מורנינג (Developer Tools ← Webhooks) לאירוע <span dir="ltr" className="font-mono">payment/received</span>, עם הכתובת הבאה:
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input dir="ltr" readOnly value={webhookUrl} className="font-mono text-xs" />
          <Button type="button" variant="outline" onClick={copyWebhookUrl}>העתק</Button>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">Webhook Secret (אופציונלי)</label>
          <Input
            type="password"
            dir="ltr"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={webhookSecretMasked ? `סיסמה נוכחית: ${webhookSecretMasked}` : "לא הוגדר עדיין"}
          />
          <p className="text-xs text-muted-foreground">אותו סוד שהוגדר עבור ה-Webhook בממשק מורנינג — לאימות שהקריאה אכן הגיעה ממורנינג</p>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? "שומר..." : "שמור"}
      </Button>
    </CostSectionCard>
  );
}
