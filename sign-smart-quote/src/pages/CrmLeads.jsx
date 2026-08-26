import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Loader2, Target, Phone, MessageCircle, AlertTriangle, CalendarClock, Sparkles, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { crmLeads, crmAgents, crmCampaignList } from "@/api/crmClient";
import { inbox } from "@/api/inboxClient";
import { relativeTime } from "@/lib/leadPriority";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel,
} from "@/components/ui/select";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import AgentSidebar from "@/components/layout/AgentSidebar";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";
import { LEAD_STATUSES, STATUS_LABELS, normalizeStatus, toneOf } from "@/lib/leadStatuses";

// The system's one real leads list — replaces the read-only 5-column grid that
// used to live as a tab inside CrmCampaignsOverview (and the /crm/leads
// redirect that bounced agents to /costs, since that page is AdminOnly).
//
// Deliberately built on the CrmCustomers.jsx shape: a single debounced effect
// that owns every reload (search + filter + sort can't race each other), a
// `busy` dim instead of a spinner on refetch, `total_count` riding on every
// row, and "טען עוד" paging. GET /api/crm/leads scopes rows by role server-side,
// so this same component serves both audiences — the only differences are the
// default filter and whether the assignee column/filter is shown.
const PAGE_SIZE = 50;

const SORTS = [
  {
    key: "priority", label: "מי הבא בתור",
    hint: "סדר עבודה אחד, לא רק תאריך: קודם ליד שהפולואפ שלו כבר הגיע/עבר (הבטחנו לחזור), אחר כך ליד שהלקוח כתב בו ביוזמתו ועדיין מחכה לתשובה, אחר כך ליד חדש שאף אחד לא נגע בו, ולבסוף כל השאר לפי מי שהכי הזמן ללא מגע. לא משנה בעלות — רק סדר תצוגה.",
  },
  { key: "last_activity", label: "פעילות אחרונה" },
  { key: "created", label: "נוצר לאחרונה" },
  { key: "follow_up", label: "פולואפ קרוב" },
  { key: "status", label: "סטטוס" },
];

// Each chip is a named server query, not a client-side array filter — that's
// what lets them work past the first page of 50. `hint` is the on-hover
// explanation: the labels are short, and "תקועים" in particular is a rule
// nobody can guess (it is NOT updated_at — see LEAD_ACTIVITY_SQL in
// routes/crm.js), so the exact definition is spelled out rather than implied.
// How far back "לידים חדשים" looks. A tile meant to answer "what came in that
// nobody has touched" has to be bounded, or an old backlog buries this week's
// arrivals and the number never moves.
const NEW_LEADS_WINDOW_DAYS = 30;
const NEW_LEADS_SINCE = () =>
  new Date(Date.now() - NEW_LEADS_WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);

const FILTERS = [
  {
    key: "open", label: "פתוחים", params: { open: "1" },
    hint: "כל ליד שעדיין לא נסגר — כלומר הסטטוס שלו אינו ״עסקה נסגרה״ ואינו אחד מסטטוסי ״לא רלוונטי״.",
  },
  {
    key: "all", label: "הכל", params: {},
    hint: "ללא סינון סטטוס כלל — כולל לידים שנסגרו ולידים שסומנו כלא רלוונטיים.",
  },
  {
    key: "awaiting", label: "בהמתנה לתשובה", params: { awaiting: "1" },
    hint: "הלקוח כתב לנו ואף אחד עדיין לא ענה — מהרגע הראשון, בלי סף זמן. נספר לפי ההודעה האחרונה בשיחה: רק תשובה יוצאת בפועל מורידה ליד מהרשימה, לא עצם זה שמישהו פתח את השיחה וקרא.",
  },
  {
    key: "awaiting_overdue", label: "באיחור בתשובה", params: { awaiting: "overdue" },
    hint: "תת-קבוצה של ״בהמתנה לתשובה״ — רק אלה שממתינים מעל הסף שהוגדר בהגדרות ה-CRM (ברירת מחדל: שעה). זה אותו סף בדיוק שמפעיל את ״באיחור״ בתיבת השיחות.",
  },
  {
    key: "stuck", label: "תקועים", params: { stuck: "1" },
    hint: "ליד פתוח שלא היה בו שום מגע מעל 48 שעות. ״מגע״ = ההודעה האחרונה בשיחת הוואטסאפ; אם אין שיחה — הפעם הראשונה שנציג טיפל בו; ואם גם זה אין — מתי הליד נכנס למערכת. שינוי טכני (סנכרון מנדיי, עריכת שדה) לא נחשב מגע.",
  },
  {
    key: "overdue", label: "פולואפ באיחור", params: { follow_up: "overdue" },
    hint: "ליד שנקבע לו תאריך פולואפ והתאריך כבר עבר — הבטחנו לחזור ללקוח ולא חזרנו.",
  },
  {
    key: "today", label: "פולואפ היום", params: { follow_up: "today" },
    hint: "כל הפולואפים שנקבעו לתאריך של היום — כולל שעות שעוד לא הגיעו. זו רשימת העבודה של הבוקר.",
  },
  {
    key: "tomorrow", label: "פולואפ מחר", params: { follow_up: "tomorrow" },
    hint: "פולואפים שנקבעו למחר — להיערכות מראש.",
  },
  {
    key: "week", label: "השבוע הקרוב", params: { follow_up: "week" },
    hint: "פולואפים מהיום ועד 7 ימים קדימה. פולואפים שכבר עברו אינם נכללים — להם יש צ׳יפ נפרד.",
  },
  {
    key: "no_followup", label: "ללא פולואפ", params: { follow_up: "none" },
    hint: "לידים פתוחים שלא נקבע להם שום תאריך פולואפ — אף תזכורת לא תצוף עליהם לעולם. זה הבקלוג השקט.",
  },
  {
    key: "unassigned", label: "לא משויך", params: { assigned_to: "unassigned" }, adminOnly: true,
    hint: "לידים שעדיין לא שויכו לאף נציג. אלה הלידים שנציג ימשוך בלחיצה על ״משוך ליד״.",
  },
  {
    key: "mine", label: "שלי", params: { assigned_to: "me" },
    hint: "לידים שאתה הנציג המשויך שלהם — גם אם אינך מחזיק בהם משבצת עבודה כרגע.",
  },
];

