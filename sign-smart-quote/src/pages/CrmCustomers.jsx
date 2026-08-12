import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Loader2, Users, Phone, Mail, Building2, MessageCircle, Plus } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { crmCustomers } from "@/api/crmClient";
import { relativeTime } from "@/lib/leadPriority";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import AgentSidebar from "@/components/layout/AgentSidebar";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";

// Phase 1 of the CRM (see CLAUDE.md CRM plan) — a searchable list over the
// unified `customers` table, backfilled from quote history on boot. Sorting,
// filtering and paging all happen server-side in GET /api/crm/customers; every
// row carries total_count so the UI knows how many matches exist beyond the page.
const PAGE_SIZE = 50;

// "לקוח" on this screen means someone an ORDER was actually issued for (a
// Morning type-100 document) — that's the default the page opens on. The other
// chips stay reachable because the search box is also how you look up a person
// who hasn't bought yet.
const FILTERS = [
  { key: "buyers", label: "לקוחות שקנו" },
  { key: "all", label: "הכל" },
  { key: "open_leads", label: "עם לידים פתוחים" },
  { key: "no_quotes", label: "ללא הצעות" },
  { key: "mine", label: "שלי" },
];

const SORTS = [
  { key: "updated", label: "עודכן לאחרונה" },
  { key: "recent_quote", label: "הצעה אחרונה" },
  { key: "quotes", label: "הכי הרבה הצעות" },
  { key: "open_leads", label: "הכי הרבה לידים פתוחים" },
  { key: "name", label: "שם (א׳–ת׳)" },
];

export default function CrmCustomers() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);   // first paint only
  const [busy, setBusy] = useState(false);        // any refetch — dims the list
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("buyers");
  const [sort, setSort] = useState("updated");
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const firstLoad = useRef(true);
  const Sidebar = user?.role === "agent" ? AgentSidebar : ManagerSidebar;

  const fetchPage = useCallback(
    (params) => crmCustomers.list({ limit: PAGE_SIZE, ...params }),
    []
  );

  // One debounced effect owns every reload — search, filter and sort all go
  // through it, so switching a chip never races the search timer.
  useEffect(() => {
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const rows = await fetchPage({ q, filter, sort, offset: 0 });
        setCustomers(rows);
        setTotal(rows[0]?.total_count ?? 0);
      } catch (err) {
        toast.error(err.message || "טעינת הלקוחות נכשלה");
      } finally {
        setBusy(false);
        setLoading(false);
        firstLoad.current = false;
      }
    }, firstLoad.current ? 0 : 300);
    return () => clearTimeout(t);
  }, [q, filter, sort, refreshKey, fetchPage]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const rows = await fetchPage({ q, filter, sort, offset: customers.length });
      setCustomers((prev) => [...prev, ...rows]);
      if (rows.length) setTotal(rows[0].total_count);
    } catch (err) {
      toast.error(err.message || "טעינת לקוחות נוספים נכשלה");
    } finally {
      setLoadingMore(false);
    }
  };

  const reload = () => setRefreshKey((k) => k + 1);

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <img src={printellaLogo} alt="Printella" className="h-24 object-contain" />
          <div>
            <h1 className="text-lg font-bold">לקוחות</h1>
            {user?.full_name && <span className="text-sm text-slate-500">{user.full_name}</span>}
          </div>
        </div>
      </div>

      <div className="w-full mx-auto px-4 sm:px-8 py-8 flex flex-col lg:flex-row gap-8 items-start">
        <Sidebar />
        <div className="flex-1 min-w-0 w-full max-w-7xl space-y-4">
          {/* Control bar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="חיפוש לפי שם, טלפון או אימייל..."
                className="pr-9"
              />
            </div>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={() => setCreateOpen(true)} className="gap-1 mr-auto">
              <Plus className="w-4 h-4" /> לקוח חדש
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`text-xs rounded-full px-3 py-1 border transition-colors ${
                  filter === f.key
                    ? "bg-primary text-primary-foreground border-primary font-semibold"
                    : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                }`}
              >
                {f.label}
              </button>
            ))}
            {!loading && (
              <span className="text-xs text-slate-400 mr-auto">נמצאו {total} לקוחות</span>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : customers.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <Users className="w-10 h-10 mx-auto mb-2" />
              לא נמצאו לקוחות
              {/* The default filter shows only customers an order was issued
                  for, which on a fresh DB can be nobody — say so instead of
                  letting the page look broken. */}
              {filter === "buyers" && (
                <div className="mt-2 text-xs">
                  הרשימה מציגה רק לקוחות שהופקה להם הזמנה.
                  <button onClick={() => setFilter("all")} className="text-primary underline mr-1">
                    הצג את כל אנשי הקשר
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className={`border border-black rounded-xl divide-y divide-slate-200 overflow-hidden bg-white transition-opacity ${busy ? "opacity-50" : ""}`}>
                <div className="hidden lg:grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_130px_90px_90px_140px_80px] gap-4 px-4 py-2 bg-slate-50 text-[11px] font-semibold text-slate-500">
                  <span>שם</span>
                  <span>פרטי קשר</span>
                  <span>לידים פתוחים</span>
                  <span>הזמנות</span>
                  <span>הצעות</span>
                  <span>הצעה אחרונה</span>
                  <span>פעולות</span>
                </div>
                {customers.map((c) => <CustomerRow key={c.id} c={c} />)}
              </div>

              {customers.length < total && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : `טען עוד (${total - customers.length})`}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <NewCustomerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onDone={(customer, existed) => {
          setCreateOpen(false);
          if (existed) toast.info("לקוח עם הטלפון הזה כבר קיים — פותח את הכרטיס שלו");
          else { toast.success("הלקוח נוצר"); reload(); }
          navigate(`/crm/customers/${customer.id}`);
        }}
      />
    </div>
  );
}

