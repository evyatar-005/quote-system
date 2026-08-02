import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import ForgotPassword from './ForgotPassword.jsx';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  if (showForgotPassword) {
    return <ForgotPassword onBack={() => setShowForgotPassword(false)} />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(
        err && err.status === 401
          ? 'אימייל או סיסמה שגויים'
          : 'ההתחברות נכשלה. נסה שוב מאוחר יותר'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      dir="rtl"
      className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-slate-50 p-4"
    >
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border-2 border-slate-300 overflow-hidden">
        {/* Thin 5-color strip echoing the Printela logo — a quiet brand touch,
            not a loud one. */}
        <div className="h-1.5 w-full flex">
          <div className="flex-1 bg-brand-pink" />
          <div className="flex-1 bg-brand-gold" />
          <div className="flex-1 bg-brand-teal" />
          <div className="flex-1 bg-brand-green" />
          <div className="flex-1 bg-brand-purple" />
        </div>

        <div className="p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900">התחברות</h1>
          <p className="text-sm text-slate-500 mt-2">מערכת הצעות מחיר</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-base font-semibold text-slate-700">אימייל</label>
            <Input
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.co.il"
              autoComplete="email"
              className="h-11 bg-slate-50 border-black"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-base font-semibold text-slate-700">סיסמה</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="סיסמה"
              autoComplete="current-password"
              className="h-11 bg-slate-50 border-black"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={loading || !email.trim() || !password.trim()}
            className="w-full h-11 bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-semibold"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'התחברות'}
          </Button>

          <button
            type="button"
            onClick={() => setShowForgotPassword(true)}
            className="w-full text-sm text-slate-400 hover:text-slate-600 transition-colors"
          >
            שכחתי סיסמה
          </button>
        </form>
        </div>
      </div>
    </div>
  );
}
