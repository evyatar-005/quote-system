import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { resetPassword } from '@/api/smtpClient';

// Reached directly from the emailed reset link (/reset-password?token=...),
// rendered by App.jsx BEFORE the auth gate — no session required. Mirrors
// ChangePassword.jsx's validation but authenticates via the one-time token
// instead of the current password.
export default function ResetPassword() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) return setError('הסיסמה החדשה חייבת להכיל לפחות 8 תווים');
    if (newPassword !== confirmPassword) return setError('הסיסמאות אינן תואמות');
    setLoading(true);
    try {
      await resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      setError(err?.message === 'הקישור אינו תקף או שפג תוקפו'
        ? err.message
        : 'איפוס הסיסמה נכשל. נסה שוב או בקש קישור חדש');
    } finally {
      setLoading(false);
    }
  };

  const goToLogin = () => {
    window.location.href = '/';
  };

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-slate-50 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border-2 border-slate-300 overflow-hidden">
        <div className="h-1.5 w-full flex">
          <div className="flex-1 bg-brand-pink" />
          <div className="flex-1 bg-brand-gold" />
          <div className="flex-1 bg-brand-teal" />
          <div className="flex-1 bg-brand-green" />
          <div className="flex-1 bg-brand-purple" />
        </div>

        <div className="p-8">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-slate-900">קביעת סיסמה חדשה</h1>
            <p className="text-sm text-slate-500 mt-2">מערכת הצעות מחיר</p>
          </div>

          {!token ? (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              הקישור אינו תקין — ודא שהעתקת אותו במלואו מהמייל.
            </div>
          ) : done ? (
            <div className="space-y-4">
              <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-3">
                הסיסמה עודכנה בהצלחה. אפשר להתחבר עם הסיסמה החדשה.
              </div>
              <Button
                type="button"
                onClick={goToLogin}
                className="w-full h-11 bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-semibold"
              >
                מעבר להתחברות
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-base font-semibold text-slate-700">סיסמה חדשה</label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className="h-11 bg-slate-50 border-black"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-base font-semibold text-slate-700">אימות סיסמה חדשה</label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="h-11 bg-slate-50 border-black"
                />
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
              )}

              <Button
                type="submit"
                disabled={loading || !newPassword || !confirmPassword}
                className="w-full h-11 bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-semibold"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'עדכן סיסמה'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
