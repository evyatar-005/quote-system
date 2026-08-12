import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  LogOut, Settings2, Info, BarChart3, Scissors, PenTool, ClipboardList, LineChart, Users, Target, MessagesSquare, Send, FileStack, Sparkles, PieChart,
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

// Collapsed by default to an icon-only rail; hovering anywhere over it expands
// the panel (over the page, not pushing it) and fades the labels in. The outer
// <aside> keeps the rail's narrow width so the page layout never shifts.
function NavGroup({ title, children }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 truncate opacity-0 group-hover:opacity-100 transition-opacity">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function NavItem({ to, icon: Icon, label, active }) {
  return (
    <Link to={to}>
      <Button
        variant="ghost"
        title={label}
        className={`w-full justify-start gap-3 h-12 px-3 rounded-xl font-normal ${active ? "bg-primary/10 text-primary font-semibold" : ""}`}
      >
        {Icon && <Icon className="w-6 h-6 shrink-0" />}
        <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">{label}</span>
      </Button>
    </Link>
  );
}

export default function ManagerSidebar() {
  const { logout } = useAuth();
  const { pathname, search } = useLocation();

  return (
    <aside className="group w-16 shrink-0">
      <div className="fixed inset-y-0 right-0 z-30 w-16 group-hover:w-64 transition-[width] duration-200 ease-out overflow-y-auto overflow-x-hidden border-l border-black bg-background group-hover:shadow-2xl px-2 py-4 space-y-6">
      <NavGroup title="מכירות">
        {/* An admin browsing the agent calculator still needs their own
            personal quote list — ManagerSidebar had no link to it at all,
            which silently hid "ההצעות שלי" the moment an admin's calculator
            page switched from AgentSidebar to this one. */}
        <NavItem to="/my-quotes" icon={FileStack} label="ההצעות שלי" active={pathname === "/my-quotes"} />
        <NavItem to="/quotes" icon={ClipboardList} label="הצעות לבדיקה" active={pathname === "/quotes"} />
        <NavItem to="/quotes-archive" icon={LineChart} label="אנליטיקה" active={pathname === "/quotes-archive"} />
      </NavGroup>
      <NavGroup title="CRM">
        <NavItem to="/my-day" icon={Sparkles} label="היום שלי" active={pathname === "/my-day"} />
        <NavItem to="/crm/customers" icon={Users} label="לקוחות" active={pathname.startsWith("/crm/customers")} />
        <NavItem to="/crm/campaigns-overview?tab=leads" icon={Target} label="לידים" active={pathname === "/crm/campaigns-overview" && search.includes("tab=leads")} />
        <NavItem to="/crm/campaigns-overview" icon={PieChart} label="קמפיינים" active={pathname === "/crm/campaigns-overview" && !search.includes("tab=leads")} />
        <NavItem to="/crm/inbox" icon={MessagesSquare} label="תיבת שיחות" active={pathname === "/crm/inbox"} />
        <NavItem to="/crm/campaigns" icon={Send} label="דיוור" active={pathname.startsWith("/crm/campaigns") && !pathname.startsWith("/crm/campaigns-overview")} />
      </NavGroup>
      <NavGroup title="תפעול">
        <NavItem to="/cutting" icon={Scissors} label="ניצולת לוחות" active={pathname === "/cutting"} />
        <NavItem to="/cutfile" icon={PenTool} label="קו חיתוך אוטומטי" active={pathname === "/cutfile"} />
      </NavGroup>
      <NavGroup title="ממשקים שונים">
        <NavItem to="/costs" icon={BarChart3} label="ממשק סוכן מכירות" active={pathname === "/costs"} />
        <NavItem to="/" icon={Settings2} label="הגדרות" active={pathname === "/" && !search} />
        <Button variant="ghost" onClick={logout} title="התנתקות" className="w-full justify-start gap-3 h-12 px-3 rounded-xl font-normal">
          <LogOut className="w-6 h-6 shrink-0" />
          <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">התנתקות</span>
        </Button>
        <NavItem to="/?tab=about" icon={Info} label="אודות" active={pathname === "/" && search === "?tab=about"} />
      </NavGroup>
      </div>
    </aside>
  );
}
