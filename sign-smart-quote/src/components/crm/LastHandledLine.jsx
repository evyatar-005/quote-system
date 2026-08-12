import { UserRound } from "lucide-react";

// Coarse "how long ago" — SQLite hands back 'YYYY-MM-DD HH:MM:SS' in UTC, so
// normalize to ISO before parsing or it reads as local and shows negative ages.
function timeAgo(ts) {
  if (!ts) return "";
  const then = new Date(ts.replace(" ", "T") + "Z").getTime();
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

// "טופל לאחרונה ע״י ..." — fed by leadContext.js's 4-level fallback chain
// (live lock → last closed handling span → last outbound message → lead
// handling span), so it's rarely blank even with thin conversation history.
export default function LastHandledLine({ lastHandled }) {
  if (!lastHandled?.full_name) return null;
  return (
    <div className="text-[11px] text-slate-400 flex items-center gap-1 truncate">
      <UserRound className="w-3 h-3 shrink-0" />
      <span className="truncate">טופל לאחרונה ע״י {lastHandled.full_name}{lastHandled.at ? ` · ${timeAgo(lastHandled.at)}` : ""}</span>
    </div>
  );
}
