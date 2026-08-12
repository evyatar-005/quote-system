import { useState, useEffect } from "react";
import { ChevronDown, MoreHorizontal, XCircle, LogOut, Timer, FileCheck, Send, Loader2 } from "lucide-react";
import { issueQuoteToMorning } from "@/api/morningClient";
import RailNotifications from "@/components/crm/RailNotifications";
import { crmLeads } from "@/api/crmClient";
import { leadQueue } from "@/api/leadQueueClient";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { rankLeads, groupRanked, relativeTime, followUpCountdown } from "@/lib/leadPriority";
import { toast } from "sonner";

const TONE_DOT = {
  red: "bg-red-500",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  slate: "bg-slate-300",
};

const TONE_BADGE = {
  red: "bg-red-50 text-red-600",
  amber: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-600",
  slate: "bg-slate-100 text-slate-600",
};

// The agent's leads as a permanent full-height rail: name only, ordered and
// grouped by urgency (lib/leadPriority), with a live countdown on anything with
// a scheduled follow-up and an unread badge when the customer has written.
// Clicking a name SWITCHES to that lead immediately — the rail is a lead
// switcher first (which is why MyDay no longer needs LeadSwitcher); the chevron
// is the way to peek at details without leaving the lead currently open.
export default function LeadRail({ leads, readyToIssue = [], openLeadId, onOpen, onChanged }) {
  // One ticker for the whole rail rather than an interval per row. It also
  // re-ranks on every tick, so a lead crossing its follow-up time moves itself
  // up into "דורש טיפול עכשיו" without waiting for MyDay's 60s refetch.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const ranked = rankLeads(leads, now);
  const groups = groupRanked(ranked);
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="border border-black rounded-xl bg-white overflow-hidden w-full lg:w-60 shrink-0 flex flex-col lg:h-[calc(100vh-9rem)]">
      <div className="px-2.5 py-1.5 bg-slate-100 border-b border-slate-300 flex items-center gap-2 shrink-0">
        <span className="text-[11px] font-bold text-slate-800">הלידים שלי</span>
        <span className="text-[11px] text-slate-500">{ranked.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="px-2.5 py-0.5 bg-slate-50 border-y border-slate-100 text-[10px] font-bold text-slate-500">
              {g.title} <span className="font-normal text-slate-400">{g.leads.length}</span>
            </div>
            {g.leads.map((lead) => (
              <RailRow
                key={lead.id}
                lead={lead}
                now={now}
                active={lead.id === openLeadId}
                expanded={lead.id === expandedId}
                onToggle={() => setExpandedId((id) => (id === lead.id ? null : lead.id))}
                onOpen={onOpen}
                onChanged={onChanged}
              />
            ))}
          </div>
        ))}
        {ranked.length === 0 && (
          <div className="px-2.5 py-6 text-center text-[11px] text-slate-400">אין לידים פתוחים</div>
        )}

        {/* Under the lead stack, in the same rail: quotes a manager approved
            that the customer STILL hasn't received. This is the agent's own
            next action (unlike "waiting for the manager", which is someone
            else's), so it belongs in the work list, not behind a bell. */}
        {readyToIssue.length > 0 && (
          <div>
            <div className="px-2.5 py-0.5 bg-emerald-50 border-y border-emerald-100 text-[10px] font-bold text-emerald-700">
              מוכנות להנפקה ללקוח <span className="font-normal text-emerald-600">{readyToIssue.length}</span>
            </div>
            {readyToIssue.map((q) => (
              <ReadyToIssueRow key={q.id} quote={q} onIssued={onChanged} onOpen={onOpen} />
            ))}
          </div>
        )}

        {/* Last section: what used to live behind the bell in the header. */}
        <RailNotifications />
      </div>
    </div>
  );
}

