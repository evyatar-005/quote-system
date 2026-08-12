import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { Search, Loader2, Target, Phone, MessageCircle, AlertTriangle, CalendarClock } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { crmLeads, crmAgents, crmCampaignList } from "@/api/crmClient";
import { relativeTime } from "@/lib/leadPriority";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel,
} from "@/components/ui/select";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import AgentSidebar from "@/components/layout/AgentSidebar";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";

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

const STATUS_LABELS = {
  new: "חדש", contacted: "יצרנו קשר", quoted: "נשלחה הצעה",
  won: "זכינו", lost: "אבדנו", disqualified: "לא רלוונטי",
};

const STATUS_TONE = {
  new: "bg-blue-50 text-blue-700 border-blue-200",
  contacted: "bg-amber-50 text-amber-700 border-amber-200",
  quoted: "bg-violet-50 text-violet-700 border-violet-200",
  won: "bg-emerald-50 text-emerald-700 border-emerald-200",
  lost: "bg-slate-100 text-slate-500 border-slate-200",
  disqualified: "bg-slate-100 text-slate-500 border-slate-200",
};

const SORTS = [
  { key: "last_activity", label: "פעילות אחרונה" },
  { key: "created", label: "נוצר לאחרונה" },
  { key: "follow_up", label: "פולואפ קרוב" },
  { key: "value", label: "ערך גבוה" },
  { key: "status", label: "סטטוס" },
];

