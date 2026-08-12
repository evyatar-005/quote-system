import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { Loader2, PieChart as PieChartIcon, AlertOctagon, Clock, TrendingUp, Wallet, Target, Users } from "lucide-react";
import { leadQueue } from "@/api/leadQueueClient";
import { crmLeads } from "@/api/crmClient";
import { crmSettings } from "@/api/mondaySyncClient";
import { toLocalDateStr } from "@/lib/quoteLabels";
import { Input } from "@/components/ui/input";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";

const STATUS_LABELS = {
  new: "חדש", contacted: "יצרנו קשר", quoted: "נשלחה הצעה",
  won: "זכינו", lost: "אבדנו", disqualified: "לא רלוונטי",
};
const STATUS_COLORS = {
  new: "bg-blue-50 text-blue-600", contacted: "bg-amber-50 text-amber-600",
  quoted: "bg-purple-50 text-purple-600", won: "bg-emerald-50 text-emerald-600",
  lost: "bg-red-50 text-red-500", disqualified: "bg-slate-100 text-slate-500",
};

const fmt = (n) => (n == null ? "—" : new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(n));
const fmtMoney = (n) => (n == null ? "—" : `₪${fmt(n)}`);
const TABS = [
  { key: "overview", label: "סקירה" },
  { key: "profitability", label: "רווחיות" },
  { key: "budget", label: "תקציב" },
  { key: "leads", label: "לידים" },
];

// Colors cycle if there are more distinct status labels than colors — real
// monday deal-status columns can have many (פולואפ, בתהליך מכירה, עסקה
// נסגרה, …), unlike the old fixed 6-value internal funnel.
const SERIES_COLORS = ["#C9A84C", "#3FA9A0", "#D6608E", "#6B5BA6", "#5CA666", "#C4703F", "#4A7FB5", "#A34F63", "#7B9E3F", "#B5854A"];

// View filter for the status pie/total — separate from the always-visible
// day/week/month/year period tiles, which stay fixed buckets regardless.
const RANGE_PRESETS = [
  { key: "all", label: "הכל" },
  { key: "day", label: "יומי" },
  { key: "week", label: "שבועי" },
  { key: "month", label: "חודשי" },
  { key: "custom", label: "טווח מותאם" },
];

function rangeToDates(preset, customFrom, customTo) {
  const now = new Date();
  const today = toLocalDateStr(now);
  if (preset === "day") return { date_from: today, date_to: today };
  if (preset === "week") {
    // Israeli calendar week: Sunday → Saturday (getDay() 0=Sunday), not a
    // rolling 7-day window.
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - now.getDay());
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    return { date_from: toLocalDateStr(sunday), date_to: toLocalDateStr(saturday) };
  }
  if (preset === "month") return { date_from: today.slice(0, 8) + "01", date_to: today };
  if (preset === "custom") return { date_from: customFrom || undefined, date_to: customTo || undefined };
  return {};
}

