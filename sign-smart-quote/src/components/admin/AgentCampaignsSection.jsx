import { useState, useEffect, useCallback } from "react";
import { Loader2, Save, ListFilter } from "lucide-react";
import { leadQueue } from "@/api/leadQueueClient";
import CostSectionCard from "./CostSectionCard";
import { toast } from "sonner";

// CRM Phase 5 §5 — per-agent campaign restrictions for the "משוך ליד"
// queue. No rows for a username = unrestricted (draws the globally oldest
// lead across every campaign); one or more rows = scoped to exactly those.
export default function AgentCampaignsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null); // username currently saving
  const [agents, setAgents] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [selections, setSelections] = useState({}); // username -> Set(campaign_id)

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [agentRows, campaignRows] = await Promise.all([leadQueue.agentCampaigns(), leadQueue.campaigns()]);
      setAgents(agentRows);
      setCampaigns(campaignRows);
      const sel = {};
      for (const a of agentRows) sel[a.username] = new Set(a.campaign_ids || []);
      setSelections(sel);
    } catch (err) {
      toast.error(err.message || "טעינת ההגבלות נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (username, campaignId) => {
    setSelections((prev) => {
      const next = new Set(prev[username]);
      if (next.has(campaignId)) next.delete(campaignId); else next.add(campaignId);
      return { ...prev, [username]: next };
    });
  };

  const save = async (username) => {
    setSaving(username);
    try {
      await leadQueue.setAgentCampaigns(username, [...(selections[username] || [])]);
      toast.success("ההגבלות נשמרו");
    } catch (err) {
      toast.error(err.message || "השמירה נכשלה");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <CostSectionCard
      icon={<ListFilter className="w-5 h-5" />}
      title="הגבלת סוכנים לקמפיינים"
      description='קובע אילו קמפיינים סוכן יכול למשוך לידים מהם דרך "משוך ליד". ללא סימון = לא מוגבל (מקבל את הליד הישן ביותר מכל קמפיין)'
    >
      {campaigns.length === 0 ? (
        <p className="text-sm text-slate-400">אין עדיין קמפיינים ממופים (נוצרים אוטומטית מבורדי מנדיי מקושרים)</p>
      ) : (
        <div className="space-y-4">
          {agents.map((a) => (
            <div key={a.username} className="border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-700">{a.full_name || a.username}</span>
                <span className="text-xs text-slate-400">
                  {selections[a.username]?.size ? `מוגבל ל-${selections[a.username].size} קמפיינים` : "לא מוגבל"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {campaigns.map((c) => {
                  const active = selections[a.username]?.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggle(a.username, c.id)}
                      className={`text-xs rounded-full px-3 py-1 border transition-colors ${
                        active ? "bg-primary text-primary-foreground border-primary" : "bg-background text-slate-600 border-slate-300"
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => save(a.username)}
                disabled={saving === a.username}
                className="text-xs font-medium text-primary flex items-center gap-1 hover:underline disabled:opacity-50"
              >
                {saving === a.username ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                שמור
              </button>
            </div>
          ))}
        </div>
      )}
    </CostSectionCard>
  );
}
