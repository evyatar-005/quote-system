import { useState, useEffect, useRef } from "react";
import { Bell, CheckCircle2, XCircle, Send, Clock, Loader2, X, Trash2, Wallet, FileDown, PackagePlus } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { issueQuoteToMorning, convertMorningDocument } from "@/api/morningClient";
import { toast } from "sonner";

// 'sent' = an agent sent a quote for review — lands on every admin, created
// server-side by notifyAdminsOfSentQuote (src/services/notifyAdmins.js).
// 'payment_received' = a payment link (createPaymentForm) got paid — created
// server-side by notifyPaymentReceived, triggered by the Morning
// payment/received webhook (see routes/morning.js).
const TYPE_ICON = { approved: CheckCircle2, rejected: XCircle, sent: Clock, payment_received: Wallet };
const TYPE_COLOR = { approved: "text-emerald-400", rejected: "text-red-400", sent: "text-amber-400", payment_received: "text-emerald-400" };

function parsePayload(n) {
  if (!n.payload_json) return null;
  try { return JSON.parse(n.payload_json); } catch { return null; }
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [issuingId, setIssuingId] = useState(null);
  const [issuingOrderId, setIssuingOrderId] = useState(null);
  const ref = useRef(null);

  // Silent on failure (e.g. session expired — base44Client already redirects
  // to login on a 401) and guards against an unexpected response shape, so a
  // bad response can't throw on the destructure and this doesn't spam an
  // unhandled rejection every 30s if the network/endpoint is briefly down.
  const load = () => base44.notifications.list()
    .then((data) => setItems(Array.isArray(data?.notifications) ? data.notifications : []))
    .catch((err) => console.error("[NotificationBell] failed to load notifications:", err));

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // light polling — no websocket in this app
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // A 'sent' notification is a manager to-do that only makes sense while the
  // quote is still pending a decision — the decision itself creates a separate
  // 'approved'/'rejected' notification instead of retiring this row, so left
  // unfiltered it piles up with every quote ever submitted, most already
  // resolved. quote_status is joined server-side (routes/notifications.js).
  const visibleItems = items.filter((n) => n.type !== "sent" || n.quote_status === "sent");
  const unreadCount = visibleItems.filter((n) => !n.is_read).length;

  const handleOpen = () => {
    setOpen((o) => !o);
    if (!open && unreadCount > 0) {
      base44.notifications.markAllRead().then(load).catch((err) => console.error("[NotificationBell] failed to mark all read:", err));
    }
  };

  const handleDelete = (id) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    base44.notifications.remove(id);
  };

  const handleDeleteAll = () => {
    setItems([]);
    base44.notifications.removeAll();
  };

  const handleIssue = async (n) => {
    setIssuingId(n.id);
    const result = await issueQuoteToMorning({ quote_number: n.quote_number, client_name: "", price_before_vat: null, price_with_vat: null });
    setIssuingId(null);
    if (!result.issued) {
      toast.message("החיבור למורנינג עדיין לא מוגדר", {
        description: "הנתונים מוכנים לשליחה — ההנפקה תתחיל לעבוד ברגע שיהיה חשבון/מפתח API של מורנינג.",
      });
    }
  };

  // Straight from the notification to an issued order — no navigating back to
  // the quote first. Only meaningful when the notification carries a real
  // quote_id (always true for payment_received, generated server-side against
  // a real quote row).
  const handleIssueOrder = async (n) => {
    setIssuingOrderId(n.id);
    try {
      await convertMorningDocument(n.quote_id, "order");
      toast.success(`הזמנה הונפקה עבור הצעה ${n.quote_number}`);
    } catch (err) {
      toast.error(err?.message || "שגיאה בהנפקת ההזמנה");
    }
    setIssuingOrderId(null);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-lg border border-black hover:bg-slate-50 transition-colors"
        title="התראות"
      >
        <Bell className="w-4 h-4 text-slate-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -left-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1rem)] max-h-96 overflow-y-auto bg-white border-2 border-black rounded-xl shadow-lg z-50" dir="rtl">
          <div className="p-3 border-b border-black flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">התראות</span>
            {visibleItems.length > 0 && (
              <button
                onClick={handleDeleteAll}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> מחק הכל
              </button>
            )}
          </div>
          {visibleItems.length === 0 ? (
            <p className="p-4 text-sm text-slate-400 text-center">אין התראות</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {visibleItems.map((n) => {
                const Icon = TYPE_ICON[n.type] || Bell;
                return (
                  <div key={n.id} className="p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${TYPE_COLOR[n.type] || "text-slate-400"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700">{n.message}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{new Date(n.created_at).toLocaleString("he-IL")}</p>
                      </div>
                      <button
                        onClick={() => handleDelete(n.id)}
                        className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                        title="הסר התראה"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {n.type === "approved" && (
                      <button
                        onClick={() => handleIssue(n)}
                        disabled={issuingId === n.id}
                        className="w-full flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                      >
                        {issuingId === n.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        הנפק הצעת מחיר ללקוח
                      </button>
                    )}
                    {n.type === "payment_received" && (() => {
                      const payload = parsePayload(n);
                      return (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleIssueOrder(n)}
                            disabled={issuingOrderId === n.id}
                            className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            {issuingOrderId === n.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackagePlus className="w-3.5 h-3.5" />}
                            הנפק הזמנה
                          </button>
                          {payload?.receiptUrl ? (
                            <a
                              href={payload.receiptUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                            >
                              <FileDown className="w-3.5 h-3.5" /> הורד קבלה
                            </a>
                          ) : (
                            <span
                              title="הקבלה עדיין לא זוהתה במורנינג — נסה שוב בעוד רגע"
                              className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 cursor-default"
                            >
                              <FileDown className="w-3.5 h-3.5" /> קבלה בהמתנה
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
