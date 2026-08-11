import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Search, Loader2, User, Calendar, TrendingUp, CheckCircle2, XCircle, ChevronDown, X, PackagePlus, Eye, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import QuoteDetailsModal from "@/components/QuoteDetailsModal";
import { convertMorningDocument, getLatestMorningDocuments } from "@/api/morningClient";
import { toast } from "sonner";
import printellaLogo from "@/assets/printella-logo.png";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import { fmt, STATUS_LABELS, STATUS_COLORS, CATEGORY_LABELS, CATEGORY_COLORS, MORNING_TYPE_LABELS, toLocalDateStr, formatDocNumber, ORIGIN_LABELS, ORIGIN_COLORS, originOf } from "@/lib/quoteLabels";

const DATE_PRESETS = [
  { key: "today", label: "היום" },
  { key: "7d", label: "7 ימים אחרונים" },
  { key: "30d", label: "30 יום אחרונים" },
  { key: "all", label: "הכל" },
  { key: "custom", label: "טווח מותאם" },
];

export default function QuotesHistory() {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [user, setUser] = useState(null);
  const [selectedQuote, setSelectedQuote] = useState(null);
  const [sellers, setSellers] = useState({});
  const [datePreset, setDatePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState(toLocalDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toLocalDateStr(new Date()));
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Row ids with a decide/delete request in flight — disables that row's action
  // buttons so a double-click can't fire two decision calls for the same quote.
  const [pendingIds, setPendingIds] = useState(() => new Set());
  // Latest Morning document per quote id — {quoteId: {morning_document_number, document_url, ...}}
  const [morningDocs, setMorningDocs] = useState({});
  const [convertingIds, setConvertingIds] = useState(() => new Set());
  // Raw Morning document URL currently previewed — resolved to a blob URL
  // below (previewBlobUrl) before the iframe ever gets it.
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState(null);
  const openMorningDoc = (url) => setPreviewDoc(url);

  // The document-proxy route needs the Bearer token, which a plain
  // <iframe src="/api/morning/document-proxy?..."> can't attach (that's why
  // it showed {"error":"unauthorized"} instead of the PDF) — fetch it with
  // the token instead and hand the iframe a blob: URL.
  useEffect(() => {
    if (!previewDoc) { setPreviewBlobUrl(null); return; }
    let cancelled = false;
    let objectUrl = null;
    base44.quotes.fetchMorningDocumentBlob(previewDoc)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewBlobUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) toast.error("שגיאה בטעינת המסמך"); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewDoc]);

  const loadQuotes = async () => {
    const data = await base44.entities.Quote.list("-created_date", 200);
    setQuotes(data);

    if (data.length > 0) {
      try {
        setMorningDocs(await getLatestMorningDocuments(data.map(q => q.id)));
      } catch {
        // Morning not configured / unreachable — the list still works without it.
      }
    }

    // Load seller names — created_by is the username (see quoteCreate in
    // src/routes/entities.js), not email, since email is optional on accounts.
    const uniqueUsernames = [...new Set(data.map(q => q.created_by).filter(Boolean))];
    const sellerMap = {};
    for (const username of uniqueUsernames) {
      try {
        const sellers = await base44.entities.User.filter({ username });
        if (sellers.length > 0) {
          sellerMap[username] = sellers[0].full_name;
        } else {
          sellerMap[username] = username;
        }
      } catch {
        sellerMap[username] = username;
      }
    }
    setSellers(sellerMap);
    setLoading(false);
  };

  useEffect(() => {
    base44.auth.me().then(setUser);
    loadQuotes();
  }, []);

  // Date range filter — computed once per render from the preset/custom inputs.
  const dateRange = (() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (datePreset === "today") return { from: startOfToday, to: null };
    if (datePreset === "7d") return { from: new Date(startOfToday.getTime() - 6 * 86400000), to: null };
    if (datePreset === "30d") return { from: new Date(startOfToday.getTime() - 29 * 86400000), to: null };
    if (datePreset === "custom") {
      const from = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
      const to = customTo ? new Date(`${customTo}T23:59:59`) : null;
      return { from, to };
    }
    return { from: null, to: null }; // "all"
  })();

  // This screen is the review QUEUE — only quotes an agent actually sent for
  // review (status='sent') belong here. Once a manager decides (approved/
  // rejected), the quote leaves this list on the next render — that's the
  // point of a queue. Full history of every quote, any status, lives in
  // "היסטוריית הצעות כללית" (/quotes-archive) instead.
  const reviewQueue = quotes.filter((q) => q.status === "sent");

  const byDate = reviewQueue.filter((q) => {
    if (!dateRange.from && !dateRange.to) return true;
    const created = new Date(q.created_date);
    if (dateRange.from && created < dateRange.from) return false;
    if (dateRange.to && created > dateRange.to) return false;
    return true;
  });

  // Per-agent breakdown — computed on the date-filtered set (independent of the
  // search box and of which agent is currently selected), so clicking an agent
  // card doesn't change the other agents' numbers.
  const agentStats = Object.values(
    byDate.reduce((acc, q) => {
      const key = q.created_by || "—";
      if (!acc[key]) acc[key] = { key, name: sellers[key] || key, count: 0, total: 0 };
      acc[key].count += 1;
      acc[key].total += q.price_with_vat || 0;
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total);

  const filtered = byDate.filter((q) => {
    if (selectedAgent && q.created_by !== selectedAgent) return false;
    if (unreadOnly && q.viewed_at) return false;
    const s = search.toLowerCase();
    return (
      !s ||
      q.client_name?.toLowerCase().includes(s) ||
      q.quote_number?.toLowerCase().includes(s) ||
      q.created_by?.toLowerCase().includes(s)
    );
  });

  // Unread count is computed on the date-filtered set (not `filtered`, which
  // already excludes read rows when the tab itself is active) — so the badge
  // stays accurate regardless of which tab is currently selected.
  const unreadCount = byDate.filter((q) => !q.viewed_at).length;

  // Opening a quote's detail view marks it viewed exactly once — subsequent
  // opens don't re-write viewed_at, preserving the original "first opened" time.
  const openQuote = (q) => {
    setSelectedQuote(q);
    if (q.viewed_at) return;
    const viewedAt = new Date().toISOString();
    setQuotes((prev) => prev.map((x) => (x.id === q.id ? { ...x, viewed_at: viewedAt } : x)));
    base44.entities.Quote.update(q.id, { viewed_at: viewedAt });
  };

  const updateStatus = async (id, status) => {
    await base44.entities.Quote.update(id, { status });
    setQuotes((prev) => prev.map((q) => (q.id === id ? { ...q, status } : q)));
  };

  const withPending = async (id, fn) => {
    setPendingIds((prev) => new Set(prev).add(id));
    try {
      await fn();
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // Deletion moved to the analytics screen (QuotesArchive.jsx), restricted
  // there to a single account — this review queue no longer offers it.

  // Quick decision (no editing) — sets status AND notifies the agent who
  // created it. The edit-then-save flow in QuoteDetailsModal counts as the
  // same "approved" decision and calls the same endpoint from there.
  const decideQuote = async (q, decision) => {
    if (pendingIds.has(q.id)) return;
    if (decision === "rejected" && !window.confirm(`לדחות את הצעה ${q.quote_number}?`)) return;
    await withPending(q.id, async () => {
      await base44.quotes.decide(q.id, decision, q.quote_number);
      setQuotes((prev) => prev.map((x) => (x.id === q.id ? { ...x, status: decision } : x)));
    });
  };

  // Converts this quote's Morning document into an order ("הזמנה") — reuses
  // the same endpoint as QuoteDetailsModal's MorningSection, just triggered
  // from the list row instead of the detail view.
  const handleConvertToOrder = async (q) => {
    if (convertingIds.has(q.id)) return;
    setConvertingIds((prev) => new Set(prev).add(q.id));
    try {
      await convertMorningDocument(q.id, "order");
      const docs = await getLatestMorningDocuments([q.id]);
      setMorningDocs((prev) => ({ ...prev, ...docs }));
      toast.success(`הצעה ${q.quote_number} הפכה להזמנה במורנינג`);
    } catch (err) {
      toast.error(err?.message || "שגיאה בהפיכת המסמך להזמנה");
    }
    setConvertingIds((prev) => {
      const next = new Set(prev);
      next.delete(q.id);
      return next;
    });
  };

  // Selected agent's own stats within the current date range — how much of
  // theirs is sitting in the queue, and how much of that the manager hasn't
  // even opened yet.
  const selectedAgentStats = selectedAgent ? (() => {
    const mine = byDate.filter((q) => q.created_by === selectedAgent);
    const unread = mine.filter((q) => !q.viewed_at).length;
    const total = mine.reduce((s, q) => s + (q.price_with_vat || 0), 0);
    return {
      name: sellers[selectedAgent] || selectedAgent,
      count: mine.length,
      total,
      avg: mine.length > 0 ? total / mine.length : 0,
      unread,
    };
  })() : null;

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      {/* Header — no back button here anymore; ManagerSidebar below is the
          single, always-visible navigation for every manager screen. */}
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <img src={printellaLogo} alt="Printella" className="h-24 object-contain" />
          {user?.full_name && (
            <span className="text-sm font-semibold text-foreground">{user.full_name}</span>
          )}
        </div>
      </div>

      <div className="w-full mx-auto px-4 sm:px-8 py-8 flex flex-col lg:flex-row gap-8 items-start">
        <ManagerSidebar />
        <div className="flex-1 min-w-0 w-full max-w-5xl space-y-6">
        {/* Date filter */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-500 shrink-0">טווח זמן:</span>
            <div className="relative">
              <select
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value)}
                dir="rtl"
                className="h-10 rounded-lg border border-black bg-white pl-3 pr-8 text-sm text-slate-700 appearance-none"
              >
                {DATE_PRESETS.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            {agentStats.length > 0 && (
              <>
                <span className="text-sm font-semibold text-slate-500 shrink-0 mr-2">סינון לפי סוכנים:</span>
                <div className="relative">
                  <select
                    value={selectedAgent || ""}
                    onChange={(e) => setSelectedAgent(e.target.value || null)}
                    dir="rtl"
                    className="h-10 rounded-lg border border-black bg-white pl-3 pr-8 text-sm text-slate-700 appearance-none"
                  >
                    <option value="">כל הסוכנים</option>
                    {agentStats.map((a) => (
                      <option key={a.key} value={a.key}>{a.name} ({a.count})</option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </>
            )}
          </div>
          {datePreset === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-10 rounded-lg border border-black bg-white px-3 text-sm text-slate-700"
                dir="ltr"
              />
              <span className="text-slate-500 text-sm">עד</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-10 rounded-lg border border-black bg-white px-3 text-sm text-slate-700"
                dir="ltr"
              />
            </div>
          )}
        </div>

        {/* Stats — every card here is about the QUEUE itself (things still
            awaiting a decision); "approved" no longer means anything on this
            screen since an approved quote leaves the queue immediately. */}
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">סיכום הצעות לטווח זמן</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border border-black rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-foreground tabular-nums">{byDate.length}</div>
            <div className="text-sm text-slate-500 mt-1">ממתינות לבדיקה</div>
          </div>
          <div className="bg-white border border-black rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-emerald-600 tabular-nums">{unreadCount}</div>
            <div className="text-sm text-slate-500 mt-1">טרם נפתחו</div>
          </div>
          <div className="bg-white border border-black rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-primary tabular-nums">{fmt(byDate.reduce((s, q) => s + (q.price_with_vat || 0), 0))}</div>
            <div className="text-sm text-slate-500 mt-1">סה״כ שווי ממתין</div>
          </div>
        </div>

        {/* Per-agent breakdown — cards for an at-a-glance overview of everyone
            (the agent picker itself now lives in the date-filter row above). */}
        {agentStats.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">לפי סוכן מכירות</h3>
              {selectedAgentStats && (
                <button
                  onClick={() => setSelectedAgent(null)}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-primary transition-colors"
                  title="חזרה לכל הסוכנים"
                >
                  <X className="w-3.5 h-3.5" />
                  {selectedAgentStats.name}
                </button>
              )}
            </div>

            {selectedAgentStats ? (
              <div className="bg-white border border-primary/40 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <div className="text-2xl font-bold text-foreground tabular-nums">{selectedAgentStats.count}</div>
                  <div className="text-xs text-slate-500 mt-1">הצעות בטווח</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-primary tabular-nums">{fmt(selectedAgentStats.total)}</div>
                  <div className="text-xs text-slate-500 mt-1">סה״כ שווי</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-foreground tabular-nums">{fmt(selectedAgentStats.avg)}</div>
                  <div className="text-xs text-slate-500 mt-1">ממוצע להצעה</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-emerald-600 tabular-nums">{selectedAgentStats.unread}</div>
                  <div className="text-xs text-slate-500 mt-1">טרם נפתחו</div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {agentStats.map((a) => {
                  const avg = a.count > 0 ? a.total / a.count : 0;
                  return (
                    <button
                      key={a.key}
                      onClick={() => setSelectedAgent(a.key)}
                      className="text-right rounded-2xl border border-black bg-white hover:border-slate-500 p-4 transition-all"
                    >
                      <div className="font-semibold text-foreground">{a.name}</div>
                      <div className="text-sm text-slate-500 mt-1">{a.count} הצעות · {fmt(a.total)} סה״כ</div>
                      <div className="text-xs text-slate-400 mt-0.5">ממוצע להצעה: {fmt(avg)}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי לקוח, מס׳ הצעה או סוכן..."
            className="h-10 bg-white border-black text-foreground placeholder:text-slate-400 pr-9"
          />
        </div>

        {/* Read/unread tabs — filters the rows below by whether a manager has
            already opened this quote's detail view at least once. */}
        <div className="flex items-center gap-2">
          {[
            { key: false, label: "כל ההצעות" },
            { key: true, label: "לא נפתחו בלבד" },
          ].map(({ key, label }) => (
            <button
              key={String(key)}
              onClick={() => setUnreadOnly(key)}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                unreadOnly === key ? "border-primary bg-primary/10 text-primary font-semibold" : "border-black text-slate-500 hover:border-slate-500"
              }`}
            >
              {label}
              {key === true && unreadCount > 0 && (
                <span className={`text-xs min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center ${unreadOnly ? "bg-primary text-white" : "bg-slate-200 text-slate-600"}`}>
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-400 text-sm">לא נמצאו הצעות מחיר</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((q) => (
              // A plain div, not a <button> — a <select> and buttons nested
              // inside a native <button> caused clicks on them to also bubble
              // up and open the modal. The row itself still opens the modal;
              // every interactive child below stops that one click first.
              <div
                key={q.id}
                onClick={() => openQuote(q)}
                className="w-full text-right bg-white border border-black rounded-2xl p-4 hover:border-slate-500 hover:bg-slate-50 transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {!q.viewed_at && (
                        <span className="w-2 h-2 rounded-full bg-primary shrink-0" title="טרם נפתחה" />
                      )}
                      <span className="font-semibold text-foreground">{q.client_name}</span>
                      <span className="text-xs text-slate-400 font-mono">{q.quote_number}</span>
                      {/* Which of the three kinds this row is — and, for the two
                          that replace something, which quote it replaces. */}
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${ORIGIN_COLORS[originOf(q)]}`}
                        title={ORIGIN_LABELS[originOf(q)]}
                      >
                        {ORIGIN_LABELS[originOf(q)]}
                        {q.parent_quote_number && ` — מחליפה את ${q.parent_quote_number}`}
                      </span>
                      {q.product_category && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${CATEGORY_COLORS[q.product_category] || "bg-slate-100 text-slate-500"}`}>{CATEGORY_LABELS[q.product_category] || q.product_category}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-sm text-slate-500 flex-wrap">
                                <span className="flex items-center gap-1"><User className="w-3 h-3" />{sellers[q.created_by] || q.created_by}</span>
                                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(q.created_date).toLocaleDateString("he-IL")}</span>
                                {q.notes && <span className="text-slate-400 truncate max-w-xs">{q.notes}</span>}
                              </div>
                    {morningDocs[q.id] && (
                      <div className="flex items-center gap-2 mt-1 text-xs text-slate-400" onClick={(e) => e.stopPropagation()}>
                        <span>
                          מסמך מורנינג: {MORNING_TYPE_LABELS[morningDocs[q.id].morning_document_type] || "מסמך"} #{formatDocNumber(morningDocs[q.id].morning_document_number || morningDocs[q.id].morning_document_id)}
                        </span>
                        {morningDocs[q.id].document_url && (
                          <button
                            onClick={() => openMorningDoc(morningDocs[q.id].document_url)}
                            className="flex items-center gap-1 text-primary hover:underline"
                          >
                            <Eye className="w-3 h-3" /> הצג מסמך
                          </button>
                        )}
                      </div>
                    )}
                    {q.agent_note && (
                      <div className="flex items-start gap-1.5 mt-1.5 text-sm bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 max-w-xl">
                        <span className="text-amber-600 font-semibold shrink-0">הערת סוכן:</span>
                        <span className="text-amber-800">{q.agent_note}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <div className="text-left">
                      <div className="text-base font-bold text-primary tabular-nums">{fmt(q.price_with_vat)}</div>
                      <div className="text-sm text-slate-400">כולל מע״מ</div>
                    </div>
                    {/* אישור/דחייה רק דרך הכפתורים — הם היחידים ששולחים התראה
                        לסוכן. הרשימה הזו נועדה רק להחזיר הצעה לטיוטה (החוצה
                        מהתור, בחזרה לסוכן), לא לקבל החלטה סופית "בשקט" בלי
                        שהסוכן ידע. אין כאן ענף "אושרה/נדחתה" — ברגע שהצעה
                        מקבלת החלטה היא כבר לא status='sent' ויוצאת מהתור. */}
                    <select
                      value={q.status}
                      onChange={(e) => updateStatus(q.id, e.target.value)}
                      title="החזרת ההצעה לטיוטה — לאישור/דחייה בפועל יש להשתמש בכפתורים"
                      className={`text-xs px-2 py-1.5 rounded-lg border-0 outline-none cursor-pointer ${STATUS_COLORS[q.status]} bg-transparent`}
                    >
                      <option value="draft" className="bg-white text-foreground">{STATUS_LABELS.draft}</option>
                      <option value="sent" className="bg-white text-foreground">{STATUS_LABELS.sent}</option>
                    </select>
                    <button
                      onClick={() => decideQuote(q, "approved")}
                      disabled={pendingIds.has(q.id)}
                      title="מאשר — שולח את ההצעה לתיבת הסוכן להנפקה ומודיע לו"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => decideQuote(q, "rejected")}
                      disabled={pendingIds.has(q.id)}
                      title="דחה — שולח הודעת דחייה לסוכן"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                    {morningDocs[q.id] && (
                      <button
                        onClick={() => handleConvertToOrder(q)}
                        disabled={convertingIds.has(q.id)}
                        title="הפוך להזמנה במורנינג"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                      >
                        {convertingIds.has(q.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackagePlus className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      {selectedQuote && (
        <QuoteDetailsModal
          quote={selectedQuote}
          morningDoc={morningDocs[selectedQuote.id]}
          onOpenMorningDoc={openMorningDoc}
          onClose={() => setSelectedQuote(null)}
          onSaved={() => { setSelectedQuote(null); loadQuotes(); }}
        />
      )}

      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setPreviewDoc(null)}>
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
              <a
                href={previewDoc}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/90 hover:bg-slate-100 border border-slate-200 transition-colors text-xs text-slate-600"
              >
                <Download className="w-4 h-4" /> הורד
              </a>
              <button onClick={() => setPreviewDoc(null)} className="p-1.5 rounded-lg bg-white/90 hover:bg-slate-100 border border-slate-200 transition-colors">
                <X className="w-4 h-4 text-slate-600" />
              </button>
            </div>
            {previewBlobUrl ? (
              <iframe src={previewBlobUrl} title="מסמך מורנינג" className="w-full h-full rounded-2xl" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}