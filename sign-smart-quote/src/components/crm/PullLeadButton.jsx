import { useState } from "react";
import { Loader2, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { leadQueue } from "@/api/leadQueueClient";
import { toast } from "sonner";

// "משוך ליד" — the agent's only way into the lead pool (CRM plan Phase 5
// §6). The server picks the lead (oldest-first, campaign-scoped); the agent
// never sees or browses the pool directly.
export default function PullLeadButton({ slotsUsed, slotsMax, onClaimed, size = "sm" }) {
  const [pulling, setPulling] = useState(false);
  const atCap = slotsUsed >= slotsMax;
  const large = size === "lg";

  const pull = async () => {
    setPulling(true);
    try {
      const { leadId } = await leadQueue.claim();
      toast.success("ליד נמשך אליך");
      onClaimed?.(leadId);
    } catch (err) {
      if (err.code === "slot_limit") toast.error(`הגעת למקסימום ${slotsMax} לידים במקביל — סיים או שחרר ליד כדי למשוך עוד`);
      else if (err.code === "empty_pool") toast.info("אין לידים ממתינים בתור כרגע");
      else toast.error(err.message || "המשיכה נכשלה");
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
      title={atCap ? `הגעת למקסימום ${slotsMax} לידים` : "משוך את הליד הבא בתור"}
    >
      {pulling ? <Loader2 className={large ? "w-5 h-5 animate-spin" : "w-3.5 h-3.5 animate-spin"} /> : <Inbox className={large ? "w-5 h-5" : "w-3.5 h-3.5"} />}
      משוך ליד ({slotsUsed}/{slotsMax})
    </Button>
  );
}
