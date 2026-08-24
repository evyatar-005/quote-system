import { useState, useEffect } from "react";
import { Loader2, X } from "lucide-react";
import { inbox } from "@/api/inboxClient";
import { Button } from "@/components/ui/button";

// Creating a lead from a WhatsApp thread used to be a single click with an
// empty body — the lead landed in the queue with nothing but a phone number,
// and whoever picked it up couldn't issue a quote without chasing the customer
// again for a name, a company and an invoice ID. This dialog collects that up
// front, so a lead is quotable the moment it exists.
//
// Only the NEW-lead path goes through here; linking an existing lead already
// carries its own details and stays a one-click action in ConversationThread.

// Field set mirrors what a quote needs on the document itself (customer name,
// contact phone/email, billing company + address + ח.פ). Rendered from a table
// so the required/optional split lives in one place instead of in seven copies
// of the same markup.
const FIELDS = [
  { key: "first_name", label: "שם פרטי", required: true },
  { key: "last_name", label: "שם משפחה", required: true },
  { key: "phone", label: "טלפון", required: true, dir: "ltr" },
  { key: "email", label: "אימייל", dir: "ltr" },
  { key: "company", label: "חברה" },
  { key: "address", label: "כתובת" },
  { key: "vat_id", label: "ח.פ / ע.מ", dir: "ltr" },
];

const EMPTY = Object.fromEntries(FIELDS.map((f) => [f.key, ""]));

export default function NewLeadDialog({ conversationId, submitting, onCancel, onSubmit }) {
  const [form, setForm] = useState(EMPTY);
  const [loadingPrefill, setLoadingPrefill] = useState(true);
  const [errors, setErrors] = useState({});

  // Prefill is a convenience, never a gate: the customer row behind the
  // conversation may be nothing but a phone number, and the endpoint itself
  // may be down. Either way the agent must still be able to type the details
  // in and create the lead, so a failure just leaves the form empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await inbox.leadPrefill(conversationId);
        if (cancelled) return;
        // Every field may come back null — coerce so the inputs stay
        // controlled and React doesn't flip them to uncontrolled.
        setForm({ ...EMPTY, ...Object.fromEntries(FIELDS.map((f) => [f.key, data?.[f.key] ?? ""])) });
      } catch {
        // Intentionally silent — a toast here would read as "lead creation
        // failed" when nothing has been attempted yet.
      } finally {
        if (!cancelled) setLoadingPrefill(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    // Clear the field's error as soon as it's being fixed, rather than making
    // the agent press "צור ליד" again to find out.
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  // Client-side gate on the three required fields. The server validates too,
  // but a round-trip to be told "שם פרטי חסר" is a wasted beat mid-conversation.
  const missingRequired = FIELDS.filter((f) => f.required && !form[f.key].trim());
  const emailEmpty = !form.email.trim();

  const submit = () => {
    if (missingRequired.length) {
      setErrors(Object.fromEntries(missingRequired.map((f) => [f.key, "שדה חובה"])));
      return;
    }
    // Trim everything and drop empties — the server treats an absent optional
    // field and an empty string the same, and blanks would otherwise be stored
    // as real (empty) values on the lead.
    const payload = {};
    for (const f of FIELDS) {
      const v = form[f.key].trim();
      if (v || f.required) payload[f.key] = v;
    }
    onSubmit(payload);
  };

  return (
    // Fixed overlay rather than an anchored popover: seven fields don't fit in
    // the header dropdown the link-existing menu uses.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="bg-white border border-black rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h2 className="font-semibold text-sm">פרטי לקוח לליד חדש</h2>
          <button type="button" onClick={onCancel} disabled={submitting} className="text-slate-400 hover:text-slate-700 disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loadingPrefill ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <p className="text-[11px] text-slate-500">
              הפרטים נדרשים כדי להפיק הצעת מחיר בהמשך.
            </p>
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-medium mb-1">
                  {f.label}
                  {f.required && <span className="text-red-500"> *</span>}
                </label>
                <input
                  type="text"
                  dir={f.dir || "rtl"}
                  value={form[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  disabled={submitting}
                  // Enter submits — same muscle memory as the composer below it.
                  onKeyDown={(e) => { if (e.key === "Enter" && !submitting) submit(); }}
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none disabled:bg-slate-50 ${errors[f.key] ? "border-red-500" : "border-slate-300"}`}
                />
                {errors[f.key] && <div className="text-[11px] text-red-600 mt-1">{errors[f.key]}</div>}
              </div>
            ))}

            {/* Email is genuinely optional — plenty of WhatsApp leads never
                give one — but the lead gets flagged "חסרים פרטים" downstream,
                so say that here rather than letting it surprise the agent in
                the success toast. Warning only: it must not block. */}
            {emailEmpty && (
              <div className="text-[11px] rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
                ללא אימייל הליד יסומן כ״חסרים פרטים״. אפשר להמשיך בכל זאת.
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={submit} disabled={submitting || missingRequired.length > 0} className="gap-1">
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                צור ליד
              </Button>
              <Button size="sm" variant="outline" onClick={onCancel} disabled={submitting}>
                ביטול
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
