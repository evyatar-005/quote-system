import { useState } from "react";
import { Loader2, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { leadQueue } from "@/api/leadQueueClient";
import { toast } from "sonner";

// "מלא תיבה" — the agent's only way into the lead pool (CRM plan Phase 5 §6).
// The server picks the leads (oldest-first, campaign-scoped); the agent never
// sees or browses the pool directly. One press tops the box back up to
// max_claimed_leads rather than claiming a single lead, so an agent who closed
// three leads doesn't press three times to get back to a full box.
export default function PullLeadButton({ slotsUsed, slotsMax, onClaimed, size = "sm" }) {
  const [pulling, setPulling] = useState(false);
  const atCap = slotsUsed >= slotsMax;
  const large = size === "lg";
  const missing = Math.max(0, slotsMax - slotsUsed);

  const pull = async () => {
    setPulling(true);
    try {
      const { claimed, reason } = await leadQueue.claimFill();
      if (claimed > 0) toast.success(claimed === 1 ? "ליד נמשך אליך" : `${claimed} לידים נמשכו אליך`);
      if (reason === "empty_pool") {
        toast.info(claimed > 0 ? "זה כל מה שיש בתור כרגע" : "אין לידים ממתינים בתור כרגע");
      } else if (reason && reason !== "slot_limit") {
        toast.error("חלק מהלידים לא נמשכו — נסה שוב");
      }
      onClaimed?.();
    } catch (err) {
      toast.error(err.message || "המשיכה נכשלה");
    } finally {
      setPulling(false);
    }
  };

  return (
    <Button
      size={large ? "lg" : "sm"}
      className={large ? "h-12 text-base gap-2 px-6" : "h-7 text-xs gap-1.5"}
      onClick={pull}
      disabled={pulling || atCap}
      title={atCap ? `התיבה מלאה — ${slotsMax} לידים` : `משוך ${missing} לידים כדי למלא את התיבה`}
    >
      {pulling ? <Loader2 className={large ? "w-5 h-5 animate-spin" : "w-3.5 h-3.5 animate-spin"} /> : <Inbox className={large ? "w-5 h-5" : "w-3.5 h-3.5"} />}
      {atCap ? `התיבה מלאה (${slotsUsed}/${slotsMax})` : `מלא תיבה (+${missing})`}
    </Button>
  );
}
