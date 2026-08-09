import { CheckCircle2, Download, X } from "lucide-react";

// Small centered confirmation shown right after a Morning document (quote,
// order, invoice — whatever type was just issued) is created, so the agent
// gets an explicit "download it now" moment instead of having to dig through
// history for the file. Purely a convenience popup — closing it loses
// nothing, the same link stays available in "ההצעות שלי" afterward.
export default function DocumentIssuedModal({ documentUrl, documentLabel = "המסמך", onClose }) {
  if (!documentUrl) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4 relative"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-3 left-3 p-1 rounded-lg text-slate-400 hover:bg-slate-100">
          <X className="w-4 h-4" />
        </button>
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 flex items-center justify-center">
          <CheckCircle2 className="w-6 h-6 text-emerald-500" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-800">{documentLabel} הונפק/ה בהצלחה במורנינג</h3>
          <p className="text-sm text-slate-500 mt-1">אפשר להוריד את המסמך המקורי עכשיו</p>
        </div>
        <a
          href={documentUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors"
        >
          <Download className="w-4 h-4" /> הורד מסמך
        </a>
        <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600">
          סגור
        </button>
      </div>
    </div>
  );
}
