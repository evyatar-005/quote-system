import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import ManagerSidebar from "@/components/layout/ManagerSidebar";
import AgentSidebar from "@/components/layout/AgentSidebar";
import LeadWorkspacePanel from "@/components/crm/LeadWorkspacePanel";
import LeadSwitcher from "@/components/crm/LeadSwitcher";
import printellaLogo from "@/assets/printella-logo.png";

// Standalone page for a lead's workspace — direct-link/refresh-safe wrapper
// around LeadWorkspacePanel.jsx (the actual thread+fields+drive+actions
// body, shared with the inline version opened straight from "היום שלי").
export default function LeadWorkspace() {
  const { id } = useParams();
  const leadId = parseInt(id, 10);
  const { user } = useAuth();
  const [context, setContext] = useState(null);
  const Sidebar = user?.role === "agent" ? AgentSidebar : ManagerSidebar;

  const isMine = context?.claim?.username === user?.username;

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <img src={printellaLogo} alt="Printella" className="h-24 object-contain" />
          <div className="flex-1 min-w-0">
            <Link to="/my-day" className="text-xs text-slate-400 hover:text-primary flex items-center gap-1">
              <ArrowRight className="w-3 h-3" /> חזרה להיום שלי
            </Link>
            <h1 className="text-lg font-bold truncate">{context?.customer?.display_name || "…"}</h1>
          </div>
          <LeadSwitcher leadId={leadId} />
          {isMine && <span className="text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-600 shrink-0">בטיפולך</span>}
        </div>
      </div>

      <div className="w-full mx-auto px-4 sm:px-8 py-8 flex flex-col lg:flex-row gap-8 items-start">
        <Sidebar />
        <div className="flex-1 min-w-0 w-full">
          <LeadWorkspacePanel leadId={leadId} onContext={setContext} />
        </div>
      </div>
    </div>
  );
}
