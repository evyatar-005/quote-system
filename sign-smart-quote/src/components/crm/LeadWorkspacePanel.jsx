import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, XCircle, Calculator, LogOut, MoreHorizontal, ThumbsDown } from "lucide-react";
import { leadQueue } from "@/api/leadQueueClient";
import { crmLeads } from "@/api/crmClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ConversationThread from "@/components/crm/ConversationThread";
import LeadFieldsPanel from "@/components/crm/LeadFieldsPanel";
import DriveMaterialsPanel from "@/components/crm/DriveMaterialsPanel";
import LeadDealPanel from "@/components/crm/LeadDealPanel";
import ReturningCustomerBanner from "@/components/crm/ReturningCustomerBanner";
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
  const [confirmDisqualify, setConfirmDisqualify] = useState(false);
  const [confirmLost, setConfirmLost] = useState(false);
  const [lostReason, setLostReason] = useState("");

  // Wraps setContext so a standalone-page wrapper can mirror customer name /
  // claim badge into its own header without a second fetch.
  const setContext = useCallback((c) => {
    setContextState(c);
    onContext?.(c);
  }, [onContext]);

  const load = useCallback(async () => {
    try {
      let ctx = await leadQueue.context(leadId);
      // A lead who never wrote to us has no conversation row yet (one is born
      // from an inbound message or an outbound send), which left this panel
      // showing a dead empty box. Open one on the spot so the thread always
      // renders as a normal WhatsApp chat the agent can write the first message
      // in. Failure is non-fatal — the rest of the workspace still loads.
      if (!ctx?.conversation_id) {
        try {
          const { conversation_id } = await leadQueue.openConversation(leadId);
          ctx = { ...ctx, conversation_id };
        } catch { /* no phone number, or provider not configured */ }
      }
      setContext(ctx);
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

  // Distinct from "לא רלוונטי": disqualified means the lead was never real,
  // lost means we competed and didn't win — and the reason is the whole point
  // of recording it, so it's required rather than optional.
  const markLost = async () => {
    const reason = lostReason.trim();
    if (!reason) return toast.error("חובה לציין סיבת הפסד");
    setBusy(true);
    try {
      await crmLeads.update(leadId, { status: "lost", lost_reason: reason });
      toast.success("סומן כאבוד");
      setConfirmLost(false);
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
      {/* Sticky header — identity on the right, actions on the left, one line.
          It used to be a bare button strip with the customer's name repeated
          twice below it (thread header + fields panel), which read as a toolbar
          floating over nothing. Naming the lead here is what makes the actions
          feel attached to someone. */}
      <div className="sticky top-16 z-10 border border-black rounded-xl bg-white px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-sm font-bold">
          {(context.customer?.display_name || "?").trim().charAt(0)}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold truncate leading-tight">{context.customer?.display_name}</div>
          <div className="text-[11px] text-slate-500 flex items-center gap-2">
            {context.customer?.phone_e164 && <span dir="ltr">{context.customer.phone_e164}</span>}
            {context.campaign?.name && <span className="truncate">· {context.campaign.name}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 mr-auto shrink-0">
          <Button size="sm" className="gap-1.5" disabled={busy} onClick={buildQuote}>
            <Calculator className="w-4 h-4" /> בנה הצעה
          </Button>
          <FollowUpScheduler onSchedule={scheduleFollowUp} disabled={busy} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={busy} title="פעולות נוספות">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
          <DropdownMenuContent align="start" dir="rtl">
            <DropdownMenuItem className="text-red-600 gap-1.5" onSelect={() => setConfirmDisqualify(true)}>
              <XCircle className="w-4 h-4" /> לא רלוונטי
            </DropdownMenuItem>
            <DropdownMenuItem className="text-red-600 gap-1.5" onSelect={() => { setLostReason(""); setConfirmLost(true); }}>
              <ThumbsDown className="w-4 h-4" /> אבדנו
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-1.5" onSelect={releaseLead}>
              <LogOut className="w-4 h-4" /> שחרר ליד
            </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Above the panels, under the action bar: the agent must see "we already
          know this person" BEFORE they start typing, not after scrolling.
          Renders nothing at all for a genuinely new customer. */}
      <ReturningCustomerBanner history={context.customer_history} customerId={context.customer?.id} />

      {/* Two columns, not three: this panel renders beside MyDay's lead rail, and
          a third column squeezed the WhatsApp thread — the widest thing here —
          to a few dozen pixels. Drive is STACKED under the fields rather than
          being its own column, because as a third grid item it wrapped onto a
          row of its own and left a screen-wide empty band beside it. */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-3 lg:h-[75vh]">
        <div className="flex flex-col gap-3 min-h-0">
          <div className="flex-1 min-h-0">
            <LeadFieldsPanel context={context} leadId={leadId} onUpdated={setContext} />
          </div>
          <div className="h-52 shrink-0">
            <DriveMaterialsPanel leadId={leadId} />
          </div>
        </div>
        {/* A lead exists here by definition — the "create lead" action only
            makes sense from the shared inbox. */}
        <ConversationThread conversationId={context.conversation_id} hideLeadAction />
      </div>

      {/* Deal value / lead notes / lead timeline — below the working area on
          purpose: the thread stays the top of the screen, but these are the
          three things that used to have nowhere to live (crm_leads.notes and
          value_estimate were written by the API and rendered nowhere, and
          crm_activity_log was never displayed at all). */}
      <LeadDealPanel leadId={leadId} lead={context.lead} onUpdated={load} />

      {/* Confirmation only on disqualify — it closes the lead out and there's
          no one-click way back. Releasing just returns it to the pool. */}
      <AlertDialog open={confirmDisqualify} onOpenChange={setConfirmDisqualify}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>לסמן את הליד כלא רלוונטי?</AlertDialogTitle>
            <AlertDialogDescription>
              הליד ייסגר ולא יחזור לתור. לשמירה להמשך טיפול השתמש ב״קבע פולואפ״.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={markDisqualified}>סמן כלא רלוונטי</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmLost} onOpenChange={setConfirmLost}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>לסמן את הליד כאבוד?</AlertDialogTitle>
            <AlertDialogDescription>
              סיבת ההפסד נשמרת על הליד ומופיעה בדוחות — בלעדיה אי אפשר לדעת למה מפסידים.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            placeholder="סיבת הפסד (מחיר / זמן אספקה / הלך למתחרה / לא ענה...)"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction disabled={!lostReason.trim()} onClick={(e) => { e.preventDefault(); markLost(); }}>
              סמן כאבוד
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
