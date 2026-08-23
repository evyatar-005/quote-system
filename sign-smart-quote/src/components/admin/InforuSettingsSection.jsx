import { useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { getInforuConfig, saveInforuConfig, listInforuTemplates, sendTestTemplate } from "@/api/inforuClient";
import { whatsapp } from "@/api/inboxClient";
import CostSectionCard from "./CostSectionCard";

// InforU is the official WhatsApp Business API (a Meta-approved BSP) — unlike
// GreenAPI it can never be blocked for looking like automation, but it lives
// under Meta's 24h customer-service-window rule: the first message to anyone
// must be one of these approved templates. This section is both the
// credential form (mirrors GreenApiSettingsSection.jsx) and the one place to
// actually send a template, since POST /api/whatsapp/test only sends free
// text and InforU will correctly refuse that outside an open window.
export default function InforuSettingsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [tokenMasked, setTokenMasked] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [pullEnabled, setPullEnabled] = useState(false);
  const [savingPull, setSavingPull] = useState(false);

  const [activeProvider, setActiveProvider] = useState("greenapi");
  const [switchingProvider, setSwitchingProvider] = useState(false);

  const [templates, setTemplates] = useState(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testTemplateId, setTestTemplateId] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const list = await listInforuTemplates();
      setTemplates(list);
      setTemplatesError("");
    } catch (err) {
      setTemplates([]);
      setTemplatesError(err?.message || "טעינת התבניות נכשלה");
    }
    setLoadingTemplates(false);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getInforuConfig();
        setUsername(cfg.username || "");
        setTokenMasked(cfg.api_token_masked || "");
        setBaseUrl(cfg.base_url || "");
        setPullEnabled(!!cfg.pull_enabled);
      } catch {
        toast.error("שגיאה בטעינת הגדרות InforU");
      }
      try {
        const wa = await whatsapp.getConfig();
        setActiveProvider(wa.active_provider || "greenapi");
      } catch {
        // non-fatal — the radio just defaults to greenapi
      }
      setLoading(false);
    })();
  }, []);

  // The toggle saves itself the moment it moves, and shows the value the
  // SERVER came back with — not the one that was clicked.
  //
  // It used to be plain local state that only reached the server if you then
  // remembered to press "שמור" in this card. This panel has a second, unrelated
  // "שמור הגדרות" button at the top of the page, so switching the toggle and
  // saving from there looked completely successful and silently discarded the
  // change — the toggle was back to off after a refresh, with no error anywhere.
  // A switch that needs a separate save is the bug; this removes the gap.
  const togglePull = async (next) => {
    const previous = pullEnabled;
    setPullEnabled(next); // optimistic — reverted below if the server disagrees
    setSavingPull(true);
    try {
      // pull_enabled ONLY: every credential field is keep-on-omit server-side,
      // so this can never blank the username or token that are already stored.
      const saved = await saveInforuConfig({ pull_enabled: next });
      const actual = saved?.pull_enabled ?? next;
      setPullEnabled(actual);
      toast.success(actual ? "משיכת הודעות נכנסות הופעלה" : "משיכת הודעות נכנסות כובתה");
    } catch (err) {
      setPullEnabled(previous);
      toast.error(err?.message || "שמירת המתג נכשלה");
    }
    setSavingPull(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveInforuConfig({
        username, api_token: apiToken, base_url: baseUrl, pull_enabled: pullEnabled,
      });
      setApiToken("");
      toast.success("הגדרות InforU נשמרו בהצלחה");
      const cfg = await getInforuConfig();
      setTokenMasked(cfg.api_token_masked || tokenMasked);
    } catch (err) {
      toast.error(err?.message || "שגיאה בשמירת הגדרות InforU");
    }
    setSaving(false);
  };

  const handleSwitchProvider = async (provider) => {
    setSwitchingProvider(true);
    try {
      await whatsapp.setProvider(provider);
      setActiveProvider(provider);
      toast.success(provider === "inforu" ? "InforU הופעל כספק הפעיל" : "GreenAPI הופעל כספק הפעיל");
    } catch (err) {
      toast.error(err?.message || "החלפת הספק נכשלה");
    }
    setSwitchingProvider(false);
  };

  const handleSendTest = async () => {
    if (!testPhone.trim() || !testTemplateId) return toast.error("יש לבחור תבנית ולהזין מספר טלפון");
    setSendingTest(true);
    try {
      const result = await sendTestTemplate({ to: testPhone.trim(), templateId: testTemplateId, parameters: [] });
      if (result.ok) toast.success("התבנית נשלחה — לאחר שהלקוח יענה ייפתח חלון של 24 שעות");
      else toast.error(result.error || "השליחה נכשלה");
    } catch (err) {
      toast.error(err?.message || "השליחה נכשלה");
    }
    setSendingTest(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <CostSectionCard
        icon={<MessageCircle className="w-5 h-5" />}
        title="הגדרות InforU (וואטסאפ רשמי)"
        description="ה-API הרשמי של WhatsApp Business — ללא סיכון חסימה, אבל כפוף לחוק ה-24 שעות של Meta"
        defaultOpen
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-600">שם משתמש</label>
            <Input dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-600">טוקן API</label>
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
            <label className="text-sm font-semibold text-slate-600">כתובת בסיס (אופציונלי)</label>
            <Input dir="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://capi.inforu.co.il" />
          </div>
          <div className="space-y-1.5 flex flex-col justify-center">
            <label className="text-sm font-semibold text-slate-600 flex items-center gap-2">
              <Switch checked={pullEnabled} onCheckedChange={togglePull} disabled={savingPull} />
              משיכת הודעות נכנסות
              {savingPull && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
            </label>
            <p className="text-xs text-muted-foreground">
              קריאה הרסנית מהתור של InforU — יש להדליק רק במופע אחד בכל רגע נתון, ורק אחרי שהתמיכה של InforU אישרה שהתור מופעל
            </p>
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "שומר..." : "שמור"}
        </Button>

        <div className="border-t border-slate-200 pt-4 space-y-2">
          <p className="text-sm font-semibold text-slate-600">ספק פעיל</p>
          <p className="text-xs text-muted-foreground">
            קובע איזה ספק משמש לכל שיחת 1:1 ולשליחת מסמכים ממורנינג — שינוי חל מיידית על כל המערכת.
          </p>
          <div className="flex gap-2">
            {[["greenapi", "GreenAPI"], ["inforu", "InforU"]].map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={activeProvider === key ? "default" : "outline"}
                disabled={switchingProvider}
                onClick={() => handleSwitchProvider(key)}
              >
                {label}
                {activeProvider === key && " (פעיל)"}
              </Button>
            ))}
          </div>
        </div>
      </CostSectionCard>

      <CostSectionCard
        icon={<Send className="w-5 h-5" />}
        title="בדיקת תבנית מאושרת"
        description="שליחת תבנית לפתיחת חלון שיחה — הדרך היחידה לבדוק חיבור לפני עבודה בפועל"
        defaultOpen={false}
      >
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={loadTemplates} disabled={loadingTemplates} className="gap-2">
            {loadingTemplates && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            טען תבניות מאושרות
          </Button>
          {templatesError && <span className="text-xs text-red-600">{templatesError}</span>}
        </div>

        {templates && templates.length === 0 && !templatesError && (
          <p className="text-xs text-muted-foreground">לא נמצאו תבניות מאושרות בחשבון InforU</p>
        )}

        {templates && templates.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-600">תבנית</label>
              <select
                className="text-xs border border-black rounded-md px-2 py-1.5 bg-white w-full h-9"
                value={testTemplateId}
                onChange={(e) => setTestTemplateId(e.target.value)}
              >
                <option value="">בחר תבנית...</option>
                {templates.map((t) => (
                  <option key={t.TemplateId} value={t.TemplateId}>{t.TemplateName} ({t.MessageText?.slice(0, 30)})</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-600">מספר טלפון לבדיקה</label>
              <Input dir="ltr" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+972501234567" />
            </div>
          </div>
        )}

        {templates && templates.length > 0 && (
          <Button onClick={handleSendTest} disabled={sendingTest} size="sm" className="gap-2">
            {sendingTest ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sendingTest ? "שולח..." : "שלח תבנית"}
          </Button>
        )}
      </CostSectionCard>
    </>
  );
}
