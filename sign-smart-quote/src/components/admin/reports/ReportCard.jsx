import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, Plus } from "lucide-react";
import ScheduleEditor from "./ScheduleEditor";

// One card = one report type, holding however many independent schedules it
// has (a daily digest AND a monthly rollup of the same report are two
// separate ScheduleEditor rows, not one config overwriting the other — see
// the plan this replaced). Generic on purpose — delivery-notes, sales, and
// any future report type all share this exact shape.
export default function ReportCard({ reportType, icon, title, description, periodNote, schedules: initialSchedules }) {
  const [open, setOpen] = useState(initialSchedules.length > 0);
  const [schedules, setSchedules] = useState(initialSchedules);
  // Local-only placeholder ids for not-yet-saved rows, so React has a stable
  // key before the server assigns a real one.
  const [newRowKeys, setNewRowKeys] = useState([]);

  const activeCount = schedules.filter((s) => s.enabled).length;

  const addSchedule = () => setNewRowKeys((prev) => [...prev, `new-${Date.now()}-${prev.length}`]);

  const handleSaved = (newRowKey, saved) => {
    if (newRowKey) setNewRowKeys((prev) => prev.filter((k) => k !== newRowKey));
    setSchedules((prev) => {
      const exists = prev.some((s) => s.id === saved.id);
      return exists ? prev.map((s) => (s.id === saved.id ? saved : s)) : [...prev, saved];
    });
  };

  const handleRemoved = (newRowKey, id) => {
    if (newRowKey) setNewRowKeys((prev) => prev.filter((k) => k !== newRowKey));
    if (id) setSchedules((prev) => prev.filter((s) => s.id !== id));
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
                      activeCount > 0 ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {schedules.length === 0
                      ? "אין תזמונים"
                      : `${schedules.length} תזמונים, ${activeCount} פעילים`}
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
        <CardContent className="space-y-3">
          {periodNote && <p className="text-xs text-muted-foreground">{periodNote}</p>}

          {schedules.map((schedule) => (
            <ScheduleEditor
              key={schedule.id}
              reportType={reportType}
              schedule={schedule}
              onSaved={(saved) => handleSaved(null, saved)}
              onRemoved={() => handleRemoved(null, schedule.id)}
            />
          ))}

          {newRowKeys.map((key) => (
            <ScheduleEditor
              key={key}
              reportType={reportType}
              schedule={null}
              onSaved={(saved) => handleSaved(key, saved)}
              onRemoved={() => handleRemoved(key, null)}
            />
          ))}

          <button
            type="button"
            onClick={addSchedule}
            className="w-full flex items-center justify-center gap-1.5 text-sm text-slate-500 hover:text-amber-600 border-2 border-dashed border-slate-200 hover:border-amber-300 rounded-xl py-2.5 transition-colors"
          >
            <Plus className="w-4 h-4" /> הוסף תזמון
          </button>
        </CardContent>
      )}
    </Card>
  );
}
