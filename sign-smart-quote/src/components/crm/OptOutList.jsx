import { useState, useEffect, useCallback } from "react";
import { Loader2, Search, Ban, Plus, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { optouts } from "@/api/campaignsClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const SOURCE_LABELS = { keyword: "מילת מפתח", manual: "ידני", import: "ייבוא", complaint: "תלונה" };

// Register of numbers suppressed from marketing sends (CRM plan Phase 4 §6).
// Rows are never hard-deleted — re-subscribe writes revoked_at, admin-only.
export default function OptOutList() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async (query) => {
    setLoading(true);
    try {
      setRows(await optouts.list(query));
    } catch (err) {
      toast.error(err.message || "טעינת רשימת ההסרות נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(""); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(q), 300);
    return () => clearTimeout(t);
  }, [q, load]);

  const addManual = async () => {
    if (!newPhone.trim()) return;
    setAdding(true);
    try {
      await optouts.create(newPhone.trim(), "manual");
      setNewPhone("");
      toast.success("המספר הוסר מרשימת התפוצה");
      load(q);
    } catch (err) {
      toast.error(err.message || "ההוספה נכשלה");
    } finally {
      setAdding(false);
    }
  };

  const resubscribe = async (id) => {
    try {
      await optouts.remove(id);
      toast.success("המספר שוחזר לרשימת התפוצה");
      load(q);
    } catch (err) {
      toast.error(err.message || "הפעולה נכשלה");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי טלפון או שם" className="pr-8 h-9" />
        </div>
        <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="הוסף מספר ידנית" dir="ltr" className="h-9 max-w-[180px]" />
        <Button size="sm" onClick={addManual} disabled={adding || !newPhone.trim()} className="gap-1.5">
          {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} הוסף
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-6 text-sm text-slate-400">
          <Ban className="w-6 h-6 mx-auto mb-1" /> אין רשומות הסרה
        </div>
      ) : (
        <div className="border border-black rounded-xl divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{r.display_name || r.phone_e164}</span>
                <span className="text-xs text-slate-400 mr-2">{r.phone_e164}</span>
                {r.revoked_at && <span className="text-xs text-emerald-600 mr-2">(שוחזר)</span>}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>{SOURCE_LABELS[r.source] || r.source}{r.keyword ? ` · "${r.keyword}"` : ""}</span>
                {!r.revoked_at && user?.role === "admin" && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => resubscribe(r.id)}>
                    <Undo2 className="w-3 h-3" /> שחזר
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
