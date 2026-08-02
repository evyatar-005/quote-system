import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Public settings no longer come from Base44 — always resolved.
  const isLoadingPublicSettings = false;

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    setIsLoadingAuth(true);
    setAuthError(null);

    let token = null;
    try {
      token = localStorage.getItem('auth_token');
    } catch {
      token = null;
    }

    if (!token) {
      // No token → simply unauthenticated (not an error).
      setUser(null);
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      return;
    }

    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
    } catch (error) {
      // Invalid / expired token — clear it and treat as unauthenticated.
      try {
        localStorage.removeItem('auth_token');
      } catch {
        // ignore
      }
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const login = async (email, password) => {
    setAuthError(null);
    try {
      const loggedInUser = await base44.auth.login(email, password);
      setUser(loggedInUser);
      setIsAuthenticated(true);
      return loggedInUser;
    } catch (error) {
      const message =
        error && error.status === 401
          ? 'אימייל או סיסמה שגויים'
          : error && error.status === 429
          ? error.message // server's own "too many failed attempts — try again in Ns"
          : 'ההתחברות נכשלה. נסה שוב מאוחר יותר';
      setAuthError({ type: 'login_failed', message });
      throw error;
    }
  };

  // Called after a successful forced/self-service password change — clears
  // the flag locally so the change-password screen unmounts immediately
  // instead of waiting on a full /api/auth/me round-trip.
  const clearMustChangePassword = () => {
    setUser((prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
  };

  const logout = async () => {
    try {
      await base44.auth.logout();
    } catch {
      // ignore
    }
    setUser(null);
    setIsAuthenticated(false);
  };

  // Kept as a harmless alias for legacy callers.
  const navigateToLogin = () => {
    base44.auth.redirectToLogin();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        login,
        logout,
        navigateToLogin,
        checkAppState,
        clearMustChangePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
