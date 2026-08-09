import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { Search, Loader2, User, Calendar, Settings, BarChart3, LogOut, ChevronDown, X, Eye, FileText, ClipboardList, List as ListIcon, PackageSearch } from "lucide-react";
import { Input } from "@/components/ui/input";
import QuoteDetailsModal from "@/components/QuoteDetailsModal";
import QuotesAnalytics from "@/components/quotes/QuotesAnalytics";
import ProductAnalytics from "@/components/quotes/ProductAnalytics";
import { getLatestMorningDocuments } from "@/api/morningClient";
import { useAuth } from "@/lib/AuthContext";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import printellaLogo from "@/assets/printella-logo.png";
import {
  fmt, STATUS_LABELS, STATUS_COLORS, CATEGORY_LABELS, CATEGORY_COLORS,
  MORNING_TYPE_LABELS, MORNING_ORDER_TYPE, toLocalDateStr,
} from "@/lib/quoteLabels";
// calculation_data stores the fine-grained productType (pvc_white, rollup_magnetic…),
// not the coarse product_category — so names come from the calculator's canonical
// PRODUCT_NAMES map, and the badge colour from the category that type rolls up to.
import { PRODUCT_NAMES, PRODUCT_CODES, categoryOf } from "@/components/calculator/CalculatorForm";

// General quote history — read-only. Distinct from /quotes (QuotesHistory),
// which is the manager's daily review queue: same underlying rows, but this
// screen never writes. See the viewed_at note on `openQuote` below for the one
// non-obvious reason the two screens must not share a row-click handler.

const DATE_PRESETS = [
  { key: "today", label: "היום" },
  { key: "7d", label: "7 ימים אחרונים" },
  { key: "30d", label: "30 יום אחרונים" },
  { key: "month", label: "החודש" },
  { key: "year", label: "השנה" },
  { key: "all", label: "הכל" },
  { key: "custom", label: "טווח מותאם" },
];

const DOC_KIND_FILTERS = [
  { key: "all", label: "הכל" },
  { key: "quote", label: "הצעת מחיר" },
  { key: "order", label: "הפך להזמנה" },
];

const safeParse = (json, fallback) => {
  try {
    return json ? JSON.parse(json) : fallback;
  } catch {
    return fallback;
  }
};

// Every product type appearing anywhere in the quote — NOT the `product_category`
// column, which stores only the FIRST item's category (see buildQuotePayload in
// MultiProductCalculator.jsx). A 3-item quote whose 2nd item is a sticker must
// still match the "מדבקות" filter.
const productTypesOf = (quote) => {
  const calc = safeParse(quote.calculation_data, null);
  const items = calc?.items || (calc?.productType ? [{ productType: calc.productType }] : []);
  return [...new Set(items.map((it) => it?.productType).filter(Boolean))];
};

const productLabel = (type) => PRODUCT_NAMES[type] || CATEGORY_LABELS[type] || type;
const productSku = (type) => PRODUCT_CODES[type] || "";
// "005-1" sorts before "005-10" and after "003-6" — compare the numeric parts,
// not the raw string, so the מק"ט order in the picker matches the catalogue.
const compareSku = (a, b) =>
  productSku(a).localeCompare(productSku(b), "en", { numeric: true }) ||
  productLabel(a).localeCompare(productLabel(b), "he");
const productBadgeClass = (type) =>
  CATEGORY_COLORS[categoryOf(type)] || CATEGORY_COLORS[type] || "bg-slate-100 text-slate-500";

// One labelled dropdown in the filter strip. Label sits above the control so
// every filter is the same height and they line up on a wrapping row.
function Filter({ label, value, onChange, children, className = "" }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          dir="rtl"
          className={`h-10 rounded-lg border border-black bg-white pl-3 pr-8 text-sm text-slate-700 appearance-none ${className}`}
        >
          {children}
        </select>
        <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
    </label>
  );
}

