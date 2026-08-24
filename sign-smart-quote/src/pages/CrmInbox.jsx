import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, MessagesSquare, Lock, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { inbox } from "@/api/inboxClient";
import { useCrmEvents } from "@/lib/crmRealtime";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import AgentSidebar from "@/components/layout/AgentSidebar";
import ConversationThread from "@/components/crm/ConversationThread";
import printellaLogo from "@/assets/printella-logo.png";
import { useAuth } from "@/lib/AuthContext";
import { toast } from "sonner";

const POLL_MS = 8 * 1000; // fallback if SSE is unavailable — see crmRealtime.js

// Same WhatsApp palette the thread panel uses (ConversationThread.jsx) — the
// list and the thread sit side by side, so they have to agree.
const WA_PANEL = "#f0f2f5";
const WA_META = "#667781";
const WA_GREEN = "#00a884";

// WhatsApp's chat-list clock: time for today, "אתמול", weekday within the
// last week, then a date — never a full timestamp, which wouldn't fit.
function listTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days === 0) return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "אתמול";
  if (days < 7) return d.toLocaleDateString("he-IL", { weekday: "long" });
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

const FILTERS = [
  ["all", "הכל"],
  ["mine", "שלי"],
  ["free", "פנויות"],
  // Survives the thread being opened and read — only an actual reply clears
  // it, unlike "באיחור" which is driven by unread_count.
  ["awaiting", "ממתינות לתשובה"],
  ["overdue", "באיחור"],
];

