import { XCircle } from "lucide-react";
import { fmtInt } from "./format";

// Why deals die, ranked. A bar list rather than a pie: the question is
// "which reason dominates", which is a comparison of lengths, and the labels
// are free text that a pie's legend would truncate.
export default function LostReasons({ rows }) {
  const data = rows || [];
  const max = Math.max(1, ...data.map((r) => r.n));
  const total = data.reduce((s, r) => s + r.n, 0);

  return (
    <div className="border border-black rounded-xl bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <XCircle className="w-4 h-4 text-slate-500" />
        <span className="font-semibold text-sm">סיבות הפסד</span>
        {total > 0 && <span className="text-xs text-slate-400">{fmtInt(total)} לידים</span>}
      </div>
      {data.length === 0 ? (
        <div className="text-center py-10 text-sm text-slate-400">אין לידים אבודים בטווח שנבחר</div>
      ) : (
        <div className="space-y-2">
          {data.slice(0, 8).map((r) => (
            <div key={r.reason} className="flex items-center gap-3">
              <div className="w-32 shrink-0 text-xs text-slate-600 truncate" title={r.reason}>{r.reason}</div>
              <div className="flex-1 h-5 bg-slate-50 rounded">
                <div className="h-full rounded bg-[#A34F63]" style={{ width: `${(r.n / max) * 100}%` }} />
              </div>
              <div className="w-20 shrink-0 text-xs text-slate-500 text-left" dir="ltr">
                {fmtInt(r.n)} · {Math.round((r.n / total) * 100)}%
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
