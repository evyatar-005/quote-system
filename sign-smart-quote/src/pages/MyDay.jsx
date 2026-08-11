import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Loader2, Sparkles, MessageSquare, CalendarClock, FileText,
  Phone, Calculator, Check, Clock, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { myDay } from "@/api/myDayClient";
import { crmLeads } from "@/api/crmClient";
import { Button } from "@/components/ui/button";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import AgentSidebar from "@/components/layout/AgentSidebar";
import NotificationBell from "@/components/NotificationBell";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";

const REFRESH_MS = 60 * 1000;

// "היום שלי" — the sales agent's home screen. Answers the four questions an
// agent opens the system to ask, in one screen: what came in for me, who is
// waiting on my reply, who did I promise to call back, and what happened to
// the quotes I sent. Every card is actionable — the point is to never make
// the agent go hunting through another screen to act on what they see here.
export default function MyDay() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
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

  // Opens the calculator pre-filled with this lead's client details, and
  // remembers the lead so the saved quote links back to it (and, for
  // monday-sourced leads, so the issued PDF lands on their board row).
  const buildQuote = (lead) => {
    navigate("/costs", {
      state: {
        sourceLeadId: lead.id,
        builderState: {
          clientName: lead.display_name || "",
          clientPhone: lead.phone_e164 || "",
          clientEmail: lead.email || "",
        },
      },
    });
  };

  const markContacted = async (leadId) => {
    try {
      await crmLeads.update(leadId, { status: "contacted" });
      toast.success("סומן כ״יצרנו קשר״");
      load();
    } catch (err) {
      toast.error(err.message || "העדכון נכשל");
    }
  };

  const snooze = async (leadId, days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    try {
      await myDay.setFollowUp(leadId, iso);
      toast.success(days === 1 ? "נדחה למחר" : `נדחה ב-${days} ימים`);
      load();
    } catch (err) {
      toast.error(err.message || "הדחייה נכשלה");
    }
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const { counts } = data;

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <img src={printellaLogo} alt="Printella" className="h-24 object-contain" />
          <div className="flex-1">
            <h1 className="text-lg font-bold">היום שלי</h1>
            {user?.full_name && <span className="text-sm text-slate-500">{user.full_name}</span>}
          </div>
          <NotificationBell />
        </div>
      </div>

      <div className="w-full mx-auto px-4 sm:px-8 py-8 flex flex-col lg:flex-row gap-8 items-start">
        <Sidebar />
        <div className="flex-1 min-w-0 w-full space-y-6">
          {/* Top strip — the four numbers, each a jump link to its column */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile icon={Sparkles} label="לידים חדשים" value={counts.new_leads} tone="primary" href="#new-leads" />
            <StatTile icon={MessageSquare} label="ממתין לתשובה" value={counts.waiting_replies} tone="amber" href="#waiting" />
            <StatTile icon={CalendarClock} label="פולואאפים להיום" value={counts.follow_ups} tone="rose" href="#followups" />
            <StatTile icon={FileText} label="הצעות שממתינות" value={counts.pending_quotes} tone="slate" href="/my-quotes" isRoute />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
            {/* 1 — new leads */}
            <Column id="new-leads" title="לידים חדשים" icon={Sparkles} count={counts.new_leads} empty="אין לידים חדשים ממתינים">
              {data.new_leads.map((l) => (
                <Card key={l.id}>
                  <Link to={`/crm/customers/${l.customer_id}`} className="font-semibold text-sm hover:text-primary block truncate">
                    {l.display_name}
                  </Link>
                  <div className="text-xs text-slate-400 flex flex-wrap gap-x-2">
                    {l.phone_e164 && <span dir="ltr">{l.phone_e164}</span>}
                    {l.campaign_name && <span>· {l.campaign_name}</span>}
                    <span>· {timeAgo(l.created_at)}</span>
                  </div>
                  <div className="flex gap-1.5 pt-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => navigate("/crm/inbox")}>
                      <MessageSquare className="w-3 h-3" /> שיחה
                    </Button>
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => buildQuote(l)}>
                      <Calculator className="w-3 h-3" /> בנה הצעה
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => markContacted(l.id)} title="סמן שיצרת קשר">
                      <Check className="w-3 h-3" />
                    </Button>
                  </div>
                </Card>
              ))}
            </Column>

            {/* 2 — waiting for my reply */}
            <Column id="waiting" title="ממתין לתשובה שלי" icon={MessageSquare} count={counts.waiting_replies} empty="אין הודעות שממתינות לך">
              {data.waiting_replies.map((c) => (
                <Card key={c.id} onClick={() => navigate("/crm/inbox")} clickable>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm truncate">{c.display_name || c.phone_e164}</span>
                    <span className={`text-xs shrink-0 flex items-center gap-1 ${c.hours_waiting >= 2 ? "text-red-500 font-semibold" : "text-slate-400"}`}>
                      <Clock className="w-3 h-3" />
                      {c.hours_waiting >= 1 ? `${c.hours_waiting} שע׳` : "עכשיו"}
                    </span>
                  </div>
                  {c.last_message && <div className="text-xs text-slate-500 line-clamp-2">{c.last_message}</div>}
                </Card>
              ))}
            </Column>

            {/* 3 — follow-ups due */}
            <Column id="followups" title="פולואאפים להיום" icon={CalendarClock} count={counts.follow_ups} empty="אין פולואאפים להיום">
              {data.follow_ups.map((l) => (
                <Card key={l.id}>
                  <div className="flex items-center justify-between gap-2">
                    <Link to={`/crm/customers/${l.customer_id}`} className="font-semibold text-sm hover:text-primary truncate">
                      {l.display_name}
                    </Link>
                    {l.is_overdue ? (
                      <span className="text-xs text-red-500 font-semibold shrink-0 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> באיחור
                      </span>
                    ) : (
                      <span className="text-xs text-emerald-600 shrink-0">היום</span>
                    )}
                  </div>
                  {l.phone_e164 && <div className="text-xs text-slate-400" dir="ltr">{l.phone_e164}</div>}
                  <div className="flex gap-1.5 pt-1">
                    {l.phone_e164 && (
                      <a href={`tel:${l.phone_e164}`}>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><Phone className="w-3 h-3" /> חייג</Button>
                      </a>
                    )}
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => buildQuote(l)}>
                      <Calculator className="w-3 h-3" /> בנה הצעה
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => snooze(l.id, 1)}>דחה למחר</Button>
                  </div>
                </Card>
              ))}
            </Column>
          </div>
        </div>
      </div>
    </div>
  );
}

const TONES = {
  primary: "bg-primary/10 text-primary",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
  slate: "bg-slate-100 text-slate-600",
};

function StatTile({ icon: Icon, label, value, tone, href, isRoute }) {
  const inner = (
    <div className="border border-black rounded-xl bg-white px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${TONES[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold leading-none">{value}</div>
        <div className="text-xs text-slate-500 mt-0.5 truncate">{label}</div>
      </div>
    </div>
  );
  return isRoute ? <Link to={href}>{inner}</Link> : <a href={href}>{inner}</a>;
}

function Column({ id, title, icon: Icon, count, empty, children }) {
  return (
    <div id={id} className="border border-black rounded-xl bg-white flex flex-col">
      <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-500" />
        <span className="font-semibold text-sm">{title}</span>
        <span className="text-xs text-slate-400 mr-auto">{count}</span>
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

// Coarse "how long ago" label — SQLite hands back 'YYYY-MM-DD HH:MM:SS' in
// UTC, so normalize to ISO before parsing or it reads as local and shows
// negative ages (same fix as elsewhere in the app).
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
