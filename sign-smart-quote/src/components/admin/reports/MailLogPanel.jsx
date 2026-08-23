import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Mail, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMailLog } from "@/api/reportsClient";

// Sending mail is the one part of this system whose real outcome lives on a
// remote mail server, not in our own code — and this app is administered by
// people with no shell access to the host, so "it said sent but nothing
// arrived" was previously undiagnosable. This shows the mail server's own
// answer per attempt: which addresses it accepted, which it rejected, and its
// raw response line.
function fmtTime(ts) {
  if (!ts) return "";
  // SQLite CURRENT_TIMESTAMP is UTC and space-separated, not ISO-8601.
  const normalized = ts.endsWith("Z") ? ts : `${ts.replace(" ", "T")}Z`;
  const d = new Date(normalized);
  if (isNaN(d)) return ts;
  return d.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function MailLogPanel() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await getMailLog(30));
    } catch (err) {
      setError(err?.message || "שגיאה בטעינת יומן המיילים");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="rounded-2xl border-2 border-black bg-white p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-slate-500" />
          <h3 className="text-base font-bold text-slate-800">יומן שליחת מיילים</h3>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} className="gap-2 h-8 text-xs">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          רענן
        </Button>
      </div>
      <p className="text-sm text-muted-foreground -mt-1">
        מה שרת הדואר עצמו החזיר על כל שליחה — אילו כתובות התקבלו ואילו נדחו. אם כתובת מופיעה כ״התקבלה״
        אך המייל לא הגיע, המסירה נחסמה אחרי שרת הדואר (ספאם / SPF / חסימה בצד המקבל).
      </p>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {rows && rows.length === 0 && (
        <div className="text-sm text-slate-400 py-6 text-center">עדיין לא נשלחו מיילים</div>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-200">
                <th className="text-right font-semibold py-1.5">מתי</th>
                <th className="text-right font-semibold">מה</th>
                <th className="text-right font-semibold">נמענים</th>
                <th className="text-right font-semibold">תוצאה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 align-top">
                  <td className="py-2 whitespace-nowrap text-slate-500 text-xs">{fmtTime(r.created_at)}</td>
                  <td className="text-xs text-slate-600">{r.context || "—"}</td>
                  <td className="text-xs text-slate-600" dir="ltr">{r.to_addresses || "—"}</td>
                  <td className="text-xs">
                    {r.success ? (
                      <span className="flex items-center gap-1 text-emerald-600">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> התקבל
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-600">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> נכשל
                      </span>
                    )}
                    {r.rejected && <div className="text-red-600 mt-0.5" dir="ltr">נדחו: {r.rejected}</div>}
                    {r.error_message && <div className="text-red-600 mt-0.5">{r.error_message}</div>}
                    {r.response && <div className="text-slate-400 mt-0.5 break-all" dir="ltr">{r.response}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
