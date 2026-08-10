import { useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { Award, AlertTriangle, Target, ChevronDown } from "lucide-react";
import { fmt, MORNING_ORDER_TYPE, DATE_PRESETS, computeDateRange, toLocalDateStr } from "@/lib/quoteLabels";
import { economicsOf, linesOf, productLabel, productSku, compareSku } from "@/lib/quoteEconomics";

// Printella brand hues — one stable colour per series so an agent keeps the
// same colour across every chart on the page.
const SERIES_COLORS = ["#C9A84C", "#3FA9A0", "#D6608E", "#6B5BA6", "#5CA666", "#C4703F", "#4A7FB5", "#A34F63"];

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key) => {
  const [y, m] = key.split("-");
  return `${m}/${y.slice(2)}`;
};

function Card({ title, subtitle, children }) {
  return (
    <div className="bg-white border border-black rounded-2xl p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// Recharts renders its own DOM; force LTR inside so axes/legends lay out
// predictably, while the Hebrew labels themselves still read correctly.
const ChartBox = ({ height = 280, children }) => (
  <div dir="ltr" style={{ width: "100%", height }}>
    <ResponsiveContainer>{children}</ResponsiveContainer>
  </div>
);

const tooltipProps = {
  formatter: (v, name) => [typeof v === "number" ? fmt(v) : v, name],
  contentStyle: { direction: "rtl", borderRadius: 12, border: "1px solid #000", fontSize: 12 },
};

// This report is about AGENTS specifically — revenue/profit/margin/average
// deal are all computed on CLOSED business only (a quote that actually became
// a Morning order), never on every quote issued. An issued-but-never-ordered
// quote generated no real revenue yet, so counting it here would inflate
// every agent's numbers by however many quotes never converted. "הצעות" and
// "אחוז סגירה" still report on ALL issued quotes — that pairing is the whole
// point (how many did they quote vs. how many actually closed).
export default function QuotesAnalytics({ quotes, sellers, morningDocs = {} }) {
  // Own dedicated time filter — deliberately independent of the archive's top
  // filter bar (see the note where this component is rendered in
  // QuotesArchive.jsx): a per-agent report must never be silently narrowed by
  // the list's "סוכן"/"סטטוס" filters, which would defeat the comparison.
  const [datePreset, setDatePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState(toLocalDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toLocalDateStr(new Date()));

  const rangedQuotes = useMemo(() => {
    const { from, to } = computeDateRange(datePreset, customFrom, customTo);
    if (!from && !to) return quotes;
    return quotes.filter((q) => {
      const created = new Date(q.created_date);
      if (from && created < from) return false;
      if (to && created > to) return false;
      return true;
    });
  }, [quotes, datePreset, customFrom, customTo]);

  // A quote only counts as "closed" once Morning actually issued an order
  // document (type 100) for it — see the note on MORNING_ORDER_TYPE. Anything
  // else (draft, sent, agent-approved-but-never-ordered) is an open or lost
  // quote, regardless of its `status`.
  const isClosed = (q) => morningDocs[q.id]?.morning_document_type === MORNING_ORDER_TYPE;

  const { agents, missingCost, months, agentNames, agentProducts, productTypes, totals } = useMemo(() => {
    const byAgent = {};
    let missingCost = 0;

    for (const q of rangedQuotes) {
      const key = q.created_by || "—";
      if (!byAgent[key]) byAgent[key] = { key, name: sellers[key] || key, count: 0, orders: 0, closedRevenue: 0, closedCost: 0, closedProfit: 0, closedNetSales: 0 };
      const a = byAgent[key];
      a.count += 1;

      if (!isClosed(q)) continue;
      a.orders += 1;

      // Net sales = sum of the priced lines themselves, no VAT, no shipping,
      // no document minimum top-up — a "clean" sales figure per the request
      // that the leading chart must never mix revenue with profit.
      for (const l of linesOf(q)) a.closedNetSales += l.result.sellingPriceAll || 0;

      const e = economicsOf(q);
      if (e) {
        a.closedRevenue += e.revenue;
        a.closedCost += e.cost;
        a.closedProfit += e.profit;
      } else {
        missingCost += 1; // a closed order with no saved cost breakdown
      }
    }

    const agents = Object.values(byAgent)
      .map((a) => ({
        ...a,
        marginPct: a.closedRevenue > 0 ? (a.closedProfit / a.closedRevenue) * 100 : 0,
        avgClosedDeal: a.orders > 0 ? a.closedRevenue / a.orders : 0,
        closeRatePct: a.count > 0 ? (a.orders / a.count) * 100 : 0,
      }))
      .sort((a, b) => b.closedProfit - a.closedProfit);

    const agentNames = agents.map((a) => a.name);

    // Trend — one row per month, one column per agent (profit from closed
    // orders only, same as everywhere else in this report).
    const monthMap = {};
    for (const q of rangedQuotes) {
      if (!isClosed(q)) continue;
      const e = economicsOf(q);
      if (!e) continue;
      const d = new Date(q.created_date);
      if (isNaN(d)) continue;
      const mk = monthKey(d);
      if (!monthMap[mk]) monthMap[mk] = { key: mk, label: monthLabel(mk) };
      const name = sellers[q.created_by] || q.created_by || "—";
      monthMap[mk][name] = (monthMap[mk][name] || 0) + e.profit;
    }
    const months = Object.values(monthMap).sort((a, b) => a.key.localeCompare(b.key));
    for (const row of months) for (const n of agentNames) if (row[n] == null) row[n] = 0;

    // Units sold per agent, broken down by product type — every issued quote,
    // not just closed ones, since this answers "what does each agent sell",
    // a separate question from the closed-revenue metrics above.
    const agentProductMap = {};
    for (const q of rangedQuotes) {
      const key = q.created_by || "—";
      for (const l of linesOf(q)) {
        const t = l.productType || "—";
        if (!agentProductMap[key]) agentProductMap[key] = {};
        agentProductMap[key][t] = (agentProductMap[key][t] || 0) + (l.quantity || 1);
      }
    }
    const productTypes = [...new Set(Object.values(agentProductMap).flatMap((m) => Object.keys(m)))].sort(compareSku);
    const agentProducts = agents.map((a) => ({
      key: a.key,
      name: a.name,
      byType: agentProductMap[a.key] || {},
      total: Object.values(agentProductMap[a.key] || {}).reduce((s, n) => s + n, 0),
    }));

    const totals = agents.reduce(
      (t, a) => ({
        closedRevenue: t.closedRevenue + a.closedRevenue,
        closedProfit: t.closedProfit + a.closedProfit,
        count: t.count + a.count,
        orders: t.orders + a.orders,
      }),
      { closedRevenue: 0, closedProfit: 0, count: 0, orders: 0 }
    );

    return { agents, missingCost, months, agentNames, agentProducts, productTypes, totals };
  }, [rangedQuotes, sellers, morningDocs]);

  const dateFilterBar = (
    <div className="flex items-center gap-3 flex-wrap">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-slate-500">טווח זמן</span>
        <div className="relative">
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value)}
            dir="rtl"
            className="h-10 rounded-lg border border-black bg-white pl-3 pr-8 text-sm text-slate-700 appearance-none"
          >
            {DATE_PRESETS.map(({ key, label }) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </label>
      {datePreset === "custom" && (
        <div className="flex items-end gap-2">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-10 rounded-lg border border-black bg-white px-3 text-sm text-slate-700" dir="ltr" />
          <span className="text-slate-500 text-sm pb-2.5">עד</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-10 rounded-lg border border-black bg-white px-3 text-sm text-slate-700" dir="ltr" />
        </div>
      )}
    </div>
  );

  if (!rangedQuotes.length) {
    return (
      <div className="space-y-4">
        {dateFilterBar}
        <div className="text-center py-20 text-slate-400 text-sm">אין הצעות בטווח הזמן שנבחר</div>
      </div>
    );
  }

  const leader = agents[0];
  const totalMarginPct = totals.closedRevenue > 0 ? (totals.closedProfit / totals.closedRevenue) * 100 : 0;
  const totalCloseRatePct = totals.count > 0 ? (totals.orders / totals.count) * 100 : 0;
  const totalAvgClosedDeal = totals.orders > 0 ? totals.closedRevenue / totals.orders : 0;

  return (
    <div className="space-y-4">
      {dateFilterBar}

      {/* An 'approved' quote is NOT a closed deal — only a Morning order (type
          100) is, and every ₪ figure on this page is scoped to closed orders
          only. An agent-issued quote sits at status='approved' whether or not
          the client ever ordered, so counting all quotes would inflate every
          agent's numbers by whatever never converted. */}
      <div className="flex items-start gap-2 text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-600">
        <Target className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
        <span>
          <strong>מחזור, רווח, מרווח וממוצע להזמנה מחושבים רק על הצעות שנסגרו בפועל</strong> — כלומר הפכו להזמנה במורנינג.
          "הצעות" ו"אחוז סגירה" כוללים כל הצעה שהוצאה (טיוטה/נשלחה/אושרה), כדי להשוות כמה הוצא מול כמה באמת נסגר —
          הצעה שסומנה "אושרה" אך לא הפכה להזמנה נחשבת לא-סגורה.
        </span>
      </div>

      {/* Headline answers — the questions this screen exists to answer. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {leader && (
          <div className="bg-white border border-primary/40 rounded-2xl p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Award className="w-3.5 h-3.5 text-primary" /> הסוכן המוביל ברווח
            </div>
            <div className="text-lg font-bold text-foreground mt-1">{leader.name}</div>
            <div className="text-sm text-primary font-semibold tabular-nums">{fmt(leader.closedProfit)}</div>
            <div className="text-xs text-slate-400 mt-0.5">מרווח {leader.marginPct.toFixed(1)}% · {leader.orders} הזמנות</div>
          </div>
        )}
        <div className="bg-white border border-black rounded-2xl p-4">
          <div className="text-xs text-slate-500">מחזור סגירה</div>
          <div className="text-2xl font-bold text-foreground tabular-nums mt-1">{fmt(totals.closedRevenue)}</div>
          <div className="text-xs text-slate-400 mt-0.5">מ-{totals.orders} הצעות שנסגרו (לפני מע״מ)</div>
        </div>
        <div className="bg-white border border-black rounded-2xl p-4">
          <div className="text-xs text-slate-500">רווח</div>
          <div className="text-2xl font-bold text-primary tabular-nums mt-1">{fmt(totals.closedProfit)}</div>
          <div className="text-xs text-slate-400 mt-0.5">מתוך מחזור הסגירה</div>
        </div>
        <div className="bg-white border border-black rounded-2xl p-4">
          <div className="text-xs text-slate-500">רווח נקי (%)</div>
          <div className="text-2xl font-bold text-foreground tabular-nums mt-1">{totalMarginPct.toFixed(1)}%</div>
          <div className="text-xs text-slate-400 mt-0.5">רווח חלקי מחזור סגירה</div>
        </div>
        <div className="bg-white border border-black rounded-2xl p-4">
          <div className="text-xs text-slate-500">ממוצע להזמנה שנסגרה</div>
          <div className="text-2xl font-bold text-foreground tabular-nums mt-1">{fmt(totalAvgClosedDeal)}</div>
          <div className="text-xs text-slate-400 mt-0.5">מחזור סגירה חלקי מס׳ הזמנות</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-white border border-black rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Target className="w-3.5 h-3.5 text-slate-400" /> אחוז סגירה כללי
          </div>
          <div className="text-2xl font-bold text-foreground tabular-nums mt-1">{totalCloseRatePct.toFixed(1)}%</div>
          <div className="text-xs text-slate-400 mt-0.5">{totals.orders} הפכו להזמנה מתוך {totals.count} הצעות שהוצאו</div>
        </div>
      </div>

      {missingCost > 0 && (
        <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          <span>
            {missingCost} מתוך {totals.orders} ההזמנות הסגורות נשמרו ללא פירוט עלויות, ולכן נכללות במחזור הסגירה אך לא בחישובי הרווח והמרווח.
          </span>
        </div>
      )}

      {/* Agent ranking — a clean, single-metric sales chart on purpose: pure
          line-item sales, no VAT, no shipping, no document minimum top-up,
          and never mixed with profit in the same bar. Revenue/profit/margin
          still live in the table below for anyone who needs the fuller
          picture. */}
      <Card title="מכירה נטו לפי סוכן" subtitle="סכום מכירה נטו מהזמנות שנסגרו — ללא מע״מ וללא משלוח.">
        <ChartBox height={280}>
          <BarChart data={agents} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₪${(v / 1000).toFixed(0)}k`} />
            <Tooltip {...tooltipProps} />
            <Bar dataKey="closedNetSales" name="מכירה נטו" fill="#C9A84C" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ChartBox>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-200">
                <th className="text-right font-semibold py-1.5">סוכן</th>
                <th className="text-right font-semibold">הצעות</th>
                <th className="text-right font-semibold">הזמנות</th>
                <th className="text-right font-semibold">אחוז סגירה</th>
                <th className="text-right font-semibold">מחזור סגירה</th>
                <th className="text-right font-semibold">רווח</th>
                <th className="text-right font-semibold">רווח נקי</th>
                <th className="text-right font-semibold">ממוצע להזמנה</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a, i) => (
                <tr key={a.key} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 font-medium text-foreground">
                    <span className="inline-block w-2 h-2 rounded-full ml-1.5" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                    {a.name}
                  </td>
                  <td className="tabular-nums text-slate-600">{a.count}</td>
                  <td className="tabular-nums text-slate-600">{a.orders}</td>
                  <td className="tabular-nums font-semibold text-foreground">{a.closeRatePct.toFixed(1)}%</td>
                  <td className="tabular-nums text-slate-600">{fmt(a.closedRevenue)}</td>
                  <td className="tabular-nums font-semibold text-primary">{fmt(a.closedProfit)}</td>
                  <td className={`tabular-nums font-semibold ${a.marginPct < 0 ? "text-red-500" : "text-emerald-600"}`}>{a.marginPct.toFixed(1)}%</td>
                  <td className="tabular-nums text-slate-600">{fmt(a.avgClosedDeal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Trend */}
      <Card title="מגמת רווח לאורך זמן" subtitle="רווח חודשי לכל סוכן מהזמנות שנסגרו — מי בעלייה ומי בירידה.">
        {months.length < 2 ? (
          <p className="text-sm text-slate-400 py-8 text-center">
            צריך לפחות שני חודשים עם הזמנות סגורות בטווח הנבחר כדי להציג מגמה. הרחב את טווח הזמן.
          </p>
        ) : (
          <ChartBox height={300}>
            <LineChart data={months} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₪${(v / 1000).toFixed(0)}k`} />
              <Tooltip {...tooltipProps} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {agentNames.map((n, i) => (
                <Line key={n} type="monotone" dataKey={n} name={n} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
              ))}
            </LineChart>
          </ChartBox>
        )}
      </Card>

      {/* Per-agent product breakdown — units, every issued quote (not scoped
          to closed orders: "what does this agent sell" is a different
          question from the closed-revenue metrics above). Product-only
          breakdowns with no agent dimension live in "ניתוח מוצרים" instead. */}
      <Card title="כמות מוצרים לפי סוג — לכל סוכן" subtitle="יחידות שנמכרו בכל ההצעות שהוצאו, לא רק הזמנות שנסגרו — שורה אחת של 20 יחידות נספרת כ-20.">
        <ChartBox height={280}>
          <BarChart data={agentProducts} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              formatter={(v, name) => [v, name]}
              contentStyle={{ direction: "rtl", borderRadius: 12, border: "1px solid #000", fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {productTypes.map((t, i) => (
              <Bar
                key={t}
                dataKey={(row) => row.byType[t] || 0}
                name={productSku(t) ? `${productSku(t)} · ${productLabel(t)}` : productLabel(t)}
                stackId="units"
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                radius={i === productTypes.length - 1 ? [6, 6, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ChartBox>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-200">
                <th className="text-right font-semibold py-1.5">סוכן</th>
                {productTypes.map((t) => (
                  <th key={t} className="text-right font-semibold px-2">{productSku(t) || productLabel(t)}</th>
                ))}
                <th className="text-right font-semibold px-2">סה״כ יחידות</th>
              </tr>
            </thead>
            <tbody>
              {agentProducts.map((a) => (
                <tr key={a.key} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 font-medium text-foreground">{a.name}</td>
                  {productTypes.map((t) => (
                    <td key={t} className="tabular-nums text-slate-600 px-2">{a.byType[t] || "—"}</td>
                  ))}
                  <td className="tabular-nums font-semibold text-foreground px-2">{a.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
