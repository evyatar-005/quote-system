import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowRight, Loader2, Pause, Play, X } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { campaigns } from "@/api/campaignsClient";
import { useCrmEvents } from "@/lib/crmRealtime";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import AgentSidebar from "@/components/layout/AgentSidebar";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";

const STATUS_LABELS = {
  pending: "ממתין", queued: "בתור", sent: "נשלח", failed: "נכשל",
  skipped: "דולג", replied: "השיב", opted_out: "הוסר",
};

export default function CrmCampaignDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const Sidebar = user?.role === "agent" ? AgentSidebar : ManagerSidebar;

  const load = useCallback(async () => {
    try { setCampaign(await campaigns.get(id)); }
    catch (err) { toast.error(err.message || "טעינת הדיוור נכשלה"); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);
  useCrmEvents(["campaign.progress", "campaign.completed"], (_e, payload) => {
    if (String(payload?.campaignId) === String(id)) load();
  });

  const act = async (fn, label) => {
    try { await fn(id); toast.success(label); load(); }
    catch (err) { toast.error(err.message || "הפעולה נכשלה"); }
  };

  if (loading || !campaign) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  }

  const pct = campaign.total_count ? Math.round(((campaign.sent_count + campaign.failed_count) / campaign.total_count) * 100) : 0;

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <img src={printellaLogo} alt="Printella" className="h-24 object-contain" />
          <h1 className="text-lg font-bold">{campaign.name}</h1>
        </div>
      </div>

      <div className="w-full mx-auto px-4 sm:px-8 py-8 flex flex-col lg:flex-row gap-8 items-start">
        <Sidebar />
        <div className="flex-1 min-w-0 w-full max-w-5xl space-y-6">
          <Link to="/crm/campaigns" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-primary">
            <ArrowRight className="w-4 h-4" /> חזרה לדיוורים
          </Link>

          <div className="border border-black rounded-xl bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-500">{campaign.sent_count} נשלחו · {campaign.failed_count} נכשלו · {campaign.total_count} סה"כ</div>
              {user?.canSendCampaigns && (
                <div className="flex items-center gap-2">
                  {campaign.status === "running" && (
                    <Button size="sm" variant="outline" onClick={() => act(campaigns.pause, "הדיוור הושהה")} className="gap-1"><Pause className="w-3.5 h-3.5" /> השהה</Button>
                  )}
                  {campaign.status === "paused" && (
                    <Button size="sm" variant="outline" onClick={() => act(campaigns.resume, "הדיוור חודש")} className="gap-1"><Play className="w-3.5 h-3.5" /> חדש</Button>
                  )}
                  {["running", "paused", "ready"].includes(campaign.status) && (
                    <Button size="sm" variant="ghost" onClick={() => act(campaigns.cancel, "הדיוור בוטל")} className="gap-1 text-red-500"><X className="w-3.5 h-3.5" /> בטל</Button>
                  )}
                </div>
              )}
            </div>
            <Progress value={pct} />
            <div className="flex gap-4 text-xs text-slate-500">
              <span>{campaign.replied_count} תגובות</span>
              <span className="text-red-500">{campaign.optout_count} הסרות</span>
              <span>{campaign.skipped_count} דולגו</span>
            </div>
          </div>

          <div className="border border-black rounded-xl bg-white p-5 space-y-2">
            <h2 className="font-semibold text-sm">נמענים</h2>
            <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
              {(campaign.recipients || []).map((r) => (
                <div key={r.id} className="flex items-center justify-between py-1.5 text-sm">
                  <span>{r.display_name || r.phone_e164}</span>
                  <span className="text-xs text-slate-400">{STATUS_LABELS[r.status] || r.status}</span>
                </div>
              ))}
              {(campaign.recipients || []).length === 0 && <div className="text-sm text-slate-400 py-4 text-center">אין נמענים</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
