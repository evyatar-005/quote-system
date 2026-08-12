import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { leadQueue } from "@/api/leadQueueClient";

// ‹ prev/next › between the agent's OWN claimed leads (not the pool) — lets
// an agent move on to the next lead they're working without leaving the
// workspace and going back through "היום שלי". Navigating between two
// /crm/leads/:id/workspace URLs doesn't remount LeadWorkspace (its
// useEffect already depends on the :id param), so this refreshes the
// content in place.
export default function LeadSwitcher({ leadId }) {
  const navigate = useNavigate();
  const [siblings, setSiblings] = useState(null);

  useEffect(() => {
    leadQueue.myClaimedLeads().then(setSiblings).catch(() => setSiblings([]));
  }, []);

  if (!siblings || siblings.length === 0) return null;

  const idx = siblings.findIndex((l) => l.id === leadId);
  if (idx === -1) return null; // e.g. released in another tab — don't show a broken switcher

  const go = (i) => navigate(`/crm/leads/${siblings[i].id}/workspace`);

  return (
    <div className="flex items-center gap-1 text-xs text-slate-500 shrink-0" dir="ltr">
      <button
        type="button"
        disabled={idx <= 0}
        onClick={() => go(idx - 1)}
        className="w-6 h-6 rounded-md border border-slate-200 flex items-center justify-center disabled:opacity-30 hover:bg-slate-50"
        title={idx > 0 ? siblings[idx - 1].display_name : ""}
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <span dir="rtl" className="px-1">{idx + 1}/{siblings.length}</span>
      <button
        type="button"
        disabled={idx >= siblings.length - 1}
        onClick={() => go(idx + 1)}
        className="w-6 h-6 rounded-md border border-slate-200 flex items-center justify-center disabled:opacity-30 hover:bg-slate-50"
        title={idx < siblings.length - 1 ? siblings[idx + 1].display_name : ""}
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
