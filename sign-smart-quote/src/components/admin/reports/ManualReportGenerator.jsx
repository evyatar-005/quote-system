import { useState } from "react";
import { Loader2, Send, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateReport } from "@/api/reportsClient";
import RecipientsEditor from "./RecipientsEditor";

const todayStr = () => new Date().toISOString().slice(0, 10);

// On-demand report generation, fully independent of any saved schedule —
// pick a report type, a date range, recipients, and send it right now.
// Lives above the per-type schedule cards in the "דוחות" tab.
export default function ManualReportGenerator({ reportDefs }) {
  const [reportType, setReportType] = useState(reportDefs[0]?.type || "");
  const [fromDate, setFromDate] = useState(todayStr());
  const [toDate, setToDate] = useState(todayStr());
  const [recipients, setRecipients] = useState([]);
  const [sending, setSending] = useState(false);

  const handleGenerate = async () => {
    if (!reportType) return;
    if (fromDate > toDate) {
      toast.error("תאריך ההתחלה חייב להיות לפני תאריך הסיום");
      return;
    }
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
    } catch (err) {
      toast.error(err?.message || "שגיאה בהפקת הדוח");
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
        הפקת דוח מיידית לטווח תאריכים חופשי, בלי לחכות לתזמון הקבוע.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">סוג דוח</label>
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
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
            onChange={(e) => setFromDate(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">עד תאריך</label>
          <input
            type="date"
            value={toDate}
            min={fromDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
      </div>

      <RecipientsEditor recipients={recipients} onChange={setRecipients} />

      <Button onClick={handleGenerate} disabled={sending} className="gap-2">
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        צור ושלח עכשיו
      </Button>
    </div>
  );
}
