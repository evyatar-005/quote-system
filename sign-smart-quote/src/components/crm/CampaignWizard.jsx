import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, AlertTriangle, Send } from "lucide-react";
import { toast } from "sonner";
import { audience, campaigns } from "@/api/campaignsClient";
import { base44 } from "@/api/base44Client";

const STEPS = ["תוכן", "קהל יעד", "קצב ואישור"];

// 3-step דיוור wizard (CRM plan Phase 4 §8). Creates a draft, previews the
// audience against real filters, builds (freezes) the recipient list, then
// requires the exact total_count typed back before start — a misclick guard,
// not a security control (requireCampaigns on the server is the real gate).
export default function CampaignWizard({ open, onClose, onCreated }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [leadCampaigns, setLeadCampaigns] = useState([]);
  const [selectedLeadCampaigns, setSelectedLeadCampaigns] = useState([]);
  const [neverQuoted, setNeverQuoted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftId, setDraftId] = useState(null);
  const [built, setBuilt] = useState(null); // { total_count }
  const [confirmText, setConfirmText] = useState("");
  const [testPhone, setTestPhone] = useState("");

  useEffect(() => {
    if (open) {
      setStep(0); setName(""); setBody(""); setPreview(null); setSelectedLeadCampaigns([]);
      setNeverQuoted(false); setDraftId(null); setBuilt(null); setConfirmText(""); setTestPhone("");
      base44.entities.Campaign.list().then(setLeadCampaigns).catch(() => {});
    }
  }, [open]);

  const filters = useCallback(() => ({
    lead_campaign_ids: selectedLeadCampaigns.length ? selectedLeadCampaigns : undefined,
    never_quoted: neverQuoted || undefined,
  }), [selectedLeadCampaigns, neverQuoted]);

  useEffect(() => {
    if (step !== 1) return;
    const t = setTimeout(async () => {
      setLoadingPreview(true);
      try { setPreview(await audience.preview(filters())); }
      catch (err) { toast.error(err.message || "תצוגת הקהל נכשלה"); }
      finally { setLoadingPreview(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [step, filters]);

  const hasOptOut = /הסר|STOP|UNSUBSCRIBE/i.test(body);

  const toStep2 = async () => {
    if (!name.trim() || !body.trim()) return toast.error("יש למלא שם וגוף הודעה");
    setStep(1);
  };

  const toStep3 = async () => {
    setSaving(true);
    try {
      let id = draftId;
      if (!id) {
        const created = await campaigns.create({ name, body, audience: filters() });
        id = created.id;
        setDraftId(id);
      } else {
        await campaigns.update(id, { name, body, audience: filters() });
      }
      const result = await campaigns.build(id);
      setBuilt({ total_count: result.total_count });
      setStep(2);
    } catch (err) {
      toast.error(err.message || "בניית הדיוור נכשלה");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!testPhone.trim() || !draftId) return;
    try {
      const r = await campaigns.testSend(draftId, testPhone.trim());
      if (r.skipped) toast.error(`לא נשלח: ${r.reason}`);
      else toast.success("הודעת בדיקה נשלחה");
    } catch (err) {
      toast.error(err.message || "שליחת הבדיקה נכשלה");
    }
  };

  const confirmStart = async () => {
    if (parseInt(confirmText, 10) !== built.total_count) return toast.error("המספר שהוקלד אינו תואם");
    setSaving(true);
    try {
      await campaigns.start(draftId, built.total_count);
      toast.success("הדיוור יצא לדרך");
      onCreated?.();
      onClose();
    } catch (err) {
      toast.error(err.message || "התחלת הדיוור נכשלה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>דיוור חדש — {STEPS[step]}</DialogTitle>
        </DialogHeader>

        {step === 0 && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-600">שם הדיוור</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: מבצע קיץ 2026" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-600">גוף ההודעה</label>
              <Textarea rows={5} dir="rtl" value={body} onChange={(e) => setBody(e.target.value)}
                placeholder="שלום {{first_name}}, ..." />
              <p className="text-xs text-muted-foreground">משתנים זמינים: {"{{name}} {{first_name}} {{company}} {{agent}} {{last_quote_date}}"}</p>
            </div>
            {!hasOptOut && (
              <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                אין שורת הסרה בטקסט — אחת תתווסף אוטומטית בעת הבנייה
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={toStep2}>המשך לבחירת קהל</Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-600">לקוחות שהגיעו מקמפיין (לא חובה)</label>
              <div className="flex flex-wrap gap-1.5">
                {leadCampaigns.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedLeadCampaigns((p) => p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id])}
                    className={`px-2.5 py-1 rounded-full text-xs border-2 border-black ${selectedLeadCampaigns.includes(c.id) ? "bg-primary text-primary-foreground" : "bg-background"}`}
                  >
                    {c.name}
                  </button>
                ))}
                {leadCampaigns.length === 0 && <span className="text-xs text-slate-400">אין קמפיינים מוגדרים</span>}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={neverQuoted} onChange={(e) => setNeverQuoted(e.target.checked)} />
              רק לקוחות שמעולם לא קיבלו הצעה
            </label>

            {loadingPreview ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
            ) : preview && (
              <div className="text-sm bg-slate-50 border border-black rounded-lg px-3 py-2">
                <b>{preview.matched}</b> נמצאו · <b className="text-emerald-600">{preview.sendable}</b> יישלחו ·
                {preview.excluded.opted_out} הוסרו · {preview.excluded.no_consent} ללא הסכמה · {preview.excluded.no_phone} ללא טלפון
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(0)}>חזרה</Button>
              <Button onClick={toStep3} disabled={saving || !preview?.sendable}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "בנה דיוור"}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && built && (
          <div className="space-y-4">
            <div className="text-sm bg-slate-50 border border-black rounded-lg px-3 py-2">
              הדיוור נבנה עם <b>{built.total_count}</b> נמענים, בקצב המוגדר בהגדרות המערכת.
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-600">שלח הודעת בדיקה אליי</label>
              <div className="flex gap-2">
                <Input dir="ltr" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="05X-XXXXXXX" />
                <Button variant="outline" onClick={sendTest} className="gap-1.5 shrink-0"><Send className="w-4 h-4" /> שלח בדיקה</Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-600">
                הקלד <b>{built.total_count}</b> לאישור שליחה סופית ל-{built.total_count} נמענים
              </label>
              <Input dir="ltr" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={String(built.total_count)} />
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>חזרה</Button>
              <Button
                onClick={confirmStart}
                disabled={saving || parseInt(confirmText, 10) !== built.total_count}
                className="bg-red-600 hover:bg-red-700"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : `שלח דיוור ל-${built.total_count} נמענים`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