// An unanswered inbound thread can sit for days — "ממתין 4320 דק׳" is
// unreadable, so scale the unit to the wait.
function waitLabel(minutes) {
  if (minutes == null) return "";
  if (minutes < 60) return `${minutes} דק׳`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} שע׳`;
  return `${Math.floor(minutes / 1440)} ימים`;
}

// CRM Phase 3 — shared WhatsApp inbox: several agents can browse the same
// conversation list at once, but only one may hold a conversation's lock
// (claim) at a time, enforced server-side (crm_conversation_locks). The
// thread panel itself lives in components/crm/ConversationThread.jsx,
// shared with the Phase 5 lead workspace.
export default function CrmInbox() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [filters, setFilters] = useState({ q: "", filter: "all" });
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep link from outside the inbox — e.g. the customers list's WhatsApp
  // button, which finds-or-creates a conversation server-side and lands here
  // with ?conversation=<id>. ConversationThread fetches its own data from
  // just the id, so it opens fine even before the conversation shows up in
  // `conversations` (which may not include it yet — a filtered/paged list,
  // or a conversation that was just created and hasn't hit the poll). The
  // param is consumed once and stripped so a later filter change or refresh
  // doesn't keep forcing this conversation back open.
  useEffect(() => {
    const fromUrl = searchParams.get("conversation");
    if (!fromUrl) return;
    setActiveId(Number(fromUrl));
    setSearchParams((prev) => { prev.delete("conversation"); return prev; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?filter=awaiting — how the leads screen's "בהמתנה לתשובה" tiles drill in.
  // Those tiles count conversations, so this is the screen that can show all
  // of them; the leads list would drop every conversation without a lead.
  useEffect(() => {
    const f = searchParams.get("filter");
    if (!f) return;
    setFilters((prev) => ({ ...prev, filter: f }));
    setSearchParams((prev) => { prev.delete("filter"); return prev; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const Sidebar = user?.role === "agent" ? AgentSidebar : ManagerSidebar;

  // The poll and the SSE handler need the CURRENT filters without being torn
  // down and rebuilt on every keystroke, so they read this ref instead of
  // closing over `filters`.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const loadList = useCallback(async () => {
    const { q, filter } = filtersRef.current;
    // Only truthy values — URLSearchParams would happily serialize
    // `filter=undefined` as the literal string "undefined".
    const params = {};
    if (q && q.trim()) params.q = q.trim();
    if (filter && filter !== "all") params.filter = filter;
    try {
      setConversations(await inbox.listConversations(params));
    } catch (err) {
      toast.error(err.message || "טעינת השיחות נכשלה");
    } finally {
      setLoadingList(false);
    }
  }, []);

  // Debounce the text search only; a tab click should feel instant.
  useEffect(() => {
    const delay = filters.q ? 300 : 0;
    const t = setTimeout(loadList, delay);
    return () => clearTimeout(t);
  }, [filters, loadList]);

  useEffect(() => {
    const t = setInterval(loadList, POLL_MS);
    return () => clearInterval(t);
  }, [loadList]);

  useCrmEvents(
    ["message.created", "message.received", "message.sent", "lock.claimed", "lock.released", "conversation.updated"],
    () => loadList()
  );

  const isFiltered = !!filters.q || filters.filter !== "all";

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
        <div className="flex-1 min-w-0 w-full grid grid-cols-1 md:grid-cols-[340px_1fr] gap-4 items-start">
          {/* Conversation list — WhatsApp's chat list: avatar, name, last-message
              preview, time, green unread badge. */}
          <div className="border border-black rounded-xl bg-white overflow-hidden h-[75vh] flex flex-col">
            <div className="shrink-0" style={{ background: WA_PANEL }}>
              <div className="px-4 pt-3 pb-2 font-semibold text-sm">שיחות</div>
              <div className="px-3 pb-2">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    value={filters.q}
                    onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                    placeholder="חיפוש לפי שם או טלפון"
                    className="pr-9 h-9 bg-white"
                  />
                </div>
              </div>
              <div className="flex gap-1 px-3">
                {FILTERS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, filter: key }))}
                    className={`px-2.5 pb-2 text-xs border-b-2 transition-colors ${filters.filter === key ? "font-semibold" : "border-transparent"}`}
                    style={filters.filter === key ? { borderColor: WA_GREEN, color: WA_GREEN } : { color: WA_META }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {loadingList ? (
              <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm px-3">
                <MessagesSquare className="w-8 h-8 mx-auto mb-2" />
                {isFiltered ? "לא נמצאו שיחות התואמות לסינון" : "אין שיחות עדיין"}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {conversations.map((c) => {
                  const name = c.customer_name || c.customer_phone || "לא ידוע";
                  const preview = c.last_type === "document"
                    ? "📎 מסמך"
                    : (c.last_body || "").replace(/\s+/g, " ").trim();
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveId(c.id)}
                      className={`w-full text-right px-3 py-2.5 flex items-center gap-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${activeId === c.id ? "bg-slate-100" : ""} ${c.is_overdue ? "border-r-4 border-r-red-500" : ""}`}
                    >
                      <div className="w-12 h-12 rounded-full bg-slate-300 text-white flex items-center justify-center font-semibold shrink-0">
                        {name.trim().charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm truncate text-slate-900">{name}</span>
                          <span className="text-[11px] shrink-0" style={{ color: WA_META }}>
                            {c.last_message_at ? listTime(c.last_message_at) : ""}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-xs truncate" style={{ color: WA_META }}>
                            {c.last_direction === "out" && <span className="ml-1">✓</span>}
                            {preview || c.customer_phone}
                          </span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            {/* Overdue badge + a red (not green) unread count, so
                                the whole row reads as one urgency signal. */}
                            {c.is_overdue && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">
                                ממתין {waitLabel(c.minutes_waiting)}
                              </span>
                            )}
                            {c.lock_username && <Lock className="w-3.5 h-3.5 text-amber-500" />}
                            {c.unread_count > 0 && (
                              <span
                                className="text-[11px] text-white rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center"
                                style={{ background: c.is_overdue ? "#ef4444" : WA_GREEN }}
                              >
                                {c.unread_count}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {!activeId ? (
            <div className="border border-black rounded-xl flex flex-col h-[75vh] items-center justify-center text-sm gap-3" style={{ background: WA_PANEL, color: WA_META }}>
              <MessagesSquare className="w-12 h-12 opacity-40" />
              בחר שיחה מהרשימה
            </div>
          ) : (
            <ConversationThread conversationId={activeId} />
          )}
        </div>
      </div>
    </div>
  );
}
