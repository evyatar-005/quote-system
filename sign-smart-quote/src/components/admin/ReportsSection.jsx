import { useEffect, useState } from "react";
import { Loader2, Truck, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { getReportsConfig } from "@/api/reportsClient";
import ReportCard from "./reports/ReportCard";
import ManualReportGenerator from "./reports/ManualReportGenerator";

// Every report type this app knows about, in display order. Adding a new
// report is: a new module under src/services/reports/, one line in
// src/routes/reports.js's REPORT_RUNNERS map, and one entry here.
const REPORT_DEFS = [
  {
    type: "delivery_notes",
    title: "דוח תעודות משלוח",
    description: "תעודות משלוח שנסגרו בתקופה, לפי מספר תעודה ולקוח",
    icon: <Truck className="w-6 h-6" />,
    periodNote: "דוח יומי מסכם את היום הנוכחי, שבועי את 7 הימים האחרונים, וחודשי את 30 הימים האחרונים — לכל תעודה: מספר, לקוח, וסכום לפני מע״מ.",
  },
  {
    type: "sales",
    title: "דוח מכירות",
    description: "הצעות שאושרו בתקופה, מסוכמות לפי סוכן מכירות",
    icon: <TrendingUp className="w-6 h-6" />,
    periodNote: "דוח יומי מסכם את היום הנוכחי, שבועי את 7 הימים האחרונים, וחודשי את 30 הימים האחרונים — סה״כ הצעות וסכום לפני מע״מ לכל סוכן.",
  },
];

export default function ReportsSection() {
  const [loading, setLoading] = useState(true);
  const [configs, setConfigs] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setConfigs(await getReportsConfig());
      } catch {
        toast.error("שגיאה בטעינת הגדרות הדוחות");
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ManualReportGenerator reportDefs={REPORT_DEFS} />
      <div>
        <h3 className="text-lg font-bold text-slate-800">דוחות מתוזמנים</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          שליחת מייל אוטומטית עם סיכום נתונים — כל דוח מתוזמן בנפרד. השליחה עצמה משתמשת בהגדרות ה-SMTP.
        </p>
      </div>
      {REPORT_DEFS.map((def) => (
        <ReportCard
          key={def.type}
          reportType={def.type}
          title={def.title}
          description={def.description}
          icon={def.icon}
          periodNote={def.periodNote}
          schedules={configs[def.type] || []}
        />
      ))}
    </div>
  );
}
