import { useState, useEffect } from "react";
import { Bell, XCircle, Clock, Wallet, X, PackagePlus, FileDown, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { convertMorningDocument } from "@/api/morningClient";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const TYPE_ICON = { rejected: XCircle, sent: Clock, payment_received: Wallet };
const TYPE_COLOR = { rejected: "text-red-500", sent: "text-amber-500", payment_received: "text-emerald-600" };

function parsePayload(n) {
  if (!n.payload_json) return null;
  try { return JSON.parse(n.payload_json); } catch { return null; }
}

// The notification bell's contents, moved into the lead rail — the rail is the
// agent's one attention list, and a separate bell meant two places to look.
// 'approved' notifications are deliberately DROPPED here: the rail already has
// a "מוכנות להנפקה" section derived from quote state (approved + no Morning
// document), which stays correct even after someone clears their notifications.
export default function RailNotifications() {
  const [items, setItems] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = () => base44.notifications.list()
    .then((data) => setItems(Array.isArray(data?.notifications) ? data.notifications : []))
    .catch((err) => console.error("[RailNotifications] failed to load:", err));

  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // same light polling the bell used
    return () => clearInterval(t);
  }, []);

  // 'approved' notices are dropped (see file header). A 'sent' notice is a
  // manager to-do that only makes sense while the quote is STILL pending — once
  // decided, quote_status moves off 'sent' but nothing ever retired the
  // notification row itself, so without this it piles up forever with every
  // quote ever submitted, most already resolved.
  const visible = items.filter((n) => {
    if (n.type === "approved") return false;
    if (n.type === "sent") return n.quote_status === "sent";
    return true;
  });
  if (visible.length === 0) return null;

  const remove = (id) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    base44.notifications.remove(id);
  };

  const issueOrder = async (n) => {
    setBusyId(n.id);
    try {
      await convertMorningDocument(n.quote_id, "order");
      toast.success(`הזמנה הונפקה עבור הצעה ${n.quote_number}`);
    } catch (err) {
      toast.error(err?.message || "שגיאה בהנפקת ההזמנה");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="px-2.5 py-0.5 bg-slate-100 border-y border-slate-200 text-[10px] font-bold text-slate-600 flex items-center gap-1">
        <Bell className="w-2.5 h-2.5" /> התראות <span className="font-normal text-slate-400">{visible.length}</span>
      </div>
      {visible.map((n) => {
        const Icon = TYPE_ICON[n.type] || Bell;
        const payload = parsePayload(n);
        return (
          <div key={n.id} className="px-2.5 py-1.5 border-b border-slate-100 space-y-1">
            <div className="flex items-start gap-1.5">
              <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${TYPE_COLOR[n.type] || "text-slate-400"}`} />
              <p className="text-[10px] text-slate-600 flex-1 leading-snug">{n.message}</p>
              <button
                onClick={() => remove(n.id)}
                className="text-slate-300 hover:text-red-500 shrink-0"
                title="הסר התראה"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {n.type === "payment_received" && (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  className="h-6 flex-1 px-1.5 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700"
                  disabled={busyId === n.id}
                  onClick={() => issueOrder(n)}
                >
                  {busyId === n.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <PackagePlus className="w-3 h-3" />}
                  הנפק הזמנה
                </Button>
                {payload?.receiptUrl ? (
                  <a
                    href={payload.receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1 text-[10px] rounded-md border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  >
                    <FileDown className="w-3 h-3" /> קבלה
                  </a>
                ) : (
                  <span
                    title="הקבלה עדיין לא זוהתה במורנינג — נסה שוב בעוד רגע"
                    className="flex-1 flex items-center justify-center gap-1 text-[10px] rounded-md border border-slate-200 bg-slate-50 text-slate-400"
                  >
                    <FileDown className="w-3 h-3" /> בהמתנה
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
