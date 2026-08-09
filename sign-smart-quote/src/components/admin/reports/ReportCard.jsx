import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, Send, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { saveReportConfig, sendReportTest } from "@/api/reportsClient";
import RecipientsEditor, { parseRecipients } from "./RecipientsEditor";
import ScheduleFields from "./ScheduleFields";

// One card = one report type's full config (enabled/recipients/schedule) +
// save/test actions. Generic on purpose — delivery-notes and sales (and any
// future report) all share the exact same shape, so this is the only place
// that shape's UI is implemented.
export default function ReportCard({ reportType, icon, title, description, periodNote, config }) {
  const [open, setOpen] = useState(!!config.enabled);
  const [enabled, setEnabled] = useState(!!config.enabled);
  const [recipients, setRecipients] = useState(parseRecipients(config.recipients));
  const [frequency, setFrequency] = useState(config.frequency);
  const [time, setTime] = useState(config.time);
  const [weekday, setWeekday] = useState(config.weekday);
  const [dayOfMonth, setDayOfMonth] = useState(config.day_of_month);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState(null); // { ok, message }

  const scheduleFieldChange = (patch) => {
    if ('frequency' in patch) setFrequency(patch.frequency);
    if ('time' in patch) setTime(patch.time);
    if ('weekday' in patch) setWeekday(patch.weekday);
    if ('dayOfMonth' in patch) setDayOfMonth(patch.dayOfMonth);
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await saveReportConfig(reportType, {
        enabled,
        recipients: recipients.join(", "),
        frequency,
        time,
        weekday: Number(weekday),
        day_of_month: Number(dayOfMonth),
      });
      setStatus({ ok: true, message: "ההגדרות נשמרו" });
      toast.success(`הגדרות ${title} נשמרו`);
    } catch (err) {
      setStatus({ ok: false, message: err?.message || "שגיאה בשמירה" });
      toast.error(err?.message || "שגיאה בשמירה");
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const result = await sendReportTest(reportType);
      setStatus({ ok: true, message: `נשלח בהצלחה (${result.count})` });
      toast.success(`דוח ${title} נשלח`);
    } catch (err) {
      setStatus({ ok: false, message: err?.message || "שליחת הבדיקה נכשלה" });
      toast.error(err?.message || "שליחת הבדיקה נכשלה");
    }
    setTesting(false);
  };

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow duration-300">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full text-right">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                {icon}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-semibold">{title}</CardTitle>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      enabled ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {enabled ? "פעיל" : "כבוי"}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
              </div>
            </div>
            <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform shrink-0 ${open ? "" : "-rotate-90"}`} />
          </div>
        </CardHeader>
      </button>

      {open && (
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-700">שליחה מתוזמנת</div>
              <p className="text-xs text-muted-foreground mt-0.5">כשכבוי, הדוח אפשר לשלוח רק ידנית עם כפתור הבדיקה למטה.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <RecipientsEditor recipients={recipients} onChange={setRecipients} />

          <ScheduleFields
            frequency={frequency}
            time={time}
            weekday={weekday}
            dayOfMonth={dayOfMonth}
            onChange={scheduleFieldChange}
          />

          {periodNote && <p className="text-xs text-muted-foreground">{periodNote}</p>}

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
              {testing ? "שולח..." : "שלח עכשיו לבדיקה"}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