// Each chip is a named server query, not a client-side array filter — that's
// what lets them work past the first page of 50. `hint` is the on-hover
// explanation: the labels are short, and "תקועים" in particular is a rule
// nobody can guess (it is NOT updated_at — see LEAD_ACTIVITY_SQL in
// routes/crm.js), so the exact definition is spelled out rather than implied.
const FILTERS = [
  {
    key: "open", label: "פתוחים", params: { open: "1" },
    hint: "כל ליד שעדיין לא נסגר — כלומר הסטטוס שלו אינו זכינו / אבדנו / לא רלוונטי.",
  },
  {
    key: "all", label: "הכל", params: {},
    hint: "ללא סינון סטטוס כלל — כולל לידים סגורים, אבודים ולא רלוונטיים.",
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
    hint: "לידים בבריכה שאף נציג לא אחראי עליהם. אלה הלידים שנציג ימשוך בלחיצה על ״משוך ליד״.",
  },
  {
    key: "mine", label: "שלי", params: { assigned_to: "me" },
    hint: "לידים שאתה הנציג המשויך שלהם — גם אם אינך מחזיק בהם משבצת עבודה כרגע.",
  },
];

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
  const [campaign, setCampaign] = useState("");
  const [sort, setSort] = useState("last_activity");
  const [agents, setAgents] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  // Monday status columns for the selected campaign's board, and the picked
  // value as "columnId|label".
  const [mondayCols, setMondayCols] = useState([]);
  const [mondayPick, setMondayPick] = useState("");
  const firstLoad = useRef(true);

  const chips = useMemo(() => FILTERS.filter((f) => isAdmin || !f.adminOnly), [isAdmin]);

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
      limit: PAGE_SIZE,
    };
  }, [q, sort, status, campaign, assignee, filter, chips, mondayPick]);

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
            {/* Campaign comes FIRST: it picks the monday board, and only then
                does a real status list exist — every board has its own label
                bank, so there is no cross-board status vocabulary to offer. */}
            <Select value={campaign || "any"} onValueChange={(v) => setCampaign(v === "any" ? "" : v)}>
              <SelectTrigger dir="rtl" className="w-[200px]"><SelectValue placeholder="קמפיין" /></SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="any">כל הקמפיינים</SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {campaign && mondayCols.length > 0 ? (
              // Real monday values for this board, grouped by their column and
              // labelled with how many leads actually carry each one.
              <Select value={mondayPick || "any"} onValueChange={(v) => setMondayPick(v === "any" ? "" : v)}>
                <SelectTrigger dir="rtl" className="w-[250px]"><SelectValue placeholder="סטטוס במנדיי" /></SelectTrigger>
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
            ) : (
              // No campaign picked — fall back to the system's own 6 statuses,
              // the only vocabulary shared by every board.
              <Select value={status || "any"} onValueChange={(v) => setStatus(v === "any" ? "" : v)}>
                <SelectTrigger dir="rtl" className="w-[190px]"><SelectValue placeholder="סטטוס" /></SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="any">כל הסטטוסים</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isAdmin && (
              <Select value={assignee || "any"} onValueChange={(v) => setAssignee(v === "any" ? "" : v)}>
                <SelectTrigger dir="rtl" className="w-[180px]"><SelectValue placeholder="נציג" /></SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="any">כל הנציגים</SelectItem>
                  <SelectItem value="unassigned">לא משויך (בבריכה)</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.username} value={a.username}>{a.full_name || a.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger dir="rtl" className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">
                {SORTS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* delayDuration 200 so hovering across the row to reach a chip
                doesn't flash a tooltip for each one on the way. */}
            <TooltipProvider delayDuration={200}>
              {chips.map((f) => (
                <Tooltip key={f.key}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setFilter(f.key)}
                      className={`text-xs rounded-full px-3 py-1 border transition-colors ${
                        filter === f.key
                          ? "bg-primary text-primary-foreground border-primary font-semibold"
                          : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {f.label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent dir="rtl" side="bottom" className="max-w-[320px] text-xs leading-relaxed">
                    {f.hint}
                  </TooltipContent>
                </Tooltip>
              ))}
            </TooltipProvider>
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
                <div className="hidden xl:grid grid-cols-[minmax(0,2fr)_120px_140px_140px_120px_100px_minmax(0,1fr)] gap-4 px-4 py-2 bg-slate-50 text-[11px] font-semibold text-slate-500">
                  <span>לקוח</span>
                  <span>סטטוס</span>
                  <span>{isAdmin ? "משויך ל" : "בטיפול"}</span>
                  <span>פעילות אחרונה</span>
                  <span>פולואפ</span>
                  <span>ערך</span>
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
        </div>
      </div>
    </div>
  );
}

function LeadRow({ l, isAdmin }) {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  const followUp = followUpLabel(l.follow_up_date);
  const waNumber = l.customer_phone ? l.customer_phone.replace(/\D/g, "") : null;

  return (
    <Link
      to={`/crm/leads/${l.id}/workspace`}
      className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_120px_140px_140px_120px_100px_minmax(0,1fr)] gap-2 xl:gap-4 xl:items-center px-4 py-3 hover:bg-slate-50 transition-colors"
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
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
          {l.customer_phone && (
            <>
              <span dir="ltr">{l.customer_phone}</span>
              <a href={`tel:${l.customer_phone}`} onClick={stop} title="חיוג" className="text-slate-400 hover:text-primary">
                <Phone className="w-3 h-3" />
              </a>
              <a
                href={`https://wa.me/${waNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="וואטסאפ"
                className="text-emerald-600 hover:text-emerald-700"
              >
                <MessageCircle className="w-3 h-3" />
              </a>
            </>
          )}
        </div>
        {l.title && <div className="text-xs text-slate-400 truncate mt-0.5">{l.title}</div>}
      </div>

      <div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_TONE[l.status] || STATUS_TONE.new}`}>
          {STATUS_LABELS[l.status] || l.status}
        </span>
      </div>

      <div className="text-xs text-slate-500 truncate">
        {isAdmin
          ? (l.assigned_to_name || l.assigned_to || <span className="text-amber-600">בבריכה</span>)
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

      <div className="text-xs text-slate-600">
        {l.value_estimate != null
          ? `₪ ${Number(l.value_estimate).toLocaleString("he-IL")}`
          : <span className="text-slate-300 hidden xl:inline">—</span>}
      </div>

      <div className="text-xs text-slate-400 truncate">{l.campaign_name || "—"}</div>
    </Link>
  );
}
