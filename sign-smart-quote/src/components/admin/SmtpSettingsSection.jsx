import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Mail, Send, FileText } from "lucide-react";
import { toast } from "sonner";
import { getSmtpConfig, saveSmtpConfig, sendSmtpTest, sendDailyReportTest } from "@/api/smtpClient";
import CostSectionCard from "./CostSectionCard";

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
  const [reportRecipientEmail, setReportRecipientEmail] = useState("");

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
        setReportRecipientEmail(cfg.report_recipient_email || "");
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
        report_recipient_email: reportRecipientEmail,
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
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-sm font-semibold text-slate-600">כתובת מייל לדוח תעודות משלוח יומי</label>
          <Input
            dir="ltr"
            value={reportRecipientEmail}
            onChange={(e) => setReportRecipientEmail(e.target.value)}
            placeholder="office@printela.co.il"
          />
          <p className="text-xs text-muted-foreground">
            כל יום ב-17:00 תישלח לכתובת הזו רשימת תעודות המשלוח שנסגרו באותו יום, עם מספר כל תעודה והסכום שלה לפני מע״מ. השדה ריק = הדוח לא נשלח.
          </p>
        </div>
        <div className="sm:col-span-2">
          <p className="text-xs text-muted-foreground">
            סוג ההצפנה נקבע אוטומטית לפי הפורט — 465 מתחבר ב-SSL ישיר, ו-587 או 25 משתמשים ב-STARTTLS.
          </p>
        </div>
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
