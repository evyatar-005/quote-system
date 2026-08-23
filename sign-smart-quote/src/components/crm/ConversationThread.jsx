import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Lock, Unlock, Send, ShieldAlert, MessagesSquare, Check, CheckCheck, Clock, FileText, UserPlus, Zap } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { inbox } from "@/api/inboxClient";
import { templates } from "@/api/campaignsClient";
import { listInforuTemplates } from "@/api/inforuClient";
import { useCrmEvents } from "@/lib/crmRealtime";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const HEARTBEAT_MS = 45 * 1000; // < lock_ttl_sec (120s default) so an active agent never loses the lock

// Self-contained WhatsApp thread panel — claim/release lock, heartbeat,
// live updates, compose+send. Extracted from CrmInbox.jsx (Phase 3) so the
// lead workspace (Phase 5 §7) can embed the exact same behavior instead of
// duplicating the lock/heartbeat logic.
//
// Styled to match WhatsApp itself (bubble colours, tails, tick marks, date
// chips, doodle background) — agents move between this and their phone all
// day, and an inbox that reads differently from the app they already know
// costs them a beat on every message.

// WhatsApp's own palette, taken from the web client. Hard-coded rather than
// themed: the point is to look like WhatsApp, not like the rest of our UI.
const WA = {
  panel: "#f0f2f5",   // header + composer bar
  chatBg: "#efeae2",  // chat canvas behind the doodles
  out: "#d9fdd3",     // outgoing bubble (green)
  in: "#ffffff",      // incoming bubble
  meta: "#667781",    // timestamps / secondary text
  tick: "#53bdeb",    // blue "read" ticks
  green: "#00a884",   // send button, unread badge
};