function ReadyToIssueRow({ quote, onIssued, onOpen }) {
  const [busy, setBusy] = useState(false);

  // The discount the manager actually approved: the gap between what the agent
  // asked for (the parent quote) and the revision that came back approved.
  const parent = Number(quote.parent_quote_number ? quote.parent_price_with_vat : 0);
  const price = Number(quote.price_with_vat) || 0;
  const discount = parent > price ? parent - price : 0;
  const discountPct = discount > 0 ? Math.round((discount / parent) * 100) : 0;
  const sentAt = quote.sent_at ? new Date(`${quote.sent_at.replace(" ", "T")}Z`) : null;

  const issue = async () => {
    setBusy(true);
    try {
      const result = await issueQuoteToMorning({
        quote_number: quote.quote_number,
        client_name: quote.client_name,
        price_before_vat: null,
        price_with_vat: quote.price_with_vat,
      });
      // issueQuoteToMorning resolves with { issued:false } when Morning has no
      // credentials yet — that's a configuration state, not a failure.
      if (result?.issued) {
        toast.success(`הצעה ${quote.quote_number} הונפקה ונשלחה ללקוח`);
        onIssued?.();
      } else {
        toast.message("החיבור למורנינג עדיין לא מוגדר", {
          description: "הנתונים מוכנים — ההנפקה תעבוד ברגע שיוגדר חשבון מורנינג.",
        });
      }
    } catch (err) {
      toast.error(err?.message || "ההנפקה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    // Clicking the row opens the CUSTOMER (the lead the quote was built from,
    // via crm_leads.quote_id) — issuing is also possible from there, so this
    // row is a shortcut, not the only path. The button stops propagation so
    // "issue" doesn't also navigate away from what the agent is doing.
    <div
      className={`px-2.5 py-1.5 border-b border-slate-100 space-y-0.5 ${quote.lead_id ? "cursor-pointer hover:bg-emerald-50/50" : ""}`}
      onClick={() => quote.lead_id && onOpen?.(quote.lead_id)}
      title={quote.lead_id ? "פתח את הלקוח" : "אין ליד מקושר להצעה זו"}
    >
      <div className="flex items-center gap-1.5">
        <FileCheck className="w-3 h-3 text-emerald-600 shrink-0" />
        <span className="text-[11px] font-semibold truncate flex-1">{quote.client_name || "ללא שם"}</span>
        <span className="text-[11px] font-bold shrink-0">₪{price.toLocaleString()}</span>
      </div>

      <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
        <span dir="ltr" className="truncate">{quote.quote_number}</span>
        {sentAt && <span className="shrink-0">· נשלח לבדיקה {sentAt.toLocaleDateString("he-IL")}</span>}
      </div>

      {discount > 0 && (
        <div className="text-[10px] text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5 w-fit">
          אושרה הנחה ₪{discount.toLocaleString()} ({discountPct}%) — מ-₪{parent.toLocaleString()}
        </div>
      )}

      <Button
        size="sm"
        className="h-6 w-full px-2 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700"
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); issue(); }}
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
        הנפק ושלח ללקוח
      </Button>
    </div>
  );
}

function RailRow({ lead, now, active, expanded, onToggle, onOpen, onChanged }) {
  const [busy, setBusy] = useState(false);
  const countdown = followUpCountdown(lead, now);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      onChanged();
    } catch (err) {
      toast.error(err.message || "הפעולה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`border-b border-slate-100 ${active ? "bg-primary/10" : ""}`}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => onOpen(lead.id)}
          className="flex-1 min-w-0 text-right px-2.5 py-1.5 flex items-center gap-2 hover:bg-slate-50"
          title="פתח את הליד"
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[lead.tone]}`} />
          <span className={`text-xs truncate flex-1 ${active ? "font-bold" : "font-semibold"}`}>{lead.display_name}</span>
          {lead.unread_count > 0 && (
            <span className="text-[10px] bg-amber-500 text-white rounded-full px-1.5 shrink-0">{lead.unread_count}</span>
          )}
        </button>
        {/* Separate hit area — expanding details must not cost the agent the
            lead they're currently working. */}
        <button
          type="button"
          onClick={onToggle}
          className="px-1.5 text-slate-400 hover:text-primary hover:bg-slate-50"
          title="פרטים"
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* The countdown sits on the collapsed row on purpose: "who do I owe a
          call to, and in how long" is the thing the agent scans this rail for. */}
      {countdown && (
        <div className="px-2.5 pb-1 -mt-0.5">
          <span
            className={`inline-flex items-center gap-1 text-[10px] rounded-full px-1.5 py-0.5 ${
              countdown.urgent ? "bg-amber-100 text-amber-700 font-semibold" : "bg-slate-100 text-slate-500"
            }`}
          >
            <Timer className="w-2.5 h-2.5" />
            <span className="tabular-nums" dir={countdown.text.includes(":") ? "ltr" : "rtl"}>{countdown.text}</span>
          </span>
        </div>
      )}

      {expanded && (
        <div className="px-2.5 pb-2 space-y-1.5 bg-slate-50/60">
          <div className={`inline-block text-[10px] rounded-full px-1.5 py-0.5 ${TONE_BADGE[lead.tone]}`}>{lead.badge}</div>
          {lead.phone_e164 && (
            <a href={`tel:${lead.phone_e164}`} className="block text-[11px] text-primary hover:underline w-fit" dir="ltr">
              {lead.phone_e164}
            </a>
          )}
          {lead.campaign_name && <div className="text-[11px] text-slate-500 truncate">{lead.campaign_name}</div>}
          {lead.last_message && <div className="text-[10px] text-slate-500 line-clamp-2">{lead.last_message}</div>}
          <div className="text-[10px] text-slate-400">{relativeTime(lead.last_message_at || lead.claimed_at)}</div>

          <div className="flex items-center gap-1 pt-0.5">
            <Button size="sm" className="h-6 px-2 text-[11px] flex-1" disabled={busy} onClick={() => onOpen(lead.id)}>
              פתח
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={busy}>
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" dir="rtl">
                <DropdownMenuItem
                  className="text-red-600 gap-1.5"
                  onSelect={() => run(() => crmLeads.update(lead.id, { status: "disqualified" }), "סומן כלא רלוונטי")}
                >
                  <XCircle className="w-4 h-4" /> לא רלוונטי
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-1.5"
                  onSelect={() => run(() => leadQueue.release(lead.id), "הליד שוחרר")}
                >
                  <LogOut className="w-4 h-4" /> שחרר ליד
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </div>
  );
}
