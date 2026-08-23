import { useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, LabelList, Text } from "recharts";
import { ChevronDown, PackageSearch } from "lucide-react";
import { fmt, DATE_PRESETS, computeDateRange, toLocalDateStr, MORNING_ORDER_TYPE } from "@/lib/quoteLabels";
import { aggregateProducts, latestRevisionsOnly } from "@/lib/quoteEconomics";

const SERIES_COLORS = ["#C9A84C", "#3FA9A0", "#D6608E", "#6B5BA6", "#5CA666", "#C4703F", "#4A7FB5", "#A34F63"];

// A plain `position="top"` label always sits above the bar's own top edge —
// for a negative bar (drawn downward from 0) that "top" is at y=0, right on
// the axis line, so the label collides with the category ticks below it.
// This renders above the bar when positive and below it when negative.
function ValueLabel({ x, y, width, height, value, formatter }) {
  const isNegative = value < 0;
  const labelY = isNegative ? y + height + 14 : y - 8;
  return (
    <Text x={x + width / 2} y={labelY} textAnchor="middle" fontSize={12} fontWeight={600} fill="#334155">
      {formatter(value)}
    </Text>
  );
}

// `barLabel` is the short text printed above each bar — distinct from `format`
// (used in the tooltip/table, where the column header already says what the
// number means) because a label floating over a chart has no such context.
const METRICS = {
  revenue: { label: "מחזור", format: (v) => fmt(v), axisFormat: (v) => `₪${(v / 1000).toFixed(0)}k`, barLabel: (v) => fmt(v), color: "#C9A84C" },
  units: { label: "יחידות שנמכרו", format: (v) => Math.round(v).toLocaleString("he-IL"), axisFormat: (v) => Math.round(v), barLabel: (v) => `${Math.round(v).toLocaleString("he-IL")} יחידות`, color: "#3FA9A0" },
  marginPct: { label: "רווחיות (%)", format: (v) => `${v.toFixed(1)}%`, axisFormat: (v) => `${v}%`, barLabel: (v) => `${v.toFixed(1)}%`, color: "#5CA666" },
  profit: { label: "רווח (₪)", format: (v) => fmt(v), axisFormat: (v) => `₪${(v / 1000).toFixed(0)}k`, barLabel: (v) => fmt(v), color: "#D6608E" },
  avgPrice: { label: "מחיר מכירה ממוצע ליחידה", format: (v) => fmt(v), axisFormat: (v) => `₪${Math.round(v)}`, barLabel: (v) => fmt(v), color: "#6B5BA6" },
};