// Manager-only "קמפיינים" overview — a whole separate tab from CrmLeads.jsx
// (per direct request), answering three questions at a glance: how many
// leads and in what status (numbers + pie), how many came in per period,
// and which WhatsApp threads are sitting unread past the configured
// threshold (crm_settings.reply_overdue_minutes — same setting already
// editable in CrmSettingsSection.jsx, now actually driving something).
export default function CrmCampaignsOverview() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [tab, setTabState] = useState(TABS.some((t) => t.key === tabParam) ? tabParam : "overview");
  const setTab = (key) => {
    setTabState(key);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (key === "overview") next.delete("tab");
      else next.set("tab", key);
      return next;
    }, { replace: true });
  };
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState("");
  const [rangePreset, setRangePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState(toLocalDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toLocalDateStr(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (cid, preset, cFrom, cTo) => {
    setLoading(true);
    try {
      const params = { ...(cid ? { campaign_id: cid } : {}), ...rangeToDates(preset, cFrom, cTo) };
      setData(await leadQueue.campaignsOverview(params));
    } catch (err) {
      toast.error(err.message || "טעינת הנתונים נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  // Loads whenever the overview tab becomes active — covers the initial
  // mount (tab starts "overview") AND returning to it after the campaign/
  // range filters changed while a different tab was open (those filters are
  // shared across tabs, but only "overview" needs this particular payload).
  useEffect(() => {
    if (tab === "overview") load(campaignId, rangePreset, customFrom, customTo);
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    leadQueue.campaigns().then(setCampaigns).catch(() => {});
  }, []);
  // Sidebar links navigate to this same route with a different ?tab= — that
  // doesn't remount the component, so pick up the change here.
  useEffect(() => {
    if (tabParam && TABS.some((t) => t.key === tabParam) && tabParam !== tab) setTabState(tabParam);
  }, [tabParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFilterChange = (cid) => {
    setCampaignId(cid);
    if (tab === "overview") load(cid, rangePreset, customFrom, customTo);
  };
  const onRangeChange = (preset) => {
    setRangePreset(preset);
    if (preset !== "custom" && tab === "overview") load(campaignId, preset, customFrom, customTo);
  };
  const onCustomRangeChange = (from, to) => {
    setCustomFrom(from);
    setCustomTo(to);
    if (tab === "overview") load(campaignId, "custom", from, to);
  };

  const pieData = (data?.by_status || []).map((r) => ({ ...r, name: r.status }));

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl">
        <div className="flex pl-4 sm:pl-6 pr-16 sm:pr-24 pt-3">
          <div className="inline-flex items-center gap-2.5 border-b border-black pb-2.5">
            <img src={printellaLogo} alt="Printella" className="h-14 object-contain" />
            <h1 className="text-base font-bold leading-tight">קמפיינים</h1>
          </div>
        </div>
      </div>

      <div className="w-full mx-auto px-4 sm:px-8 pt-3 pb-8 flex flex-col lg:flex-row gap-8 items-start">
        <ManagerSidebar />
        <div className="flex-1 min-w-0 w-full flex flex-col md:flex-row gap-4 items-stretch">
          {/* Small side list of campaign names — replaces the dropdown, always
              visible, stretched to the full height of the content column. */}
          <div className="border border-black rounded-xl bg-white w-full md:w-52 shrink-0 overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-500">קמפיינים</div>
            <div className="flex flex-row md:flex-col overflow-x-auto md:overflow-visible md:flex-1">
              <button
                type="button"
                onClick={() => onFilterChange("")}
                className={`text-right text-sm px-3 py-2 whitespace-nowrap md:whitespace-normal shrink-0 md:shrink hover:bg-slate-50 ${campaignId === "" ? "bg-primary/10 text-primary font-semibold" : "text-slate-600"}`}
              >
                כל הקמפיינים
              </button>
              {campaigns.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onFilterChange(String(c.id))}
                  className={`text-right text-sm px-3 py-2 whitespace-nowrap md:whitespace-normal shrink-0 md:shrink hover:bg-slate-50 ${String(campaignId) === String(c.id) ? "bg-primary/10 text-primary font-semibold" : "text-slate-600"}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-w-0 w-full space-y-6">
          {/* Range selector — shared across all tabs (drives the overview
              funnel/pie, the profitability table, and the leads date filter). */}
          <div className="flex flex-wrap items-center gap-2">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onRangeChange(p.key)}
                className={`h-8 px-3 text-xs rounded-lg border transition-colors ${
                  rangePreset === p.key ? "border-primary bg-primary/10 text-primary font-semibold" : "border-black text-slate-500 hover:border-slate-500"
                }`}
              >
                {p.label}
              </button>
            ))}
            {rangePreset === "custom" && (
              <div className="flex items-center gap-2">
                <input type="date" value={customFrom} onChange={(e) => onCustomRangeChange(e.target.value, customTo)} className="h-8 rounded-lg border border-black bg-white px-2 text-xs" dir="ltr" />
                <span className="text-slate-400 text-xs">עד</span>
                <input type="date" value={customTo} onChange={(e) => onCustomRangeChange(customFrom, e.target.value)} className="h-8 rounded-lg border border-black bg-white px-2 text-xs" dir="ltr" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`h-8 px-3 text-xs rounded-lg border transition-colors ${
                  tab === t.key ? "border-primary bg-primary/10 text-primary font-semibold" : "border-black text-slate-500 hover:border-slate-500"
                }`}
              >
                {t.label}
              </button>
            ))}
            {tab === "overview" && data && <span className="text-xs text-slate-400 mr-auto">{data.total} לידים בסך הכל</span>}
          </div>

          {tab === "profitability" && (
            <ProfitabilityTab campaignId={campaignId} rangePreset={rangePreset} customFrom={customFrom} customTo={customTo} />
          )}
          {tab === "budget" && <BudgetTab campaigns={campaigns} />}
          {tab === "leads" && (
            <LeadsTab campaignId={campaignId} rangePreset={rangePreset} customFrom={customFrom} customTo={customTo} />
          )}

          {tab === "overview" && (loading || !data ? (
            <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : (
            <>
              {/* Funnel tiles — respect the range above */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <PeriodTile label="לידים נכנסים" value={data.funnel.leads_in} />
                <PeriodTile label="הגיעו לשלב הצעת מחיר" value={data.funnel.leads_quoted} />
                <PeriodTile label="נסגרה עסקה" value={data.funnel.leads_won} />
              </div>

              {/* Status breakdown — numbers + pie */}
              <div className="border border-black rounded-xl bg-white p-4">
                <div className="flex items-center gap-2 mb-3">
                  <PieChartIcon className="w-4 h-4 text-slate-500" />
                  <span className="font-semibold text-sm">פילוח לפי סטטוס</span>
                </div>
                {pieData.length === 0 ? (
                  <div className="text-center py-10 text-sm text-slate-400">אין לידים תואמים</div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-center">
                    <div dir="ltr" style={{ width: "100%", height: 260 }}>
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="n"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius="75%"
                            paddingAngle={2}
                            label={({ name, percent }) => (percent > 0.04 ? `${name} ${(percent * 100).toFixed(0)}%` : "")}
                            labelLine={false}
                          >
                            {pieData.map((r, i) => <Cell key={r.status} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />)}
                          </Pie>
                          <Tooltip
                            formatter={(v, n, p) => [`${v} (${p.payload.pct}%)`, p.payload.name]}
                            contentStyle={{ direction: "rtl", borderRadius: 12, border: "1px solid #000", fontSize: 12 }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-sm text-black border-b border-slate-200">
                            <th className="text-right font-semibold py-1.5">מדד</th>
                            <th className="text-right font-semibold py-1.5">כמות</th>
                            <th className="text-right font-semibold py-1.5">אחוזים</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pieData.map((r, i) => (
                            <tr key={r.status} className="border-b border-slate-100">
                              <td className="py-1.5">
                                <span className="flex items-center gap-2">
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                                  {r.name}
                                </span>
                              </td>
                              <td className="py-1.5 text-slate-600">{r.n}</td>
                              <td className="py-1.5 text-slate-600">{r.pct}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* Exceptional leads */}
              <div className="border border-black rounded-xl bg-white">
                <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
                  <AlertOctagon className="w-4 h-4 text-red-500" />
                  <span className="font-semibold text-sm">לידים חריגים — ממתינים לתשובה מעל {data.reply_overdue_minutes} דקות</span>
                  <span className="text-xs text-slate-400">{data.exceptions.length}</span>
                </div>
                <div className="p-2 space-y-2 max-h-[50vh] overflow-y-auto">
                  {data.exceptions.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-400">אין לידים חריגים כרגע</div>
                  ) : (
                    data.exceptions.map((e) => (
                      <div
                        key={e.conversation_id}
                        onClick={() => navigate(e.lead_id ? `/crm/leads/${e.lead_id}/workspace` : "/crm/inbox")}
                        className="border border-slate-200 rounded-lg p-2 bg-slate-50/50 cursor-pointer hover:bg-slate-100 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">{e.display_name || e.phone_e164}</div>
                          {e.phone_e164 && <div className="text-xs text-slate-400" dir="ltr">{e.phone_e164}</div>}
                        </div>
                        <span className="text-xs shrink-0 flex items-center gap-1 text-red-500 font-semibold">
                          <Clock className="w-3 h-3" /> {e.minutes_waiting} דק׳
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PeriodTile({ label, value }) {
  return (
    <div className="border border-black rounded-xl bg-white px-4 py-3">
      <div className="text-2xl font-bold leading-none">{value ?? 0}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

const PROFIT_COLS = [
  { key: "campaign_name", label: "קמפיין", fmt: (v) => v },
  { key: "leads", label: "לידים", fmt },
  { key: "quoted", label: "הצעות", fmt },
  { key: "deals", label: "עסקאות", fmt },
  { key: "conversion_pct", label: "% המרה", fmt: (v) => `${v}%` },
  { key: "spend", label: "תקציב", fmt: fmtMoney },
  { key: "cpl", label: "עלות לליד", fmt: fmtMoney },
  { key: "cpa", label: "עלות לעסקה", fmt: fmtMoney },
  { key: "revenue", label: "מחזור", fmt: fmtMoney },
  { key: "profit", label: "רווח גולמי", fmt: fmtMoney },
  { key: "roas", label: "ROAS", fmt: (v) => (v == null ? "—" : `${v}x`) },
  { key: "net_profit", label: "רווח נקי", fmt: fmtMoney },
  { key: "avg_days_to_close", label: "ימים לסגירה (ממוצע)", fmt: (v) => (v == null ? "—" : v) },
];

// Comparison table (rows=campaigns, cols=metrics) — the right shape for
// comparing, not a pie. Every ROI column is null (rendered "—") rather than
// 0/Infinity when no budget was entered for the range — see
// GET /api/crm/analytics/campaigns's spend handling.
function ProfitabilityTab({ campaignId, rangePreset, customFrom, customTo }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState("net_profit");
  const [sortDir, setSortDir] = useState(-1);

  useEffect(() => {
    setLoading(true);
    leadQueue.campaignAnalytics(rangeToDates(rangePreset, customFrom, customTo))
      .then((d) => setRows(d.rows))
      .catch((err) => toast.error(err.message || "טעינת הנתונים נכשלה"))
      .finally(() => setLoading(false));
  }, [rangePreset, customFrom, customTo]);

  const filtered = useMemo(() => {
    let r = rows || [];
    if (campaignId) r = r.filter((x) => String(x.campaign_id) === String(campaignId));
    return [...r].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      return av < bv ? sortDir : av > bv ? -sortDir : 0;
    });
  }, [rows, campaignId, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(-1); }
  };

  if (loading || !rows) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="border border-black rounded-xl bg-white overflow-x-auto">
      <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-slate-500" />
        <span className="font-semibold text-sm">רווחיות קמפיינים</span>
      </div>
      <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="text-sm text-black border-b border-slate-200">
            {PROFIT_COLS.map((c) => (
              <th key={c.key} className="text-right font-semibold py-2 px-3 cursor-pointer select-none" onClick={() => toggleSort(c.key)}>
                {c.label}{sortKey === c.key ? (sortDir === 1 ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.campaign_id} className="border-b border-slate-100 hover:bg-slate-50">
              {PROFIT_COLS.map((c) => (
                <td
                  key={c.key}
                  className={`py-2 px-3 ${c.key === "net_profit" && r.net_profit != null && r.net_profit < 0 ? "text-red-600 font-semibold" : "text-slate-600"}`}
                >
                  {c.fmt(r[c.key])}
                </td>
              ))}
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td colSpan={PROFIT_COLS.length} className="text-center py-8 text-xs text-slate-400">אין נתונים</td></tr>
          )}
        </tbody>
      </table>
      {rows.some((r) => r.missing_cost_count > 0) && (
        <div className="px-3 py-2 text-xs text-amber-600 border-t border-slate-100">
          ⚠ חלק מהעסקאות הסגורות חסרות פירוט עלות (לא נכנסו לחישוב הרווח) — כמו במסך "הצעות" הראשי.
        </div>
      )}
    </div>
  );
}

// Manual DAILY spend entry — the one cost input the whole profitability
// screen depends on (see CLAUDE.md CRM analytics plan §1.3: no ad-platform
// integration, a manager types it in). Daily so it lines up exactly with
// any custom date range in the "רווחיות" tab instead of a monthly bucket.
function BudgetTab({ campaigns }) {
  const [day, setDay] = useState(toLocalDateStr(new Date()));
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    setLoading(true);
    leadQueue.campaignSpend(day)
      .then((rows) => setValues(Object.fromEntries(rows.map((r) => [r.campaign_id, String(r.amount)]))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [day]);

  const save = async (campaignId) => {
    setSavingId(campaignId);
    try {
      await leadQueue.setCampaignSpend(campaignId, day, values[campaignId] || "", "");
      toast.success("נשמר");
    } catch (err) {
      toast.error(err.message || "השמירה נכשלה");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="border border-black rounded-xl bg-white">
      <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
        <Wallet className="w-4 h-4 text-slate-500" />
        <span className="font-semibold text-sm">תקציב יומי לקמפיין</span>
        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-40 h-8 text-xs mr-auto" dir="ltr" />
      </div>
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : (
        <div className="divide-y divide-slate-100">
          {campaigns.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-3 py-2">
              <span className="text-sm flex-1">{c.name}</span>
              <Input
                type="number"
                min={0}
                dir="ltr"
                placeholder="0"
                value={values[c.id] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))}
                className="w-32 h-8 text-xs"
              />
              <button
                type="button"
                onClick={() => save(c.id)}
                disabled={savingId === c.id}
                className="text-xs text-primary font-medium hover:underline disabled:opacity-50 w-10"
              >
                {savingId === c.id ? "..." : "שמור"}
              </button>
            </div>
          ))}
          {campaigns.length === 0 && <div className="text-center py-8 text-xs text-slate-400">אין קמפיינים</div>}
        </div>
      )}
    </div>
  );
}

// Every lead (up to 500, newest first), filterable by status/agent/free-text
// search, plus the 12-month trend and per-agent claim-slot strip. Ported
// from the old standalone CrmLeads.jsx — campaign + date range now come from
// the parent (the side rail / range selector above), so this tab only owns
// its own status/agent/search filters.
function LeadsTab({ campaignId, rangePreset, customFrom, customTo }) {
  const [leads, setLeads] = useState([]);
  const [agents, setAgents] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [workload, setWorkload] = useState([]);
  const [maxClaimed, setMaxClaimed] = useState(4);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: "", assigned_to: "" });
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async (f, cid, dates, query) => {
    setLoading(true);
    try {
      const params = Object.fromEntries(
        Object.entries({ ...f, campaign_id: cid, ...dates, q: query }).filter(([, v]) => v)
      );
      setLeads(await crmLeads.list(params));
    } catch (err) {
      toast.error(err.message || "טעינת הלידים נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filters, campaignId, rangeToDates(rangePreset, customFrom, customTo), debouncedQ);
  }, [filters, campaignId, rangePreset, customFrom, customTo, debouncedQ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      try {
        const [a, m, w, s] = await Promise.all([
          leadQueue.agentCampaigns(), crmLeads.monthlyStats(), leadQueue.agentsWorkload(), crmSettings.get(),
        ]);
        setAgents(a);
        setMonthly(m);
        setWorkload(w);
        setMaxClaimed(s.max_claimed_leads || 4);
      } catch { /* non-critical — chart/strip just stay empty */ }
    })();
  }, []);

  const setFilter = (patch) => setFilters((f) => ({ ...f, ...patch }));

  const move = async (leadId, status) => {
    try {
      await crmLeads.update(leadId, { status });
      load(filters, campaignId, rangeToDates(rangePreset, customFrom, customTo), debouncedQ);
    } catch (err) {
      toast.error(err.message || "עדכון הליד נכשל");
    }
  };

  const maxMonthly = useMemo(() => Math.max(1, ...monthly.map((m) => m.total)), [monthly]);

  return (
    <div className="space-y-6">
      {/* Monthly trend */}
      {monthly.length > 0 && (
        <div className="border border-black rounded-xl bg-white p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="w-4 h-4 text-slate-500" /> לידים לפי חודש (12 חודשים אחרונים)
          </div>
          <div className="flex items-end gap-1.5 h-24">
            {monthly.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${m.month}: ${m.total}`}>
                <span className="text-[10px] text-slate-400">{m.total}</span>
                <div className="w-full bg-primary/20 rounded-t" style={{ height: `${Math.max(4, (m.total / maxMonthly) * 70)}px` }} />
                <span className="text-[10px] text-slate-400">{m.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent workload */}
      {workload.length > 0 && (
        <div className="border border-black rounded-xl bg-white p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="w-4 h-4 text-slate-500" /> מצב הסוכנים
          </div>
          <div className="flex flex-wrap gap-2">
            {workload.map((a) => (
              <span
                key={a.username}
                className={`text-xs rounded-full px-3 py-1 border ${a.open_slots >= maxClaimed ? "border-red-400 text-red-600 bg-red-50" : "border-slate-200 bg-slate-50"}`}
              >
                {a.full_name || a.username} · {a.open_slots}/{maxClaimed} · נמשכו היום {a.claimed_today} · נסגרו {a.closed_today}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="border border-black rounded-xl bg-white p-3 flex flex-wrap gap-2 items-center">
        <Input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש לפי שם או טלפון"
          className="w-56 h-8 text-xs"
        />
        <select value={filters.status} onChange={(e) => setFilter({ status: e.target.value })} className="text-xs border border-black rounded-md px-2 py-1.5 bg-white">
          <option value="">כל הסטטוסים</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.assigned_to} onChange={(e) => setFilter({ assigned_to: e.target.value })} className="text-xs border border-black rounded-md px-2 py-1.5 bg-white">
          <option value="">כל הסוכנים</option>
          <option value="unassigned">לא משויך (בבריכה)</option>
          {agents.map((a) => <option key={a.username} value={a.username}>{a.full_name || a.username}</option>)}
        </select>
        <span className="text-xs text-slate-400 mr-auto">{leads.length} תוצאות</span>
      </div>

      {/* Results table */}
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : leads.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <Target className="w-10 h-10 mx-auto mb-2" />
          אין לידים תואמים לסינון
        </div>
      ) : (
        <div className="border border-black rounded-xl bg-white overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="text-right px-3 py-2 font-medium">לקוח</th>
                <th className="text-right px-3 py-2 font-medium">קמפיין</th>
                <th className="text-right px-3 py-2 font-medium">משויך ל</th>
                <th className="text-right px-3 py-2 font-medium">נוצר</th>
                <th className="text-right px-3 py-2 font-medium">סטטוס</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link to={`/crm/customers/${l.customer_id}`} className="font-medium hover:text-primary block truncate max-w-[220px]">
                      {l.customer_name}
                    </Link>
                    {l.customer_phone && <div className="text-xs text-slate-400" dir="ltr">{l.customer_phone}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{l.campaign_name || "—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{l.assigned_to_name || l.assigned_to || "לא משויך"}</td>
                  <td className="px-3 py-2 text-xs text-slate-400" dir="ltr">
                    {(l.source_created_at || l.created_at || "").slice(0, 10)}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={l.status}
                      onChange={(e) => move(l.id, e.target.value)}
                      className={`text-xs rounded-full px-2 py-1 border-none ${STATUS_COLORS[l.status] || "bg-slate-100 text-slate-500"}`}
                    >
                      {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
