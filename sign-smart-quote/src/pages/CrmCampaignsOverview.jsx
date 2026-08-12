import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { Loader2, PieChart as PieChartIcon, AlertOctagon, Clock, TrendingUp, Wallet, Target, Users } from "lucide-react";
import { leadQueue } from "@/api/leadQueueClient";
import { crmSettings } from "@/api/mondaySyncClient";
import KpiTile from "@/components/crm/analytics/KpiTile";
import TrendChart from "@/components/crm/analytics/TrendChart";
import FunnelChart from "@/components/crm/analytics/FunnelChart";
import SlaPanel from "@/components/crm/analytics/SlaPanel";
import LostReasons from "@/components/crm/analytics/LostReasons";
import { fmtPct, fmtDays } from "@/components/crm/analytics/format";
import { toLocalDateStr } from "@/lib/quoteLabels";
import { Input } from "@/components/ui/input";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";

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
  // Period-over-period comparison. "הכל" has no preceding window, so the
  // server ignores compare there and the toggle is disabled.
  const [compare, setCompare] = useState(false);

  const load = useCallback(async (cid, preset, cFrom, cTo, cmp) => {
    setLoading(true);
    try {
      const params = {
        ...(cid ? { campaign_id: cid } : {}),
        ...rangeToDates(preset, cFrom, cTo),
        ...(cmp ? { compare: 1 } : {}),
      };
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
    if (tab === "overview" || tab === "leads") load(campaignId, rangePreset, customFrom, customTo, compare);
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    leadQueue.campaigns().then(setCampaigns).catch(() => {});
  }, []);
  // Sidebar links navigate to this same route with a different ?tab= — that
  // doesn't remount the component, so pick up the change here.
  useEffect(() => {
    if (tabParam && TABS.some((t) => t.key === tabParam) && tabParam !== tab) setTabState(tabParam);
  }, [tabParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // The overview payload now also feeds the "לידים" tab's trend chart, so
  // both tabs reload on a filter change — that tab used to ignore the shared
  // campaign/range filters entirely and show a fixed 12-month chart.
  const needsOverview = tab === "overview" || tab === "leads";
  const onFilterChange = (cid) => {
    setCampaignId(cid);
    if (needsOverview) load(cid, rangePreset, customFrom, customTo, compare);
  };
  const onRangeChange = (preset) => {
    setRangePreset(preset);
    if (preset !== "custom" && needsOverview) load(campaignId, preset, customFrom, customTo, compare);
  };
  const onCustomRangeChange = (from, to) => {
    setCustomFrom(from);
    setCustomTo(to);
    if (needsOverview) load(campaignId, "custom", from, to, compare);
  };
  const onCompareChange = (next) => {
    setCompare(next);
    if (needsOverview) load(campaignId, rangePreset, customFrom, customTo, next);
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
            <label
              className={`flex items-center gap-1.5 text-xs mr-auto ${rangePreset === "all" ? "text-slate-300 cursor-not-allowed" : "text-slate-500 cursor-pointer"}`}
              title={rangePreset === "all" ? 'אין תקופה קודמת להשוואה כאשר הטווח הוא "הכל"' : undefined}
            >
              <input
                type="checkbox"
                checked={compare && rangePreset !== "all"}
                disabled={rangePreset === "all"}
                onChange={(e) => onCompareChange(e.target.checked)}
                className="accent-primary"
              />
              השוואה לתקופה קודמת
            </label>
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
            <LeadsTab series={data?.series} loading={loading} />
          )}

          {tab === "overview" && (loading || !data ? (
            <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : (
            <>
              {/* KPI row — cohort counts + the two rates and the cycle time
                  that a manager actually steers on. `previous` is present
                  only when the comparison toggle is on. */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <KpiTile label="לידים נכנסים" value={data.funnel.leads_in} previous={data.previous?.funnel.leads_in} series={data.series} seriesKey="leads" />
                <KpiTile label="הגיעו להצעת מחיר" value={data.funnel.leads_quoted} previous={data.previous?.funnel.leads_quoted} series={data.series} seriesKey="quoted" />
                <KpiTile label="נסגרה עסקה" value={data.funnel.leads_won} previous={data.previous?.funnel.leads_won} series={data.series} seriesKey="won" />
                <KpiTile label="% המרה כולל" value={data.funnel.win_rate} previous={data.previous?.funnel.win_rate} format={fmtPct} />
                <KpiTile label="זמן מהצעה לסגירה" value={data.funnel.avg_days_quote_to_close} previous={data.previous?.funnel.avg_days_quote_to_close} format={fmtDays} lowerIsBetter />
              </div>

              <TrendChart series={data.series} />

              <FunnelChart funnel={data.funnel} />

              <SlaPanel sla={data.sla} overdueMinutes={data.reply_overdue_minutes} />

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

              <LostReasons rows={data.lost_reasons} />

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
  // Same columns, different row key — the server returns an identical row
  // shape for both (see GET /api/crm/analytics/campaigns's `group`).
  const [groupBy, setGroupBy] = useState("campaign");
  const byAgent = groupBy === "agent";

  useEffect(() => {
    setLoading(true);
    leadQueue.campaignAnalytics({
      ...rangeToDates(rangePreset, customFrom, customTo),
      ...(byAgent ? { group: "agent", ...(campaignId ? { campaign_id: campaignId } : {}) } : {}),
    })
      .then((d) => setRows(d.rows))
      .catch((err) => toast.error(err.message || "טעינת הנתונים נכשלה"))
      .finally(() => setLoading(false));
  }, [rangePreset, customFrom, customTo, groupBy, campaignId, byAgent]);

  const filtered = useMemo(() => {
    let r = rows || [];
    // Agent rows are already narrowed server-side by campaign_id; filtering
    // them again by that id here would match nothing (the row key is a
    // username, not a campaign id).
    if (campaignId && !byAgent) r = r.filter((x) => String(x.campaign_id) === String(campaignId));
    return [...r].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      return av < bv ? sortDir : av > bv ? -sortDir : 0;
    });
  }, [rows, campaignId, byAgent, sortKey, sortDir]);

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
        <span className="font-semibold text-sm">{byAgent ? "ביצועי נציגים" : "רווחיות קמפיינים"}</span>
        <div className="flex items-center gap-1 mr-auto">
          {[{ key: "campaign", label: "לפי קמפיין" }, { key: "agent", label: "לפי נציג" }].map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGroupBy(g.key)}
              className={`h-7 px-2.5 text-xs rounded-lg border transition-colors ${
                groupBy === g.key ? "border-primary bg-primary/10 text-primary font-semibold" : "border-slate-200 text-slate-500 hover:border-slate-400"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="text-sm text-black border-b border-slate-200">
            {PROFIT_COLS.map((c) => (
              <th key={c.key} className="text-right font-semibold py-2 px-3 cursor-pointer select-none" onClick={() => toggleSort(c.key)}>
                {c.key === "campaign_name" && byAgent ? "נציג" : c.label}{sortKey === c.key ? (sortDir === 1 ? " ▲" : " ▼") : ""}
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
      {byAgent && (
        <div className="px-3 py-2 text-xs text-slate-400 border-t border-slate-100">
          התקציב מוזן ברמת קמפיין בלבד, ולכן עמודות תקציב / עלות לליד / עלות לעסקה / ROAS / רווח נקי מוצגות כ־"—" בתצוגת נציגים.
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
  const [dayLeads, setDayLeads] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    setLoading(true);
    // Alongside the spend rows, that same day's lead count per campaign —
    // typing a budget blind is how a campaign ends up overfunded for a day
    // it produced nothing. Reuses the profitability endpoint with a
    // single-day range rather than adding another one.
    Promise.all([
      leadQueue.campaignSpend(day),
      leadQueue.campaignAnalytics({ date_from: day, date_to: day }).catch(() => ({ rows: [] })),
    ])
      .then(([rows, analytics]) => {
        setValues(Object.fromEntries(rows.map((r) => [r.campaign_id, String(r.amount)])));
        setDayLeads(Object.fromEntries((analytics.rows || []).map((r) => [r.campaign_id, r.leads])));
      })
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
              <span className="text-xs text-slate-400 shrink-0 w-24 text-left" dir="rtl">
                {dayLeads[c.id] ? `${dayLeads[c.id]} לידים` : "אין לידים"}
              </span>
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

// Campaign-level lead analytics: the trend chart and the per-agent
// claim-slot strip. The lead LIST it used to also render moved out to the
// standalone /crm/leads page (CrmLeads.jsx) — that page is role-aware and can
// search/sort/page, which this tab never could.
//
// The trend now comes from the shared overview payload (`series`), so it
// finally honours the campaign and date filters at the top of the page. The
// old hand-rolled bar chart was hardwired to the last 12 months across all
// campaigns and quietly contradicted every other number on screen.
function LeadsTab({ series, loading }) {
  const [workload, setWorkload] = useState([]);
  const [maxClaimed, setMaxClaimed] = useState(4);

  useEffect(() => {
    (async () => {
      try {
        const [w, s] = await Promise.all([leadQueue.agentsWorkload(), crmSettings.get()]);
        setWorkload(w);
        setMaxClaimed(s.max_claimed_leads || 4);
      } catch { /* non-critical — the strip just stays empty */ }
    })();
  }, []);

  return (
    <div className="space-y-6">
      {loading && !series ? (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : (
        <TrendChart series={series} title="לידים לאורך זמן" />
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

      {/* The working list itself now lives at /crm/leads (search, sort,
          paging, last-activity, stuck/overdue filters). Keeping a second,
          weaker copy of it here is how the two drifted apart in the first
          place — this tab keeps only what's genuinely campaign analytics. */}
      <Link
        to="/crm/leads"
        className="border border-black rounded-xl bg-white p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Target className="w-4 h-4 text-slate-500" /> רשימת הלידים המלאה — חיפוש, סינון ומיון
        </span>
        <span className="text-xs text-primary font-semibold">פתח בדף הלידים ←</span>
      </Link>
    </div>
  );
}
