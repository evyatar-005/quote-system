import { useState, useEffect, useCallback } from "react";
import { Loader2, Plus, Pencil, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { templates } from "@/api/campaignsClient";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

// The variables render() understands (src/services/crm/templates.js).
// Shown as helper text because the server's only feedback on a typo is a 400
// with unknown_variables — there's no autocomplete.
const VARS = ["{{name}}", "{{first_name}}", "{{company}}", "{{phone}}", "{{agent}}", "{{last_quote_date}}"];

// Shared quick-reply templates for the WhatsApp inbox composer. Deliberately
// scoped to category='service': 'marketing' belongs to the דיוור wizard, and
// mixing the two would put blast copy one click away from a 1:1 reply.
// Same shape as OptOutList — the other list-manager embedded in CRM settings.
export default function TemplateManager() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // {id?, name, body}
  const [saving, setSaving] = useState(false);

  const canWrite = user?.role === "admin" || !!user?.canSendCampaigns;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // No `active` filter — a manager needs to see disabled ones to re-enable.
      setRows(await templates.list({ category: "service" }));
    } catch (err) {
      toast.error(err.message || "טעינת התבניות נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing?.name?.trim() || !editing?.body?.trim()) {
      return toast.error("שם וטקסט התבנית הם שדות חובה");
    }
    setSaving(true);
    try {
      const payload = { name: editing.name.trim(), body: editing.body.trim(), category: "service" };
      if (editing.id) await templates.update(editing.id, payload);
      // category MUST be sent on create — the route defaults to 'marketing',
      // which would make the template invisible to the inbox picker.
      else await templates.create(payload);
      toast.success("התבנית נשמרה");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.message || "השמירה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (t) => {
    try {
      await templates.update(t.id, { is_active: t.is_active ? 0 : 1 });
      load();
    } catch (err) {
      toast.error(err.message || "העדכון נכשל");
    }
  };

  const remove = async (t) => {
    try {
      await templates.remove(t.id);
      toast.success("התבנית נמחקה");
      load();
    } catch (err) {
      toast.error(err.message || "המחיקה נכשלה");
    }
  };

  if (loading) {
    return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">עדיין לא הוגדרו תבניות מענה מהיר.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {rows.map((t) => (
            <div key={t.id} className={`flex items-start gap-3 px-3 py-2 ${t.is_active ? "" : "opacity-50"}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{t.name}</div>
                <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-2">{t.body}</div>
              </div>
              {canWrite && (
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={!!t.is_active} onCheckedChange={() => toggleActive(t)} />
                  <button type="button" onClick={() => setEditing({ id: t.id, name: t.name, body: t.body })} className="text-slate-400 hover:text-slate-700">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => remove(t)} className="text-slate-400 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {canWrite && (editing ? (
        <div className="border border-black rounded-lg p-3 space-y-2 bg-slate-50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{editing.id ? "עריכת תבנית" : "תבנית חדשה"}</span>
            <button type="button" onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          </div>
          <Input
            value={editing.name}
            onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))}
            placeholder="שם התבנית (לשימוש פנימי)"
          />
          <Textarea
            rows={4}
            dir="rtl"
            value={editing.body}
            onChange={(e) => setEditing((s) => ({ ...s, body: e.target.value }))}
            placeholder="טקסט ההודעה..."
          />
          <p className="text-[11px] text-muted-foreground">
            משתנים זמינים: {VARS.join(" ")} — {"{{agent}}"} יוחלף בשם הסוכן ששולח.
          </p>
          <Button onClick={save} disabled={saving} size="sm" className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? "שומר..." : "שמור"}
          </Button>
        </div>
      ) : (
        <Button onClick={() => setEditing({ name: "", body: "" })} size="sm" variant="outline" className="gap-2">
          <Plus className="w-4 h-4" /> תבנית חדשה
        </Button>
      ))}
    </div>
  );
}
