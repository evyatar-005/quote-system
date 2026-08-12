import { useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { fmtBucket, fmtInt, fmtMoney, TOOLTIP_STYLE } from "./format";

// Which marks each metric view draws. Volume is the default because "how
// many leads are arriving" is the question the page opens on; the cost views
// are only meaningful once a budget has been entered, and render as gaps
// (null, not 0) when it hasn't — see the spend handling in routes/crm.js.
const METRICS = [
  { key: "volume", label: "נפח" },
  { key: "spend", label: "הוצאה" },
  { key: "efficiency", label: "עלות" },
];

const AXIS = { tick: { fontSize: 11, fill: "#94a3b8" }, axisLine: false, tickLine: false };

export default function TrendChart({ series, title = "מגמה לאורך זמן" }) {
  const [metric, setMetric] = useState("volume");
  const points = series?.points || [];
  const granularity = series?.granularity || "day";

  const data = points.map((p) => ({ ...p, x: fmtBucket(p.bucket, granularity) }));
  const money = metric !== "volume";

  return (
    <div className="border border-black rounded-xl bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-slate-500" />
        <span className="font-semibold text-sm">{title}</span>
        <span className="text-xs text-slate-400">{granularity === "day" ? "לפי יום" : "לפי חודש"}</span>
        <div className="flex items-center gap-1 mr-auto">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              className={`h-7 px-2.5 text-xs rounded-lg border transition-colors ${
                metric === m.key ? "border-primary bg-primary/10 text-primary font-semibold" : "border-slate-200 text-slate-500 hover:border-slate-400"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="text-center py-10 text-sm text-slate-400">אין נתונים בטווח שנבחר</div>
      ) : (
        <div dir="ltr" style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="x" {...AXIS} interval="preserveStartEnd" minTickGap={12} />
              <YAxis {...AXIS} width={44} tickFormatter={money ? (v) => `₪${v}` : fmtInt} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v, n) => [money ? fmtMoney(v) : fmtInt(v), n]}
              />
              <Legend wrapperStyle={{ fontSize: 11, direction: "rtl" }} />

              {metric === "volume" && <Bar dataKey="leads" name="לידים" fill="#C9A84C" radius={[3, 3, 0, 0]} />}
              {metric === "volume" && <Bar dataKey="quoted" name="הצעות" fill="#3FA9A0" radius={[3, 3, 0, 0]} />}
              {metric === "volume" && <Bar dataKey="won" name="עסקאות" fill="#5CA666" radius={[3, 3, 0, 0]} />}

              {metric === "spend" && <Bar dataKey="spend" name="הוצאה" fill="#6B5BA6" radius={[3, 3, 0, 0]} />}

              {/* connectNulls={false}: a bucket with no budget entered is a
                  hole in the data, not a drop to zero — joining across it
                  would draw a cost trend that never happened. */}
              {metric === "efficiency" && <Line type="monotone" dataKey="cpl" name="עלות לליד" stroke="#C4703F" strokeWidth={2} dot={false} connectNulls={false} />}
              {metric === "efficiency" && <Line type="monotone" dataKey="cpa" name="עלות לעסקה" stroke="#D6608E" strokeWidth={2} dot={false} connectNulls={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
