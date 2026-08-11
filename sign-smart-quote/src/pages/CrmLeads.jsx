import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { Loader2, Target } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { crmLeads } from "@/api/crmClient";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import AgentSidebar from "@/components/layout/AgentSidebar";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";

const PIPELINE = [
  { key: "new", label: "חדש" },
  { key: "contacted", label: "יצרנו קשר" },
  { key: "quoted", label: "נשלחה הצעה" },
  { key: "won", label: "זכינו" },
  { key: "lost", label: "אבדנו" },
];

// Phase 1 lead pipeline — a simple kanban-style board over crm_leads,
// grouped client-side by status (server returns a flat list, see
// GET /api/crm/leads in src/routes/crm.js).
export default function CrmLeads() {
  const { user } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const Sidebar = user?.role === "agent" ? AgentSidebar : ManagerSidebar;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLeads(await crmLeads.list({}));
    } catch (err) {
      toast.error(err.message || "טעינת הלידים נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const map = Object.fromEntries(PIPELINE.map((s) => [s.key, []]));
    for (const l of leads) {
      if (!map[l.status]) map[l.status] = [];
      map[l.status].push(l);
    }
    return map;
  }, [leads]);

  const move = async (leadId, status) => {
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
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <img src={printellaLogo} alt="Printella" className="h-24 object-contain" />
          <h1 className="text-lg font-bold">לידים</h1>
        </div>
      </div>

      <div className="w-full mx-auto px-4 sm:px-8 py-8 flex flex-col lg:flex-row gap-8 items-start">
        <Sidebar />
        <div className="flex-1 min-w-0 w-full space-y-6">
          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : leads.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <Target className="w-10 h-10 mx-auto mb-2" />
              אין לידים עדיין — לידים ייווצרו כאן ידנית או דרך סנכרון מנדיי (בשלב הבא)
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
              {PIPELINE.map((col) => (
                <div key={col.key} className="border border-black rounded-xl bg-white flex flex-col min-h-[200px]">
                  <div className="px-3 py-2 border-b border-slate-200 font-semibold text-sm flex items-center justify-between">
                    {col.label}
                    <span className="text-xs text-slate-400">{grouped[col.key]?.length || 0}</span>
                  </div>
                  <div className="p-2 space-y-2 flex-1">
                    {(grouped[col.key] || []).map((l) => (
                      <div key={l.id} className="border border-slate-200 rounded-lg p-2 text-xs space-y-1.5 bg-slate-50">
                        <Link to={`/crm/customers/${l.customer_id}`} className="font-medium text-sm hover:text-primary block truncate">
                          {l.customer_name}
                        </Link>
                        {l.customer_phone && <div className="text-slate-400">{l.customer_phone}</div>}
                        <select
                          value={l.status}
                          onChange={(e) => move(l.id, e.target.value)}
                          className="w-full text-xs border border-black rounded-md px-1.5 py-1 bg-white"
                        >
                          {PIPELINE.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          <option value="disqualified">לא רלוונטי</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
