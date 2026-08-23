import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, Send, Trash2, ChevronDown, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { createSchedule, updateSchedule, deleteSchedule, sendReportTest } from "@/api/reportsClient";
import RecipientsEditor, { parseRecipients } from "./RecipientsEditor";
import ScheduleFields from "./ScheduleFields";

const FREQUENCY_LABELS = { daily: "יומי", weekly: "שבועי", monthly: "חודשי" };
const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function summarize(s) {
  const freq = FREQUENCY_LABELS[s.frequency] || s.frequency;
  if (s.frequency === "weekly") return `${freq}, ${WEEKDAY_LABELS[s.weekday]} ${s.time}`;
  if (s.frequency === "monthly") return `${freq}, ${s.dayOfMonth} לחודש ${s.time}`;
  if (s.frequency === "daily" && Array.isArray(s.daysOfWeek) && s.daysOfWeek.length && s.daysOfWeek.length < 7) {
    const days = [...s.daysOfWeek].sort().map((d) => WEEKDAY_LABELS[d]).join("׳, ");
    return `${freq} (${days}), ${s.time}`;
  }
  return `${freq}, ${s.time}`;
}

function parseDaysOfWeek(raw) {
  if (!raw) return [];
  return String(raw).split(",").map(Number).filter((n) => !Number.isNaN(n));
}

// Coarse relative time in Hebrew — this only needs to answer "did this run
// recently or has it been suspiciously long", not be a precise countdown.
function relativeTime(isoString) {
  // SQLite's CURRENT_TIMESTAMP is UTC but space-separated ("YYYY-MM-DD
  // HH:MM:SS"), not real ISO-8601 — normalize only that shape; a value we
  // set ourselves via `new Date().toISOString()` already has a trailing Z
  // and must be left alone.
  const normalized = isoString.endsWith('Z') ? isoString : `${isoString.replace(' ', 'T')}Z`;
  const then = new Date(normalized);
  const minutes = Math.round((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.round(hours / 24);
  return `לפני ${days} ימים`;
}

// One schedule = one row: a collapsed summary line by default, expanding to
// the full recipients/frequency editor. `schedule === null` means this is a
// brand-new, not-yet-saved row (starts expanded; "cancel" just removes it
// from the list instead of deleting anything server-side).
export default function ScheduleEditor({ reportType, schedule, onSaved, onRemoved }) {
  const isNew = !schedule;
  const [open, setOpen] = useState(isNew);
  const [enabled, setEnabled] = useState(schedule ? !!schedule.enabled : true);
  const [recipients, setRecipients] = useState(parseRecipients(schedule?.recipients));
  const [frequency, setFrequency] = useState(schedule?.frequency || "daily");
  const [time, setTime] = useState(schedule?.time || "17:00");
  const [weekday, setWeekday] = useState(schedule?.weekday ?? 0);
  const [dayOfMonth, setDayOfMonth] = useState(schedule?.day_of_month ?? 1);
  const [daysOfWeek, setDaysOfWeek] = useState(parseDaysOfWeek(schedule?.days_of_week));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Local mirror of last_sent_at/last_run_status/last_run_error, updated
  // in-place after a manual test so the row reflects it immediately instead
  // of only after a full page reload — see runAndRecord on the backend.
  const [lastSentAt, setLastSentAt] = useState(schedule?.last_sent_at || null);
  const [lastRunStatus, setLastRunStatus] = useState(schedule?.last_run_status || null);
  const [lastRunError, setLastRunError] = useState(schedule?.last_run_error || null);

  const scheduleFieldChange = (patch) => {
    if ("frequency" in patch) setFrequency(patch.frequency);
    if ("time" in patch) setTime(patch.time);
    if ("weekday" in patch) setWeekday(patch.weekday);
    if ("dayOfMonth" in patch) setDayOfMonth(patch.dayOfMonth);
    if ("daysOfWeek" in patch) setDaysOfWeek(patch.daysOfWeek);
  };

  const payload = () => ({
    enabled,
    recipients: recipients.join(", "),
    frequency,
    time,
    weekday: Number(weekday),
    day_of_month: Number(dayOfMonth),
    days_of_week: frequency === "daily" ? daysOfWeek : [],
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = isNew
        ? await createSchedule(reportType, payload())
        : await updateSchedule(reportType, schedule.id, payload());
      toast.success("התזמון נשמר");
      setOpen(false);
      onSaved(saved);
    } catch (err) {
      toast.error(err?.message || "שגיאה בשמירת התזמון");
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await sendReportTest(reportType, schedule.id);
      toast.success(`נשלח בהצלחה (${result.count})`);
      setLastSentAt(new Date().toISOString());
      setLastRunStatus("success");
      setLastRunError(null);
    } catch (err) {
      toast.error(err?.message || "שליחת הבדיקה נכשלה");
      setLastRunStatus("error");
      setLastRunError(err?.message || "שליחת הבדיקה נכשלה");
    }
    setTesting(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteSchedule(reportType, schedule.id);
      toast.success("התזמון נמחק");
      onRemoved(schedule.id);
    } catch (err) {
      toast.error(err?.message || "מחיקת התזמון נכשלה");
      setDeleting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-3 bg-slate-50 hover:bg-slate-100 rounded-xl px-4 py-3 text-right transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${enabled ? "bg-emerald-500" : "bg-slate-300"}`} />
          <span className="text-sm font-semibold text-slate-700">{summarize({ frequency, time, weekday, dayOfMonth, daysOfWeek })}</span>
          <span className="text-xs text-slate-400 truncate">{recipients.length ? `${recipients.length} נמענים` : "אין נמענים"}</span>
          {lastRunStatus === "error" ? (
            <span className="flex items-center gap-1 text-xs text-red-500 shrink-0">
              <AlertCircle className="w-3.5 h-3.5" /> השליחה האחרונה נכשלה
            </span>
          ) : lastSentAt ? (
            <span className="flex items-center gap-1 text-xs text-emerald-600 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" /> נשלח {relativeTime(lastSentAt)}
            </span>
          ) : (
            <span className="text-xs text-slate-400 shrink-0">עדיין לא נשלח</span>
          )}
        </div>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 -rotate-90" />
      </button>
    );
  }

  return (
    <div className="border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setOpen(false)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ChevronDown className="w-4 h-4" /> כיווץ
        </button>
        {isNew ? (
          <button type="button" onClick={() => onRemoved(null)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500">
            <X className="w-3.5 h-3.5" /> ביטול
          </button>
        ) : (
          <button type="button" onClick={handleDelete} disabled={deleting} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 disabled:opacity-50">
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} מחק תזמון
          </button>
        )}
      </div>

      <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
        <div className="text-sm font-semibold text-slate-700">{enabled ? "תזמון פעיל" : "תזמון כבוי"}</div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      {lastRunStatus === "error" && lastRunError && (
        <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>השליחה האחרונה נכשלה: {lastRunError}</span>
        </div>
      )}

      <RecipientsEditor recipients={recipients} onChange={setRecipients} />

      <ScheduleFields frequency={frequency} time={time} weekday={weekday} dayOfMonth={dayOfMonth} daysOfWeek={daysOfWeek} onChange={scheduleFieldChange} />

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "שומר..." : "שמור"}
        </Button>
        {!isNew && (
          <Button onClick={handleTest} disabled={testing} variant="outline" className="gap-2">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {testing ? "שולח..." : "שלח עכשיו לבדיקה"}
          </Button>
        )}
      </div>
    </div>
  );
}
