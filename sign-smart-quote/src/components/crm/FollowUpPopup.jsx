import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BellRing, ArrowLeftCircle } from "lucide-react";
import { myDay } from "@/api/myDayClient";
import { toast } from "sonner";

function plusMinutes(minutes) {
  const d = new Date(Date.now() + minutes * 60000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// A follow-up is an action item, not a passive list item — this interrupts
// with a pop-up the instant its date+time arrives (date+time precision from
// GET /api/crm/my-day's due_follow_ups), instead of sitting quietly in a
// column the agent has to remember to check. One item at a time; dismissing
// or snoozing reveals the next (client-side only — dismissed ids are held
// in this component's state, not persisted, so a refresh brings them back
// if still due).
export default function FollowUpPopup({ dueFollowUps = [], onHandled }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const current = dueFollowUps.find((l) => !dismissed.has(l.id));
  if (!current) return null;

  const dismiss = () => setDismissed((s) => new Set(s).add(current.id));

  const snooze = async (minutes) => {
    setBusy(true);
    try {
      await myDay.setFollowUp(current.id, plusMinutes(minutes));
      dismiss();
      onHandled?.();
    } catch (err) {
      toast.error(err.message || "הדחייה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const openLead = () => {
    dismiss();
    navigate(`/crm/leads/${current.id}/workspace`);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="w-5 h-5 text-amber-500" /> זמן פולואפ הגיע
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <div className="font-semibold text-base">{current.display_name}</div>
          {current.phone_e164 && <div className="text-sm text-slate-500" dir="ltr">{current.phone_e164}</div>}
          <div className="text-xs text-slate-400">הלקוח ביקש שיחזרו אליו עכשיו</div>
        </div>
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-start">
          <Button onClick={openLead} className="gap-1.5"><ArrowLeftCircle className="w-4 h-4" /> פתח ליד</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => snooze(15)}>דחה 15 דק&apos;</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => snooze(60)}>דחה שעה</Button>
          <Button variant="ghost" size="sm" onClick={dismiss}>סגור</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
