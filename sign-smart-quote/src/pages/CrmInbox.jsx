import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, MessagesSquare, Lock, Unlock, Send, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { inbox } from "@/api/inboxClient";
import { useCrmEvents } from "@/lib/crmRealtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import AgentSidebar from "@/components/layout/AgentSidebar";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";

const HEARTBEAT_MS = 45 * 1000; // < lock_ttl_sec (120s default) so an active agent never loses the lock
const POLL_MS = 8 * 1000; // fallback if SSE is unavailable — see crmRealtime.js

// CRM Phase 3 — shared WhatsApp inbox: several agents can browse the same
// conversation list at once, but only one may hold a conversation's lock
// (claim) at a time, enforced server-side (crm_conversation_locks).
export default function CrmInbox() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [thread, setThread] = useState(null); // { conversation, messages }
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const heartbeatRef = useRef(null);
  const Sidebar = user?.role === "agent" ? AgentSidebar : ManagerSidebar;

  const loadList = useCallback(async () => {
    try {
      setConversations(await inbox.listConversations({}));
    } catch (err) {
      toast.error(err.message || "טעינת השיחות נכשלה");
    } finally {
      setLoadingList(false);
    }
  }, []);

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

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    const t = setInterval(loadList, POLL_MS);
    return () => clearInterval(t);
  }, [loadList]);
  useEffect(() => { if (activeId) loadThread(activeId); }, [activeId, loadThread]);

  // Live updates — falls back to the polling above if SSE drops.
  useCrmEvents(
    ["message.created", "message.received", "message.sent", "lock.claimed", "lock.released", "conversation.updated"],
    (event, payload) => {
      loadList();
      if (payload?.conversationId === activeId) loadThread(activeId);
    }
  );

  // Heartbeat the lock while this agent holds it, and release on unmount/switch.
  useEffect(() => {
    if (!thread || thread.conversation.lock_username !== user?.username) return;
    heartbeatRef.current = setInterval(() => {
      inbox.heartbeat(thread.conversation.id).catch(() => {});
    }, HEARTBEAT_MS);
    return () => clearInterval(heartbeatRef.current);
  }, [thread, user?.username]);

  const openConversation = (id) => setActiveId(id);

  const claim = async () => {
    try {
      await inbox.claim(activeId);
      loadThread(activeId);
    } catch (err) {
      toast.error(err.data?.locked_by ? `השיחה בטיפול ${err.data.locked_by}` : (err.message || "הנעילה נכשלה"));
      loadThread(activeId);
    }
  };

  const release = async () => {
    try {
      await inbox.release(activeId);
      loadThread(activeId);
    } catch (err) {
      toast.error(err.message || "השחרור נכשל");
    }
  };

  const forceClaim = async () => {
    try {
      await inbox.forceClaim(activeId);
      loadThread(activeId);
      toast.success("השיחה נלקחה בכוח");
    } catch (err) {
      toast.error(err.message || "הפעולה נכשלה");
    }
  };

  const send = async () => {
    if (!draft.trim() || !activeId) return;
    setSending(true);
    try {
      await inbox.sendMessage(activeId, draft.trim());
      setDraft("");
      loadThread(activeId);
    } catch (err) {
      toast.error(err.message || "השליחה נכשלה");
    } finally {
      setSending(false);
    }
  };

  const isMine = thread?.conversation?.lock_username === user?.username;
  const isLockedByOther = thread?.conversation?.lock_username && !isMine;

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <img src={printellaLogo} alt="Printella" className="h-24 object-contain" />
          <h1 className="text-lg font-bold">תיבת שיחות</h1>
        </div>
      </div>

      <div className="w-full mx-auto px-4 sm:px-8 py-8 flex flex-col lg:flex-row gap-8 items-start">
        <Sidebar />
        <div className="flex-1 min-w-0 w-full grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 items-start">
          {/* Conversation list */}
          <div className="border border-black rounded-xl bg-white overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-200 font-semibold text-sm">שיחות</div>
            {loadingList ? (
              <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm px-3">
                <MessagesSquare className="w-8 h-8 mx-auto mb-2" />
                אין שיחות עדיין
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[65vh] overflow-y-auto">
                {conversations.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openConversation(c.id)}
                    className={`w-full text-right px-3 py-2.5 hover:bg-slate-50 transition-colors ${activeId === c.id ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate">{c.customer_name || c.customer_phone || "לא ידוע"}</span>
                      {c.lock_username && <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-xs text-slate-400">{c.customer_phone}</span>
                      {c.unread_count > 0 && <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5">{c.unread_count}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Thread */}
          <div className="border border-black rounded-xl bg-white flex flex-col min-h-[65vh]">
            {!activeId ? (
              <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">בחר שיחה מהרשימה</div>
            ) : loadingThread || !thread ? (
              <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
            ) : (
              <>
                <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-sm">{thread.conversation.customer_name || thread.conversation.customer_phone}</div>
                    <div className="text-xs text-slate-400">{thread.conversation.customer_phone}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {thread.conversation.lock_username ? (
                      <span className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${isMine ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                        <Lock className="w-3 h-3" /> {isMine ? "בטיפולך" : `בטיפול ${thread.conversation.lock_username}`}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-500 flex items-center gap-1">
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

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {thread.messages.map((m) => (
                    <div key={m.id} className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.direction === "out" ? "bg-primary/10 mr-auto" : "bg-slate-100 ml-auto"}`}>
                      {m.message_type === "document" && m.media_url ? (
                        <a href={m.media_url} target="_blank" rel="noreferrer" className="text-primary underline">{m.media_filename || "מסמך"}</a>
                      ) : (
                        <div className="whitespace-pre-wrap">{m.body}</div>
                      )}
                      <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                        {new Date(m.created_at).toLocaleString("he-IL")} {m.direction === "out" && `· ${m.status}`}
                      </div>
                    </div>
                  ))}
                  {thread.messages.length === 0 && <div className="text-center text-slate-400 text-sm py-10">אין הודעות עדיין</div>}
                </div>

                <div className="p-3 border-t border-slate-200 flex items-center gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !sending) send(); }}
                    placeholder={isMine ? "כתוב הודעה..." : "יש לקחת את השיחה כדי להשיב"}
                    disabled={!isMine || sending}
                  />
                  <Button onClick={send} disabled={!isMine || sending || !draft.trim()} size="icon">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
