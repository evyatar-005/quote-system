import { useState, useEffect } from "react";
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

function Row({ label, value }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className="text-slate-700 truncate">{value}</span>
    </div>
  );
}

function mmss(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// A follow-up is an action item, not a passive list item — this interrupts
// with a pop-up (date+time precision from GET /api/crm/my-day's
// due_follow_ups), instead of sitting quietly in a column the agent has to
// remember to check. It opens PRE_ALERT_MINUTES *before* the scheduled minute
// and counts down to it, so the agent can open the lead and read the thread
// before the customer expects the call — appearing exactly at the hour left no
// time to prepare. One item at a time; dismissing or snoozing reveals the next
// (client-side only — dismissed ids are held in this component's state, not
// persisted, so a refresh brings them back if still due).
export default function FollowUpPopup({ dueFollowUps = [], onHandled }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const current = dueFollowUps.find((l) => !dismissed.has(l.id));

  // Ticks locally off the server-computed offset — the page only refetches
  // every 60s, which is far too coarse for a countdown.
  const [secondsLeft, setSecondsLeft] = useState(null);
  useEffect(() => {
    if (!current) return undefined;
    const startedAt = Date.now();
    const base = current.due_in_seconds ?? 0;
    const tick = () => setSecondsLeft(base - Math.round((Date.now() - startedAt) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [current?.id, current?.due_in_seconds]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return null;
  const pending = secondsLeft !== null && secondsLeft > 0;

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
            <BellRing className={`w-5 h-5 ${pending ? "text-amber-500" : "text-red-500"}`} />
            {pending ? "פולואפ מתקרב" : "זמן פולואפ הגיע"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <div className="font-semibold text-base">{current.display_name}</div>
            {current.phone_e164 && (
              // Click-to-call: the agent is about to phone this person, so the
              // number is the action, not a label.
              <a href={`tel:${current.phone_e164}`} className="text-sm text-primary hover:underline" dir="ltr">
                {current.phone_e164}
              </a>
            )}
          </div>

          {pending ? (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums text-amber-600" dir="ltr">{mmss(secondsLeft)}</span>
              <span className="text-xs text-slate-500">עד השעה שנקבעה — {current.follow_up_date?.slice(11, 16) || ""}</span>
            </div>
          ) : (
            <div className="text-xs text-slate-400">הלקוח ביקש שיחזרו אליו עכשיו</div>
          )}

          {/* Everything the agent needs to pick up the thread without opening the
              lead first — the whole point of a 20-minute warning is having a
              moment to remember who this is before dialling. */}
          <div className="border-t border-slate-200 pt-2 space-y-1.5 text-xs">
            {current.campaign_name && <Row label="קמפיין" value={current.campaign_name} />}
            {current.email && <Row label="אימייל" value={current.email} />}
            {current.value_estimate > 0 && <Row label="ערך עסקה" value={`₪${Number(current.value_estimate).toLocaleString()}`} />}
            {current.quote_id && <Row label="הצעה" value={`נשלחה #${current.quote_id}`} />}
            {current.notes && (
              <div className="space-y-0.5">
                <div className="text-slate-400">הערה על הליד</div>
                <div className="text-slate-700 whitespace-pre-wrap line-clamp-4">{current.notes}</div>
              </div>
            )}
            {current.last_message && (
              <div className="space-y-0.5">
                <div className="text-slate-400">הודעה אחרונה</div>
                <div className="bg-slate-50 rounded-lg p-2 text-slate-700 line-clamp-3">{current.last_message}</div>
              </div>
            )}
          </div>
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
