import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Loader2, Send, Plus } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { campaigns } from "@/api/campaignsClient";
import { Button } from "@/components/ui/button";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import AgentSidebar from "@/components/layout/AgentSidebar";
import CampaignWizard from "@/components/crm/CampaignWizard";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";

const STATUS_LABELS = {
  draft: "טיוטה", ready: "מוכן", running: "רץ", paused: "מושהה", completed: "הושלם", cancelled: "בוטל",
};
const STATUS_COLORS = {
  draft: "bg-slate-100 text-slate-500", ready: "bg-blue-50 text-blue-600",
  running: "bg-emerald-50 text-emerald-600", paused: "bg-amber-50 text-amber-600",
  completed: "bg-slate-100 text-slate-600", cancelled: "bg-red-50 text-red-500",
};

// CRM Phase 4 — list of דיוורים (bulk WhatsApp broadcasts). Create/send is
// gated by user.canSendCampaigns; viewing is open to any CRM user (agents
// need to see what was sent to their own customers).
export default function CrmCampaigns() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const Sidebar = user?.role === "agent" ? AgentSidebar : ManagerSidebar;

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await campaigns.list()); }
    catch (err) { toast.error(err.message || "טעינת הדיוורים נכשלה"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <img src={printellaLogo} alt="Printella" className="h-24 object-contain" />
          <h1 className="text-lg font-bold">דיוור</h1>
        </div>
      </div>

      <div className="w-full mx-auto px-4 sm:px-8 py-8 flex flex-col lg:flex-row gap-8 items-start">
        <Sidebar />
        <div className="flex-1 min-w-0 w-full max-w-5xl space-y-6">
          {user?.canSendCampaigns && (
            <div className="flex justify-end">
              <Button onClick={() => setWizardOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" /> דיוור חדש
              </Button>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : rows.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <Send className="w-10 h-10 mx-auto mb-2" />
              אין דיוורים עדיין
            </div>
          ) : (
            <div className="border border-black rounded-xl divide-y divide-slate-200 overflow-hidden bg-white">
              {rows.map((c) => (
                <Link key={c.id} to={`/crm/campaigns/${c.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50">
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-slate-400">{new Date(c.created_at).toLocaleDateString("he-IL")} · {c.created_by}</div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>{c.sent_count}/{c.total_count} נשלחו</span>
                    {c.replied_count > 0 && <span className="text-emerald-600">{c.replied_count} תגובות</span>}
                    {c.optout_count > 0 && <span className="text-red-500">{c.optout_count} הסרות</span>}
                    <span className={`px-2 py-1 rounded-full font-semibold ${STATUS_COLORS[c.status]}`}>{STATUS_LABELS[c.status] || c.status}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <CampaignWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreated={load} />
    </div>
  );
}
