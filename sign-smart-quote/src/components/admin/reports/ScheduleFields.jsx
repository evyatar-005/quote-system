import { Input } from "@/components/ui/input";

const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// Frequency + time-of-day (+ weekday/day-of-month, shown only when relevant)
// — shared by every report card.
export default function ScheduleFields({ frequency, time, weekday, dayOfMonth, daysOfWeek, onChange }) {
  const toggleDay = (day) => {
    // Empty/missing daysOfWeek means "every day" — expand that to an
    // explicit list first, so unchecking one day doesn't collapse back to
    // "every day" being interpreted as "only this day".
    const current = Array.isArray(daysOfWeek) && daysOfWeek.length ? daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    onChange({ daysOfWeek: next });
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-semibold text-slate-600">תדירות</label>
        <select
          value={frequency}
          onChange={(e) => onChange({ frequency: e.target.value })}
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
          value={time}
          onChange={(e) => onChange({ time: e.target.value })}
        />
      </div>
      {frequency === "daily" && (
        <div className="space-y-1.5 sm:col-span-3">
          <label className="text-sm font-semibold text-slate-600">ימים לשליחה</label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((label, i) => {
              const active = !Array.isArray(daysOfWeek) || daysOfWeek.length === 0 || daysOfWeek.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`px-3 h-8 rounded-lg text-sm border transition-colors ${
                    active
                      ? "bg-[#C9A84C]/20 border-[#C9A84C] text-slate-800"
                      : "bg-white border-slate-200 text-slate-400"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">כל הימים מסומנים כברירת מחדל — הסר יום כדי לדלג עליו (למשל שישי/שבת).</p>
        </div>
      )}
      {frequency === "weekly" && (
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">יום בשבוע</label>
          <select
            value={weekday}
            onChange={(e) => onChange({ weekday: Number(e.target.value) })}
            className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            {WEEKDAY_LABELS.map((label, i) => (
              <option key={i} value={i}>{label}</option>
            ))}
          </select>
        </div>
      )}
      {frequency === "monthly" && (
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">יום בחודש</label>
          <Input
            type="number"
            dir="ltr"
            min={1}
            max={31}
            value={dayOfMonth}
            onChange={(e) => onChange({ dayOfMonth: Number(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">בחודשים קצרים יותר (כמו פברואר) יישלח ביום האחרון של החודש.</p>
        </div>
      )}
    </div>
  );
}
