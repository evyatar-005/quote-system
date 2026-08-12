import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Loader2, FileText, Inbox } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { myDay } from "@/api/myDayClient";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import AgentSidebar from "@/components/layout/AgentSidebar";
import NotificationBell from "@/components/NotificationBell";
import PullLeadButton from "@/components/crm/PullLeadButton";
import FollowUpPopup from "@/components/crm/FollowUpPopup";
import LeadWorkspacePanel from "@/components/crm/LeadWorkspacePanel";
import LeadRail from "@/components/crm/LeadRail";
import InactiveAgentsPanel from "@/components/crm/InactiveAgentsPanel";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";

const REFRESH_MS = 60 * 1000;

// "היום שלי" — the sales agent's home screen, built as a WORK QUEUE rather
// than a dashboard: LeadQueue ranks every claimed lead by urgency and each row
// states the stage, the wait, and the next action, so the agent never has to
// open leads one by one to find out where they stand (ranking: lib/leadPriority).
// "משוך ליד" is still the only way into the lead pool (agents don't browse it),
// and a due follow-up still interrupts with FollowUpPopup the instant its
// scheduled date+time arrives.
export default function MyDay() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
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
          {/* One dense line, no card: pull CTA + slot meter + the two secondary
              destinations as plain links. Stays visible with a lead open — it's
              two lines tall and the agent shouldn't lose the slot meter just
              because they're working someone. */}
          <div className="flex items-center gap-3 flex-wrap px-1 py-0.5">
            {/* slots_used, NOT my_leads — the rail also lists leads the agent
                owns without holding a slot (a scheduled follow-up frees the
                slot but keeps the lead). */}
            <PullLeadButton slotsUsed={counts.slots_used} slotsMax={settings.max_claimed_leads} onClaimed={() => load()} />

            <SlotMeter used={counts.slots_used} max={settings.max_claimed_leads} />

            {/* No "תיבת הודעות" link here: every lead's WhatsApp thread lives
                inside the lead workspace and unread messages already show as a
                badge on the rail, so the shared inbox only covers conversations
                that aren't a lead of this agent at all — a rare case that the
                permanent sidebar's "תיבת שיחות" entry already links to. */}
            <div className="flex items-center gap-3 mr-auto shrink-0">
              <Link
                to="/my-quotes"
                title="הצעות שנשלחו וממתינות לאישור/דחייה של מנהל מכירות"
                className="text-[11px] text-slate-500 hover:text-primary flex items-center gap-1"
              >
                <FileText className="w-3 h-3" /> הצעות לאישור
                {counts.pending_quotes > 0 && (
                  <span className="bg-slate-200 text-slate-700 rounded-full px-1.5">{counts.pending_quotes}</span>
                )}
              </Link>
            </div>
          </div>

          <InactiveAgentsPanel agents={data.inactive_agents || []} />

          {/* Rail + workspace side by side. The rail is permanent, so moving
              between leads is one click and never goes back through a list —
              which is also why LeadSwitcher's ‹ prev/next › isn't here. */}
          <div className="flex flex-col lg:flex-row gap-3 items-start">
            <LeadRail
              leads={data.my_leads}
              openLeadId={openLeadId}
              onOpen={setOpenLeadId}
              onChanged={load}
            />

            <div className="flex-1 min-w-0 w-full">
              {openLeadId ? (
                <LeadWorkspacePanel
                  leadId={openLeadId}
                  onChanged={() => { setOpenLeadId(null); load(); }}
                />
              ) : (
                <div className="border border-black rounded-xl bg-white px-6 py-14 text-center space-y-2">
                  <Inbox className="w-8 h-8 text-slate-300 mx-auto" />
                  <div className="font-semibold text-sm">
                    {counts.my_leads === 0 ? "אין לך לידים פתוחים" : "בחר ליד מהרשימה"}
                  </div>
                  <p className="text-xs text-slate-500">
                    {counts.my_leads === 0
                      ? "לחץ על ״מלא תיבה״ למעלה כדי לקבל את הלידים הבאים בתור"
                      : "לחץ על שם ליד כדי לראות פרטים, ועל ״פתח״ כדי לעבוד עליו"}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <FollowUpPopup dueFollowUps={data.due_follow_ups} onHandled={load} />
    </div>
  );
}


// Claimed-lead slots as filled/empty pips — "3/5" as a number never made it
// obvious how much room was left before "משוך ליד" starts refusing.
function SlotMeter({ used, max }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0" title={`${used} מתוך ${max} משבצות בשימוש`}>
      <div className="flex items-center gap-1">
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={`w-1.5 h-4 rounded-full ${i < used ? "bg-primary" : "bg-slate-200"}`} />
        ))}
      </div>
      <span className="text-[11px] text-slate-500">{used}/{max}</span>
    </div>
  );
}
