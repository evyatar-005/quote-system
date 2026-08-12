import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

// Replaces the page's old PeriodTile: same box, plus a period-over-period
// delta and a sparkline. A bare number can't tell a manager whether a
// campaign is improving — the delta is the entire point of the tile.
//
// `lowerIsBetter` flips only the COLOUR, never the arrow: the arrow always
// reports the direction the number moved, so "ימים לסגירה ↓" reads as a green
// down-arrow rather than a confusing green up-arrow.
export default function KpiTile({
  label,
  value,
  previous,
  format = (v) => v,
  series,
  seriesKey,
  lowerIsBetter = false,
}) {
  const hasPrev = previous != null && value != null;
  // No baseline to divide by: 0 → 5 is a real change but an infinite
  // percentage, so show the arrow without a meaningless number.
  const deltaPct = hasPrev && previous !== 0
    ? Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10
    : null;
  const dir = hasPrev ? Math.sign(value - previous) : 0;
  const good = lowerIsBetter ? dir < 0 : dir > 0;
  const Arrow = dir === 0 ? Minus : dir > 0 ? ArrowUp : ArrowDown;
  const tone = dir === 0 ? "text-slate-400" : good ? "text-emerald-600" : "text-red-500";

  const spark = seriesKey && series?.points?.length > 1 ? series.points : null;

  return (
    <div className="border border-black rounded-xl bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-2xl font-bold leading-none">{format(value)}</div>
          <div className="text-xs text-slate-500 mt-1">{label}</div>
        </div>
        {spark && (
          <div dir="ltr" className="w-16 h-8 shrink-0 opacity-70">
            <ResponsiveContainer>
              <AreaChart data={spark} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                <Area type="monotone" dataKey={seriesKey} stroke="#C9A84C" fill="#C9A84C" fillOpacity={0.18} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {hasPrev && (
        <div className={`mt-2 flex items-center gap-1 text-xs font-semibold ${tone}`}>
          <Arrow className="w-3 h-3" />
          {deltaPct == null ? "—" : `${Math.abs(deltaPct)}%`}
          <span className="text-slate-400 font-normal">מול התקופה הקודמת ({format(previous)})</span>
        </div>
      )}
    </div>
  );
}
