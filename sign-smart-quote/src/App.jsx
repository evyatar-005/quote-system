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
import RecipesAdmin from './pages/RecipesAdmin.jsx';
import ProductionBoard from './pages/ProductionBoard.jsx';
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
        <Route path="/recipes" element={<OperationsOnly><RecipesAdmin /></OperationsOnly>} />
        <Route path="/production" element={<OperationsOnly><ProductionBoard /></OperationsOnly>} />
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