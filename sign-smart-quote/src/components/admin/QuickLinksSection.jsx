import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Link2, Plus, Trash2, Save, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import { quickLinks } from "@/api/driveClient";
import CostSectionCard from "./CostSectionCard";

// Admin-managed list of one-click WhatsApp sends (Instagram, website,
// catalog, ...) shown next to the Drive file browser in the lead workspace's
// "חומרי שיווק" panel — see DriveMaterialsPanel.jsx.
export default function QuickLinksSection() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newContent, setNewContent] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    quickLinks.list()
      .then(setItems)
      .catch((err) => toast.error(err.message || "טעינת הקישורים נכשלה"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async () => {
    if (!newLabel.trim() || !newContent.trim()) return;
    setSaving(true);
    try {
      await quickLinks.create({ label: newLabel.trim(), content: newContent.trim() });
      setNewLabel("");
      setNewContent("");
      setAdding(false);
      load();
      toast.success("הקישור נוסף");
    } catch (err) {
      toast.error(err.message || "ההוספה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditLabel(item.label);
    setEditContent(item.content);
  };

  const saveEdit = async (id) => {
    if (!editLabel.trim() || !editContent.trim()) return;
    setSaving(true);
    try {
      await quickLinks.update(id, { label: editLabel.trim(), content: editContent.trim() });
      setEditingId(null);
      load();
      toast.success("נשמר");
    } catch (err) {
      toast.error(err.message || "השמירה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("למחוק את הקישור הזה?")) return;
    try {
      await quickLinks.remove(id);
      load();
    } catch (err) {
      toast.error(err.message || "המחיקה נכשלה");
    }
  };

  return (
    <CostSectionCard
      icon={<Link2 className="w-5 h-5" />}
      title="קישורים מהירים לשליחה"
      description='כפתורים שמופיעים ליד חומרי הדרייב בסביבת העבודה של הליד — לחיצה שולחת את הטקסט/הקישור ישירות בווצאפ ללקוח (למשל: אינסטגרם, אתר, קטלוג)'
    >
      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-2">
          {items.map((item) =>
            editingId === item.id ? (
              <div key={item.id} className="flex flex-col sm:flex-row gap-2 border border-slate-200 rounded-lg p-2">
                <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="תווית הכפתור" className="sm:w-40" />
                <Input value={editContent} onChange={(e) => setEditContent(e.target.value)} placeholder="הטקסט/קישור שיישלח" className="flex-1" dir="ltr" />
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" disabled={saving} onClick={() => saveEdit(item.id)} className="gap-1">
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)}><X className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            ) : (
              <div key={item.id} className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2">
                <span className="font-semibold text-sm shrink-0 w-32 truncate">{item.label}</span>
                <span className="text-xs text-slate-400 truncate flex-1" dir="ltr">{item.content}</span>
                <button onClick={() => startEdit(item)} className="text-slate-400 hover:text-primary shrink-0" title="עריכה">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => remove(item.id)} className="text-slate-400 hover:text-red-600 shrink-0" title="מחיקה">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          )}

          {adding ? (
            <div className="flex flex-col sm:flex-row gap-2 border border-slate-200 rounded-lg p-2">
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="תווית הכפתור (למשל: אינסטגרם)" className="sm:w-40" autoFocus />
              <Input value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="הטקסט/קישור שיישלח ללקוח" className="flex-1" dir="ltr" />
              <div className="flex gap-1 shrink-0">
                <Button size="sm" disabled={saving} onClick={create} className="gap-1">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAdding(false)}><X className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" /> הוסף קישור
            </Button>
          )}
        </div>
      )}
    </CostSectionCard>
  );
}
