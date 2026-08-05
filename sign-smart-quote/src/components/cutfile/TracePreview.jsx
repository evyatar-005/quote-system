// The automated equivalent of Illustrator step 5 ("בדיקת התמונה מול הקו
// חיתוך מוכן ותיקונים") — the source photo with the traced outline and the
// final (offset) cut line drawn over it, so the graphic designer can confirm
// the shape before downloading instead of guessing blind.
//
// Paths (tracePathD/cutPathD) are in millimetre space, same origin/orientation
// (top-left, Y-down) as the source image — the overlay SVG's viewBox is set to
// the same width/height in mm with preserveAspectRatio="none" so it lines up
// with the <img> regardless of the image's on-screen pixel size.

export default function TracePreview({ sourceUrl, widthMm, heightMm, tracePathD, cutPathD, loading }) {
  return (
    <div className="relative inline-block max-w-full rounded-xl overflow-hidden border-2 border-slate-900 bg-[repeating-conic-gradient(#e2e8f0_0%_25%,white_0%_50%)] bg-[length:16px_16px]">
      {sourceUrl && (
        <img src={sourceUrl} alt="תמונת מקור" className="block max-w-full max-h-[60vh] w-auto h-auto" />
      )}
      {sourceUrl && widthMm > 0 && heightMm > 0 && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${widthMm} ${heightMm}`}
          preserveAspectRatio="none"
        >
          {tracePathD && (
            <path d={tracePathD} fill="none" stroke="#22c55e" strokeWidth={Math.max(widthMm * 0.0015, 0.3)} opacity={0.85} />
          )}
          {cutPathD && (
            <path d={cutPathD} fill="none" stroke="#ef4444" strokeWidth={Math.max(widthMm * 0.0025, 0.5)} />
          )}
        </svg>
      )}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/40">
          <div className="w-8 h-8 border-4 border-slate-300 border-t-amber-600 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
