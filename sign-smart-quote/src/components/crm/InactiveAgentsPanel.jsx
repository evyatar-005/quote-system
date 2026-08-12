import { UserX, CalendarClock, Briefcase } from "lucide-react";
import { Link } from "react-router-dom";

// Manager-only strip on "היום שלי": agents who haven't logged in today but do
// have work waiting on them (a follow-up due today, or leads still holding
// slots). Without it, an absent agent's callbacks simply never happen and
// nobody finds out — the follow-up pop-up only fires on that agent's own
// screen. "Not active today" = no session row created today (see
// routes/myDay.js — there is no last_login column; sessions are the signal).
// Agents with nothing pending are filtered out server-side: absence only
// matters here when work is stuck behind it.
export default function InactiveAgentsPanel({ agents = [] }) {
  if (agents.length === 0) return null;

  return (
    <div className="border border-black rounded-xl bg-white">
      <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
        <UserX className="w-4 h-4 text-red-500" />
        <span className="font-semibold text-sm">סוכנים שלא נכנסו היום</span>
        <span className="text-xs text-slate-400">{agents.length}</span>
        <span className="text-[11px] text-slate-400 mr-auto hidden sm:inline">משימות שממתינות להם</span>
      </div>
      <div className="p-2 space-y-1.5">
        {agents.map((a) => (
          <div
            key={a.username}
            className="flex items-center gap-2 flex-wrap px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50/50"
          >
            <span className="font-semibold text-xs">{a.full_name || a.username}</span>
            {a.due_today > 0 && (
              <span className="text-[11px] rounded-full px-2 py-0.5 bg-red-50 text-red-600 flex items-center gap-1">
                <CalendarClock className="w-3 h-3" /> {a.due_today} פולואפים להיום
              </span>
            )}
            {a.open_slots > 0 && (
              <span className="text-[11px] rounded-full px-2 py-0.5 bg-slate-100 text-slate-600 flex items-center gap-1">
                <Briefcase className="w-3 h-3" /> {a.open_slots} לידים בטיפול
              </span>
            )}
            {/* The manager's existing tool for taking work off an agent —
                force-release / reassign lives on the lead-pool screen. */}
            <Link
              to="/crm/campaigns-overview?tab=leads"
              className="text-[11px] text-primary hover:underline mr-auto"
            >
              העבר לסוכן אחר
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
