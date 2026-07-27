import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

// Blocks the entire app until a forced/reset password is replaced — reached
// only when user.mustChangePassword is true (see App.jsx). Not skippable:
// there's no "cancel" or route out of this screen on purpose.
export default function ChangePassword() {
  const { user, clearMustChangePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) return setError('הסיסמה החדשה חייבת להכיל לפחות 6 תווים');
    if (newPassword !== confirmPassword) return setError('הסיסמאות אינן תואמות');
    setLoading(true);
    try {
      await base44.auth.changePassword(currentPassword, newPassword);
      clearMustChangePassword();
    } catch (err) {
      setError(err && err.status === 401 ? 'הסיסמה הנוכחית שגויה' : 'שינוי הסיסמה נכשל. נסה שוב');
    } finally {
      setLoading(false);
    }
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
            <h1 className="text-xl font-bold text-slate-900">נדרש שינוי סיסמה</h1>
            <p className="text-sm text-slate-500 mt-2">
              {user?.full_name || user?.username}, זו הכניסה הראשונה שלך (או שהסיסמה אופסה) — יש לבחור סיסמה חדשה כדי להמשיך.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-base font-semibold text-slate-700">סיסמה נוכחית</label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className="h-11 bg-slate-50 border-black"
              />
            </div>

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
              disabled={loading || !currentPassword || !newPassword || !confirmPassword}
              className="w-full h-11 bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-semibold"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'עדכן סיסמה והמשך'}
            </Button>

            <button
              type="button"
              onClick={logout}
              className="w-full text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              התנתק
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
