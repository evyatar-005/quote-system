import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Search, Loader2, Users, Phone, Mail, Building2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { crmCustomers } from "@/api/crmClient";
import { Input } from "@/components/ui/input";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import AgentSidebar from "@/components/layout/AgentSidebar";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";

// Phase 1 of the CRM (see CLAUDE.md CRM plan) — a searchable list over the
// unified `customers` table, backfilled from quote history on boot.
export default function CrmCustomers() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const Sidebar = user?.role === "agent" ? AgentSidebar : ManagerSidebar;

  const load = useCallback(async (query) => {
    setLoading(true);
    try {
      setCustomers(await crmCustomers.list({ q: query }));
    } catch (err) {
      toast.error(err.message || "טעינת הלקוחות נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(""); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(q), 300);
    return () => clearTimeout(t);
  }, [q, load]);

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <img src={printellaLogo} alt="Printella" className="h-24 object-contain" />
          <div>
            <h1 className="text-lg font-bold">לקוחות</h1>
            {user?.full_name && <span className="text-sm text-slate-500">{user.full_name}</span>}
          </div>
        </div>
      </div>

      <div className="w-full mx-auto px-4 sm:px-8 py-8 flex flex-col lg:flex-row gap-8 items-start">
        <Sidebar />
        <div className="flex-1 min-w-0 w-full max-w-5xl space-y-6">
          <div className="relative max-w-md">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="חיפוש לפי שם, טלפון או אימייל..."
              className="pr-9"
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : customers.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <Users className="w-10 h-10 mx-auto mb-2" />
              לא נמצאו לקוחות
            </div>
          ) : (
            <div className="border border-black rounded-xl divide-y divide-slate-200 overflow-hidden bg-white">
              {customers.map((c) => (
                <Link
                  key={c.id}
                  to={`/crm/customers/${c.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{c.display_name}</div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                      {c.phone_e164 && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone_e164}</span>}
                      {c.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</span>}
                      {c.company && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{c.company}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 text-xs text-slate-500">
                    {c.open_leads > 0 && <span className="px-2 py-1 rounded-full bg-primary/10 text-primary font-semibold">{c.open_leads} לידים פתוחים</span>}
                    <span>{c.quote_count || 0} הצעות</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