function CustomerRow({ c }) {
  // The whole row is a Link, so the contact shortcuts must swallow the click —
  // otherwise tapping "וואטסאפ" would also navigate into the customer card.
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  const waNumber = c.phone_e164 ? c.phone_e164.replace(/\D/g, "") : null;

  return (
    <Link
      to={`/crm/customers/${c.id}`}
      className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_130px_90px_90px_140px_80px] gap-2 lg:gap-4 lg:items-center px-4 py-3 hover:bg-slate-50 transition-colors"
    >
      <div className="min-w-0">
        <div className="font-semibold truncate">{c.display_name}</div>
        {c.company && (
          <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
            <Building2 className="w-3 h-3 shrink-0" /><span className="truncate">{c.company}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-0.5 text-xs text-slate-500 min-w-0">
        {c.phone_e164 && (
          <span className="flex items-center gap-1"><Phone className="w-3 h-3 shrink-0" /><span dir="ltr">{c.phone_e164}</span></span>
        )}
        {c.email && (
          <span className="flex items-center gap-1 min-w-0"><Mail className="w-3 h-3 shrink-0" /><span className="truncate">{c.email}</span></span>
        )}
      </div>

      <div className="text-xs">
        {c.open_leads > 0
          ? <span className="px-2 py-1 rounded-full bg-primary/10 text-primary font-semibold">{c.open_leads} לידים פתוחים</span>
          : <span className="text-slate-300 hidden lg:inline">—</span>}
      </div>

      <div className="text-xs">
        {c.order_count > 0
          ? <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold">{c.order_count} הזמנות</span>
          : <span className="text-slate-300 hidden lg:inline">—</span>}
      </div>

      <div className="text-xs text-slate-500">{c.quote_count || 0} הצעות</div>

      <div className="text-xs text-slate-500">
        {c.last_quote_at
          ? <><span className="lg:hidden">הצעה אחרונה: </span>{relativeTime(c.last_quote_at)}</>
          : <span className="text-slate-300">ללא הצעות</span>}
      </div>

      <div className="flex items-center gap-1">
        {c.phone_e164 && (
          <>
            <a
              href={`tel:${c.phone_e164}`}
              onClick={stop}
              title="חיוג"
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100"
            >
              <Phone className="w-3.5 h-3.5" />
            </a>
            <a
              href={`https://wa.me/${waNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="וואטסאפ"
              className="p-1.5 rounded-lg border border-slate-200 text-emerald-600 hover:bg-emerald-50"
            >
              <MessageCircle className="w-3.5 h-3.5" />
            </a>
          </>
        )}
      </div>
    </Link>
  );
}

// POST /api/crm/customers dedupes by phone_e164 and returns the existing row
// with 200, so a "created" response that we didn't just insert is reported to
// the user as an existing customer rather than silently looking like a new one.
function NewCustomerDialog({ open, onOpenChange, onDone }) {
  const [form, setForm] = useState({ display_name: "", phone_raw: "", email: "", company: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ display_name: "", phone_raw: "", email: "", company: "" });
  }, [open]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.display_name.trim()) return toast.error("שם הלקוח הוא שדה חובה");
    setSaving(true);
    try {
      const customer = await crmCustomers.create(form);
      onDone(customer, Boolean(customer.existing));
    } catch (err) {
      toast.error(err.message || "יצירת הלקוח נכשלה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader><DialogTitle>לקוח חדש</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Input value={form.display_name} onChange={set("display_name")} placeholder="שם הלקוח *" autoFocus />
          <Input value={form.phone_raw} onChange={set("phone_raw")} placeholder="טלפון" dir="ltr" />
          <Input value={form.email} onChange={set("email")} placeholder="אימייל" dir="ltr" />
          <Input value={form.company} onChange={set("company")} placeholder="חברה" />
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "צור לקוח"}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
