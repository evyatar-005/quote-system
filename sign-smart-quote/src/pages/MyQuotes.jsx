import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link, useNavigate } from "react-router-dom";
import {
  FileText,
  Loader2,
  Calendar,
  Copy,
  Download,
  PackagePlus,
  Send,
  X,
  BarChart3,
  ArrowRight,
  Search,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { convertMorningDocument, createPaymentLink, getLatestMorningDocuments } from "@/api/morningClient";
import QuoteDocument from "@/components/calculator/QuoteDocument";
import DocumentIssuedModal from "@/components/DocumentIssuedModal";
import { MORNING_ORDER_TYPE, toLocalDateStr, DATE_PRESETS, computeDateRange, formatDocNumber } from "@/lib/quoteLabels";
import { latestRevisionsOnly } from "@/lib/quoteEconomics";

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
// Shown instead of the "מורנינג: ..." line when nothing was ever issued —
// so a quote with no document reads as "not issued yet, here's why", not as
// a blank line that looks like a loading glitch.
const NOT_ISSUED_LABELS = {
  draft: "לא הונפק — טיוטה",
  sent: "לא הונפק — נוצר לבדיקת הנחה",
  approved: "לא הונפק — ממתין להנפקה",
  rejected: "לא הונפק — נדחה",
};

const TABS = [
  { key: "all", label: "כל ההצעות" },
  { key: "orders", label: "ההזמנות שלי" },
];

export default function MyQuotes() {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [morningDocs, setMorningDocs] = useState({});
  const [issuingIds, setIssuingIds] = useState(() => new Set());
  const [documentQuote, setDocumentQuote] = useState(null);
  // Raw Morning document URL currently previewed — resolved to a blob URL
  // below (previewBlobUrl) before the iframe ever gets it (the proxy route
  // needs the Bearer token, which a plain <iframe src> can't attach).
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState(null);
  const [paymentLinkPanel, setPaymentLinkPanel] = useState(null); // { quoteNumber, url }
  const [issuedDocument, setIssuedDocument] = useState(null); // { url, label }
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState(toLocalDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toLocalDateStr(new Date()));

  const loadQuotes = async () => {
    setLoading(true);
    // `own: 1` forces server-side scoping to the logged-in user's own quotes
    // even for an admin — otherwise an admin viewing "ההצעות שלי" saw every
    // agent's quotes too (see quoteList in routes/entities.js).
    const data = await base44.entities.Quote.filter({ own: 1 }, "-created_date", 200);
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

  // The document-proxy route needs the Bearer token, which a plain
  // <iframe src="/api/morning/document-proxy?..."> can't attach — fetch it
  // with the token instead and hand the iframe a blob: URL (same pattern as
  // QuotesArchive.jsx/QuotesHistory.jsx).
  useEffect(() => {
    if (!previewDoc) { setPreviewBlobUrl(null); return; }
    let cancelled = false;
    let objectUrl = null;
    base44.quotes.fetchMorningDocumentBlob(previewDoc)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewBlobUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) toast.error("שגיאה בטעינת המסמך"); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewDoc]);

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

  // Issuing the order and generating a payment link are two independent
  // Morning operations (see sync.js/createPaymentForm) — a payment button
  // can't be attached to an order document at all on this account, and doing
  // so would close the order anyway, blocking the delivery note issued from
  // it afterward. So: issue/convert the order as before, then separately ask
  // for a standalone payment form link, which creates its own receipt only
  // once the customer actually pays.
  const runConvert = async (q, extra) => {
    const doc = await convertMorningDocument(q.id, "order", extra);
    const docUrl = doc?.url && (doc.url.he || doc.url.origin);
    if (docUrl) setIssuedDocument({ url: docUrl, label: `הזמנה ${q.quote_number}` });
    const docs = await getLatestMorningDocuments([q.id]);
    setMorningDocs((prev) => ({ ...prev, ...docs }));
    try {
      const url = await createPaymentLink(q.id);
      setPaymentLinkPanel({ quoteNumber: q.quote_number, url });
    } catch (err) {
      toast.message(`הזמנה ${q.quote_number} הונפקה במורנינג — יצירת קישור תשלום נכשלה`, {
        description: err?.message || "שגיאה לא ידועה",
        duration: 15000,
      });
    }
  };

  // Issues this quote's own Morning "quote" document (הצעת מחיר) — the
  // customer-facing PDF itself, independent of "הנפק הזמנת עבודה" below
  // (which converts/creates an order, type 100). Before this button existed
  // there was no way for an agent to issue a quote-type Morning document from
  // this screen at all — only from the calculator's own "הנפק" action at
  // save time (MultiProductCalculator's handleIssue), which a lot of quotes
  // never went through (e.g. anything sent for manager review first).
  const handleIssueQuoteDoc = async (q) => {
    if (issuingIds.has(q.id)) return;
    await withIssuing(q.id, async () => {
      try {
        const doc = await convertMorningDocument(q.id, "quote");
        const docUrl = doc?.url && (doc.url.he || doc.url.origin);
        if (docUrl) setIssuedDocument({ url: docUrl, label: `הצעת מחיר ${q.quote_number}` });
        const docs = await getLatestMorningDocuments([q.id]);
        setMorningDocs((prev) => ({ ...prev, ...docs }));
        toast.success(`הצעת מחיר ${q.quote_number} הונפקה במורנינג`);
      } catch (err) {
        toast.error(err?.message || "שגיאה בהנפקת הצעת המחיר");
      }
    });
  };

  // Email/VAT-ID are never required to issue an order + payment link — an
  // agent who just wants a link to forward manually (WhatsApp etc.) shouldn't
  // have to chase down the client's contact details first. Whatever's already
  // on the quote is still sent along so Morning's client card benefits from it
  // when present (see routes/morning.js), it's just never mandatory.
  const handleIssueOrder = async (q) => {
    if (issuingIds.has(q.id)) return;
    await withIssuing(q.id, async () => {
      try {
        await runConvert(q);
      } catch (err) {
        toast.error(err?.message || "שגיאה בהנפקת ההזמנה");
      }
    });
  };

  // For an order already issued, re-pulling a payment link should NOT
  // re-convert/re-issue the order (that would create a redundant new linked
  // Morning document each time) — just ask for a fresh standalone link.
  const handlePullPaymentLink = async (q) => {
    if (issuingIds.has(q.id)) return;
    await withIssuing(q.id, async () => {
      try {
        const url = await createPaymentLink(q.id);
        setPaymentLinkPanel({ quoteNumber: q.quote_number, url });
      } catch (err) {
        toast.error(err?.message || "שגיאה ביצירת קישור תשלום");
      }
    });
  };

  // navigator.clipboard requires a "secure context" (https, or localhost) —
  // this app is often reached over plain http on the local network (e.g.
  // 10.0.0.x:3000), where that API is simply undefined. Fall back to the
  // old execCommand('copy') trick via a hidden textarea, which has no such
  // restriction, instead of just failing silently on every LAN user.
  const copyLink = async (url) => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        toast.success("הקישור הועתק");
        return;
      } catch {
        // fall through to the legacy method below
      }
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (ok) toast.success("הקישור הועתק");
      else throw new Error("execCommand failed");
    } catch {
      toast.error("לא ניתן להעתיק אוטומטית — יש לסמן ולהעתיק את הקישור ידנית (Ctrl+C)");
    }
  };

  const dateRange = computeDateRange(datePreset, customFrom, customTo);

  // A manager's "שמור הצעה מתוקנת" saves the correction as a NEW row
  // (parent_quote_number pointing at the original) rather than editing the
  // original in place — so without this, the agent saw BOTH the stale
  // pre-edit original and the corrected revision as separate rows, and
  // nothing marked the original as superseded. Issuing a Morning document
  // from the wrong (original) row silently sent the client the old pricing.
  // Same helper QuotesArchive/CostsDashboard already use to avoid double-
  // counting revisions in analytics.
  const visibleQuotes = latestRevisionsOnly(quotes)
    .filter((q) => tab !== "orders" || morningDocs[q.id]?.morning_document_type === MORNING_ORDER_TYPE)
    .filter((q) => {
      if (!dateRange.from && !dateRange.to) return true;
      const created = new Date(q.created_date);
      if (dateRange.from && created < dateRange.from) return false;
      if (dateRange.to && created > dateRange.to) return false;
      return true;
    })
    .filter((q) => !search.trim() || q.client_name?.toLowerCase().includes(search.trim().toLowerCase()));

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
        {/* Tabs — both read the same fetched `quotes`/`morningDocs`, so this is
            a display filter only, no extra fetch. */}
        <div className="flex items-center gap-2 border-b border-slate-200">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
                tab === key ? "border-amber-500 text-amber-600 font-semibold" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Date filter + client-name search — same pattern/components as QuotesHistory. */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-500 shrink-0">טווח זמן:</span>
            <div className="relative">
              <select
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value)}
                dir="rtl"
                className="h-10 rounded-lg border border-black bg-white pl-3 pr-8 text-sm text-slate-700 appearance-none"
              >
                {DATE_PRESETS.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
          {datePreset === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-10 rounded-lg border border-black bg-white px-3 text-sm text-slate-700"
                dir="ltr"
              />
              <span className="text-slate-500 text-sm">עד</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-10 rounded-lg border border-black bg-white px-3 text-sm text-slate-700"
                dir="ltr"
              />
            </div>
          )}
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם לקוח..."
              className="h-10 bg-white border-black text-foreground placeholder:text-slate-400 pr-9"
            />
          </div>
        </div>

        {paymentLinkPanel && (
          <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-emerald-700">
                קישור לתשלום עבור הצעה {paymentLinkPanel.quoteNumber}:
              </div>
              {/* readOnly input, not a plain div — lets the agent manually select
                  + Ctrl+C as a last resort if both copy methods above fail. */}
              <input
                readOnly
                value={paymentLinkPanel.url}
                onFocus={(e) => e.target.select()}
                dir="ltr"
                className="w-full bg-transparent text-xs text-emerald-600 border-0 p-0 focus:outline-none focus:ring-0"
              />
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
        ) : visibleQuotes.length === 0 ? (
          <div className="text-center py-20 text-slate-400 text-sm">
            {tab === "orders" ? "עדיין אין הזמנות" : "עדיין לא נשמרו הצעות"}
          </div>
        ) : (
          <div className="space-y-2">
            {visibleQuotes.map((q) => {
              const ownDoc = morningDocs[q.id];
              // A duplicated quote ("שכפול מ-...") never gets its own Morning
              // document until it's issued separately — until then, fall back
              // to the ORIGINAL quote's document so "פתח"/"הורד" still work,
              // instead of just having nothing to show.
              const parentQuote = !ownDoc && q.parent_quote_number
                ? quotes.find((x) => x.quote_number === q.parent_quote_number)
                : null;
              const parentDoc = parentQuote ? morningDocs[parentQuote.id] : null;
              const morningDoc = ownDoc || parentDoc;
              const docIsFromParent = !ownDoc && !!parentDoc;
              // Order/"אושרה" status is about THIS quote, never borrowed from
              // the parent — only the document open/download actions fall back.
              const alreadyOrder = ownDoc && ownDoc.morning_document_type === MORNING_ORDER_TYPE;
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
                        {/* "אושרה" is no longer tied to the admin's internal review
                            decision (q.status === "approved") — an agent doesn't
                            care that a manager clicked approve, only that the
                            quote actually became a real order in Morning. So this
                            label is now driven by alreadyOrder; every other status
                            (draft/sent/rejected) still reads straight off q.status. */}
                        {alreadyOrder ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">
                            אושרה
                          </span>
                        ) : q.status !== "approved" ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[q.status || "draft"]}`}>
                            {STATUS_LABELS[q.status || "draft"]}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-sm text-slate-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(q.created_date).toLocaleDateString("he-IL")}
                        </span>
                        {morningDoc ? (
                          <span className="text-slate-400">
                            מורנינג: {MORNING_TYPE_LABELS[morningDoc.morning_document_type] || "מסמך"} #
                            {formatDocNumber(morningDoc.morning_document_number || morningDoc.morning_document_id)}
                            {docIsFromParent && " (מהצעה המקורית)"}
                          </span>
                        ) : (
                          <span className="text-slate-400">{NOT_ISSUED_LABELS[q.status || "draft"]}</span>
                        )}
                        {morningDoc?.document_url && (
                          <a
                            href={morningDoc.document_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-amber-600 hover:text-amber-700 hover:underline"
                          >
                            <Download className="w-3 h-3" /> הורד מסמך מורנינג{docIsFromParent && " (מקורי)"}
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-left ml-2">
                        <div className="text-base font-bold text-primary tabular-nums">{fmt(q.price_with_vat)}</div>
                        <div className="text-sm text-slate-400">כולל מע״מ</div>
                      </div>
                      <button
                        onClick={() => (morningDoc?.document_url ? setPreviewDoc(morningDoc.document_url) : openQuoteDocument(q))}
                        title={morningDoc?.document_url ? "תצוגה מקדימה של מסמך המורנינג" : "טרם הונפק מסמך — מוצגת התצוגה הפנימית"}
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
                      {/* Standalone payment link — a completely independent Morning
                          operation (see createPaymentForm in sync.js), always
                          available whether or not the order exists yet. This lets
                          an agent collect payment BEFORE issuing the work order,
                          not just after. Each click creates a fresh link (the
                          underlying receipt is only created by Morning once the
                          customer actually pays), so re-clicking to resend is safe. */}
                      <button
                        onClick={() => handlePullPaymentLink(q)}
                        disabled={issuingIds.has(q.id)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                      >
                        {issuingIds.has(q.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        שלח קישור תשלום
                      </button>
                      {!ownDoc && (
                        <button
                          onClick={() => handleIssueQuoteDoc(q)}
                          disabled={issuingIds.has(q.id)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-black text-slate-600 hover:border-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                        >
                          {issuingIds.has(q.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                          הנפק הצעת מחיר
                        </button>
                      )}
                      {!alreadyOrder && (
                        <button
                          onClick={() => handleIssueOrder(q)}
                          disabled={issuingIds.has(q.id)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
                        >
                          {issuingIds.has(q.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackagePlus className="w-3.5 h-3.5" />}
                          הנפק הזמנת עבודה
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

      {issuedDocument && (
        <DocumentIssuedModal
          documentUrl={issuedDocument.url}
          documentLabel={issuedDocument.label}
          onClose={() => setIssuedDocument(null)}
        />
      )}
    </div>
  );
}
