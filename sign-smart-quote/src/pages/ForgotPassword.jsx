import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { forgotPassword } from '@/api/smtpClient';

// Reached from Login.jsx's "שכחתי סיסמה" link. Always shows the same generic
// success message regardless of whether the username matched anything — the
// backend (POST /api/auth/forgot-password) is deliberately silent about that
// too, so this screen can't be used to enumerate usernames.
export default function ForgotPassword({ onBack }) {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    try {
      await forgotPassword(username.trim());
    } catch {
      // Ignore — the endpoint itself never signals failure for this reason;
      // a network/500 error still shows the same generic message.
    } finally {
      setLoading(false);
      setSent(true);
    }
  };

  return (
    <div
      dir="rtl"
      className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-slate-50 p-4"
    >
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border-2 border-slate-300 overflow-hidden">
        <div className="h-1.5 w-full flex">
          <div className="flex-1 bg-brand-pink" />
          <div className="flex-1 bg-brand-gold" />
          <div className="flex-1 bg-brand-teal" />
          <div className="flex-1 bg-brand-green" />
          <div className="flex-1 bg-brand-purple" />
        </div>

        <div className="p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-slate-900">שחזור סיסמה</h1>
            <p className="text-sm text-slate-500 mt-2">מערכת הצעות מחיר</p>
          </div>

          {sent ? (
            <div className="space-y-4">
              <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
                אם קיים משתמש כזה עם כתובת מייל רשומה, נשלח אליו קישור לאיפוס הסיסמה. בדוק את תיבת הדואר שלך.
              </div>
              <Button
                type="button"
                onClick={onBack}
                className="w-full h-11 bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-semibold"
              >
                חזרה להתחברות
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-base font-semibold text-slate-700">שם משתמש</label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="שם משתמש"
                  autoComplete="username"
                  className="h-11 bg-slate-50 border-black"
                />
              </div>

              <Button
                type="submit"
                disabled={loading || !username.trim()}
                className="w-full h-11 bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-semibold"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'שליחת קישור לאיפוס'}
              </Button>

              <button
                type="button"
                onClick={onBack}
                className="w-full text-sm text-slate-400 hover:text-slate-600 transition-colors"
              >
                חזרה להתחברות
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
