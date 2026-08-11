import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createMorningClient } from "@/api/morningClient";

// Payment-terms options are credit days sent straight to Morning's own
// `paymentTerms` field on the client card (confirmed via a live GET
// /clients/:id — numeric, not documented in docs/morning-api-reference.md).
const PAYMENT_TERMS_OPTIONS = [
  { value: 0, label: "מזומן / שוטף" },
  { value: 30, label: "שוטף+30" },
  { value: 60, label: "שוטף+60" },
  { value: 90, label: "שוטף+90" },
];

// Explicit "צור לקוח חדש" form — opened from ClientSearchField when a typed
// name has no match in Morning. Creates the client immediately (awaited, not
// a fire-and-forget side effect of saving a quote), then hands the result to
// the same onCreated callback the calculator uses for a picked search result,
// so phone/address/vatId/email/morning_client_id autofill needs no changes.
export default function NewClientModal({ initialName = "", onCreated, onClose }) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [vatId, setVatId] = useState("");
  const [email, setEmail] = useState("");
  const [paymentTerms, setPaymentTerms] = useState(0);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("שם לקוח הוא שדה חובה");
      return;
    }
    // Saving a quote requires client_phone server-side (routes/entities.js
    // quoteCreate) — a client created here without one used to save fine but
    // then fail, unexplained, only once the agent tried to send/issue.
    if (!phone.trim()) {
      toast.error("טלפון הוא שדה חובה — נדרש כדי לשלוח/להנפיק את ההצעה");
      return;
    }
    setSaving(true);
    try {
      const client = await createMorningClient({ name: name.trim(), phone, address, vatId, email, paymentTerms });
      toast.success(`לקוח "${client.name}" נוצר במורנינג`);
      onCreated(client);
    } catch (err) {
      toast.error(err?.message || "שגיאה ביצירת הלקוח");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 relative"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} className="absolute top-3 left-3 p-1 rounded-lg text-slate-400 hover:bg-slate-100">
          <X className="w-4 h-4" />
        </button>
        <h3 className="text-base font-bold text-slate-800">לקוח חדש</h3>

        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">שם לקוח <span className="text-red-500">*</span></label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full h-9 rounded-lg border border-slate-300 px-2.5 text-sm focus-visible:outline-none focus-visible:border-amber-400"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">טלפון <span className="text-red-500">*</span></label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            dir="ltr"
            className="w-full h-9 rounded-lg border border-slate-300 px-2.5 text-sm focus-visible:outline-none focus-visible:border-amber-400"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">כתובת</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full h-9 rounded-lg border border-slate-300 px-2.5 text-sm focus-visible:outline-none focus-visible:border-amber-400"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">ח.פ / עוסק מורשה</label>
          <input
            value={vatId}
            onChange={(e) => setVatId(e.target.value)}
            dir="ltr"
            className="w-full h-9 rounded-lg border border-slate-300 px-2.5 text-sm focus-visible:outline-none focus-visible:border-amber-400"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">אימייל</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            dir="ltr"
            className="w-full h-9 rounded-lg border border-slate-300 px-2.5 text-sm focus-visible:outline-none focus-visible:border-amber-400"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-600">תנאי תשלום</label>
          <select
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(Number(e.target.value))}
            className="w-full h-9 rounded-lg border border-slate-300 px-2.5 text-sm bg-white focus-visible:outline-none focus-visible:border-amber-400"
          >
            {PAYMENT_TERMS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          צור לקוח
        </button>
      </form>
    </div>
  );
}
