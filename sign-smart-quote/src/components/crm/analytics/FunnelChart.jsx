import { Filter } from "lucide-react";
import { fmtInt, fmtPct, fmtDays } from "./format";

// Horizontal cohort funnel. Plain divs rather than recharts: a funnel's
// meaning lives in the step-to-step percentages and dwell times between the
// bars, which a chart library would make harder to place, not easier.
//
// All three stages describe the SAME cohort (leads that arrived in the
// window) — see the funnel query in routes/crm.js — so the bars are
// guaranteed monotonically narrowing and the drop-off between them is real.
export default function FunnelChart({ funnel }) {
  if (!funnel) return null;
  const top = funnel.leads_in || 0;
  const stages = [
    { label: "לידים נכנסים", value: funnel.leads_in, color: "#C9A84C", step: null, gap: null },
    { label: "הגיעו להצעת מחיר", value: funnel.leads_quoted, color: "#3FA9A0", step: funnel.quote_rate, gap: funnel.avg_days_to_quote, gapLabel: "זמן ממוצע עד הצעה" },
    { label: "נסגרה עסקה", value: funnel.leads_won, color: "#5CA666", step: funnel.close_rate, gap: funnel.avg_days_quote_to_close, gapLabel: "זמן ממוצע מהצעה לסגירה" },
  ];

  return (
    <div className="border border-black rounded-xl bg-white p-4">
      <div className="flex items-center gap-2 mb-4">
        <Filter className="w-4 h-4 text-slate-500" />
        <span className="font-semibold text-sm">משפך המרה</span>
        <span className="text-xs text-slate-400">
          {top ? `${fmtPct(funnel.win_rate)} מהלידים נסגרו בעסקה` : "אין לידים בטווח"}
        </span>
        {funnel.leads_dead > 0 && (
          <span className="text-xs text-slate-400 mr-auto">{fmtInt(funnel.leads_dead)} אבודים / לא רלוונטיים</span>
        )}
      </div>

      <div className="space-y-1">
        {stages.map((s, i) => (
          <div key={s.label}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-1 pr-3 text-xs text-slate-400">
                <span className="text-slate-300">↓</span>
                <span className={s.step != null && s.step < 100 ? "font-semibold text-slate-500" : ""}>
                  {fmtPct(s.step)} מעבר
                </span>
                {s.gap != null && <span>· {s.gapLabel}: {fmtDays(s.gap)}</span>}
              </div>
            )}
            <div className="flex items-center gap-3">
              {/* Width is share-of-top so the narrowing is proportional; a
                  non-zero stage keeps a 4% floor so it stays clickable-wide
                  and visible rather than collapsing to a sliver. */}
              <div className="flex-1 h-9 bg-slate-50 rounded-lg overflow-hidden">
                <div
                  className="h-full rounded-lg flex items-center px-3 text-white text-sm font-semibold transition-all"
                  style={{
                    width: top ? `${Math.max(s.value ? 4 : 0, (s.value / top) * 100)}%` : "0%",
                    background: s.color,
                  }}
                >
                  {s.value > 0 && fmtInt(s.value)}
                </div>
              </div>
              <div className="w-40 shrink-0 text-xs">
                <div className="font-semibold text-slate-700">{s.label}</div>
                <div className="text-slate-400">{fmtInt(s.value)} · {fmtPct(top ? Math.round((s.value / top) * 1000) / 10 : null)} מהסך</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
