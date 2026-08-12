import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Loader2, MessageSquare, FileText, Users, Inbox, ChevronDown, ChevronUp, ArrowRight,
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { myDay } from "@/api/myDayClient";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import AgentSidebar from "@/components/layout/AgentSidebar";
import NotificationBell from "@/components/NotificationBell";
import PullLeadButton from "@/components/crm/PullLeadButton";
import FollowUpPopup from "@/components/crm/FollowUpPopup";
import LeadWorkspacePanel from "@/components/crm/LeadWorkspacePanel";
import LeadSwitcher from "@/components/crm/LeadSwitcher";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";

const REFRESH_MS = 60 * 1000;

// "היום שלי" — the sales agent's home screen. "משוך ליד" is the only way
// into the lead pool (agents don't browse it). A due follow-up interrupts
// with a pop-up (FollowUpPopup, driven by due_follow_ups) the instant its
// scheduled date+time arrives, instead of sitting in a list. "ממתין
// לתשובה" is a click-to-expand panel, not a standing column — see
// waiting_unread (unread_count > 0, reset the moment a thread is opened).
export default function MyDay() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showWaiting, setShowWaiting] = useState(false);
  // Opening a lead no longer navigates to a separate page — the whole
  // workspace (thread + fields + drive + actions) opens IN PLACE of the
  // tile row/lists, right here on "היום שלי" (per direct feedback: the
  // agent shouldn't have to leave this screen to work a lead).
  const [openLeadId, setOpenLeadId] = useState(null);
  const Sidebar = user?.role === "agent" ? AgentSidebar : ManagerSidebar;

  const load = useCallback(async () => {
    try {
      setData(await myDay.get());
    } catch (err) {
      toast.error(err.message || "טעינת המסך נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const { counts, settings } = data;
  const firstName = (user?.full_name || user?.username || "").trim().split(/\s+/)[0];

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl">
        <div className="flex pl-4 sm:pl-6 pr-16 sm:pr-24 pt-3">
          <div className="inline-flex items-center gap-2.5 border-b border-black pb-2.5">
            <img src={printellaLogo} alt="Printella" className="h-14 object-contain" />
            <div>
              <h1 className="text-base font-bold leading-tight">היום שלי</h1>
              {firstName && <span className="text-xs text-slate-500">{firstName}</span>}
            </div>
            <NotificationBell />
          </div>
        </div>
      </div>

      <div className="w-full mx-auto px-4 sm:px-8 pt-3 pb-8 flex flex-col lg:flex-row gap-8 items-start">
        <Sidebar />
        <div className="flex-1 min-w-0 w-full space-y-2">
          {openLeadId ? (
            <>
              {/* A lead is open — the workspace takes over this whole
                  content area (per feedback: don't leave "היום שלי" to
                  work a lead). Everything above (tiles/lists) is hidden
                  while open, not just collapsed, so it reads as one screen. */}
              <div className="flex items-center justify-between gap-2 pb-1">
                <button
                  type="button"
                  onClick={() => { setOpenLeadId(null); load(); }}
                  className="text-xs text-slate-500 hover:text-primary flex items-center gap-1"
                >
                  <ArrowRight className="w-3.5 h-3.5" /> חזרה לרשימה
                </button>
                <LeadSwitcher leadId={openLeadId} />
              </div>
              <LeadWorkspacePanel
                leadId={openLeadId}
                onChanged={() => { setOpenLeadId(null); load(); }}
              />
            </>
          ) : (
            <>
              {/* One compact row — pull CTA + the three counters, all the same
                  size, side by side (was a big hero banner + a separate 2-col
                  grid; compressed per direct feedback). */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <div className="border border-black rounded-xl bg-primary/5 px-3 py-2 flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Inbox className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold truncate">{firstName ? `היי ${firstName}!` : "ליד הבא"}</div>
                    <PullLeadButton slotsUsed={counts.my_leads} slotsMax={settings.max_claimed_leads} onClaimed={() => load()} />
                  </div>
                </div>

                <StatTile icon={Users} label={`הלידים שלי (${counts.my_leads}/${settings.max_claimed_leads})`} value={counts.my_leads} tone="primary" href="#my-leads" />

                <StatTile
                  icon={MessageSquare}
                  label="ממתינים לתשובה"
                  value={counts.waiting_unread}
                  tone={counts.waiting_unread > 0 ? "amber" : "slate"}
                  onClick={() => setShowWaiting((v) => !v)}
                  trailingIcon={showWaiting ? ChevronUp : ChevronDown}
                />

                <StatTile
                  icon={FileText}
                  label="הצעות לאישור מנהל"
                  value={counts.pending_quotes}
                  tone="slate"
                  href="/my-quotes"
                  isRoute
                  title="הצעות שנשלחו וממתינות לאישור/דחייה של מנהל מכירות"
                />
              </div>

              {/* Click-to-expand panel for "ממתינים לתשובה" — not a standing
                  column, opens in place right under the tile row. */}
              {showWaiting && (
                <div className="border border-black rounded-xl bg-white">
                  <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-slate-500" />
                    <span className="font-semibold text-sm">ממתינים לתשובה</span>
                    <span className="text-xs text-slate-400">{counts.waiting_unread}</span>
                  </div>
                  <div className="p-2 space-y-2 max-h-[50vh] overflow-y-auto">
                    {counts.waiting_unread === 0 ? (
                      <div className="text-center py-6 text-xs text-slate-400">אין הודעות שלא נקראו</div>
                    ) : (
                      data.waiting_unread.map((c) => (
                        <Card key={c.id} onClick={() => navigate("/crm/inbox")} clickable>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-sm truncate">{c.display_name || c.phone_e164}</span>
                            <span className="text-xs shrink-0 bg-amber-100 text-amber-700 rounded-full px-1.5">{c.unread_count}</span>
                          </div>
                          {c.last_message && <div className="text-xs text-slate-500 line-clamp-2">{c.last_message}</div>}
                        </Card>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Compact "הלידים שלי" — one tight row per lead, opens inline. */}
              <div className="grid grid-cols-1 items-start">
                <Column
                  id="my-leads"
                  title="הלידים שלי"
                  icon={Users}
                  count={counts.my_leads}
                  empty="לא משכת לידים עדיין — לחץ למעלה על ״משוך ליד״"
                >
                  {data.my_leads.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setOpenLeadId(l.id)}
                      className="w-full text-right flex items-center gap-2 px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-100 transition-colors"
                    >
                      <span className="font-semibold text-xs truncate flex-1">{l.display_name}</span>
                      {l.phone_e164 && <span className="text-[11px] text-slate-400 shrink-0" dir="ltr">{l.phone_e164}</span>}
                      {l.campaign_name && <span className="text-[11px] text-slate-400 shrink-0 hidden sm:inline">· {l.campaign_name}</span>}
                    </button>
                  ))}
                </Column>
              </div>
            </>
          )}
        </div>
      </div>

      <FollowUpPopup dueFollowUps={data.due_follow_ups} onHandled={load} />
    </div>
  );
}


const TONES = {
  primary: "bg-primary/10 text-primary",
  amber: "bg-amber-50 text-amber-600",
  red: "bg-red-50 text-red-600",
  rose: "bg-rose-50 text-rose-600",
  slate: "bg-slate-100 text-slate-600",
};

// Renders as a <button> when `onClick` is given (e.g. the click-to-expand
// "ממתינים לתשובה" tile), a route <Link> when `isRoute`, or a plain anchor
// otherwise — same compact card in all three cases.
function StatTile({ icon: Icon, label, value, tone, href, isRoute, onClick, trailingIcon: Trailing, title }) {
  const inner = (
    <div className="border border-black rounded-xl bg-white px-3 py-2 flex items-center gap-2.5 hover:bg-slate-50 transition-colors h-full">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${TONES[tone]}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xl font-bold leading-none">{value}</div>
        <div className="text-xs text-slate-500 mt-0.5 truncate">{label}</div>
      </div>
      {Trailing && <Trailing className="w-4 h-4 text-slate-400 shrink-0" />}
    </div>
  );
  if (onClick) return <button type="button" onClick={onClick} title={title} className="text-right">{inner}</button>;
  return isRoute ? <Link to={href} title={title}>{inner}</Link> : <a href={href} title={title}>{inner}</a>;
}

function Column({ id, title, icon: Icon, count, empty, children, tone, headerExtra, wide }) {
  return (
    <div id={id} className={`border border-black rounded-xl bg-white flex flex-col ${wide ? "xl:col-span-3" : ""}`}>
      <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
        <Icon className={`w-4 h-4 ${tone === "red" ? "text-red-500" : "text-slate-500"}`} />
        <span className="font-semibold text-sm">{title}</span>
        <span className="text-xs text-slate-400">{count}</span>
        {headerExtra && <div className="mr-auto">{headerExtra}</div>}
      </div>
      <div className="p-2 space-y-2 max-h-[65vh] overflow-y-auto">
        {count === 0 ? <div className="text-center py-8 text-xs text-slate-400">{empty}</div> : children}
      </div>
    </div>
  );
}

function Card({ children, onClick, clickable }) {
  return (
    <div
      onClick={onClick}
      className={`border border-slate-200 rounded-lg p-2 space-y-1 bg-slate-50/50 ${clickable ? "cursor-pointer hover:bg-slate-100" : ""}`}
    >
      {children}
    </div>
  );
}
