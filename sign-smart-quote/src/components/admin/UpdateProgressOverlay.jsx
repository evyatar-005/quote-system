import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Rocket } from "lucide-react";

// Full-screen takeover shown while deploy/UPDATE.ps1 runs on the server.
// It exists mostly to stop people from clicking things mid-deploy: the server
// is stopped and restarted underneath, so any request made during this window
// fails in a way that looks like a bug but isn't.
//
// The countdown is a progress indication, not the actual completion signal —
// AboutSection polls /api/version and reports back through `phase`. A deploy
// that finishes in 25s closes early; one that needs 90s keeps waiting instead
// of lying that it's done.
const TOTAL_SECONDS = 60;

const STEPS = [
  { at: 0,  label: "מגבה את בסיס הנתונים" },
  { at: 8,  label: "מוריד את הגרסה החדשה מ-GitHub" },
  { at: 20, label: "מתקין תלויות" },
  { at: 32, label: "בונה את הממשק" },
  { at: 48, label: "מפעיל מחדש את השרת" },
];

export default function UpdateProgressOverlay({ phase, version, error, onClose }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const remaining = Math.max(0, TOTAL_SECONDS - elapsed);
  const pct = Math.min(100, (elapsed / TOTAL_SECONDS) * 100);
  const currentStep = [...STEPS].reverse().find((s) => elapsed >= s.at) || STEPS[0];

  // Circumference of the r=52 progress ring below.
  const CIRC = 2 * Math.PI * 52;

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border-2 border-slate-300 overflow-hidden">
        <div className="h-1.5 w-full flex">
          <div className="flex-1 bg-brand-pink" />
          <div className="flex-1 bg-brand-gold" />
          <div className="flex-1 bg-brand-teal" />
          <div className="flex-1 bg-brand-green" />
          <div className="flex-1 bg-brand-purple" />
        </div>

        <div className="p-8 text-center">
          {phase === "running" && (
            <>
              <div className="relative w-32 h-32 mx-auto mb-6">
                <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="8" className="text-slate-200" />
                  <circle
                    cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round"
                    className="text-[#C9A84C] transition-all duration-1000 ease-linear"
                    strokeDasharray={CIRC}
                    strokeDashoffset={CIRC - (pct / 100) * CIRC}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-slate-900 tabular-nums">{remaining}</span>
                  <span className="text-xs text-slate-500">שניות</span>
                </div>
              </div>

              <h2 className="text-xl font-bold text-slate-900">מתבצע עדכון מערכת</h2>
              <p className="text-sm text-slate-500 mt-1.5">{currentStep.label}…</p>

              <div className="mt-6 space-y-2 text-right">
                {STEPS.map((s) => {
                  const done = elapsed > (STEPS[STEPS.indexOf(s) + 1]?.at ?? TOTAL_SECONDS);
                  const active = s === currentStep && !done;
                  return (
                    <div key={s.at} className="flex items-center gap-2 text-sm">
                      {done ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${active ? "border-[#C9A84C] animate-pulse" : "border-slate-300"}`} />
                      )}
                      <span className={done ? "text-slate-400 line-through" : active ? "text-slate-900 font-semibold" : "text-slate-400"}>
                        {s.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="text-xs text-slate-400 mt-6">
                אל תסגור את החלון. הממשק יתרענן אוטומטית בסיום.
                {remaining === 0 && " העדכון נמשך יותר מהצפוי — עדיין ממתין…"}
              </p>
            </>
          )}

          {phase === "done" && (
            <>
              <CheckCircle2 className="w-16 h-16 text-emerald-600 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-slate-900">העדכון הושלם</h2>
              <p className="text-sm text-slate-500 mt-1.5">
                גרסה <span className="font-semibold">{version?.version}</span> רצה כעת
              </p>
              <p className="text-xs text-slate-400 mt-4">מרענן את הממשק…</p>
            </>
          )}

          {(phase === "failed" || phase === "rejected") && (
            <>
              <AlertTriangle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-slate-900">
                {phase === "rejected" ? "העדכון לא הופעל" : "לא הצלחנו לאשר שהעדכון הסתיים"}
              </h2>
              <p className="text-sm text-slate-600 mt-2">{error}</p>
              <p className="text-xs text-slate-400 mt-3">
                {phase === "rejected"
                  ? "השרת לא נגע בכלום והמערכת ממשיכה לרוץ כרגיל."
                  : <>העדכון עשוי עדיין לרוץ ברקע. אם השרת חוזר מעצמו — הכל תקין. אחרת יש להריץ את <span className="font-mono">deploy\UPDATE.ps1</span> ידנית בשרת.</>}
              </p>
              <button
                onClick={onClose}
                className="mt-5 h-10 px-5 rounded-lg bg-[#C9A84C] text-black font-semibold hover:bg-[#C9A84C]/90"
              >
                סגור
              </button>
            </>
          )}

          {phase === "starting" && (
            <>
              <Rocket className="w-16 h-16 text-[#C9A84C] mx-auto mb-4 animate-pulse" />
              <h2 className="text-xl font-bold text-slate-900">מפעיל את העדכון…</h2>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