// Groups for the filter dropdown. Ordered by what a manager opens the screen
// for: the two service-debt filters first, then the follow-up calendar, then
// assignment. Keys not listed here simply don't render, so adding a FILTER
// entry without placing it is visible immediately rather than silently lost.
const CHIP_GROUPS = [
  { label: "כללי", keys: ["open", "all", "stuck"] },
  { label: "ממתינים לנו", keys: ["awaiting", "awaiting_overdue"] },
  { label: "פולואפ", keys: ["overdue", "today", "tomorrow", "week", "no_followup"] },
  { label: "שיוך", keys: ["unassigned", "mine"] },
];

// An unanswered message can sit for days — "ממתין 4320 דק׳" is unreadable,
// so the unit scales to the wait. Same function as the inbox's chat list
// (CrmInbox.jsx), duplicated rather than shared: two copies is not yet a
// pattern, and neither file owns a helpers module the other imports.
function waitLabel(minutes) {
  if (minutes == null) return "";
  if (minutes < 60) return `${minutes} דק׳`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} שע׳`;
  return `${Math.floor(minutes / 1440)} ימים`;
}

// SQLite hands back naive 'YYYY-MM-DD HH:MM:SS'. follow_up_date is Israel
// wall-clock (see the note in lib/leadPriority.js), so it is parsed as local
// while CURRENT_TIMESTAMP columns go through relativeTime's UTC path.
function followUpLabel(s) {
  if (!s) return null;
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  if (isNaN(d)) return null;
  const overdue = d <= new Date();
  const txt = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { txt, overdue };
}

export default function CrmLeads() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const Sidebar = user?.role === "agent" ? AgentSidebar : ManagerSidebar;

  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);   // first paint only
  const [busy, setBusy] = useState(false);        // any refetch — dims the list
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("open");
  const [status, setStatus] = useState("");
  const [assignee, setAssignee] = useState("");
  // Persisted per-browser (not per-user, not synced anywhere): an agent who
  // only ever works one board shouldn't have to re-pick it after every
  // reload, and unlike a server-side default this can never change what a
  // DIFFERENT machine sees — each browser remembers its own last pick, or
  // none at all.
  const [campaign, setCampaign] = useState(
    () => { try { return localStorage.getItem("crm_leads_campaign") || ""; } catch { return ""; } }
  );
  useEffect(() => {
    try { localStorage.setItem("crm_leads_campaign", campaign); } catch { /* private mode etc. */ }
  }, [campaign]);
  // Off by default: an ended campaign's leads are still real work for
  // whoever owns them, but the table shouldn't quietly include years of dead
  // campaigns either — same activeCampaignSql() the tiles already use,
  // opted into here explicitly instead of on by default.
  const [includeEnded, setIncludeEnded] = useState(false);
  const [sort, setSort] = useState("last_activity");
  const [agents, setAgents] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  // Monday status columns for the selected campaign's board, and the picked
  // value as "columnId|label".
  const [mondayCols, setMondayCols] = useState([]);
  const [mondayPick, setMondayPick] = useState("");
  const firstLoad = useRef(true);
  const listRef = useRef(null);

  // Two always-on summary tiles, independent of whatever the filter bar is
  // currently set to — they run their own fixed query each so a manager can
  // see "new" and "overdue follow-up" counts no matter what's selected below.
  const [newCount, setNewCount] = useState(null);
  // "לידים חדשים" counted every open lead at status 'new' with no time bound,
  // so a years-old backlog dominated it permanently and the tile stopped being
  // a signal about today. The headline is now the recent window; the all-time
  // figure stays visible beside it so nothing is hidden, just demoted.
  const [newTotal, setNewTotal] = useState(null);
  // All-time shape of the database (total / won / lost / open), fetched in one
  // request alongside the workload numbers. Kept separate from the workload
  // tiles below because they answer different questions: one is "what does the
  // CRM hold", the other is "what has to be done today".
  const [summary, setSummary] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [overdueCount, setOverdueCount] = useState(null);
  const [overdueSoonest, setOverdueSoonest] = useState(null);
  // "The customer wrote and we haven't answered" — counted from the first
  // minute (awaiting) and, separately, only past the configured SLA
  // (awaitingLate). Two numbers rather than one because "someone is waiting"
  // and "someone has been waiting too long" are different decisions: the
  // first is the queue, the second is the alarm.
  const [awaitingCount, setAwaitingCount] = useState(null);
  const [awaitingLate, setAwaitingLate] = useState(null);
  const [awaitingLongest, setAwaitingLongest] = useState(null);
  // Conversations from customers nobody ever opened a lead for. They cannot
  // appear in the leads table by definition — there is no lead row — so they
  // are fetched separately and rendered as their own clearly-separated
  // section, rather than being silently missing from a filtered view.
  const [leadless, setLeadless] = useState([]);

  const reloadSummary = useCallback(() => {
    // One call replaces the several limit=1 list requests this screen used to
    // fire purely to read total_count off each. campaign_id rides on every
    // one of the four calls below — otherwise picking a board filters the
    // table but leaves every tile above it showing all-boards numbers, which
    // is indistinguishable from the tiles being wrong. active_only rides
    // alongside it (the backend ignores active_only whenever campaign_id is
    // set): with no board picked, these headline numbers default to active
    // campaigns only, so a campaign someone ended two years ago doesn't sit
    // in every tile forever. This is tiles-only — the main table below keeps
    // showing every open lead regardless of campaign state, on purpose: a
    // lead doesn't stop being someone's job just because its campaign ended.
    crmLeads.summary({ campaign_id: campaign, active_only: 1 })
      .then((s) => {
        setSummary(s);
        setNewCount(s.newRecent);
        setNewTotal(s.newTotal);
        setOverdueCount(s.followUpOverdue);
      })
      .catch(() => {});
    crmLeads.list({ follow_up: "overdue", sort: "follow_up", limit: 1, campaign_id: campaign, active_only: 1 })
      .then((rows) => {
        setOverdueCount(rows[0]?.total_count ?? 0);
        setOverdueSoonest(rows[0]?.follow_up_date ?? null);
      })
      .catch(() => {});
    // Counted over CONVERSATIONS, not leads — this was the bug. The tiles used
    // the leads query, which can only see a conversation that maps to a lead
    // (crm_conversations.lead_id, or a customer that has one). A person who
    // messages the business WhatsApp without anyone creating a lead for them
    // is invisible to it: locally 3 conversations were awaiting a reply and
    // the tile said 1. The inbox was right and the tile was wrong, which is
    // the worst way for a number to be wrong — it says "nobody is waiting".
    inbox.listConversations({ filter: "awaiting", limit: 1, campaign_id: campaign, active_only: 1 })
      .then((rows) => setAwaitingCount(rows[0]?.total_count ?? 0))
      .catch(() => {});
    inbox.listConversations({ filter: "awaiting_overdue", campaign_id: campaign, active_only: 1 })
      .then((rows) => {
        setAwaitingLate(rows[0]?.total_count ?? 0);
        // minutes_waiting rides on every conversation row (routes/inbox.js).
        const longest = rows.reduce((max, r) => Math.max(max, r.minutes_waiting || 0), 0);
        setAwaitingLongest(longest || null);
      })
      .catch(() => {});
  }, [campaign]);

  useEffect(() => { reloadSummary(); }, [reloadSummary]);

  // Only meaningful for the two awaiting views — those are the ones counted
  // over conversations, so those are the ones where the leads table alone
  // under-reports. Every other chip is a pure lead query with nothing missing.
  useEffect(() => {
    if (filter !== "awaiting" && filter !== "awaiting_overdue") {
      setLeadless([]);
      return;
    }
    let cancelled = false;
    inbox.listConversations({ filter, without_lead: 1 })
      .then((rows) => { if (!cancelled) setLeadless(Array.isArray(rows) ? rows : []); })
      // A failure here must not blank the leads table beside it.
      .catch(() => { if (!cancelled) setLeadless([]); });
    return () => { cancelled = true; };
  }, [filter]);

  // Clicking a tile jumps straight to that slice — status "new" doesn't have
  // its own chip, so it also clears any campaign/monday pick that would
  // otherwise hide leads with no board match yet.
  const openNewLeads = () => {
    setFilter("open");
    setStatus("new");
    setCampaign("");
    setAssignee("");
    // Match the tile: clicking a number must show exactly the rows it counted,
    // otherwise the list contradicts the tile that opened it.
    setDateFrom(NEW_LEADS_SINCE());
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const openOverdue = () => {
    setDateFrom("");
    setFilter("overdue");
    setStatus("");
    setCampaign("");
    setAssignee("");
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // These two tiles count conversations, so they open the inbox — the screen
  // that can actually show all of them. Sending them to the leads list below
  // would silently drop every conversation without a lead, which is exactly
  // the discrepancy that made the tile wrong in the first place.
  const openAwaiting = (key) => {
    navigate(`/crm/inbox?filter=${key === "awaiting_overdue" ? "awaiting_overdue" : "awaiting"}`);
  };

  // Same slice, filtered into the LEADS table below instead of navigating
  // away. Deliberately a second, separate action rather than a replacement:
  // the tile counts conversations, and the leads table can only show the
  // ones that actually have a lead behind them — so this list is legitimately
  // shorter, and swapping the tile over to it would resurrect the old
  // "the tile says nobody is waiting" bug. The count difference is spelled
  // out to the user rather than hidden.
  const filterAwaitingInTable = (key) => {
    setDateFrom("");
    setFilter(key);
    setStatus("");
    setCampaign("");
    setAssignee("");
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const chips = useMemo(() => FILTERS.filter((f) => isAdmin || !f.adminOnly), [isAdmin]);
  const activeChip = useMemo(() => chips.find((f) => f.key === filter), [chips, filter]);
  // Hidden filters need a visible count, or a campaign left selected quietly
  // shrinks every list with nothing on screen explaining why.
  const extraFilterCount = [campaign, assignee, mondayPick, dateFrom].filter(Boolean).length;

  const params = useMemo(() => {
    const chip = chips.find((f) => f.key === filter) || chips[0];
    const [mondayCol, ...rest] = mondayPick ? mondayPick.split("|") : [];
    return {
      q, sort, status, campaign_id: campaign, ...chip.params,
      // Label text can itself contain "|", so only the first segment is the
      // column id and everything after it is the value.
      ...(mondayPick ? { monday_col: mondayCol, monday_val: rest.join("|") } : {}),
      // An explicit assignee pick wins over the chip's own assigned_to.
      ...(assignee ? { assigned_to: assignee } : {}),
      ...(dateFrom ? { date_from: dateFrom } : {}),
      // Same activeCampaignSql() default the dashboard tiles already use —
      // off by default, so a campaign someone ended doesn't quietly pile up
      // in the table forever, but every lead from it is one checkbox away,
      // never deleted or actually hidden from the person who owns it.
      ...(includeEnded ? {} : { active_only: 1 }),
      limit: PAGE_SIZE,
    };
  }, [q, sort, status, campaign, assignee, filter, chips, mondayPick, includeEnded]);

  useEffect(() => {
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const rows = await crmLeads.list({ ...params, offset: 0 });
        setLeads(rows);
        setTotal(rows[0]?.total_count ?? 0);
      } catch (err) {
        toast.error(err.message || "טעינת הלידים נכשלה");
      } finally {
        setBusy(false);
        setLoading(false);
        firstLoad.current = false;
      }
    }, firstLoad.current ? 0 : 300);
    return () => clearTimeout(t);
  }, [params]);

  // Manager-only: populates the assignee dropdown. Agents never see it, and
  // the endpoint is requireAdmin anyway.
  useEffect(() => {
    if (!isAdmin) return;
    crmAgents.workload().then(setAgents).catch(() => {});
  }, [isAdmin]);

  // Campaign == monday board (monday_board_map is 1:1), so this filter is
  // effectively "which board did this lead come from".
  useEffect(() => {
    crmCampaignList.list().then(setCampaigns).catch(() => {});
  }, []);

  // Monday label banks differ per board, so the real-status list only exists
  // once a campaign is chosen — hence campaign sits BEFORE status in the bar.
  // Switching campaign drops the previous pick, which belonged to another board.
  useEffect(() => {
    setMondayPick("");
    if (!campaign) return setMondayCols([]);
    crmLeads.mondayFilters(campaign).then((r) => setMondayCols(r.columns || [])).catch(() => setMondayCols([]));
  }, [campaign]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const rows = await crmLeads.list({ ...params, offset: leads.length });
      setLeads((prev) => [...prev, ...rows]);
      if (rows.length) setTotal(rows[0].total_count);
    } catch (err) {
      toast.error(err.message || "טעינת לידים נוספים נכשלה");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <img src={printellaLogo} alt="Printella" className="h-24 object-contain" />
          <div>
            <h1 className="text-lg font-bold">לידים</h1>
            <span className="text-sm text-slate-500">
              {isAdmin ? "כל הלידים במערכת" : "הלידים שלך"}
            </span>
          </div>
        </div>
      </div>

      <div className="w-full mx-auto px-4 sm:px-8 py-8 flex flex-col lg:flex-row gap-8 items-start">
        <Sidebar />
        <div className="flex-1 min-w-0 w-full max-w-[1400px] space-y-4">
          {/* Summary tiles — fixed queries, independent of the filter bar
              below. Clicking one sets the matching filter and scrolls the
              list into view, so it reads as "drill down", not a separate
              report. */}
          {/* All-time shape of the database. Separate row, quieter styling and
              deliberately NOT clickable: these describe what the CRM holds,
              they are not a queue anyone works from. Mixing them in with the
              workload tiles below is what made a months-old backlog read as
              today's to-do list. */}
          {summary && (
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
              {[
                { label: "סך הכל לידים", value: summary.total, tone: "text-slate-800" },
                { label: "פתוחים", value: summary.open, tone: "text-blue-700" },
                { label: "עסקאות שנסגרו", value: summary.won, tone: "text-emerald-700" },
                { label: "לא רלוונטי / אבודים", value: summary.lost, tone: "text-slate-500" },
                { label: "ללא נציג", value: summary.unassigned, tone: "text-amber-700" },
              ].map((t) => (
                <div key={t.label} className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-2.5">
                  <span className="block text-[11px] text-slate-500">{t.label}</span>
                  <span className={`block text-lg font-bold tabular-nums ${t.tone}`}>
                    {t.value.toLocaleString("he-IL")}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={openNewLeads}
              className="flex items-center gap-3 rounded-xl border border-black bg-white px-4 py-3 text-right hover:bg-slate-50 transition-colors"
            >
              <span className="shrink-0 w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs text-slate-500">לידים חדשים · {NEW_LEADS_WINDOW_DAYS} ימים</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-xl font-bold">
                    {newCount === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-300" /> : newCount}
                  </span>
                  {/* The all-time figure is not hidden, only demoted — it is
                      real, it is just not a signal about this week. */}
                  {newTotal != null && newTotal !== newCount && (
                    <span className="text-[11px] text-slate-400">מתוך {newTotal} בסך הכול</span>
                  )}
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={openOverdue}
              className="flex items-center gap-3 rounded-xl border border-black bg-white px-4 py-3 text-right hover:bg-slate-50 transition-colors"
            >
              <span className="shrink-0 w-9 h-9 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs text-slate-500">פולואפ באיחור</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-xl font-bold">
                    {overdueCount === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-300" /> : overdueCount}
                  </span>
                  {overdueCount > 0 && overdueSoonest && (
                    <span className="text-[11px] text-slate-400" dir="ltr">
                      הראשון: {followUpLabel(overdueSoonest)?.txt}
                    </span>
                  )}
                </span>
              </span>
            </button>

            {/* The customer is waiting on US — counted from minute one. */}
            <button
              type="button"
              onClick={() => openAwaiting("awaiting")}
              className="flex items-center gap-3 rounded-xl border border-black bg-white px-4 py-3 text-right hover:bg-slate-50 transition-colors"
            >
              <span className="shrink-0 w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <MessageCircle className="w-4 h-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">בהמתנה לתשובה</span>
                  <span
                    role="button"
                    tabIndex={0}
                    title="סינון בטבלת הלידים למטה (רק לידים — המספר עשוי להיות נמוך יותר)"
                    onClick={(e) => { e.stopPropagation(); filterAwaitingInTable("awaiting"); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); filterAwaitingInTable("awaiting"); } }}
                    className="text-[10px] px-1.5 py-0.5 rounded-full border border-slate-300 text-slate-500 hover:bg-slate-100 cursor-pointer"
                  >
                    בטבלה
                  </span>
                </span>
                <span className="block text-xl font-bold">
                  {awaitingCount === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-300" /> : awaitingCount}
                </span>
              </span>
            </button>

            {/* The subset that has crossed the SLA — the alarm, not the queue. */}
            <button
              type="button"
              onClick={() => openAwaiting("awaiting_overdue")}
              className="flex items-center gap-3 rounded-xl border border-black bg-white px-4 py-3 text-right hover:bg-slate-50 transition-colors"
            >
              <span className="shrink-0 w-9 h-9 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">באיחור בתשובה</span>
                  <span
                    role="button"
                    tabIndex={0}
                    title="סינון בטבלת הלידים למטה (רק לידים — המספר עשוי להיות נמוך יותר)"
                    onClick={(e) => { e.stopPropagation(); filterAwaitingInTable("awaiting_overdue"); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); filterAwaitingInTable("awaiting_overdue"); } }}
                    className="text-[10px] px-1.5 py-0.5 rounded-full border border-slate-300 text-slate-500 hover:bg-slate-100 cursor-pointer"
                  >
                    בטבלה
                  </span>
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="text-xl font-bold">
                    {awaitingLate === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-300" /> : awaitingLate}
                  </span>
                  {awaitingLate > 0 && awaitingLongest && (
                    <span className="text-[11px] text-slate-400">
                      הכי ותיק: {waitLabel(awaitingLongest)}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </div>

          {/* Control bar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="חיפוש לפי שם, טלפון, אימייל, חברה או הערה..."
                className="pr-9"
              />
            </div>
            {/* Sort is the only always-visible control besides search and the
                filter below: it is not a filter, it never hides rows, and it is
                useful in every view. Campaign / agent / monday-status moved
                into "עוד מסננים" — each is reached occasionally, and together
                they made a seven-control bar that buried the table. */}
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger dir="rtl" className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">
                {SORTS.map((s) => <SelectItem key={s.key} value={s.key} title={s.hint}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-10">
                  <SlidersHorizontal className="w-4 h-4" />
                  עוד מסננים
                  {/* A count, because these are now hidden: a campaign left
                      selected would otherwise silently shrink every list with
                      nothing on screen to explain why. */}
                  {extraFilterCount > 0 && (
                    <span className="text-[10px] font-bold rounded-full bg-primary text-primary-foreground px-1.5 py-0.5">
                      {extraFilterCount}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent dir="rtl" align="start" className="w-[300px] space-y-3">
                {/* Campaign comes FIRST: it picks the monday board, and only
                    then does a real status list exist — every board has its own
                    label bank, so there is no cross-board status vocabulary. */}
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500">קמפיין</label>
                  <Select value={campaign || "any"} onValueChange={(v) => setCampaign(v === "any" ? "" : v)}>
                    <SelectTrigger dir="rtl"><SelectValue placeholder="קמפיין" /></SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="any">כל הקמפיינים</SelectItem>
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Off by default — an ended campaign's leads are still real
                    work, but the table shouldn't quietly include years of
                    dead campaigns without being asked. */}
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <Checkbox checked={includeEnded} onCheckedChange={(v) => setIncludeEnded(!!v)} />
                  כולל קמפיינים שהסתיימו
                </label>

                {campaign && mondayCols.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-500">סטטוס במנדיי</label>
                    <Select value={mondayPick || "any"} onValueChange={(v) => setMondayPick(v === "any" ? "" : v)}>
                      <SelectTrigger dir="rtl"><SelectValue placeholder="סטטוס במנדיי" /></SelectTrigger>
                      <SelectContent dir="rtl" className="max-h-[360px]">
                        <SelectItem value="any">כל הסטטוסים</SelectItem>
                        {mondayCols.map((col) => (
                          <SelectGroup key={col.column_id}>
                            <SelectLabel className="text-[11px] text-slate-400">{col.title}</SelectLabel>
                            {col.values.map((v) => (
                              <SelectItem key={`${col.column_id}|${v.label}`} value={`${col.column_id}|${v.label}`}>
                                {v.label} <span className="text-slate-400">({v.n})</span>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {isAdmin && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-500">נציג</label>
                    <Select value={assignee || "any"} onValueChange={(v) => setAssignee(v === "any" ? "" : v)}>
                      <SelectTrigger dir="rtl"><SelectValue placeholder="נציג" /></SelectTrigger>
                      <SelectContent dir="rtl">
                        <SelectItem value="any">כל הנציגים</SelectItem>
                        <SelectItem value="unassigned">טרם שויך לנציג</SelectItem>
                        {agents.map((a) => (
                          <SelectItem key={a.username} value={a.username}>{a.full_name || a.username}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {extraFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => { setCampaign(""); setAssignee(""); setMondayPick(""); }}
                  >
                    נקה מסננים
                  </Button>
                )}
              </PopoverContent>
            </Popover>
          </div>

          {/* Twelve chips in a wrapping row pushed the table below the fold and
              gave every filter the same visual weight, so the two a manager
              actually opens on ("פולואפ באיחור", "בהמתנה לתשובה") were no
              easier to find than "ללא פולואפ". They are one grouped dropdown
              now; the tiles above are the fast path to the urgent ones. */}
          <div ref={listRef} className="flex flex-wrap items-center gap-3 scroll-mt-24">
            {/* One control for "which leads am I looking at". The 6 lead
                statuses were a second dropdown next to this one, which is the
                same question asked twice — picking a status is just another way
                to narrow the list. Values are prefixed so the two vocabularies
                can share one <Select> without colliding: f: = a named server
                query, s: = a lead status. Picking a status drops the named
                filter to "all", otherwise "פתוחים" + "עסקה נסגרה" would contradict
                each other and always return nothing. */}
            <Select
              value={status ? `s:${status}` : `f:${filter}`}
              onValueChange={(v) => {
                if (v.startsWith("s:")) { setStatus(v.slice(2)); setFilter("all"); }
                else { setFilter(v.slice(2)); setStatus(""); }
              }}
            >
              <SelectTrigger dir="rtl" className="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl" className="max-h-[420px]">
                {CHIP_GROUPS.map((group) => {
                  const items = group.keys
                    .map((k) => chips.find((c) => c.key === k))
                    .filter(Boolean);
                  if (!items.length) return null;
                  return (
                    <SelectGroup key={group.label}>
                      <SelectLabel className="text-[11px] text-slate-400">{group.label}</SelectLabel>
                      {items.map((f) => (
                        <SelectItem key={f.key} value={`f:${f.key}`}>{f.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
                <SelectGroup>
                  <SelectLabel className="text-[11px] text-slate-400">סטטוס הליד</SelectLabel>
                  {/* Driven off the ordered list, not an object's key order:
                      the board's own stage order is what an agent expects to
                      scan, and a new stage appears here for free. */}
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s.key} value={`s:${s.key}`}>{s.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            {/* The chosen filter's rule, spelled out. It used to be a tooltip
                per chip; inside a dropdown there is nowhere to hover, and these
                rules ("תקועים" especially) are not guessable. */}
            {activeChip?.hint && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[11px] text-slate-400 max-w-[420px] truncate cursor-help">
                      {activeChip.hint}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent dir="rtl" side="bottom" className="max-w-[320px] text-xs leading-relaxed">
                    {activeChip.hint}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* A date filter set by a tile click must announce itself — an
                unexplained short list is exactly the confusion this screen
                already guards against for campaign/assignee filters. */}
            {dateFrom && (
              <button
                type="button"
                onClick={() => setDateFrom("")}
                title="הסר את סינון התאריך"
                className="text-[11px] px-2 py-0.5 rounded-full border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
              >
                מ-{dateFrom} ואילך ✕
              </button>
            )}
            {!loading && <span className="text-xs text-slate-400 mr-auto">נמצאו {total} לידים</span>}
          </div>

          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : leads.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <Target className="w-10 h-10 mx-auto mb-2" />
              לא נמצאו לידים
            </div>
          ) : (
            <>
              <div className={`border border-black rounded-xl divide-y divide-slate-200 overflow-hidden bg-white transition-opacity ${busy ? "opacity-50" : ""}`}>
                <div className="hidden xl:grid grid-cols-[minmax(0,2fr)_120px_140px_140px_120px_minmax(0,1fr)] gap-4 px-4 py-2 bg-slate-50 text-[11px] font-semibold text-slate-500">
                  <span>לקוח</span>
                  <span>סטטוס</span>
                  <span>{isAdmin ? "סוכן מטפל" : "בטיפול"}</span>
                  <span>פעילות אחרונה</span>
                  <span>פולואפ</span>
                  <span>קמפיין</span>
                </div>
                {leads.map((l) => <LeadRow key={l.id} l={l} isAdmin={isAdmin} />)}
              </div>

              {leads.length < total && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : `טען עוד (${total - leads.length})`}
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Customers waiting on us that nobody opened a lead for. Kept as a
              separate block on purpose rather than merged into the table
              above: these have no lead, so they have no status, no owner and
              no campaign, and dropping them into those columns as blanks
              would read as "a lead with missing data" instead of "no lead
              exists". This section is the difference between the tile's
              conversation count and the lead count beside it. */}
          {leadless.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 pt-2">
                <span className="text-sm font-semibold text-slate-700">ללא ליד</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                  {leadless.length}
                </span>
                <span className="text-xs text-slate-500">
                  לקוחות שכתבו לנו ואף אחד לא פתח להם ליד — הם לא מופיעים בטבלה שלמעלה כי אין להם ליד במערכת
                </span>
              </div>
              <div className="border border-amber-300 rounded-xl divide-y divide-amber-100 overflow-hidden bg-amber-50/40">
                {leadless.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => navigate(`/crm/inbox?conversation=${c.id}`)}
                    className="w-full text-right px-4 py-2.5 grid grid-cols-[minmax(0,2fr)_120px_minmax(0,1fr)] gap-4 items-center hover:bg-amber-50 transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-800 truncate">
                        {c.customer_name || c.customer_phone || "לא ידוע"}
                      </span>
                      <span className="block text-xs text-slate-500 truncate" dir="ltr">
                        {c.customer_phone || ""}
                      </span>
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-300 text-amber-800 bg-white whitespace-nowrap">
                      לא נפתח ליד
                    </span>
                    <span className="text-xs text-slate-500 truncate">
                      {c.minutes_waiting != null ? `ממתין ${waitLabel(c.minutes_waiting)}` : "—"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LeadRow({ l, isAdmin }) {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  const navigate = useNavigate();
  const followUp = followUpLabel(l.follow_up_date);

  return (
    <Link
      to={`/crm/leads/${l.id}/workspace`}
      className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_120px_140px_140px_120px_minmax(0,1fr)] gap-2 xl:gap-4 xl:items-center px-4 py-3 hover:bg-slate-50 transition-colors"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold truncate">{l.customer_name}</span>
          {/* Bought before → the strong badge. Prior enquiries with no purchase
              is a much weaker signal and stays a quiet grey pill, so the green
              one keeps meaning "real money already changed hands". */}
          {l.prior_purchases > 0 ? (
            <span
              title={`לקוח חוזר — ${l.prior_purchases} הזמנות קודמות`}
              className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
            >
              לקוח חוזר
            </span>
          ) : l.prior_leads > 0 ? (
            <span
              title={`${l.prior_leads} פניות קודמות של אותו לקוח — עדיין לא רכש`}
              className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200"
            >
              פנייה {l.prior_leads + 1}
            </span>
          ) : null}
          {l.unread_count > 0 && (
            <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">
              {l.unread_count}
            </span>
          )}
          {/* Survives being read, unlike the unread badge next to it — this is
              "still owes them an answer", which only an outbound reply clears. */}
          {l.awaiting_minutes != null && (
            <span
              title="הלקוח כתב ועדיין לא נענה"
              className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"
            >
              ממתין {waitLabel(l.awaiting_minutes)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
          {l.customer_phone && (
            <>
              <span dir="ltr">{l.customer_phone}</span>
              <a href={`tel:${l.customer_phone}`} onClick={stop} title="חיוג" className="text-slate-400 hover:text-primary">
                <Phone className="w-3 h-3" />
              </a>
              {/* Opened wa.me — WhatsApp Web in a new tab, outside the system:
                  nothing logged, no thread, invisible to the next agent. Goes
                  to the lead's own workspace instead, which opens (or creates)
                  the conversation and shows it beside the lead's context. Same
                  fix already applied to the customers list. */}
              <button
                type="button"
                onClick={(e) => { stop(e); navigate(`/crm/leads/${l.id}/workspace`); }}
                title="פתח שיחת וואטסאפ במערכת"
                className="text-emerald-600 hover:text-emerald-700"
              >
                <MessageCircle className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
        {l.title && <div className="text-xs text-slate-400 truncate mt-0.5">{l.title}</div>}
      </div>

      <div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${toneOf(normalizeStatus(l.status))}`}>
          {STATUS_LABELS[normalizeStatus(l.status)] || l.status}
        </span>
      </div>

      <div className="text-xs text-slate-500 truncate">
        {isAdmin
          ? (l.assigned_to_name || l.assigned_to || <span className="text-amber-600">טרם שויך לנציג</span>)
          : (l.claimed_by ? "בטיפולך" : <span className="text-slate-300">—</span>)}
        {isAdmin && l.claimed_by && (
          <div className="text-[10px] text-slate-400">תפוס ע״י {l.claimed_by_name || l.claimed_by}</div>
        )}
      </div>

      <div className="text-xs text-slate-500">
        <span className="xl:hidden">פעילות: </span>{relativeTime(l.last_activity_at) || "—"}
      </div>

      <div className="text-xs">
        {followUp ? (
          <span className={`inline-flex items-center gap-1 ${followUp.overdue ? "text-red-600 font-semibold" : "text-slate-500"}`}>
            {followUp.overdue ? <AlertTriangle className="w-3 h-3" /> : <CalendarClock className="w-3 h-3" />}
            <span dir="ltr">{followUp.txt}</span>
          </span>
        ) : <span className="text-slate-300 hidden xl:inline">—</span>}
      </div>

      <div className="text-xs text-slate-400 truncate">{l.campaign_name || "—"}</div>
    </Link>
  );
}
