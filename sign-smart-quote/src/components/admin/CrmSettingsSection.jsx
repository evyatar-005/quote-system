import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { crmSettings } from "@/api/mondaySyncClient";
import OptOutList from "@/components/crm/OptOutList";
import CostSectionCard from "./CostSectionCard";

const DAY_LABELS = [
  { value: 0, label: "א׳" }, { value: 1, label: "ב׳" }, { value: 2, label: "ג׳" },
  { value: 3, label: "ד׳" }, { value: 4, label: "ה׳" }, { value: 5, label: "ו׳" }, { value: 6, label: "ש׳" },
];

// CRM Phase 4 admin settings — pacing/window/caps for wa_send_queue's bulk
// drainer, opt-out wording, and the opt-out register. Tunable BEFORE the
// first real דיוור (see CLAUDE.md CRM plan §9 build order).
export default function CrmSettingsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [s, setS] = useState(null);

  useEffect(() => {
    (async () => {
      try { setS(await crmSettings.get()); }
      catch { toast.error("טעינת הגדרות ה-CRM נכשלה"); }
      setLoading(false);
    })();
  }, []);

  const set = (patch) => setS((p) => ({ ...p, ...patch }));

  const toggleDay = (day) => {
    const days = (s.send_days || "").split(",").filter(Boolean).map(Number);
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
    set({ send_days: next.join(",") });
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await crmSettings.update({
        queue_min_delay_sec: Number(s.queue_min_delay_sec),
        queue_max_delay_sec: Number(s.queue_max_delay_sec),
        global_daily_send_cap: Number(s.global_daily_send_cap),
        send_window_start: s.send_window_start,
        send_window_end: s.send_window_end,
        send_days: s.send_days,
        auto_optout_keywords: s.auto_optout_keywords,
        optout_footer: s.optout_footer,
        optout_reply_text: s.optout_reply_text,
      });
      setS(updated);
      toast.success("ההגדרות נשמרו");
    } catch (err) {
      toast.error(err.message || "השמירה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !s) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const activeDays = (s.send_days || "").split(",").filter(Boolean).map(Number);

  return (
    <CostSectionCard
      icon={<MessagesSquare className="w-5 h-5" />}
      title="דיוור ווצאפ — קצב, חלון שעות והסרה"
      description="קביעת קצב שליחה, חלון שעות פעילות ומכסה יומית לתפוצות; טקסטי הסרה; רישום ההסרות"
      defaultOpen
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">השהיה מינימלית בין הודעות (שניות)</label>
          <Input type="number" min={5} value={s.queue_min_delay_sec} onChange={(e) => set({ queue_min_delay_sec: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">השהיה מקסימלית בין הודעות (שניות)</label>
          <Input type="number" min={5} value={s.queue_max_delay_sec} onChange={(e) => set({ queue_max_delay_sec: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">מכסה יומית גלובלית (כל הדיוורים יחד)</label>
          <Input type="number" min={1} value={s.global_daily_send_cap} onChange={(e) => set({ global_daily_send_cap: e.target.value })} />
          <p className="text-xs text-muted-foreground">מומלץ להתחיל נמוך (עד 50) בדיוורים הראשונים — סיכון חסימת המספר</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">חלון שעות פעילות</label>
          <div className="flex items-center gap-2">
            <Input type="time" dir="ltr" value={s.send_window_start} onChange={(e) => set({ send_window_start: e.target.value })} />
            <span className="text-slate-400">עד</span>
            <Input type="time" dir="ltr" value={s.send_window_end} onChange={(e) => set({ send_window_end: e.target.value })} />
          </div>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-sm font-semibold text-slate-600">ימי שליחה</label>
          <div className="flex items-center gap-2">
            {DAY_LABELS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                className={`w-9 h-9 rounded-full border-2 border-black text-sm font-medium transition-colors ${
                  activeDays.includes(d.value) ? "bg-primary text-primary-foreground" : "bg-background text-slate-600"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-sm font-semibold text-slate-600">מילות מפתח להסרה (מופרדות בפסיק)</label>
          <Input dir="rtl" value={s.auto_optout_keywords} onChange={(e) => set({ auto_optout_keywords: e.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-sm font-semibold text-slate-600">שורת הסרה (נוספת אוטומטית לדיוור שלא כוללת אחת)</label>
          <Input dir="rtl" value={s.optout_footer} onChange={(e) => set({ optout_footer: e.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-sm font-semibold text-slate-600">הודעת אישור הסרה (נשלחת מיד אחרי שהלקוח מסיר את עצמו)</label>
          <Textarea dir="rtl" rows={2} value={s.optout_reply_text} onChange={(e) => set({ optout_reply_text: e.target.value })} />
        </div>
      </div>

      <Button onClick={save} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? "שומר..." : "שמור"}
      </Button>

      <div className="border-t border-slate-200 pt-4 space-y-2">
        <p className="text-sm font-semibold text-slate-600">רשימת הסרות</p>
        <OptOutList />
      </div>
    </CostSectionCard>
  );
}