// The faint doodle wallpaper. Inlined as a data-URI SVG so the artifact stays
// self-contained (no asset fetch) and the pattern tiles at any panel size.
const DOODLE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 140 140">
       <g fill="none" stroke="#000" stroke-opacity="0.045" stroke-width="1.6" stroke-linecap="round">
         <circle cx="24" cy="26" r="9"/><path d="M60 18h20v14H66l-6 6z"/>
         <path d="M104 20l8 8-8 8-8-8z"/><path d="M14 66h18v12H14z"/>
         <circle cx="70" cy="72" r="7"/><path d="M100 62c6 0 10 4 10 9s-4 9-10 9h-4l-5 5v-5c-5-1-8-4-8-9 0-5 4-9 10-9z"/>
         <path d="M20 108l7 7 13-14"/><path d="M62 104h22v16H62z"/>
         <circle cx="112" cy="112" r="8"/>
       </g>
     </svg>`
  );

// WhatsApp's own status glyphs: clock while queued, one tick sent, two grey
// delivered, two blue read. Anything unrecognised falls back to the clock so
// a new provider status can't render as a blank gap.
function StatusTicks({ status }) {
  if (status === "read") return <CheckCheck className="w-3.5 h-3.5" style={{ color: WA.tick }} />;
  if (status === "delivered") return <CheckCheck className="w-3.5 h-3.5" style={{ color: WA.meta }} />;
  if (status === "sent") return <Check className="w-3.5 h-3.5" style={{ color: WA.meta }} />;
  if (status === "failed") return <span className="text-[10px] text-red-500">נכשל</span>;
  return <Clock className="w-3 h-3" style={{ color: WA.meta }} />;
}

const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

// "היום" / "אתמול" / a date — the chip WhatsApp puts between days.
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (diffDays === 0) return "היום";
  if (diffDays === 1) return "אתמול";
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export default function ConversationThread({ conversationId, headerExtra, hideLeadAction }) {
  const { user } = useAuth();
  const [thread, setThread] = useState(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [leadCandidates, setLeadCandidates] = useState(null); // null = menu closed
  const [creatingLead, setCreatingLead] = useState(false);
  const [tpls, setTpls] = useState(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const heartbeatRef = useRef(null);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  const loadThread = useCallback(async (id) => {
    if (!id) return;
    setLoadingThread(true);
    try {
      setThread(await inbox.getMessages(id));
    } catch (err) {
      toast.error(err.message || "טעינת השיחה נכשלה");
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    if (conversationId) loadThread(conversationId); else setThread(null);
    // Switching conversations can switch between an open and a closed window
    // (or a different template set entirely) — never carry a stale list over.
    setTpls(null);
    setTplOpen(false);
  }, [conversationId, loadThread]);

  useCrmEvents(
    ["message.created", "message.received", "message.sent", "lock.claimed", "lock.released", "conversation.updated"],
    (event, payload) => {
      if (payload?.conversationId === conversationId) loadThread(conversationId);
    }
  );

  // Pin to the newest message, like every chat app — otherwise a reload drops
  // the agent at the top of a long history.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.messages?.length, conversationId]);

  // Heartbeat the lock while this agent holds it, and stop on unmount/switch.
  useEffect(() => {
    if (!thread || thread.conversation.lock_username !== user?.username) return;
    heartbeatRef.current = setInterval(() => {
      inbox.heartbeat(thread.conversation.id).catch(() => {});
    }, HEARTBEAT_MS);
    return () => clearInterval(heartbeatRef.current);
  }, [thread, user?.username]);

  const claim = async () => {
    try {
      await inbox.claim(conversationId);
      loadThread(conversationId);
    } catch (err) {
      toast.error(err.data?.locked_by ? `השיחה בטיפול ${err.data.locked_by}` : (err.message || "הנעילה נכשלה"));
      loadThread(conversationId);
    }
  };

  const release = async () => {
    try {
      await inbox.release(conversationId);
      loadThread(conversationId);
    } catch (err) {
      toast.error(err.message || "השחרור נכשל");
    }
  };

  const forceClaim = async () => {
    try {
      await inbox.forceClaim(conversationId);
      loadThread(conversationId);
      toast.success("השיחה נלקחה בכוח");
    } catch (err) {
      toast.error(err.message || "הפעולה נכשלה");
    }
  };

  const send = async () => {
    if (!draft.trim() || !conversationId) return;
    setSending(true);
    try {
      await inbox.sendMessage(conversationId, draft.trim());
      setDraft("");
      loadThread(conversationId);
    } catch (err) {
      toast.error(err.message || "השליחה נכשלה");
    } finally {
      setSending(false);
    }
  };

  // An inbound message auto-creates a customer but never a lead, so a
  // conversation from an unknown number stays outside the queue and every
  // report until someone presses this. Deliberately manual.
  const doCreateLead = async (leadId) => {
    setCreatingLead(true);
    try {
      await inbox.createLead(conversationId, leadId);
      toast.success(leadId ? "השיחה שויכה לליד" : "ליד נוצר ושויך לשיחה");
      setLeadCandidates(null);
      loadThread(conversationId);
    } catch (err) {
      toast.error(err.message || "הפעולה נכשלה");
    } finally {
      setCreatingLead(false);
    }
  };

  const openLeadMenu = async () => {
    try {
      const rows = await inbox.leadCandidates(conversationId);
      // Nothing to link to — skip the menu entirely and just create.
      if (!rows.length) return doCreateLead(null);
      setLeadCandidates(rows);
    } catch (err) {
      toast.error(err.message || "טעינת הלידים נכשלה");
    }
  };

  // The 24h WhatsApp session window (Meta rule — see sessionWindow.js on the
  // server). Only a provider that lives under it (InforU) ever reports this
  // false; GreenAPI's conversations always come back with it true/undefined,
  // so nothing below changes GreenAPI's existing behaviour.
  const windowClosed = thread?.conversation?.session_window_open === false;

  const openTemplates = async () => {
    if (tplOpen) return setTplOpen(false);
    setTplOpen(true);
    if (tpls) return;
    try {
      if (windowClosed) {
        // A closed window can ONLY be reopened by a Meta-approved template —
        // free-form quick replies (message_templates) don't apply here at all.
        setTpls(await listInforuTemplates());
      } else {
        // 'service' only — a marketing blast template has no business in a 1:1
        // reply. `active` must be the string '1', that's what the route compares.
        setTpls(await templates.list({ category: "service", active: "1" }));
      }
    } catch (err) {
      setTpls([]);
      if (windowClosed) toast.error(err.message || "טעינת התבניות המאושרות נכשלה");
    }
  };

  const pickTemplate = async (t) => {
    if (windowClosed) return sendApprovedTemplate(t);
    try {
      const { rendered } = await templates.preview(t.body, thread?.conversation?.customer_id, true);
      // Append, never replace — the agent may have already typed half a line.
      setDraft((d) => (d ? `${d}\n${rendered}` : rendered));
      setTplOpen(false);
      textareaRef.current?.focus();
    } catch (err) {
      toast.error(err.message || "טעינת התבנית נכשלה");
    }
  };

  // Unlike a quick-reply template, an InforU template's text is fixed by
  // Meta's approval — there's nothing to edit in a draft, so picking one
  // sends it immediately. This is also what reopens the window.
  const sendApprovedTemplate = async (t) => {
    setSendingTemplate(true);
    try {
      await inbox.sendTemplate(conversationId, t.TemplateId, [], t.MessageText);
      toast.success("התבנית נשלחה");
      setTplOpen(false);
      loadThread(conversationId);
    } catch (err) {
      toast.error(err.message || "שליחת התבנית נכשלה");
    } finally {
      setSendingTemplate(false);
    }
  };

  const isMine = thread?.conversation?.lock_username === user?.username;
  const isLockedByOther = thread?.conversation?.lock_username && !isMine;

  if (!conversationId) {
    // Same WhatsApp shell (header bar + doodle canvas) as the loaded-but-empty
    // thread below, just with placeholder skeletons instead of real customer
    // data — LeadWorkspacePanel normally opens a conversation before this ever
    // renders, so this is the brief moment before that lands (or the rare case
    // it can't: no phone number, provider not configured). A plain white box
    // here read as broken; this reads as "WhatsApp, just not started yet."
    return (
      <div className="border border-black rounded-xl bg-white flex flex-col h-[75vh] overflow-hidden">
        <div className="px-4 py-2 flex items-center gap-3 shrink-0" style={{ background: WA.panel }}>
          <div className="w-10 h-10 rounded-full bg-slate-300 shrink-0" />
          <div className="h-3.5 w-28 rounded bg-slate-300/70" />
        </div>
        <div
          className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400 text-sm"
          style={{ background: WA.chatBg, backgroundImage: `url("${DOODLE}")`, backgroundRepeat: "repeat" }}
        >
          <MessagesSquare className="w-8 h-8" />
          אין שיחת ווצאפ פתוחה עבור ליד זה
        </div>
      </div>
    );
  }

  if (loadingThread || !thread) {
    return (
      <div className="border border-black rounded-xl bg-white flex flex-col min-h-[65vh] items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  const title = thread.conversation.customer_name || thread.conversation.customer_phone || "לא ידוע";
  let lastDay = null;

  return (
    <div className="border border-black rounded-xl bg-white flex flex-col h-[75vh] overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-4 py-2 flex items-center justify-between gap-3 shrink-0" style={{ background: WA.panel }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-slate-300 text-white flex items-center justify-center font-semibold shrink-0">
            {title.trim().charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate text-slate-900">{title}</div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs truncate" style={{ color: WA.meta }} dir="ltr">{thread.conversation.customer_phone}</span>
              {thread.conversation.lead_id && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 shrink-0">
                  ליד #{thread.conversation.lead_id}
                </span>
              )}
              {windowClosed && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 shrink-0">
                  חלון סגור
                </span>
              )}
            </div>
            {headerExtra}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Hidden in the lead workspace (hideLeadAction) — there a lead
              exists by definition. */}
          {!hideLeadAction && !thread.conversation.lead_id && isMine && (
            <div className="relative">
              <Button size="sm" variant="outline" onClick={openLeadMenu} disabled={creatingLead} className="gap-1">
                {creatingLead ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                צור ליד
              </Button>
              {leadCandidates && (
                <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-black rounded-lg shadow-lg p-2 w-64 text-right">
                  <div className="text-[11px] mb-1" style={{ color: WA.meta }}>ללקוח זה יש כבר לידים פתוחים:</div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-slate-100">
                    {leadCandidates.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => doCreateLead(l.id)}
                        className="w-full text-right text-xs py-1.5 px-1 hover:bg-slate-50"
                      >
                        <div className="truncate">{l.title || `ליד #${l.id}`}</div>
                        <div className="text-[10px]" style={{ color: WA.meta }}>{l.campaign_name || "ללא קמפיין"}</div>
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => doCreateLead(null)} className="w-full text-xs text-primary font-medium pt-2 mt-1 border-t border-slate-200 hover:underline">
                    צור ליד חדש בכל זאת
                  </button>
                  <button type="button" onClick={() => setLeadCandidates(null)} className="w-full text-[11px] pt-1" style={{ color: WA.meta }}>
                    ביטול
                  </button>
                </div>
              )}
            </div>
          )}
          {thread.conversation.lock_username ? (
            <span className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${isMine ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              <Lock className="w-3 h-3" /> {isMine ? "בטיפולך" : `בטיפול ${thread.conversation.lock_username}`}
            </span>
          ) : (
            <span className="text-xs px-2 py-1 rounded-full bg-white text-slate-500 flex items-center gap-1">
              <Unlock className="w-3 h-3" /> פנוי
            </span>
          )}
          {!thread.conversation.lock_username && <Button size="sm" onClick={claim}>קח שיחה</Button>}
          {isMine && <Button size="sm" variant="outline" onClick={release}>שחרר</Button>}
          {isLockedByOther && user?.role === "admin" && (
            <Button size="sm" variant="ghost" onClick={forceClaim} className="text-red-500 gap-1">
              <ShieldAlert className="w-3.5 h-3.5" /> קח בכוח
            </Button>
          )}
        </div>
      </div>

      {/* ── Messages ───────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-4 space-y-1"
        style={{ background: WA.chatBg, backgroundImage: `url("${DOODLE}")`, backgroundRepeat: "repeat" }}
      >
        {thread.messages.map((m) => {
          const out = m.direction === "out";
          const day = dayLabel(m.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {showDay && (
                <div className="flex justify-center my-3">
                  <span className="text-[11px] px-3 py-1 rounded-lg bg-white/90 shadow-sm uppercase" style={{ color: WA.meta }}>
                    {day}
                  </span>
                </div>
              )}
              {/* In RTL the agent's own messages sit on the LEFT, exactly as
                  WhatsApp mirrors them for Hebrew. */}
              <div className={`flex ${out ? "justify-start" : "justify-end"}`}>
                <div
                  className="relative max-w-[65%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm"
                  style={{ background: out ? WA.out : WA.in, borderRadius: 8 }}
                >
                  {m.message_type === "document" && m.media_url ? (
                    <a
                      href={m.media_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 underline text-slate-800"
                    >
                      <FileText className="w-4 h-4 shrink-0" />
                      {m.media_filename || "מסמך"}
                    </a>
                  ) : (
                    <div className="whitespace-pre-wrap break-words text-slate-900 leading-snug">{m.body}</div>
                  )}
                  {/* Timestamp + ticks tucked into the bubble's bottom-left,
                      WhatsApp-style. */}
                  <div className="flex items-center gap-1 justify-end mt-0.5 -mb-0.5" dir="ltr">
                    <span className="text-[10px]" style={{ color: WA.meta }}>{timeOf(m.created_at)}</span>
                    {out && <StatusTicks status={m.status} />}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {thread.messages.length === 0 && (
          <div className="text-center text-sm py-10" style={{ color: WA.meta }}>אין הודעות עדיין</div>
        )}
      </div>

      {/* ── Composer ───────────────────────────────────────────────────── */}
      {/* `relative` anchors the template popover here rather than inside the
          message scroller — the thread root is overflow-hidden and would
          clip it. */}
      <div className="px-3 py-2.5 flex items-end gap-2 shrink-0 relative" style={{ background: WA.panel }}>
        {tplOpen && (
          <div className="absolute bottom-full right-3 left-3 mb-2 z-30 bg-white border border-black rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {tpls === null ? (
              <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>
            ) : tpls.length === 0 ? (
              <div className="text-xs text-center py-6 px-3" style={{ color: WA.meta }}>
                {windowClosed ? "אין תבניות מאושרות בחשבון InforU" : "אין תבניות מענה מהיר"}
                {user?.role === "admin" && <div className="mt-1">ניתן להגדיר אותן במסך הניהול</div>}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {tpls.map((t) => (
                  <button
                    key={windowClosed ? t.TemplateId : t.id}
                    type="button"
                    onClick={() => pickTemplate(t)}
                    disabled={sendingTemplate}
                    className="w-full text-right px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <div className="text-xs font-semibold truncate">{windowClosed ? t.TemplateName : t.name}</div>
                    <div className="text-[11px] truncate" style={{ color: WA.meta }}>
                      {windowClosed ? t.MessageText : (t.body || "").split("\n")[0]}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={openTemplates}
          disabled={!isMine}
          title={windowClosed ? "תבנית מאושרת (InforU)" : "תבניות מענה מהיר"}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-slate-500 shrink-0 disabled:opacity-40 hover:text-slate-700"
        >
          <Zap className="w-4 h-4" />
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // Enter sends, Shift+Enter breaks a line — the muscle memory every
          // agent already has from WhatsApp itself.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!sending) send(); }
          }}
          placeholder={
            !isMine ? "יש לקחת את השיחה כדי להשיב"
            : windowClosed ? "חלון 24 השעות סגור — בחר/י תבנית מאושרת"
            : "הקלד/י הודעה"
          }
          disabled={!isMine || sending || windowClosed}
          className="flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm bg-white outline-none max-h-32 disabled:bg-white/60 disabled:text-slate-400 placeholder:text-slate-400"
        />
        <button
          type="button"
          onClick={send}
          disabled={!isMine || sending || windowClosed || !draft.trim()}
          className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 disabled:opacity-40"
          style={{ background: WA.green }}
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 rotate-180" />}
        </button>
      </div>
    </div>
  );
}
