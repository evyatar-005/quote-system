import { useState, useEffect, useCallback } from "react";
import { Loader2, StickyNote, History, Banknote, Check } from "lucide-react";
import { crmLeads } from "@/api/crmClient";
import { relativeTime } from "@/lib/leadPriority";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

// The three lead-level facts the workspace had no home for: what the deal is
// worth, what we agreed on this specific enquiry, and what has already
// happened to it.
//
// All three are LOCAL columns — monday's pull is insert-once and only ever
// rewrites source_created_at / follow_up_date (services/crm/mondaySync.js), so
// nothing here is at risk of being erased by a poll. Everything monday DOES
// own is rendered read-only/next to its own dropdown in LeadFieldsPanel.

const KIND_LABEL = {
  note: "הערה",
  status_change: "שינוי סטטוס",
  assignment: "שיוך",
  claim: "טיפול",
  merge: "מיזוג",
  quote_linked: "הצעה קושרה",
  quote: "הצעת מחיר",
};

export default function LeadDealPanel({ leadId, lead, onUpdated }) {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [value, setValue] = useState("");
  const [savingValue, setSavingValue] = useState(false);

  // Only re-seeds when the lead identity changes, so a half-typed amount
  // isn't clobbered by the parent's refresh.
  useEffect(() => {
    setValue(lead?.value_estimate != null ? String(lead.value_estimate) : "");
  }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    try {
      setActivity(await crmLeads.activity(leadId));
    } catch {
      /* timeline is supporting detail — a failure here shouldn't blank the workspace */
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const addNote = async () => {
    const text = note.trim();
    if (!text) return;
    setSavingNote(true);
    try {
      const updated = await crmLeads.addNote(leadId, text);
      setNote("");
      onUpdated?.(updated);
      load();
    } catch (err) {
      toast.error(err.message || "שמירת ההערה נכשלה");
    } finally {
      setSavingNote(false);
    }
  };

  const saveValue = async () => {
    setSavingValue(true);
    try {
      const raw = value.trim();
      const updated = await crmLeads.update(leadId, { value_estimate: raw === "" ? null : Number(raw) });
      onUpdated?.(updated);
      toast.success("ערך העסקה נשמר");
    } catch (err) {
      toast.error(err.message || "השמירה נכשלה");
    } finally {
      setSavingValue(false);
    }
  };

  const valueDirty = value.trim() !== (lead?.value_estimate != null ? String(lead.value_estimate) : "");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <div className="border border-black rounded-xl bg-white p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Banknote className="w-4 h-4 text-slate-500" /> ערך העסקה
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="הערכת שווי ב-₪"
              className="max-w-[180px] h-9"
              dir="ltr"
            />
            <Button size="sm" variant="outline" onClick={saveValue} disabled={savingValue || !valueDirty}>
              {savingValue ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </Button>
          </div>
          {lead?.lost_reason && (
            <div className="text-xs text-red-600">סיבת הפסד: {lead.lost_reason}</div>
          )}
        </div>

        <div className="space-y-2 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <StickyNote className="w-4 h-4 text-slate-500" /> הערה על הליד
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="מה סוכם בשיחה? מה הלקוח ביקש?"
            rows={3}
          />
          <Button size="sm" onClick={addNote} disabled={savingNote || !note.trim()}>
            {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : "שמור הערה"}
          </Button>
        </div>
      </div>

      <div className="border border-black rounded-xl bg-white p-4 space-y-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <History className="w-4 h-4 text-slate-500" /> היסטוריית הליד
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : activity.length === 0 ? (
          <div className="text-xs text-slate-400 py-4">עדיין לא נרשמה פעילות על הליד</div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto divide-y divide-slate-100">
            {activity.map((a) => (
              <div key={`${a.kind}-${a.id}`} className="py-2 text-xs">
                <div className="flex items-center gap-2 text-slate-400">
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{KIND_LABEL[a.kind] || a.kind}</span>
                  <span>{relativeTime(a.created_at)}</span>
                  {a.actor && <span className="mr-auto">{a.actor}</span>}
                </div>
                <div className="text-slate-700 break-words mt-0.5">{a.summary}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
