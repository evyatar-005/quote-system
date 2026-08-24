import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowRight, Loader2, Phone, Mail, MapPin, Building2, Plus } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { crmCustomers, crmLeads } from "@/api/crmClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import AgentSidebar from "@/components/layout/AgentSidebar";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";
import { LEAD_STATUSES } from "@/lib/leadStatuses";

// The status picker offers the board's full stage list, in board order —
// see src/lib/leadStatuses.js for why the vocabulary lives in one place.

export default function CrmCustomerDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const Sidebar = user?.role === "agent" ? AgentSidebar : ManagerSidebar;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCustomer(await crmCustomers.get(id));
    } catch (err) {
      toast.error(err.message || "טעינת הלקוח נכשלה");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const addNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await crmCustomers.addNote(id, noteText.trim());
      setNoteText("");
      toast.success("ההערה נשמרה");
      load();
    } catch (err) {
      toast.error(err.message || "שמירת ההערה נכשלה");
    } finally {
      setSavingNote(false);
    }
  };

  const createLead = async () => {
    try {
      await crmLeads.create({ customer_id: id, title: "ליד חדש" });
      toast.success("ליד נוצר");
      load();
    } catch (err) {
      toast.error(err.message || "יצירת הליד נכשלה");
    }
  };

  const updateLeadStatus = async (leadId, status) => {
    try {
      await crmLeads.update(leadId, { status });
      load();
    } catch (err) {
      toast.error(err.message || "עדכון הליד נכשל");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <img src={printellaLogo} alt="Printella" className="h-24 object-contain" />
          <div>
            <h1 className="text-lg font-bold">{customer?.display_name || "כרטיס לקוח"}</h1>
          </div>
        </div>
      </div>

      <div className="w-full mx-auto px-4 sm:px-8 py-8 flex flex-col lg:flex-row gap-8 items-start">
        <Sidebar />
        <div className="flex-1 min-w-0 w-full max-w-5xl space-y-6">
          <Link to="/crm/customers" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-primary">
            <ArrowRight className="w-4 h-4" /> חזרה לרשימת הלקוחות
          </Link>

          {loading || !customer ? (
            <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : (
            <>
              <div className="border border-black rounded-xl bg-white p-5 space-y-2">
                <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                  {customer.phone_e164 && <span className="flex items-center gap-1.5"><Phone className="w-4 h-4" />{customer.phone_e164}</span>}
                  {customer.email && <span className="flex items-center gap-1.5"><Mail className="w-4 h-4" />{customer.email}</span>}
                  {customer.address && <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" />{customer.address}</span>}
                  {customer.company && <span className="flex items-center gap-1.5"><Building2 className="w-4 h-4" />{customer.company}</span>}
                </div>
              </div>

              <div className="border border-black rounded-xl bg-white p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">לידים</h2>
                  <Button size="sm" variant="outline" onClick={createLead} className="gap-1">
                    <Plus className="w-4 h-4" /> ליד חדש
                  </Button>
                </div>
                {(customer.leads || []).length === 0 ? (
                  <div className="text-sm text-slate-400">אין לידים עדיין</div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {customer.leads.map((l) => (
                      <div key={l.id} className="flex items-center justify-between py-2 gap-3">
                        <div>
                          <div className="text-sm font-medium">{l.title || `ליד #${l.id}`}</div>
                          <div className="text-xs text-slate-400">{new Date(l.created_at).toLocaleDateString("he-IL")}</div>
                        </div>
                        <select
                          value={l.status}
                          onChange={(e) => updateLeadStatus(l.id, e.target.value)}
                          className="text-xs border border-black rounded-lg px-2 py-1 bg-white"
                        >
                          {LEAD_STATUSES.map((st) => (
                            <option key={st.key} value={st.key}>{st.label}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border border-black rounded-xl bg-white p-5 space-y-3">
                <h2 className="font-semibold">הצעות</h2>
                {(customer.quotes || []).length === 0 ? (
                  <div className="text-sm text-slate-400">אין הצעות עדיין</div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {customer.quotes.map((q) => (
                      <div key={q.id} className="flex items-center justify-between py-2 text-sm">
                        <span>{q.quote_number} — {q.product_category}</span>
                        <span className="text-slate-500">{q.price_with_vat != null ? `₪ ${Number(q.price_with_vat).toLocaleString("he-IL")}` : "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border border-black rounded-xl bg-white p-5 space-y-3">
                <h2 className="font-semibold">הערה חדשה</h2>
                <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="כתוב הערה על הלקוח..." rows={3} />
                <Button size="sm" onClick={addNote} disabled={savingNote || !noteText.trim()}>
                  {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : "שמור הערה"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
