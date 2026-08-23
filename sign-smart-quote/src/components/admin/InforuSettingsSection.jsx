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
  const [pullStatus, setPullStatus] = useState(null);

  // Inbound is a background poll, so its state changes without anything on
  // this screen being touched — it has to refresh itself or it shows a stale
  // "working fine" long after it stopped.
  const refreshStatus = useCallback(async () => {
    try {
      const cfg = await getInforuConfig();
      setPullStatus(cfg.pull_status || null);
      setPullEnabled(!!cfg.pull_enabled);
    } catch {
      // leave the last known status on screen rather than blanking it
    }
  }, []);

  useEffect(() => {
    const t = setInterval(refreshStatus, 15000);
    return () => clearInterval(t);
  }, [refreshStatus]);

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
        setPullStatus(cfg.pull_status || null);
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

        {/* Live state of the inbound poll. Without this the only symptom of a
            broken pull is "the inbox is quiet", which looks exactly like a
            genuinely quiet inbox. */}
        {pullStatus && (
          <div className="rounded-xl border border-black p-3 space-y-1.5 bg-slate-50">
            <div className="text-sm font-semibold text-slate-600">מצב קליטת הודעות נכנסות</div>

            {!pullStatus.gates_pass ? (
              <div className="text-xs text-red-600 font-medium">
                ⚠ הודעות נכנסות אינן נקלטות כרגע —{" "}
                {!pullStatus.provider_is_active
                  ? "InforU אינו הספק הפעיל (ראה ״ספק פעיל״ למטה)"
                  : !pullEnabled
                  ? "מתג המשיכה כבוי"
                  : "חסרים פרטי התחברות (שם משתמש/טוקן)"}
              </div>
            ) : pullStatus.last_error ? (
              <>
                <div className="text-xs text-red-600 font-medium">⚠ המשיכה האחרונה נכשלה — זו התשובה של InforU:</div>
                <div className="text-[11px] font-mono bg-white border border-red-200 rounded p-2 text-red-700 break-all" dir="ltr">
                  {pullStatus.last_error}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  אם מדובר בהרשאה — יש לפנות לתמיכת InforU ולבקש להפעיל PullData לחשבון.
                </div>
              </>
            ) : pullStatus.last_pull_at ? (
              <>
                <div className="text-xs text-emerald-700">
                  ✓ פעיל. משיכה אחרונה: {new Date(pullStatus.last_pull_at.replace(" ", "T") + "Z").toLocaleString("he-IL")}
                  {pullStatus.last_count != null && ` · ${pullStatus.last_count} הודעות נמשכו`}
                </div>
                {/* "0 נמשכו" alone can't tell an empty queue from messages we
                    received and then dropped — both look identical, and the
                    pull is destructive so the message is gone either way. The
                    running total is what separates the two. */}
                <div className="text-[11px] text-muted-foreground">
                  סה״כ מאז ההפעלה: {pullStatus.total_pulls ?? 0} משיכות ·{" "}
                  <span className={pullStatus.total_items_ever > 0 ? "text-slate-700 font-semibold" : ""}>
                    {pullStatus.total_items_ever ?? 0} הודעות התקבלו מ-InforU בסך הכל
                  </span>
                </div>
                {pullStatus.total_items_ever === 0 && (
                  <div className="text-[11px] text-amber-700">
                    מעולם לא התקבלה אף הודעה. החיבור תקין — כלומר ההודעות של הלקוחות
                    לא מגיעות לתור של InforU מלכתחילה. יש לבדוק מול InforU האם הודעות
                    נכנסות למספר מוגדרות להיכנס לתור המשיכה (ולא נשלחות ל-callback אחר).
                  </div>
                )}
                {/* When nothing ever arrives, the exact request/response pair is
                    the only thing left to show InforU support. */}
                {pullStatus.last_raw && (
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-slate-600">הצג את הבקשה והתשובה האחרונה מ-InforU (למסירה לתמיכה)</summary>
                    <div className="mt-1 space-y-1">
                      <div className="text-[10px] text-muted-foreground">
                        נשלח: <code dir="ltr">POST /api/v2/PullData · Type: {pullStatus.pull_type_sent}</code>
                      </div>
                      <pre className="bg-white border border-slate-200 rounded p-2 overflow-auto max-h-52 text-[10px] whitespace-pre-wrap break-all" dir="ltr">
                        {pullStatus.last_raw.raw || "(ריק)"}
                      </pre>
                    </div>
                  </details>
                )}
                {pullStatus.last_pull_with_items && (
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-slate-600">
                      ⚠ התקבלו הודעות אך ייתכן שלא נשמרו — המשיכה האחרונה עם תוכן
                      ({pullStatus.last_pull_with_items.count} פריטים,{" "}
                      {new Date(pullStatus.last_pull_with_items.at.replace(" ", "T") + "Z").toLocaleString("he-IL")})
                    </summary>
                    <pre className="mt-1 bg-white border border-slate-200 rounded p-2 overflow-auto max-h-52 text-[10px] whitespace-pre-wrap break-all" dir="ltr">
                      {pullStatus.last_pull_with_items.raw}
                    </pre>
                  </details>
                )}
              </>
            ) : (
              <div className="text-xs text-amber-600">
                ההגדרות תקינות, אך טרם בוצעה משיכה. המשיכה רצה כל 10 שניות — יש לרענן בעוד רגע.
              </div>
            )}
          </div>
        )}

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
