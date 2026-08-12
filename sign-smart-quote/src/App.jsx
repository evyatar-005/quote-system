import { Toaster } from "@/components/ui/toaster"
// Two independent toast systems live in this app: the Radix one above (driven
// by use-toast) and sonner. Every settings/admin screen calls sonner's `toast`,
// but its Toaster was never mounted — so those messages silently went nowhere.
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import AdminDashboard from './pages/AdminDashboard';
import CostsDashboard from './pages/CostsDashboard.jsx';
import CutListOptimizer from './pages/CutListOptimizer.jsx';
import CutFileGenerator from './pages/CutFileGenerator.jsx';
import QuotesHistory from './pages/QuotesHistory.jsx';
import QuotesArchive from './pages/QuotesArchive.jsx';
import MyQuotes from './pages/MyQuotes.jsx';
import RecipesAdmin from './pages/RecipesAdmin.jsx';
import ProductionBoard from './pages/ProductionBoard.jsx';
import CrmCustomers from './pages/CrmCustomers.jsx';
import CrmCustomerDetail from './pages/CrmCustomerDetail.jsx';
import CrmLeads from './pages/CrmLeads.jsx';
import CrmCampaignsOverview from './pages/CrmCampaignsOverview.jsx';
import CrmInbox from './pages/CrmInbox.jsx';
import CrmCampaigns from './pages/CrmCampaigns.jsx';
import CrmCampaignDetail from './pages/CrmCampaignDetail.jsx';
import MyDay from './pages/MyDay.jsx';
import LeadWorkspace from './pages/LeadWorkspace.jsx';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import ErrorBoundary from '@/components/ErrorBoundary';
import Footer from '@/components/Footer';
import { Navigate } from 'react-router-dom';
// Add page imports here

const AdminOnly = ({ children }) => {
  const { user } = useAuth();
  if (user && user.role !== 'admin') return <Navigate to="/costs" replace />;
  return children;
};

// Production/תפ"י screens (recipes + worksheet board) — admin can also reach
// them (same reasoning as requireOperations on the server: admin can do
// everything operations can), but a sales agent gets redirected away, same
// as AdminOnly does for non-admins.
const OperationsOnly = ({ children }) => {
  const { user } = useAuth();
  if (user && user.role !== 'admin' && user.role !== 'operations') return <Navigate to="/costs" replace />;
  return children;
};

// CRM screens (Phase 1) — sales-facing (admin + agent), not production staff.
const CrmAccess = ({ children }) => {
  const { user } = useAuth();
  if (user && !['admin', 'agent'].includes(user.role)) return <Navigate to="/costs" replace />;
  return children;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, isAuthenticated, user } = useAuth();

  // Reached from the emailed reset link — must render before any auth check
  // (no session exists yet) and before the auth-loading spinner below.
  if (window.location.pathname === '/reset-password') {
    return <ResetPassword />;
  }

  // Show loading spinner while checking auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-black border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Not authenticated → show the local login screen.
  if (!isAuthenticated) {
    return <Login />;
  }

  // Seeded/reset accounts must pick their own password before touching
  // anything else — no route out of this screen.
  if (user?.mustChangePassword) {
    return <ChangePassword />;
  }

  // Render the main app. The footer lives here rather than around the whole
  // tree so it stays off the login/reset screens, which are centred
  // min-h-screen cards that a trailing block would push into scrolling.
  return (
    <>
      <Routes>
        <Route path="/" element={<AdminOnly><AdminDashboard /></AdminOnly>} />
        <Route path="/costs" element={<CostsDashboard />} />
        <Route path="/cutting" element={<CutListOptimizer />} />
        <Route path="/cutfile" element={<CutFileGenerator />} />
        <Route path="/quotes" element={<AdminOnly><QuotesHistory /></AdminOnly>} />
        <Route path="/quotes-archive" element={<AdminOnly><QuotesArchive /></AdminOnly>} />
        <Route path="/my-quotes" element={<MyQuotes />} />
        <Route path="/recipes" element={<OperationsOnly><RecipesAdmin /></OperationsOnly>} />
        <Route path="/production" element={<OperationsOnly><ProductionBoard /></OperationsOnly>} />
        {/* Manager-only oversight screens — an agent's daily CRM workflow is
            entirely /my-day + the lead workspace it links into (see
            AgentSidebar.jsx). Customer detail stays CrmAccess: /my-day's
            follow-up cards link into it directly. */}
        <Route path="/crm/customers" element={<AdminOnly><CrmCustomers /></AdminOnly>} />
        <Route path="/crm/customers/:id" element={<CrmAccess><CrmCustomerDetail /></CrmAccess>} />
        {/* The real leads list — sales-facing, so CrmAccess (admin + agent),
            NOT AdminOnly. It used to redirect into the AdminOnly campaigns
            overview, which meant an agent clicking "לידים" landed on /costs.
            Row scoping is enforced server-side in GET /api/crm/leads. */}
        <Route path="/crm/leads" element={<CrmAccess><CrmLeads /></CrmAccess>} />
        <Route path="/crm/campaigns-overview" element={<AdminOnly><CrmCampaignsOverview /></AdminOnly>} />
        <Route path="/crm/inbox" element={<AdminOnly><CrmInbox /></AdminOnly>} />
        <Route path="/crm/campaigns" element={<AdminOnly><CrmCampaigns /></AdminOnly>} />
        <Route path="/crm/campaigns/:id" element={<AdminOnly><CrmCampaignDetail /></AdminOnly>} />
        <Route path="/my-day" element={<CrmAccess><MyDay /></CrmAccess>} />
        <Route path="/crm/leads/:id/workspace" element={<CrmAccess><LeadWorkspace /></CrmAccess>} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
      <Footer />
    </>
  );
};


function App() {

  return (
    <ErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <AuthenticatedApp />
          </Router>
          <Toaster />
          <SonnerToaster />
        </QueryClientProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App