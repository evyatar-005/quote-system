import { useState, useEffect } from "react";
import { ChevronDown, MoreHorizontal, XCircle, LogOut, Timer } from "lucide-react";
import { crmLeads } from "@/api/crmClient";
import { leadQueue } from "@/api/leadQueueClient";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { rankLeads, groupRanked, relativeTime, followUpCountdown } from "@/lib/leadPriority";
import { toast } from "sonner";

const TONE_DOT = {
  red: "bg-red-500",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  slate: "bg-slate-300",
};

const TONE_BADGE = {
  red: "bg-red-50 text-red-600",
  amber: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-600",
  slate: "bg-slate-100 text-slate-600",
};

// The agent's leads as a permanent full-height rail: name only, ordered and
// grouped by urgency (lib/leadPriority), with a live countdown on anything with
// a scheduled follow-up and an unread badge when the customer has written.
// Clicking a name SWITCHES to that lead immediately — the rail is a lead
// switcher first (which is why MyDay no longer needs LeadSwitcher); the chevron
// is the way to peek at details without leaving the lead currently open.
export default function LeadRail({ leads, openLeadId, onOpen, onChanged }) {
  // One ticker for the whole rail rather than an interval per row. It also
  // re-ranks on every tick, so a lead crossing its follow-up time moves itself
  // up into "דורש טיפול עכשיו" without waiting for MyDay's 60s refetch.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const ranked = rankLeads(leads, now);
  const groups = groupRanked(ranked);
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="border border-black rounded-xl bg-white overflow-hidden w-full lg:w-60 shrink-0 flex flex-col lg:h-[calc(100vh-9rem)]">
      <div className="px-2.5 py-1.5 bg-slate-100 border-b border-slate-300 flex items-center gap-2 shrink-0">
        <span className="text-[11px] font-bold text-slate-800">הלידים שלי</span>
        <span className="text-[11px] text-slate-500">{ranked.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="px-2.5 py-0.5 bg-slate-50 border-y border-slate-100 text-[10px] font-bold text-slate-500">
              {g.title} <span className="font-normal text-slate-400">{g.leads.length}</span>
            </div>
            {g.leads.map((lead) => (
              <RailRow
                key={lead.id}
                lead={lead}
                now={now}
                active={lead.id === openLeadId}
                expanded={lead.id === expandedId}
                onToggle={() => setExpandedId((id) => (id === lead.id ? null : lead.id))}
                onOpen={onOpen}
                onChanged={onChanged}
              />
            ))}
          </div>
        ))}
        {ranked.length === 0 && (
          <div className="px-2.5 py-6 text-center text-[11px] text-slate-400">אין לידים פתוחים</div>
        )}
      </div>
    </div>
  );
}

function RailRow({ lead, now, active, expanded, onToggle, onOpen, onChanged }) {
  const [busy, setBusy] = useState(false);
  const countdown = followUpCountdown(lead, now);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      onChanged();
    } catch (err) {
      toast.error(err.message || "הפעולה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`border-b border-slate-100 ${active ? "bg-primary/10" : ""}`}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => onOpen(lead.id)}
          className="flex-1 min-w-0 text-right px-2.5 py-1.5 flex items-center gap-2 hover:bg-slate-50"
          title="פתח את הליד"
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[lead.tone]}`} />
          <span className={`text-xs truncate flex-1 ${active ? "font-bold" : "font-semibold"}`}>{lead.display_name}</span>
          {lead.unread_count > 0 && (
            <span className="text-[10px] bg-amber-500 text-white rounded-full px-1.5 shrink-0">{lead.unread_count}</span>
          )}
        </button>
        {/* Separate hit area — expanding details must not cost the agent the
            lead they're currently working. */}
        <button
          type="button"
          onClick={onToggle}
          className="px-1.5 text-slate-400 hover:text-primary hover:bg-slate-50"
          title="פרטים"
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* The countdown sits on the collapsed row on purpose: "who do I owe a
          call to, and in how long" is the thing the agent scans this rail for. */}
      {countdown && (
        <div className="px-2.5 pb-1 -mt-0.5">
          <span
            className={`inline-flex items-center gap-1 text-[10px] rounded-full px-1.5 py-0.5 ${
              countdown.urgent ? "bg-amber-100 text-amber-700 font-semibold" : "bg-slate-100 text-slate-500"
            }`}
          >
            <Timer className="w-2.5 h-2.5" />
            <span className="tabular-nums" dir={countdown.text.includes(":") ? "ltr" : "rtl"}>{countdown.text}</span>
          </span>
        </div>
      )}

      {expanded && (
        <div className="px-2.5 pb-2 space-y-1.5 bg-slate-50/60">
          <div className={`inline-block text-[10px] rounded-full px-1.5 py-0.5 ${TONE_BADGE[lead.tone]}`}>{lead.badge}</div>
          {lead.phone_e164 && (
            <a href={`tel:${lead.phone_e164}`} className="block text-[11px] text-primary hover:underline w-fit" dir="ltr">
              {lead.phone_e164}
            </a>
          )}
          {lead.campaign_name && <div className="text-[11px] text-slate-500 truncate">{lead.campaign_name}</div>}
          {lead.last_message && <div className="text-[10px] text-slate-500 line-clamp-2">{lead.last_message}</div>}
          <div className="text-[10px] text-slate-400">{relativeTime(lead.last_message_at || lead.claimed_at)}</div>

          <div className="flex items-center gap-1 pt-0.5">
            <Button size="sm" className="h-6 px-2 text-[11px] flex-1" disabled={busy} onClick={() => onOpen(lead.id)}>
              פתח
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={busy}>
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" dir="rtl">
                <DropdownMenuItem
                  className="text-red-600 gap-1.5"
                  onSelect={() => run(() => crmLeads.update(lead.id, { status: "disqualified" }), "סומן כלא רלוונטי")}
                >
                  <XCircle className="w-4 h-4" /> לא רלוונטי
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-1.5"
                  onSelect={() => run(() => leadQueue.release(lead.id), "הליד שוחרר")}
                >
                  <LogOut className="w-4 h-4" /> שחרר ליד
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </div>
  );
}