export default function QuotesArchive() {
  const { logout } = useAuth();
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [sellers, setSellers] = useState({});
  const [morningDocs, setMorningDocs] = useState({});
  const [selectedQuote, setSelectedQuote] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [tab, setTab] = useState("list");

  // Filters
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState(toLocalDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toLocalDateStr(new Date()));
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [docKind, setDocKind] = useState("all");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");

  useEffect(() => {
    base44.auth.me().then(setUser);

    (async () => {
      // 1000, not the review queue's 200 — this screen is meant to span the full
      // history. There are only tens of quotes today, so a single unpaginated
      // fetch keeps every stat card consistent with the visible rows.
      const data = await base44.entities.Quote.list("-created_date", 1000);
      setQuotes(data);

      if (data.length > 0) {
        try {
          setMorningDocs(await getLatestMorningDocuments(data.map((q) => q.id)));
        } catch {
          // Morning not configured / unreachable — the list still works, and the
          // הצעה/הזמנה filter simply sees everything as a plain quote.
        }
      }

      // created_by is the username (see quoteCreate in src/routes/entities.js).
      const sellerMap = {};
      for (const username of [...new Set(data.map((q) => q.created_by).filter(Boolean))]) {
        try {
          const found = await base44.entities.User.filter({ username });
          sellerMap[username] = found.length > 0 ? found[0].full_name : username;
        } catch {
          sellerMap[username] = username;
        }
      }
      setSellers(sellerMap);
      setLoading(false);
    })();
  }, []);

  const isOrder = (q) => morningDocs[q.id]?.morning_document_type === MORNING_ORDER_TYPE;

  const dateRange = (() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (datePreset === "today") return { from: startOfToday, to: null };
    if (datePreset === "7d") return { from: new Date(startOfToday.getTime() - 6 * 86400000), to: null };
    if (datePreset === "30d") return { from: new Date(startOfToday.getTime() - 29 * 86400000), to: null };
    if (datePreset === "month") return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
    if (datePreset === "year") return { from: new Date(now.getFullYear(), 0, 1), to: null };
    if (datePreset === "custom") {
      return {
        from: customFrom ? new Date(`${customFrom}T00:00:00`) : null,
        to: customTo ? new Date(`${customTo}T23:59:59`) : null,
      };
    }
    return { from: null, to: null }; // "all"
  })();

  const byDate = quotes.filter((q) => {
    if (!dateRange.from && !dateRange.to) return true;
    const created = new Date(q.created_date);
    if (dateRange.from && created < dateRange.from) return false;
    if (dateRange.to && created > dateRange.to) return false;
    return true;
  });

  // Per-agent breakdown is computed on the date-filtered set only, so picking an
  // agent doesn't change the other agents' numbers.
  const agentStats = Object.values(
    byDate.reduce((acc, q) => {
      const key = q.created_by || "—";
      if (!acc[key]) acc[key] = { key, name: sellers[key] || key, count: 0, total: 0 };
      acc[key].count += 1;
      acc[key].total += q.price_with_vat || 0;
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total);

  // The agent PICKER is built from every quote, not just the ones in range —
  // otherwise choosing a date range with no results makes the dropdown vanish
  // while `selectedAgent` stays set, leaving an invisible filter applied with
  // no control to clear it. Counts still reflect the current range (0 is a
  // legitimate, informative answer).
  const agentOptions = [...new Set(quotes.map((q) => q.created_by).filter(Boolean))]
    .map((key) => ({
      key,
      name: sellers[key] || key,
      count: agentStats.find((a) => a.key === key)?.count || 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "he"));

  // Product checklist is built from what's actually present in range, so it never
  // offers a filter that can only return zero rows.
  const availableProducts = useMemo(() => {
    const seen = new Set();
    for (const q of byDate) for (const t of productTypesOf(q)) seen.add(t);
    return [...seen].sort(compareSku);
  }, [byDate]);

  const filtered = byDate.filter((q) => {
    if (selectedAgent && q.created_by !== selectedAgent) return false;
    if (statusFilter && (q.status || "draft") !== statusFilter) return false;
    if (docKind === "order" && !isOrder(q)) return false;
    if (docKind === "quote" && isOrder(q)) return false;

    // Matches anywhere in the quote, not just the first item.
    if (selectedProduct && !productTypesOf(q).includes(selectedProduct)) return false;

    const s = search.toLowerCase();
    return (
      !s ||
      q.client_name?.toLowerCase().includes(s) ||
      q.quote_number?.toLowerCase().includes(s) ||
      q.created_by?.toLowerCase().includes(s)
    );
  });

  const resetFilters = () => {
    setSearch(""); setDatePreset("all"); setSelectedAgent(null); setDocKind("all");
    setStatusFilter(""); setSelectedProduct("");
  };

  const orderCount = filtered.filter(isOrder).length;
  const filteredTotal = filtered.reduce((s, q) => s + (q.price_with_vat || 0), 0);

  const selectedAgentStats = selectedAgent ? agentStats.find((a) => a.key === selectedAgent) : null;

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={printellaLogo} alt="Printella" className="h-24 object-contain" />
            <div>
              <h1 className="text-lg font-bold">היסטוריית הצעות כללית</h1>
              {user?.full_name && <span className="text-sm text-slate-500">{user.full_name}</span>}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-primary transition-colors px-3 py-1.5 rounded-lg border border-black hover:border-primary/40">
                <Settings className="w-4 h-4" />
                תפריט
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="bg-white border-black">
              <DropdownMenuItem asChild>
                <Link to="/quotes" className="flex items-center gap-2 cursor-pointer">
                  <ClipboardList className="w-4 h-4" />
                  הצעות לבדיקה
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/" className="flex items-center gap-2 cursor-pointer">
                  <Settings className="w-4 h-4" />
                  מחירים ועלויות
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/costs" className="flex items-center gap-2 cursor-pointer">
                  <BarChart3 className="w-4 h-4" />
                  מחשבון
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout} className="flex items-center gap-2 cursor-pointer">
                <LogOut className="w-4 h-4" />
                התנתקות
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Every filter is a labelled dropdown on one wrapping row, so the whole
            filter set reads as a single control strip instead of stacked rows. */}
        <div className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            <Filter label="טווח זמן" value={datePreset} onChange={setDatePreset}>
              {DATE_PRESETS.map(({ key, label }) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Filter>

            {agentOptions.length > 0 && (
              <Filter label="סוכן" value={selectedAgent || ""} onChange={(v) => setSelectedAgent(v || null)}>
                <option value="">כל הסוכנים</option>
                {agentOptions.map((a) => (
                  <option key={a.key} value={a.key}>{a.name} ({a.count})</option>
                ))}
              </Filter>
            )}

            <Filter label="סוג מסמך" value={docKind} onChange={setDocKind}>
              {DOC_KIND_FILTERS.map(({ key, label }) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Filter>

            <Filter label="סטטוס מסמך" value={statusFilter} onChange={setStatusFilter}>
              <option value="">כל הסטטוסים</option>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Filter>

            {availableProducts.length > 0 && (
              <Filter label="מכילה פריט" value={selectedProduct} onChange={setSelectedProduct} className="w-[15rem]">
                <option value="">כל הפריטים</option>
                {availableProducts.map((type) => (
                  <option key={type} value={type}>
                    {productSku(type) ? `${productSku(type)} · ${productLabel(type)}` : productLabel(type)}
                  </option>
                ))}
              </Filter>
            )}

            <button
              onClick={resetFilters}
              className="h-10 px-3 text-sm rounded-lg border border-black text-slate-500 hover:border-slate-500 flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" /> נקה סינונים
            </button>
          </div>

          {datePreset === "custom" && (
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-10 rounded-lg border border-black bg-white px-3 text-sm text-slate-700" dir="ltr" />
              <span className="text-slate-500 text-sm">עד</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-10 rounded-lg border border-black bg-white px-3 text-sm text-slate-700" dir="ltr" />
            </div>
          )}
        </div>

        {/* "רשימת הצעות" reads the top filter bar (`filtered`). "אנליטיקה" and
            "ניתוח מוצרים" both read the full unfiltered `quotes` set and own
            their own time filter instead — a per-agent comparison report
            would be meaningless if the top bar's "סוכן" filter (meant for
            browsing the list) silently collapsed it down to one agent. */}
        <div className="flex items-center gap-2 border-b border-slate-200">
          {[
            { key: "list", label: "רשימת הצעות", Icon: ListIcon },
            { key: "analytics", label: "אנליטיקה", Icon: BarChart3 },
            { key: "products", label: "ניתוח מוצרים", Icon: PackageSearch },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
                tab === key ? "border-primary text-primary font-semibold" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {tab === "analytics" ? (
          <QuotesAnalytics quotes={quotes} sellers={sellers} morningDocs={morningDocs} />
        ) : tab === "products" ? (
          <ProductAnalytics quotes={quotes} morningDocs={morningDocs} />
        ) : (
        <>
        {/* Search */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי לקוח, מס׳ הצעה או סוכן..."
            className="h-10 bg-white border-black text-foreground placeholder:text-slate-400 pr-9"
          />
        </div>

        {/* Summary — the slot future per-day/month/product analytics will extend. */}
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">סיכום לפי הסינון הנוכחי</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border border-black rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-foreground tabular-nums">{filtered.length}</div>
            <div className="text-sm text-slate-500 mt-1">סה״כ הצעות</div>
          </div>
          <div className="bg-white border border-black rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-emerald-600 tabular-nums">{orderCount}</div>
            <div className="text-sm text-slate-500 mt-1">הפכו להזמנה</div>
          </div>
          <div className="bg-white border border-black rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-primary tabular-nums">{fmt(filteredTotal)}</div>
            <div className="text-sm text-slate-500 mt-1">שווי כולל</div>
          </div>
        </div>

        {/* Per-agent breakdown */}
        {agentStats.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">לפי סוכן מכירות</h3>
              {selectedAgentStats && (
                <button onClick={() => setSelectedAgent(null)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-primary transition-colors" title="חזרה לכל הסוכנים">
                  <X className="w-3.5 h-3.5" />
                  {selectedAgentStats.name}
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {agentStats.map((a) => (
                <button
                  key={a.key}
                  onClick={() => setSelectedAgent(a.key === selectedAgent ? null : a.key)}
                  className={`text-right rounded-2xl border bg-white p-4 transition-all ${
                    a.key === selectedAgent ? "border-primary/60" : "border-black hover:border-slate-500"
                  }`}
                >
                  <div className="font-semibold text-foreground">{a.name}</div>
                  <div className="text-sm text-slate-500 mt-1">{a.count} הצעות · {fmt(a.total)} סה״כ</div>
                  <div className="text-xs text-slate-400 mt-0.5">ממוצע להצעה: {fmt(a.count > 0 ? a.total / a.count : 0)}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Rows — read-only */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-400 text-sm">לא נמצאו הצעות מחיר</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((q) => (
              // Deliberately does NOT write viewed_at (unlike openQuote in
              // QuotesHistory). viewed_at is the sole input to the review
              // queue's "לא נפתחו בלבד" badge — browsing the archive would
              // silently mark old quotes as reviewed, with no way back.
              <div
                key={q.id}
                onClick={() => setSelectedQuote(q)}
                className="w-full text-right bg-white border border-black rounded-2xl p-4 hover:border-slate-500 hover:bg-slate-50 transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{q.client_name}</span>
                      <span className="text-xs text-slate-400 font-mono">{q.quote_number}</span>
                      {q.parent_quote_number && (
                        <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">תיקון ל-{q.parent_quote_number}</span>
                      )}
                      {productTypesOf(q).sort(compareSku).map((type) => (
                        <span key={type} className={`text-xs px-2 py-0.5 rounded-full ${productBadgeClass(type)}`}>
                          {productSku(type) ? `${productSku(type)} · ${productLabel(type)}` : productLabel(type)}
                        </span>
                      ))}
                      {isOrder(q) && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 flex items-center gap-1">
                          <FileText className="w-3 h-3" /> הזמנה
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-sm text-slate-500 flex-wrap">
                      <span className="flex items-center gap-1"><User className="w-3 h-3" />{sellers[q.created_by] || q.created_by}</span>
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(q.created_date).toLocaleDateString("he-IL")}</span>
                      {q.notes && <span className="text-slate-400 truncate max-w-xs">{q.notes}</span>}
                    </div>
                    {morningDocs[q.id] && (
                      <div className="flex items-center gap-2 mt-1 text-xs text-slate-400" onClick={(e) => e.stopPropagation()}>
                        <span>
                          מסמך מורנינג: {MORNING_TYPE_LABELS[morningDocs[q.id].morning_document_type] || "מסמך"} #{morningDocs[q.id].morning_document_number || morningDocs[q.id].morning_document_id}
                        </span>
                        {morningDocs[q.id].document_url && (
                          <button onClick={() => setPreviewUrl(morningDocs[q.id].document_url)} className="flex items-center gap-1 text-primary hover:underline">
                            <Eye className="w-3 h-3" /> הצג מסמך
                          </button>
                        )}
                      </div>
                    )}
                    {q.agent_note && (
                      <div className="flex items-start gap-1.5 mt-1.5 text-sm bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 max-w-xl">
                        <span className="text-amber-600 font-semibold shrink-0">הערת סוכן:</span>
                        <span className="text-amber-800">{q.agent_note}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-left">
                      <div className="text-base font-bold text-primary tabular-nums">{fmt(q.price_with_vat)}</div>
                      <div className="text-sm text-slate-400">כולל מע״מ</div>
                    </div>
                    {/* Static badge — status is never editable from the archive. */}
                    <span className={`text-xs px-2 py-1.5 rounded-lg ${STATUS_COLORS[q.status || "draft"]}`}>
                      {STATUS_LABELS[q.status || "draft"]}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </>
        )}
      </div>

      {selectedQuote && (
        <QuoteDetailsModal quote={selectedQuote} readOnly onClose={() => setSelectedQuote(null)} />
      )}

      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setPreviewUrl(null)}>
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPreviewUrl(null)} className="absolute left-3 top-3 z-10 p-1.5 rounded-lg bg-white/90 hover:bg-slate-100 border border-slate-200 transition-colors">
              <X className="w-4 h-4 text-slate-600" />
            </button>
            <iframe src={previewUrl} title="מסמך מורנינג" className="w-full h-full rounded-2xl" />
          </div>
        </div>
      )}
    </div>
  );
}
