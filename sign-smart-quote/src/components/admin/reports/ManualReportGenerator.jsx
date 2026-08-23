import { useState } from "react";
import { Loader2, Send, Zap, Eye, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateReport, previewReport } from "@/api/reportsClient";
import RecipientsEditor from "./RecipientsEditor";

const todayStr = () => new Date().toISOString().slice(0, 10);

// On-demand report generation, fully independent of any saved schedule —
// pick a report type, a date range, recipients, preview the rendered email
// before committing, then send it right now. Lives above the per-type
// schedule cards in the "דוחות" tab.
export default function ManualReportGenerator({ reportDefs }) {
  const [reportType, setReportType] = useState(reportDefs[0]?.type || "");
  const [fromDate, setFromDate] = useState(todayStr());
  const [toDate, setToDate] = useState(todayStr());
  const [recipients, setRecipients] = useState([]);
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null); // { subject, html, count }

  const validRange = () => {
    if (fromDate > toDate) {
      toast.error("תאריך ההתחלה חייב להיות לפני תאריך הסיום");
      return false;
    }
    return true;
  };

  const handlePreview = async () => {
    if (!reportType || !validRange()) return;
    setPreviewing(true);
    try {
      const result = await previewReport(reportType, { fromDate, toDate });
      setPreview(result);
    } catch (err) {
      toast.error(err?.message || "שגיאה בהפקת התצוגה המקדימה");
    } finally {
      setPreviewing(false);
    }
  };

  const handleSend = async () => {
    if (!reportType || !validRange()) return;
    if (!recipients.length) {
      toast.error("יש להוסיף לפחות נמען אחד");
      return;
    }
    setSending(true);
    try {
      const result = await generateReport(reportType, {
        recipients: recipients.join(", "),
        fromDate,
        toDate,
      });
      toast.success(`הדוח נשלח בהצלחה (${result.count} רשומות)`);
      setPreview(null);
    } catch (err) {
      toast.error(err?.message || "שגיאה בשליחת הדוח");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-black bg-white p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="w-5 h-5 text-amber-500" />
        <h3 className="text-base font-bold text-slate-800">יצירת דוח ידני</h3>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        הפקת דוח מיידית לטווח תאריכים חופשי, בלי לחכות לתזמון הקבוע. אפשר לראות תצוגה מקדימה לפני השליחה.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">סוג דוח</label>
          <select
            value={reportType}
            onChange={(e) => { setReportType(e.target.value); setPreview(null); }}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {reportDefs.map((def) => (
              <option key={def.type} value={def.type}>{def.title}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">מתאריך</label>
          <input
            type="date"
            value={fromDate}
            max={toDate}
            onChange={(e) => { setFromDate(e.target.value); setPreview(null); }}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">עד תאריך</label>
          <input
            type="date"
            value={toDate}
            min={fromDate}
            onChange={(e) => { setToDate(e.target.value); setPreview(null); }}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
      </div>

      <RecipientsEditor recipients={recipients} onChange={setRecipients} />

      <div className="flex gap-3">
        <Button variant="outline" onClick={handlePreview} disabled={previewing} className="gap-2">
          {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          תצוגה מקדימה
        </Button>
        <Button onClick={handleSend} disabled={sending} className="gap-2">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          צור ושלח עכשיו
        </Button>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <div>
                <h4 className="font-bold text-slate-800">{preview.subject}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">{preview.count} רשומות בטווח שנבחר</p>
              </div>
              <button onClick={() => setPreview(null)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <iframe
              title="תצוגה מקדימה של הדוח"
              srcDoc={preview.html}
              className="flex-1 w-full border-0"
              style={{ minHeight: "50vh" }}
            />
            <div className="p-4 border-t border-slate-200 flex justify-end">
              <Button onClick={handleSend} disabled={sending} className="gap-2">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                שלח עכשיו
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
