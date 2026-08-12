import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, XCircle, Calculator, LogOut } from "lucide-react";
import { leadQueue } from "@/api/leadQueueClient";
import { crmLeads } from "@/api/crmClient";
import { Button } from "@/components/ui/button";
import ConversationThread from "@/components/crm/ConversationThread";
import LeadFieldsPanel from "@/components/crm/LeadFieldsPanel";
import DriveMaterialsPanel from "@/components/crm/DriveMaterialsPanel";
import FollowUpScheduler from "@/components/crm/FollowUpScheduler";
import { toast } from "sonner";

// The actual "work a lead" body — thread + fields + drive + outcome actions.
// Extracted out of the standalone LeadWorkspace.jsx page so it can ALSO be
// rendered inline inside "היום שלי" (MyDay.jsx opens this in place of the
// lead list instead of navigating to a separate page/URL) — same component,
// same logic, two mount points. `onChanged` lets an embedding parent (e.g.
// MyDay) know an outcome fired so it can refresh its own lists; standalone
// LeadWorkspace.jsx passes navigate("/my-day") instead.
export default function LeadWorkspacePanel({ leadId, onChanged, onContext }) {
  const navigate = useNavigate();
  const [context, setContextState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Wraps setContext so a standalone-page wrapper can mirror customer name /
  // claim badge into its own header without a second fetch.
  const setContext = useCallback((c) => {
    setContextState(c);
    onContext?.(c);
  }, [onContext]);

  const load = useCallback(async () => {
    try {
      setContext(await leadQueue.context(leadId));
    } catch (err) {
      toast.error(err.message || "טעינת הליד נכשלה");
    } finally {
      setLoading(false);
    }
  }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // Opens in a NEW TAB (not a same-tab navigate) — per direct request: the
  // agent needs to keep working the WhatsApp conversation on this tab while
  // building the quote on the other one. A new tab is a fresh browsing
  // context with no access to router `state`, so client details go as URL
  // query params instead; CostsDashboard.jsx reads them as a fallback when
  // state isn't present (see its comment for the matching half of this).
  const buildQuote = () => {
    if (!context) return;
    const params = new URLSearchParams({
      sourceLeadId: String(leadId),
      clientName: context.customer?.display_name || "",
      clientPhone: context.customer?.phone_e164 || "",
      clientEmail: context.customer?.email || "",
    });
    window.open(`/costs?${params.toString()}`, "_blank");
  };

  const scheduleFollowUp = async (isoDateOrDatetime) => {
    setBusy(true);
    try {
      await crmLeads.update(leadId, { follow_up_date: isoDateOrDatetime });
      toast.success("נקבע פולואפ — הליד יישאר שלך, המשבצת התפנתה");
      onChanged ? onChanged() : navigate("/my-day");
    } catch (err) {
      toast.error(err.message || "הקביעה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const markDisqualified = async () => {
    setBusy(true);
    try {
      await crmLeads.update(leadId, { status: "disqualified" });
      toast.success("סומן כלא רלוונטי");
      onChanged ? onChanged() : navigate("/my-day");
    } catch (err) {
      toast.error(err.message || "העדכון נכשל");
    } finally {
      setBusy(false);
    }
  };

  const releaseLead = async () => {
    setBusy(true);
    try {
      await leadQueue.release(leadId);
      toast.success("הליד שוחרר");
      onChanged ? onChanged() : navigate("/my-day");
    } catch (err) {
      toast.error(err.message || "השחרור נכשל");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !context) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr_300px] gap-4 items-start">
        <LeadFieldsPanel context={context} leadId={leadId} onUpdated={setContext} />
        {/* A lead exists here by definition — the "create lead" action only
            makes sense from the shared inbox. */}
        <ConversationThread conversationId={context.conversation_id} hideLeadAction />
        <DriveMaterialsPanel leadId={leadId} />
      </div>

      <div className="border border-black rounded-xl bg-white p-3 flex flex-wrap items-center gap-2">
        <Button size="sm" className="gap-1.5" disabled={busy} onClick={buildQuote}>
          <Calculator className="w-4 h-4" /> בנה הצעה
        </Button>
        <FollowUpScheduler onSchedule={scheduleFollowUp} disabled={busy} />
        <Button size="sm" variant="outline" className="gap-1.5 text-red-500" disabled={busy} onClick={markDisqualified}>
          <XCircle className="w-4 h-4" /> לא רלוונטי
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5 mr-auto" disabled={busy} onClick={releaseLead}>
          <LogOut className="w-4 h-4" /> שחרר ליד
        </Button>
      </div>
    </div>
  );
}
