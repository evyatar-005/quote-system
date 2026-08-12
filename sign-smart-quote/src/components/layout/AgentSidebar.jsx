import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut, Settings2, FileStack, Scissors, PenTool, Sparkles, Target } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

// The agent-facing counterpart to ManagerSidebar — same fixed-width, full
// labeled menu, stretching the full height of the viewport (same NavGroup/
// NavItem visual language), so the "main menu" reads identically everywhere.
// Content differs on purpose (ההצעות שלי instead of the manager-only הצעות
// לבדיקה/אנליטיקה, no "ממשק סוכן מכירות" link back into itself) — same
// permissions as before: the admin-only link stays gated behind
// user.role === "admin".
//
// "היום שלי" stays the agent's daily driver (claim, work the WhatsApp thread,
// send materials). "לידים" was added alongside it because MyDay can only ever
// show the leads the agent currently holds a slot on — it can't answer "where
// is the lead I spoke to last week" or "what did I close this month", since a
// closed lead releases its claim and disappears. The other manager-facing CRM
// screens (לקוחות/תיבת שיחות/דיוור) are still deliberately absent.

// Icon-only rail that expands on hover — same behaviour as ManagerSidebar, so
// an admin switching between the two menus never sees them behave differently.
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

export default function AgentSidebar() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  return (
    <aside className="group w-16 shrink-0">
      <div className="fixed inset-y-0 right-0 z-30 w-16 group-hover:w-64 transition-[width] duration-200 ease-out overflow-y-auto overflow-x-hidden border-l border-black bg-background group-hover:shadow-2xl px-2 py-4 space-y-6">
      <NavGroup title="מכירות">
        <NavItem to="/my-day" icon={Sparkles} label="היום שלי" active={pathname === "/my-day"} />
        <NavItem to="/crm/leads" icon={Target} label="לידים" active={pathname === "/crm/leads"} />
        <NavItem to="/my-quotes" icon={FileStack} label="ההצעות שלי" active={pathname === "/my-quotes"} />
      </NavGroup>
      <NavGroup title="תפעול">
        <NavItem to="/cutting" icon={Scissors} label="ניצולת לוחות" active={pathname === "/cutting"} />
        <NavItem to="/cutfile" icon={PenTool} label="קו חיתוך אוטומטי" active={pathname === "/cutfile"} />
      </NavGroup>
      <NavGroup title="ממשקים שונים">
        {user?.role === "admin" && (
          <NavItem to="/" icon={Settings2} label="הגדרות מנהל" active={pathname === "/"} />
        )}
        <Button variant="ghost" onClick={logout} title="התנתקות" className="w-full justify-start gap-3 h-12 px-3 rounded-xl font-normal">
          <LogOut className="w-6 h-6 shrink-0" />
          <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">התנתקות</span>
        </Button>
      </NavGroup>
      </div>
    </aside>
  );
}
