import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut, Settings2, FileStack, Scissors, PenTool, Users, Target, MessagesSquare, Send } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

// The agent-facing counterpart to ManagerSidebar — same fixed-width, full
// labeled menu, stretching the full height of the viewport (same NavGroup/
// NavItem visual language), so the "main menu" reads identically everywhere.
// Content differs on purpose (ההצעות שלי instead of the manager-only הצעות
// לבדיקה/אנליטיקה, no "ממשק סוכן מכירות" link back into itself) — same
// permissions as before: the admin-only link stays gated behind
// user.role === "admin".

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

export default function AgentSidebar() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  return (
    <aside className="w-64 shrink-0 sticky top-24 h-[calc(100vh-6rem)] overflow-y-auto border-l border-black pl-4 space-y-6">
      <NavGroup title="מכירות">
        <NavItem to="/my-quotes" icon={FileStack} label="ההצעות שלי" active={pathname === "/my-quotes"} />
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
        {user?.role === "admin" && (
          <NavItem to="/" icon={Settings2} label="הגדרות מנהל" active={pathname === "/"} />
        )}
        <Button variant="ghost" onClick={logout} className="w-full justify-start gap-3 h-12 px-3 rounded-xl font-normal">
          <LogOut className="w-6 h-6 shrink-0" />
          התנתקות
        </Button>
      </NavGroup>
    </aside>
  );
}
