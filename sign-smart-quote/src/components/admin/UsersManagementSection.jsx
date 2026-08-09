import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Plus, Trash2, KeyRound, Mail, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";

const ROLE_LABEL = { admin: "מנהל מכירות", agent: "סוכן מכירות", operations: "תפעול (תפ\"י)" };

export default function UsersManagementSection() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", full_name: "", email: "", role: "agent" });
  const [resetPasswordFor, setResetPasswordFor] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [editEmailFor, setEditEmailFor] = useState(null);
  const [editEmailValue, setEditEmailValue] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { users } = await base44.adminUsers.list();
      setUsers(users);
    } catch (err) {
      toast.error("שגיאה בטעינת רשימת המשתמשים");
    }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!newUser.username.trim()) return toast.error("יש להזין שם משתמש");
    // Required client-side too, not just server-side: login is by email now,
    // so a user created without one would have no way to ever sign in.
    if (!newUser.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newUser.email.trim())) return toast.error("יש להזין כתובת מייל תקינה — היא משמשת להתחברות");
    if (!newUser.password || newUser.password.length < 8) return toast.error("סיסמה חייבת להכיל לפחות 8 תווים");
    setCreating(true);
    try {
      await base44.adminUsers.create(newUser);
      toast.success("המשתמש נוצר בהצלחה");
      setNewUser({ username: "", password: "", full_name: "", email: "", role: "agent" });
      loadUsers();
    } catch (err) {
      const known = { "username already exists": "שם המשתמש כבר קיים", "email already exists": "כתובת המייל כבר בשימוש" };
      toast.error(known[err.message] || "שגיאה ביצירת המשתמש");
    }
    setCreating(false);
  };

  const handleRoleChange = async (id, role) => {
    try {
      await base44.adminUsers.update(id, { role });
      toast.success("ההרשאה עודכנה");
      loadUsers();
    } catch (err) {
      toast.error("שגיאה בעדכון ההרשאה");
    }
  };

  // Without this an admin has no way to set a user's email at all, which makes
  // "שכחתי סיסמה" unusable for them — the reset link is sent to users.email.
  const handleSaveEmail = async () => {
    const email = editEmailValue.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error("כתובת מייל לא תקינה");
    try {
      await base44.adminUsers.update(editEmailFor.id, { email });
      toast.success(`המייל של "${editEmailFor.username}" עודכן`);
      setEditEmailFor(null);
      setEditEmailValue("");
      loadUsers();
    } catch (err) {
      toast.error(err.message === "email already exists" ? "כתובת המייל כבר בשימוש ע״י משתמש אחר" : "שגיאה בעדכון המייל");
    }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`למחוק את המשתמש "${u.username}"?`)) return;
    try {
      await base44.adminUsers.delete(u.id);
      toast.success("המשתמש נמחק");
      loadUsers();
    } catch (err) {
      toast.error(err.message === "cannot delete your own account" ? "לא ניתן למחוק את המשתמש שלך" : "שגיאה במחיקת המשתמש");
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordValue || resetPasswordValue.length < 8) return toast.error("סיסמה חייבת להכיל לפחות 8 תווים");
    try {
      await base44.adminUsers.resetPassword(resetPasswordFor.id, resetPasswordValue);
      toast.success(`הסיסמה של "${resetPasswordFor.username}" עודכנה`);
      setResetPasswordFor(null);
      setResetPasswordValue("");
    } catch (err) {
      toast.error("שגיאה באיפוס הסיסמה");
    }
  };

  return (
    <Card className="border-2 border-black shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <UsersIcon className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">ניהול משתמשים</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">הוספת סוכנים ומנהלים, קביעת הרשאות, איפוס סיסמאות</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Add new user */}
        <div className="border-2 border-black rounded-xl p-4 space-y-3 bg-slate-50/50">
          <p className="text-sm font-semibold text-slate-700">הוספת משתמש חדש</p>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <Input
              placeholder="שם משתמש"
              value={newUser.username}
              onChange={(e) => setNewUser((p) => ({ ...p, username: e.target.value }))}
              autoComplete="off"
              className="bg-background"
            />
            <Input
              placeholder="סיסמה"
              type="password"
              value={newUser.password}
              onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
              autoComplete="new-password"
              className="bg-background"
            />
            <Input
              placeholder="שם מלא (לא חובה)"
              value={newUser.full_name}
              onChange={(e) => setNewUser((p) => ({ ...p, full_name: e.target.value }))}
              className="bg-background"
            />
            <Input
              placeholder="כתובת מייל"
              type="email"
              dir="ltr"
              value={newUser.email}
              onChange={(e) => setNewUser((p) => ({ ...p, email: e.target.value }))}
              autoComplete="off"
              className="bg-background"
            />
            <Select value={newUser.role} onValueChange={(role) => setNewUser((p) => ({ ...p, role }))}>
              <SelectTrigger className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent">סוכן מכירות</SelectItem>
                <SelectItem value="admin">מנהל מכירות</SelectItem>
                <SelectItem value="operations">תפעול (תפ"י)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleCreate} disabled={creating} className="gap-2">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            הוסף משתמש
          </Button>
        </div>

        {/* Role filter tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { value: "all", label: "הכל" },
            { value: "admin", label: "מנהלי מכירות" },
            { value: "agent", label: "סוכני מכירות" },
            { value: "operations", label: "תפעול (תפ\"י)" },
          ].map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setRoleFilter(tab.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border-2 border-black transition-colors ${
                roleFilter === tab.value ? "bg-primary text-primary-foreground" : "bg-background text-slate-700 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Users list */}
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="border-2 border-black rounded-xl divide-y divide-slate-300">
            {users.filter((u) => roleFilter === "all" || u.role === roleFilter).map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 p-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{u.full_name || u.username}</p>
                  <p className="text-xs text-muted-foreground">
                    {u.username}
                    {u.email ? ` · ${u.email}` : ""}
                    {/* Login is by email now — without one this account cannot sign in at all,
                        not merely "can't reset its password" as before. */}
                    {!u.email && <span className="text-amber-600"> · ללא מייל — לא יוכל להתחבר למערכת</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={u.role} onValueChange={(role) => handleRoleChange(u.id, role)}>
                    <SelectTrigger className="h-9 w-36 bg-background">
                      <SelectValue>{ROLE_LABEL[u.role] || u.role}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agent">סוכן מכירות</SelectItem>
                      <SelectItem value="admin">מנהל מכירות</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-9"
                    onClick={() => { setEditEmailFor(u); setEditEmailValue(u.email || ""); }}
                  >
                    <Mail className="w-4 h-4" /> מייל
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-9"
                    onClick={() => { setResetPasswordFor(u); setResetPasswordValue(""); }}
                  >
                    <KeyRound className="w-4 h-4" /> איפוס סיסמה
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 text-destructive hover:text-destructive"
                    disabled={u.id === currentUser?.id}
                    onClick={() => handleDelete(u)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit email inline panel — same shape as the reset-password one below */}
        {editEmailFor && (
          <div className="border-2 border-black rounded-xl p-4 space-y-3 bg-slate-50/50">
            <p className="text-sm font-semibold text-slate-700">כתובת מייל עבור "{editEmailFor.username}"</p>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                type="email"
                dir="ltr"
                placeholder="name@company.co.il"
                value={editEmailValue}
                onChange={(e) => setEditEmailValue(e.target.value)}
                autoComplete="off"
                className="bg-background max-w-xs"
              />
              <Button onClick={handleSaveEmail}>שמור מייל</Button>
              <Button variant="ghost" onClick={() => { setEditEmailFor(null); setEditEmailValue(""); }}>ביטול</Button>
            </div>
            <p className="text-xs text-muted-foreground">כתובת זו משמשת להתחברות למערכת ולקבלת קישור איפוס סיסמה. השארה ריקה תמחק אותה — המשתמש לא יוכל להתחבר עד שתוגדר כתובת מחדש.</p>
          </div>
        )}

        {/* Reset password inline panel */}
        {resetPasswordFor && (
          <div className="border-2 border-black rounded-xl p-4 space-y-3 bg-slate-50/50">
            <p className="text-sm font-semibold text-slate-700">איפוס סיסמה עבור "{resetPasswordFor.username}"</p>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                type="password"
                placeholder="סיסמה חדשה"
                value={resetPasswordValue}
                onChange={(e) => setResetPasswordValue(e.target.value)}
                autoComplete="new-password"
                className="bg-background max-w-xs"
              />
              <Button onClick={handleResetPassword}>שמור סיסמה חדשה</Button>
              <Button variant="outline" onClick={() => setResetPasswordFor(null)}>ביטול</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
