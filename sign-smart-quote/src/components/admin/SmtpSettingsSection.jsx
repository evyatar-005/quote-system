import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Mail, Send, FileText, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { getSmtpConfig, saveSmtpConfig, sendSmtpTest, sendDailyReportTest } from "@/api/smtpClient";
import CostSectionCard from "./CostSectionCard";

const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// Same split rule as the backend's parseRecipients (dailyDeliveryReport.js) —
// comma/semicolon/newline separated, trimmed, de-duplicated, blanks dropped.
function parseRecipients(raw) {
  if (!raw) return [];
  const seen = new Set();
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(s) && seen.add(s));
}

export default function SmtpSettingsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingReport, setTestingReport] = useState(false);
  // Shown inline rather than relying only on a toast: diagnosing a wrong SMTP
  // host/password is the whole point of the test button, and forgot-password
  // is deliberately silent about failures, so this is the only place the real
  // error is ever visible.
  const [status, setStatus] = useState(null); // { ok: boolean, message: string }
  const [host, setHost] = useState("");
  const [port, setPort] = useState(587);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordMasked, setPasswordMasked] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [appBaseUrl, setAppBaseUrl] = useState("");
  const [recipients, setRecipients] = useState([]); // string[] — the actual list edited in the UI
  const [recipientInput, setRecipientInput] = useState("");
  const [reportFrequency, setReportFrequency] = useState("daily");
  const [reportTime, setReportTime] = useState("17:00");
  const [reportWeekday, setReportWeekday] = useState(0);
  const [reportDayOfMonth, setReportDayOfMonth] = useState(1);

  const addRecipient = () => {
    const email = recipientInput.trim();
    if (!email) return;
    setRecipients((prev) => (prev.includes(email) ? prev : [...prev, email]));
    setRecipientInput("");
  };
  const removeRecipient = (email) => setRecipients((prev) => prev.filter((r) => r !== email));

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getSmtpConfig();
        setHost(cfg.host || "");
        setPort(cfg.port || 587);
        setUsername(cfg.username || "");
        setPasswordMasked(cfg.password_masked || "");
        setFromEmail(cfg.from_email || "");
        setFromName(cfg.from_name || "");
        setAppBaseUrl(cfg.app_base_url || "");
        setRecipients(parseRecipients(cfg.report_recipient_email));
        setReportFrequency(cfg.report_frequency || "daily");
        setReportTime(cfg.report_time || "17:00");
        setReportWeekday(cfg.report_weekday ?? 0);
        setReportDayOfMonth(cfg.report_day_of_month ?? 1);
      } catch {
        toast.error("שגיאה בטעינת הגדרות SMTP");
      }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      // Blank password means "keep the existing one" — the backend never
      // overwrites a stored password with an empty value, same convention as
      // MorningSettingsSection.
      const result = await saveSmtpConfig({
        host,
        port: Number(port) || 587,
        username,
        password,
        from_email: fromEmail,
        from_name: fromName,
        app_base_url: appBaseUrl,
        report_recipient_email: recipients.join(", "),
        report_frequency: reportFrequency,
        report_time: reportTime,
        report_weekday: Number(reportWeekday),
        report_day_of_month: Number(reportDayOfMonth),
      });
      setPassword("");
      setPasswordMasked(result?.password_masked || passwordMasked);
      setStatus({ ok: true, message: "הגדרות SMTP נשמרו בהצלחה" });
      toast.success("הגדרות SMTP נשמרו בהצלחה");
    } catch (err) {
      setStatus({ ok: false, message: err?.message || "שגיאה בשמירת הגדרות SMTP" });
      toast.error(err?.message || "שגיאה בשמירת הגדרות SMTP");
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setStatus(null);
    try {
      await sendSmtpTest();
      setStatus({ ok: true, message: "מייל בדיקה נשלח — בדוק את תיבת הדואר שלך" });
      toast.success("מייל בדיקה נשלח — בדוק את תיבת הדואר שלך");
    } catch (err) {
      setStatus({ ok: false, message: err?.message || "שליחת מייל הבדיקה נכשלה" });
      toast.error(err?.message || "שליחת מייל הבדיקה נכשלה");
    }
    setTesting(false);
  };

  const handleTestReport = async () => {
    setTestingReport(true);
    setStatus(null);
    try {
      const result = await sendDailyReportTest();
      setStatus({ ok: true, message: `דוח תעודות משלוח נשלח (${result.count} תעודות) — בדוק את תיבת הדואר` });
      toast.success("דוח תעודות משלוח נשלח");
    } catch (err) {
      setStatus({ ok: false, message: err?.message || "שליחת דוח הבדיקה נכשלה" });
      toast.error(err?.message || "שליחת דוח הבדיקה נכשלה");
    }
    setTestingReport(false);
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
      icon={<Mail className="w-5 h-5" />}
      title="הגדרות SMTP"
      description="שרת דואר יוצא — משמש לשליחת קישורי איפוס סיסמה למשתמשים"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">Host</label>
          <Input
            dir="ltr"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="smtp.gmail.com"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">Port</label>
          <Input
            dir="ltr"
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="587"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">שם משתמש (SMTP)</label>
          <Input
            dir="ltr"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="user@example.com"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">סיסמה (SMTP)</label>
          <Input
            type="password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={passwordMasked ? `סיסמה נוכחית: ${passwordMasked}` : "לא הוגדר עדיין"}
          />
          <p className="text-xs text-muted-foreground">השדה נשאר ריק אם לא מזינים ערך חדש — כך שהסיסמה הקיימת לא נמחקת</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">כתובת שולח (From)</label>
          <Input
            dir="ltr"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder="noreply@printela.co.il"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">שם שולח (אופציונלי)</label>
          <Input
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="מערכת הצעות מחיר"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-sm font-semibold text-slate-600">כתובת בסיס לקישורים (App Base URL)</label>
          <Input
            dir="ltr"
            value={appBaseUrl}
            onChange={(e) => setAppBaseUrl(e.target.value)}
            placeholder="https://xxxx.trycloudflare.com"
          />
          <p className="text-xs text-muted-foreground">
            כתובת ה-tunnel הפעילה, כדי שקישורי איפוס סיסמה במייל יעבדו נכון — כתובת ה-tunnel משתנה בכל הפעלה, לכן יש לעדכן כאן לפי הצורך.
          </p>
        </div>
        <div className="sm:col-span-2">
          <p className="text-xs text-muted-foreground">
            סוג ההצפנה נקבע אוטומטית לפי הפורט — 465 מתחבר ב-SSL ישיר, ו-587 או 25 משתמשים ב-STARTTLS.
          </p>
        </div>
      </div>

      <div className="border-t border-slate-100 pt-4 space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-slate-500" />
          <h4 className="text-sm font-semibold text-slate-700">דוח תעודות משלוח מתוזמן</h4>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">נמענים</label>
          <div className="flex flex-wrap gap-2">
            {recipients.map((email) => (
              <span
                key={email}
                className="flex items-center gap-1.5 text-xs bg-slate-100 text-slate-700 rounded-full pl-1 pr-3 py-1"
                dir="ltr"
              >
                {email}
                <button
                  type="button"
                  onClick={() => removeRecipient(email)}
                  className="p-0.5 rounded-full hover:bg-slate-200 text-slate-500"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              dir="ltr"
              value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addRecipient(); }
              }}
              placeholder="office@printela.co.il"
              className="flex-1"
            />
            <Button type="button" variant="outline" onClick={addRecipient} className="gap-1.5 shrink-0">
              <Plus className="w-4 h-4" /> הוסף
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            אפשר להוסיף כמה כתובות שרוצים. רשימה ריקה = הדוח לא נשלח.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-600">תדירות</label>
            <select
              value={reportFrequency}
              onChange={(e) => setReportFrequency(e.target.value)}
              className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="daily">יומי</option>
              <option value="weekly">שבועי</option>
              <option value="monthly">חודשי</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-600">שעת שליחה</label>
            <Input
              type="time"
              dir="ltr"
              value={reportTime}
              onChange={(e) => setReportTime(e.target.value)}
            />
          </div>
          {reportFrequency === "weekly" && (
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-600">יום בשבוע</label>
              <select
                value={reportWeekday}
                onChange={(e) => setReportWeekday(e.target.value)}
                className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
              >
                {WEEKDAY_LABELS.map((label, i) => (
                  <option key={i} value={i}>{label}</option>
                ))}
              </select>
            </div>
          )}
          {reportFrequency === "monthly" && (
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-600">יום בחודש</label>
              <Input
                type="number"
                dir="ltr"
                min={1}
                max={31}
                value={reportDayOfMonth}
                onChange={(e) => setReportDayOfMonth(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">בחודשים קצרים יותר (כמו פברואר) יישלח ביום האחרון של החודש.</p>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          דוח יומי מסכם את היום הנוכחי, שבועי את 7 הימים האחרונים, וחודשי את 30 הימים האחרונים — לכל תעודת משלוח שנסגרה בתקופה: מספר תעודה, לקוח, וסכום לפני מע״מ.
        </p>
      </div>

      {status && (
        <div
          className={
            status.ok
              ? "text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"
              : "text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
          }
        >
          {status.message}
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "שומר..." : "שמור"}
        </Button>
        <Button onClick={handleTest} disabled={testing} variant="outline" className="gap-2">
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {testing ? "שולח..." : "שלח מייל בדיקה"}
        </Button>
        <Button onClick={handleTestReport} disabled={testingReport} variant="outline" className="gap-2">
          {testingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          {testingReport ? "שולח..." : "שלח דוח תעודות משלוח עכשיו"}
        </Button>
      </div>
    </CostSectionCard>
  );
}