// One metric, one independent time filter, one chart — each card answers
// exactly one question and can be looked at on its own time window without
// affecting the others.
function ProductMetricCard({ title, subtitle, orders, metricKey }) {
  const [datePreset, setDatePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState(toLocalDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toLocalDateStr(new Date()));
  const metric = METRICS[metricKey];

  const rows = useMemo(() => {
    const { from, to } = computeDateRange(datePreset, customFrom, customTo);
    const inRange = orders.filter((q) => {
      if (!from && !to) return true;
      const created = new Date(q.created_date);
      if (from && created < from) return false;
      if (to && created > to) return false;
      return true;
    });
    return aggregateProducts(inRange)
      .filter((p) => p.units > 0)
      // A product with no saved cost has no knowable profit or margin — it
      // would rank as a flat ₪0 / 0.0% next to real measured values and read
      // as "this product earns nothing", which isn't what the data says.
      // Revenue/units/avgPrice are unaffected, so those views keep it.
      .filter((p) => (metricKey === "profit" || metricKey === "marginPct" ? p.hasCost : true))
      .sort((a, b) => b[metricKey] - a[metricKey]);
  }, [orders, datePreset, customFrom, customTo, metricKey]);

  return (
    <div className="bg-white border border-black rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="relative shrink-0">
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value)}
            dir="rtl"
            className="h-9 rounded-lg border border-black bg-white pl-3 pr-8 text-xs text-slate-700 appearance-none"
          >
            {DATE_PRESETS.map(({ key, label }) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {datePreset === "custom" && (
        <div className="flex items-center gap-2 mb-3">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 rounded-lg border border-black bg-white px-3 text-xs text-slate-700" dir="ltr" />
          <span className="text-slate-500 text-xs">עד</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-9 rounded-lg border border-black bg-white px-3 text-xs text-slate-700" dir="ltr" />
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">אין נתונים בטווח הזמן שנבחר</p>
      ) : (
        <>
          <div dir="ltr" style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={rows} margin={{ top: 24, right: 16, bottom: 20, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="sku" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={metric.axisFormat} />
                <Tooltip
                  formatter={(v) => [metric.format(v), metric.label]}
                  labelFormatter={(sku) => rows.find((r) => r.sku === sku)?.label || sku}
                  contentStyle={{ direction: "rtl", borderRadius: 12, border: "1px solid #000", fontSize: 12 }}
                />
                <Bar dataKey={metricKey} radius={[6, 6, 0, 0]} maxBarSize={36}>
                  {rows.map((r, i) => (
                    <Cell key={r.type} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
                  ))}
                  <LabelList dataKey={metricKey} content={(props) => <ValueLabel {...props} formatter={metric.barLabel} />} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-200">
                  <th className="text-right font-semibold py-1.5">מק״ט</th>
                  <th className="text-right font-semibold">מוצר</th>
                  <th className="text-right font-semibold">{metric.label}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.type} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 font-mono text-xs text-slate-500">
                      <span className="inline-block w-2 h-2 rounded-full ml-1.5" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                      {r.sku || "—"}
                    </td>
                    <td className="text-foreground">{r.name}</td>
                    <td
                      className="tabular-nums font-semibold"
                      style={{ color: r[metricKey] < 0 ? "#ef4444" : metric.color }}
                    >
                      {metric.format(r[metricKey])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// Pie view of the product split — a different lens from the ranked bar cards
// above: proportion of the whole, not "who's #1". Moved here from the
// per-agent report (it has no agent dimension, so it belongs with the other
// product-only breakdowns) — and switched to orders-only to match this tab's
// rule, same as every other card here.
function ProductPieCard({ orders }) {
  const [datePreset, setDatePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState(toLocalDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toLocalDateStr(new Date()));
  const [metricKey, setMetricKey] = useState("revenue");
  const metric = METRICS[metricKey];

  const rows = useMemo(() => {
    const { from, to } = computeDateRange(datePreset, customFrom, customTo);
    const inRange = orders.filter((q) => {
      if (!from && !to) return true;
      const created = new Date(q.created_date);
      if (from && created < from) return false;
      if (to && created > to) return false;
      return true;
    });
    return aggregateProducts(inRange)
      .filter((p) => p.units > 0)
      // A product with no saved cost has no knowable profit or margin — it
      // would rank as a flat ₪0 / 0.0% next to real measured values and read
      // as "this product earns nothing", which isn't what the data says.
      // Revenue/units/avgPrice are unaffected, so those views keep it.
      .filter((p) => (metricKey === "profit" || metricKey === "marginPct" ? p.hasCost : true))
      .sort((a, b) => b[metricKey] - a[metricKey]);
  }, [orders, datePreset, customFrom, customTo, metricKey]);

  return (
    <div className="bg-white border border-black rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">פילוח לפי מוצר</h3>
          <p className="text-xs text-slate-500 mt-0.5">מחושב לפי שורות ההזמנה בלבד — משלוח ומחיר מינימום למסמך אינם משויכים למוצר ולכן אינם נכללים כאן.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {["revenue", "profit"].map((key) => (
            <button
              key={key}
              onClick={() => setMetricKey(key)}
              className={`h-8 px-3 text-xs rounded-lg border transition-colors ${
                metricKey === key ? "border-primary bg-primary/10 text-primary font-semibold" : "border-black text-slate-500 hover:border-slate-500"
              }`}
            >
              {key === "revenue" ? "לפי מחזור" : "לפי רווח"}
            </button>
          ))}
          <div className="relative">
            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value)}
              dir="rtl"
              className="h-9 rounded-lg border border-black bg-white pl-3 pr-8 text-xs text-slate-700 appearance-none"
            >
              {DATE_PRESETS.map(({ key, label }) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {datePreset === "custom" && (
        <div className="flex items-center gap-2 mb-3">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 rounded-lg border border-black bg-white px-3 text-xs text-slate-700" dir="ltr" />
          <span className="text-slate-500 text-xs">עד</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-9 rounded-lg border border-black bg-white px-3 text-xs text-slate-700" dir="ltr" />
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">אין נתונים בטווח הזמן שנבחר</p>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div dir="ltr" style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={rows}
                    dataKey={metricKey}
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius="75%"
                    paddingAngle={2}
                    // Label by NAME, not by מק"ט: a product with no catalogue
                    // code (free_product) has an empty sku, which rendered as
                    // a bare orphan "34%" with nothing identifying it. The
                    // percent leads so the two never transpose visually
                    // inside this LTR chart container.
                    label={({ name, sku, percent }) =>
                      percent > 0.04 ? `${(percent * 100).toFixed(0)}% · ${name || sku || "—"}` : ""
                    }
                    labelLine={false}
                  >
                    {rows.map((r, i) => (
                      <Cell key={r.type} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => [metric.format(v), metric.label]}
                    contentStyle={{ direction: "rtl", borderRadius: 12, border: "1px solid #000", fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div dir="ltr" style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={rows} margin={{ top: 24, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="sku" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={metric.axisFormat} />
                  <Tooltip
                    formatter={(v) => [metric.format(v), metric.label]}
                    labelFormatter={(sku) => rows.find((r) => r.sku === sku)?.label || sku}
                    contentStyle={{ direction: "rtl", borderRadius: 12, border: "1px solid #000", fontSize: 12 }}
                  />
                  <Bar dataKey={metricKey} radius={[6, 6, 0, 0]} maxBarSize={36}>
                    {rows.map((r, i) => (
                      <Cell key={r.type} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-200">
                  <th className="text-right font-semibold py-1.5">מק״ט</th>
                  <th className="text-right font-semibold">מוצר</th>
                  <th className="text-right font-semibold">שורות</th>
                  <th className="text-right font-semibold">מחזור</th>
                  <th className="text-right font-semibold">רווח</th>
                  <th className="text-right font-semibold">מרווח</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.type} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 font-mono text-xs text-slate-500">
                      <span className="inline-block w-2 h-2 rounded-full ml-1.5" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                      {r.sku || "—"}
                    </td>
                    <td className="text-foreground">{r.name}</td>
                    <td className="tabular-nums text-slate-600">{r.lines}</td>
                    <td className="tabular-nums text-slate-600">{fmt(r.revenue)}</td>
                    {/* A line with no saved cost (מוצר חופשי, and older
                        graphics-style rows) has an UNKNOWN profit, not a zero
                        one — printing revenue as profit produced a fake 100%
                        margin and inflated every profit figure on the tab. */}
                    <td className="tabular-nums font-semibold text-primary">
                      {r.hasCost ? fmt(r.profit) : <span className="text-slate-400 font-normal">—</span>}
                    </td>
                    <td className={`tabular-nums font-semibold ${!r.hasCost ? "" : r.marginPct < 0 ? "text-red-500" : "text-emerald-600"}`}>
                      {r.hasCost ? (
                        <>
                          {r.marginPct.toFixed(1)}%
                          {r.costMissing > 0 && (
                            <span className="text-[10px] text-amber-600 font-normal mr-1" title={`${r.costMissing} שורות ללא עלות שמורה — לא נכללות בחישוב הרווחיות`}>
                              ({r.costMissing} ללא עלות)
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400 font-normal" title="אין עלות שמורה לשורות של מוצר זה — לא ניתן לחשב רווחיות">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// Product analytics counts ONLY quotes that actually became a Morning order
// (morning_documents_map type 100) — not drafts, not quotes merely sent for
// review or issued to the client but never turned into a real order. This is
// deliberately a smaller, truthier set than the agent-analytics tab.
export default function ProductAnalytics({ quotes, morningDocs }) {
  // הזמנות (default) = quotes that became a real Morning order.
  // הצעות = every issued quote, ordered or not. The two answer different
  // questions ("what did we sell" vs "what do we offer"), so they must never
  // be silently mixed — hence an explicit switch rather than one blended set.
  const [scope, setScope] = useState("orders");

  const orders = useMemo(() => {
    // latestRevisionsOnly first: a revised quote is one deal saved as two
    // rows, and if both ever became orders the units/revenue would double.
    const live = latestRevisionsOnly(quotes);
    const rows = scope === "orders"
      ? live.filter((q) => morningDocs[q.id]?.morning_document_type === MORNING_ORDER_TYPE)
      : live;
    // Date every ORDER by when Morning actually issued it, not by when the
    // quote behind it was first drafted — a quote written last month and
    // confirmed today is this month's business. Same correction already made
    // to the sales email report (v1.0.100); the charts here were still
    // filtering on created_date and misattributing those orders.
    return rows.map((q) => {
      const orderedAt = morningDocs[q.id]?.created_at;
      return scope === "orders" && orderedAt ? { ...q, created_date: orderedAt } : q;
    });
  }, [quotes, morningDocs, scope]);

  const scopeSwitch = (
    <div className="flex items-center gap-2">
      {[
        { key: "orders", label: "הזמנות" },
        { key: "quotes", label: "הצעות מחיר" },
      ].map(({ key, label }) => (
        <button
          key={key}
          onClick={() => setScope(key)}
          className={`h-8 px-3 text-xs rounded-lg border transition-colors ${
            scope === key ? "border-primary bg-primary/10 text-primary font-semibold" : "border-black text-slate-500 hover:border-slate-500"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (!orders.length) {
    return (
      <div className="bg-white border border-black rounded-2xl p-8 text-center">
        <PackageSearch className="w-8 h-8 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-foreground font-semibold">
          {scope === "orders" ? "אין עדיין הזמנות בפועל" : "אין עדיין הצעות מחיר"}
        </p>
        <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
          {scope === "orders"
            ? "התצוגה הזו סופרת רק הצעות שהונפקו בפועל כהזמנה במורנינג — לא טיוטות, לא הצעות שנשלחו לבדיקה, ולא הצעות שהונפקו ללקוח בלי שהפכו להזמנה. אפשר לעבור ל\"הצעות מחיר\" כדי לראות גם כאלה שטרם נסגרו."
            : "עדיין לא נשמרו הצעות מחיר במערכת."}
        </p>
        {/* The switch has to stay reachable here too — otherwise an empty
            "הזמנות" view is a dead end with no way back to "הצעות מחיר". */}
        <div className="flex justify-center mt-4">{scopeSwitch}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground">ניתוח מוצרים</h3>
        {scopeSwitch}
      </div>

      <div className="flex items-start gap-2 text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-600">
        <PackageSearch className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
        <span>
          מבוסס על {orders.length} {scope === "orders" ? "הזמנות שהונפקו בפועל במורנינג" : "הצעות מחיר שהוצאו (כולל כאלה שלא נסגרו)"}.
          כל גרף מסונן בנפרד לפי הזמן שבחרת עבורו
          {scope === "orders" && " — לפי התאריך שבו ההזמנה הונפקה במורנינג, לא לפי מתי ההצעה נכתבה"}.
          {" "}המחזור והרווח מחושבים ברמת השורה (לא כולל מע״מ, משלוח או התקנה — אלה שייכים להצעה כולה, לא למוצר ספציפי),
          ומשוקללים לפי הנחת המנהל בפועל. שורות ללא עלות שמורה מסומנות ולא נכללות בחישוב הרווחיות.
        </span>
      </div>

      <ProductPieCard orders={orders} />

      <ProductMetricCard
        title="הכי הרבה מחזור"
        subtitle="לפני מע״מ, לא כולל משלוח והתקנה"
        orders={orders}
        metricKey="revenue"
      />
      <ProductMetricCard
        title="הכי הרבה יחידות"
        subtitle="כמות יחידות שנמכרו בפועל"
        orders={orders}
        metricKey="units"
      />
      <ProductMetricCard
        title="הרווחיות הגבוהה ביותר (%)"
        subtitle="רווח כאחוז מהמחזור — לא סכום הרווח"
        orders={orders}
        metricKey="marginPct"
      />
      <ProductMetricCard
        title="הרווח הגבוה ביותר (₪)"
        subtitle="סכום הרווח בפועל, לא אחוז"
        orders={orders}
        metricKey="profit"
      />
      <ProductMetricCard
        title="מחיר מכירה ממוצע ליחידה"
        subtitle="מחזור חלקי יחידות — עוזר לזהות מוצר שנמכר הרבה במחיר נמוך"
        orders={orders}
        metricKey="avgPrice"
      />
    </div>
  );
}
