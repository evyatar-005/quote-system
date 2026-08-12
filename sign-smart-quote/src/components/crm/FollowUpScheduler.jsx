import { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarClock, Loader2 } from "lucide-react";

function tomorrow9am() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return { date: d.toISOString().slice(0, 10), time: "09:00" };
}

// "קבע פולואפ" — a customer who asked for a callback at a specific hour
// needs that hour captured, not just "tomorrow" (see CLAUDE.md CRM plan
// Phase 5 follow-up: the pop-up reminder is only as precise as what's
// scheduled here). Leaving time blank schedules an all-day reminder
// (due at local midnight) instead of an exact-minute one.
export default function FollowUpScheduler({ onSchedule, disabled }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState(tomorrow9am);

  const confirm = async () => {
    if (!values.date) return;
    setBusy(true);
    try {
      const iso = values.time ? `${values.date} ${values.time}` : values.date;
      await onSchedule(iso);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={disabled}>
          <CalendarClock className="w-4 h-4" /> קבע פולואפ
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" dir="rtl">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600">תאריך</label>
          <Input type="date" dir="ltr" value={values.date} onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600">שעה (אופציונלי — הלקוח ביקש שעה מסוימת?)</label>
          <Input type="time" dir="ltr" value={values.time} onChange={(e) => setValues((v) => ({ ...v, time: e.target.value }))} />
        </div>
        <Button size="sm" className="w-full gap-1.5" disabled={busy || !values.date} onClick={confirm}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />}
          קבע פולואפ
        </Button>
      </PopoverContent>
    </Popover>
  );
}
