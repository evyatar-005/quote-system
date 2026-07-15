import { useState } from "react";
import { ChevronDown } from "lucide-react";

// Meant to be used several-in-a-row inside a `flex flex-wrap` parent (see
// SalesPriceTable.jsx). Renders as two SEPARATE flex children, not one nested
// box: the trigger chip (small, content-sized, default order) and — only when
// open — the content panel. The panel gets `order-last basis-full`, which
// flexbox guarantees sorts after every chip and forces it onto its own
// full-width line — so no matter which chips are open or in what sequence,
// ALL the small trigger chips stay together in the top row(s), and every open
// panel renders below them, in DOM order.
export default function CollapsibleSection({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 shadow-sm transition-colors whitespace-nowrap ${
          open ? "border-amber-400 bg-amber-50 text-amber-700" : "border-slate-900 bg-slate-100 hover:bg-slate-200"
        }`}
      >
        <span className="text-sm font-semibold">{title}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="order-last basis-full w-full border-2 border-slate-900 rounded-lg shadow-sm p-4">
          {children}
        </div>
      )}
    </>
  );
}
