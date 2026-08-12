import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { Timer } from "lucide-react";
import { fmtDuration, fmtInt, fmtPct, TOOLTIP_STYLE } from "./format";

const AXIS = { tick: { fontSize: 11, fill: "#94a3b8" }, axisLine: false, tickLine: false };

// Response speed vs. outcome. The bars alone would just be an operations
// report; pairing them with the win rate per bucket is what turns it into an
// argument — if the leftmost buckets close at a visibly higher rate, the
// reply-time SLA is worth money, and if they don't, it isn't.
export default function SlaPanel({ sla, overdueMinutes }) {
  if (!sla) return null;
  const data = (sla.by_bucket || []).map((b) => ({ ...b, x: b.label }));
  const hasData = data.some((b) => b.n > 0);

  return (
    <div className="border border-black rounded-xl bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <Timer className="w-4 h-4 text-slate-500" />
        <span className="font-semibold text-sm">מהירות תגובה מול סגירה</span>
        <span className="text-xs text-slate-400">יעד: מענה תוך {overdueMinutes} דקות</span>
      </div>

      {!hasData ? (
        <div className="text-center py-10 text-sm text-slate-400">אין שיחות ווטסאפ משויכות ללידים בטווח שנבחר</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Stat label="זמן מענה חציוני" value={fmtDuration(sla.median_response_ms)} />
            <Stat label="זמן מענה ממוצע" value={fmtDuration(sla.avg_response_ms)} />
            <Stat label="עמידה ביעד" value={fmtPct(sla.within_sla_pct)} />
            <Stat label="ללא מענה כלל" value={fmtInt(sla.no_response)} tone={sla.no_response > 0 ? "text-red-600" : ""} />
          </div>

          <div dir="ltr" style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="x" {...AXIS} />
                <YAxis yAxisId="left" {...AXIS} width={36} tickFormatter={fmtInt} />
                <YAxis yAxisId="right" orientation="right" {...AXIS} width={40} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v, n) => [n === "% סגירה" ? fmtPct(v) : fmtInt(v), n]}
                />
                <Legend wrapperStyle={{ fontSize: 11, direction: "rtl" }} />
                <Bar yAxisId="left" dataKey="n" name="לידים" fill="#4A7FB5" radius={[3, 3, 0, 0]} />
                {/* connectNulls: an empty bucket has no win rate at all, so
                    the line bridges it rather than diving to 0%. */}
                <Line yAxisId="right" type="monotone" dataKey="won_rate" name="% סגירה" stroke="#5CA666" strokeWidth={2} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "" }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className={`text-lg font-bold leading-none ${tone}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-1">{label}</div>
    </div>
  );
}
