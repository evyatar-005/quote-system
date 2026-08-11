import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  LogOut, Settings2, Info, BarChart3, Scissors, PenTool, ClipboardList, LineChart, Users, Target, MessagesSquare, Send, FileStack, Sparkles,
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

// The one right-side nav every sales-manager screen shares (AdminDashboard,
// QuotesHistory, QuotesArchive, …) — replaces each page's own top-left
// "תפריט" dropdown so the same navigation is always in the same place.
// Fixed-width, full labeled menu, stretching the full height of the viewport
// (same NavGroup/NavItem visual language as AgentSidebar, the agent-facing
// counterpart, so both read identically). "הגדרות" and "אודות" are plain
// links into AdminDashboard's tabs (via ?tab=) rather than a local
// collapsible switcher, since only that page actually owns the Tabs state —
// every other screen just deep-links in.

function NavGroup({ title, children }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function NavItem({ to, icon: Icon, label, active }) {
  return (
    <Link to={to}>
      <Button
        variant="ghost"
        className={`w-full justify-start gap-3 h-12 px-3 rounded-xl font-normal ${active ? "bg-primary/10 text-primary font-semibold" : ""}`}
      >
        {Icon && <Icon className="w-6 h-6 shrink-0" />}
        {label}
      </Button>
    </Link>
  );
}

export default function ManagerSidebar() {
  const { logout } = useAuth();
  const { pathname, search } = useLocation();

  return (
    <aside className="w-64 shrink-0 sticky top-24 h-[calc(100vh-6rem)] overflow-y-auto border-l border-black pl-4 space-y-6">
      <NavGroup title="מכירות">
        {/* An admin browsing the agent calculator still needs their own
            personal quote list — ManagerSidebar had no link to it at all,
            which silently hid "ההצעות שלי" the moment an admin's calculator
            page switched from AgentSidebar to this one. */}
        <NavItem to="/my-day" icon={Sparkles} label="היום שלי" active={pathname === "/my-day"} />
        <NavItem to="/my-quotes" icon={FileStack} label="ההצעות שלי" active={pathname === "/my-quotes"} />
        <NavItem to="/quotes" icon={ClipboardList} label="הצעות לבדיקה" active={pathname === "/quotes"} />
        <NavItem to="/quotes-archive" icon={LineChart} label="אנליטיקה" active={pathname === "/quotes-archive"} />
      </NavGroup>
      <NavGroup title="CRM">
        <NavItem to="/crm/customers" icon={Users} label="לקוחות" active={pathname.startsWith("/crm/customers")} />
        <NavItem to="/crm/leads" icon={Target} label="לידים" active={pathname === "/crm/leads"} />
        <NavItem to="/crm/inbox" icon={MessagesSquare} label="תיבת שיחות" active={pathname === "/crm/inbox"} />
        <NavItem to="/crm/campaigns" icon={Send} label="דיוור" active={pathname.startsWith("/crm/campaigns")} />
      </NavGroup>
      <NavGroup title="תפעול">
        <NavItem to="/cutting" icon={Scissors} label="ניצולת לוחות" active={pathname === "/cutting"} />
        <NavItem to="/cutfile" icon={PenTool} label="קו חיתוך אוטומטי" active={pathname === "/cutfile"} />
      </NavGroup>
      <NavGroup title="ממשקים שונים">
        <NavItem to="/costs" icon={BarChart3} label="ממשק סוכן מכירות" active={pathname === "/costs"} />
        <NavItem to="/" icon={Settings2} label="הגדרות" active={pathname === "/" && !search} />
        <Button variant="ghost" onClick={logout} className="w-full justify-start gap-3 h-12 px-3 rounded-xl font-normal">
          <LogOut className="w-6 h-6 shrink-0" />
          התנתקות
        </Button>
        <NavItem to="/?tab=about" icon={Info} label="אודות" active={pathname === "/" && search === "?tab=about"} />
      </NavGroup>
    </aside>
  );
}
