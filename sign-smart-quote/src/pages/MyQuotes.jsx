import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link, useNavigate } from "react-router-dom";
import {
  FileText,
  Loader2,
  Calendar,
  Copy,
  PackagePlus,
  Check,
  X,
  BarChart3,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { convertMorningDocument, getLatestMorningDocuments } from "@/api/morningClient";
import QuoteDocument from "@/components/calculator/QuoteDocument";

const fmt = (val) =>
  val != null ? `₪ ${Number(val).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—";

const STATUS_LABELS = { draft: "טיוטה", sent: "נשלחה", approved: "אושרה", rejected: "נדחתה" };
const STATUS_COLORS = {
  draft: "bg-slate-100 text-slate-500",
  sent: "bg-blue-50 text-blue-600",
  approved: "bg-emerald-50 text-emerald-600",
  rejected: "bg-red-50 text-red-500",
};
// Morning document type codes — see docs/morning-api-reference.md / src/services/morning/mappings.js
const MORNING_TYPE_LABELS = { 10: "הצעת מחיר", 100: "הזמנה", 300: "חשבון עסקה", 305: "חשבונית מס" };

export default function MyQuotes() {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [morningDocs, setMorningDocs] = useState({});
  const [issuingIds, setIssuingIds] = useState(() => new Set());
  const [documentQuote, setDocumentQuote] = useState(null);
  // Row id currently showing the inline email/VAT prompt (blocked conversion).
  const [gateRowId, setGateRowId] = useState(null);
  const [gateEmail, setGateEmail] = useState("");
  const [gateVatId, setGateVatId] = useState("");
  const [paymentLinkPanel, setPaymentLinkPanel] = useState(null); // { quoteNumber, url }

  const loadQuotes = async () => {
    setLoading(true);
    const data = await base44.entities.Quote.list("-created_date", 200);
    setQuotes(data);
    if (data.length > 0) {
      try {
        setMorningDocs(await getLatestMorningDocuments(data.map((q) => q.id)));
      } catch {
        // Morning not configured / unreachable — the list still works without it.
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadQuotes();
  }, []);

  const openQuoteDocument = (q) => {
    let lineItems = [];
    try {
      const parsed = JSON.parse(q.line_items || "[]");
      lineItems = parsed.map((item) => ({
        productCode: item.sku || "",
        description: item.description || "",
        freeText: item.freeText || "",
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        groupLabel: item.groupLabel || null,
        isGroupStart: false,
      }));
    } catch {
      toast.error("שגיאה בקריאת פרטי ההצעה");
      return;
    }
    setDocumentQuote({ ...q, lineItems });
  };

  const duplicateQuote = (q) => {
    if (q.builder_state) {
      let parsed;
      try {
        parsed = JSON.parse(q.builder_state);
      } catch {
        parsed = null;
      }
      if (parsed) {
        navigate("/costs", { state: { builderState: parsed, sourceQuoteNumber: q.quote_number } });
        return;
      }
    }
    // Pre-existing quote saved before builder_state existed — restore client
    // fields only, leave the product list empty.
    toast.message("לא ניתן לשחזר את פרטי המוצרים להצעה זו", {
      description: "ההצעה נשמרה לפני תכונה זו — יחזרו רק פרטי הלקוח, יש לבנות את המוצרים מחדש.",
    });
    navigate("/costs", {
      state: {
        builderState: {
          clientName: q.client_name,
          clientPhone: q.client_phone,
          clientAddress: q.client_address,
          clientVatId: q.client_vat_id,
          clientEmail: q.client_email,
          documentTitle: q.notes,
        },
        sourceQuoteNumber: q.quote_number,
      },
    });
  };

  const withIssuing = async (id, fn) => {
    setIssuingIds((prev) => new Set(prev).add(id));
    try {
      await fn();
    } finally {
      setIssuingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const runConvert = async (q, extra) => {
    const result = await convertMorningDocument(q.id, "order", { wantPaymentLink: true, ...extra });
    const docs = await getLatestMorningDocuments([q.id]);
    setMorningDocs((prev) => ({ ...prev, ...docs }));
    const url = result?.url?.he || result?.url?.origin;
    if (url) {
      setPaymentLinkPanel({ quoteNumber: q.quote_number, url });
    } else {
      toast.success(`הזמנה ${q.quote_number} הונפקה במורנינג (ללא קישור תשלום — לא הוגדר פלאגין תשלום פעיל)`);
    }
  };

  const handleIssueOrder = async (q) => {
    if (issuingIds.has(q.id)) return;
    await withIssuing(q.id, async () => {
      try {
        await runConvert(q);
      } catch (err) {
        if (err?.message === "client_email_and_vat_required") {
          setGateRowId(q.id);
          setGateEmail(q.client_email || "");
          setGateVatId(q.client_vat_id || "");
        } else {
          toast.error(err?.message || "שגיאה בהנפקת ההזמנה");
        }
      }
    });
  };

  const submitGate = async (q) => {
    if (!gateEmail.trim() || !gateVatId.trim()) {
      toast.error("יש למלא אימייל ות.ז/ח.פ");
      return;
    }
    await withIssuing(q.id, async () => {
      try {
        await runConvert(q, { clientEmail: gateEmail.trim(), clientVatId: gateVatId.trim() });
        setGateRowId(null);
      } catch (err) {
        toast.error(err?.message || "שגיאה בהנפקת ההזמנה");
      }
    });
  };

  const copyLink = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("הקישור הועתק");
    } catch {
      toast.error("שגיאה בהעתקת הקישור");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-500" />
            ההצעות שלי
          </h1>
          <Link
            to="/costs"
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-amber-600 transition-colors px-3 py-1.5 rounded-lg border border-black hover:border-amber-300"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            מחשבון
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {paymentLinkPanel && (
          <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-emerald-700">
                הזמנה {paymentLinkPanel.quoteNumber} הונפקה — קישור לתשלום:
              </div>
              <div className="text-xs text-emerald-600 truncate" dir="ltr">
                {paymentLinkPanel.url}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => copyLink(paymentLinkPanel.url)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Copy className="w-3.5 h-3.5" /> העתק קישור
              </button>
              <button
                onClick={() => setPaymentLinkPanel(null)}
                className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : quotes.length === 0 ? (
          <div className="text-center py-20 text-slate-400 text-sm">עדיין לא נשמרו הצעות</div>
        ) : (
          <div className="space-y-2">
            {quotes.map((q) => {
              const morningDoc = morningDocs[q.id];
              const alreadyOrder = morningDoc && morningDoc.morning_document_type === 100;
              return (
                <div key={q.id} className="bg-white border border-black rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">{q.client_name}</span>
                        <span className="text-xs text-slate-400 font-mono">{q.quote_number}</span>
                        {q.parent_quote_number && (
                          <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">
                            שכפול מ-{q.parent_quote_number}
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[q.status || "draft"]}`}>
                          {STATUS_LABELS[q.status || "draft"]}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-sm text-slate-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(q.created_date).toLocaleDateString("he-IL")}
                        </span>
                        {morningDoc && (
                          <span className="text-slate-400">
                            מורנינג: {MORNING_TYPE_LABELS[morningDoc.morning_document_type] || "מסמך"} #
                            {morningDoc.morning_document_number || morningDoc.morning_document_id}
                          </span>
                        )}
                      </div>

                      {gateRowId === q.id && (
                        <div className="mt-3 flex flex-wrap items-end gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-amber-700">אימייל לקוח</label>
                            <input
                              type="email"
                              value={gateEmail}
                              onChange={(e) => setGateEmail(e.target.value)}
                              className="h-9 rounded-lg border border-amber-300 bg-white px-2.5 text-sm"
                              dir="ltr"
                              placeholder="client@example.com"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-amber-700">ת.ז / ח.פ</label>
                            <input
                              type="text"
                              value={gateVatId}
                              onChange={(e) => setGateVatId(e.target.value)}
                              className="h-9 rounded-lg border border-amber-300 bg-white px-2.5 text-sm"
                              dir="ltr"
                              placeholder="123456789"
                            />
                          </div>
                          <button
                            onClick={() => submitGate(q)}
                            disabled={issuingIds.has(q.id)}
                            className="h-9 flex items-center gap-1.5 text-xs px-3 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                          >
                            {issuingIds.has(q.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            אישור והנפקה
                          </button>
                          <button
                            onClick={() => setGateRowId(null)}
                            className="h-9 flex items-center gap-1 text-xs px-2.5 rounded-lg text-amber-600 hover:bg-amber-100"
                          >
                            <X className="w-3.5 h-3.5" /> ביטול
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-left ml-2">
                        <div className="text-base font-bold text-primary tabular-nums">{fmt(q.price_with_vat)}</div>
                        <div className="text-sm text-slate-400">כולל מע״מ</div>
                      </div>
                      <button
                        onClick={() => openQuoteDocument(q)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-black text-slate-600 hover:border-slate-500 hover:bg-slate-50 transition-colors"
                      >
                        פתח
                      </button>
                      <button
                        onClick={() => duplicateQuote(q)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-black text-slate-600 hover:border-slate-500 hover:bg-slate-50 transition-colors"
                      >
                        שכפל
                      </button>
                      {alreadyOrder ? (
                        <span className="text-xs px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                          כבר הונפקה כהזמנה
                        </span>
                      ) : (
                        <button
                          onClick={() => handleIssueOrder(q)}
                          disabled={issuingIds.has(q.id) || gateRowId === q.id}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
                        >
                          {issuingIds.has(q.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackagePlus className="w-3.5 h-3.5" />}
                          הנפק הזמנה
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {documentQuote && (
        <QuoteDocument
          lineItems={documentQuote.lineItems}
          clientName={documentQuote.client_name}
          quoteNumber={documentQuote.quote_number}
          notes={documentQuote.notes}
          paymentType={documentQuote.payment_type}
          onClose={() => setDocumentQuote(null)}
        />
      )}
    </div>
  );
}
