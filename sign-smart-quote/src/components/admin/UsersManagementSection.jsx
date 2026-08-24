import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, KeyRound, Mail, Users as UsersIcon, DollarSign, Send, MessagesSquare, HelpCircle, ChevronDown } from "lucide-react";
import { toast } from "sonner";

const ROLE_LABEL = { admin: "מנהל מכירות", agent: "סוכן מכירות", operations: "תפעול (תפ\"י)" };

// Every role this system actually accepts (the server validates against the
// same three — see ROLES in routes/auth.js). Kept as one list so the create
// form and the per-row selector can never drift apart again: the row selector
// used to omit "תפעול", which meant an operations user could not be edited
// here at all without silently being demoted to something else.
const ROLE_OPTIONS = ["agent", "admin", "operations"];

// What each role actually unlocks. Written from the middleware that enforces
// it, not from intent — requireAdmin / requireOperations in routes/auth.js.
const ROLE_DESCRIPTIONS = {
  agent: "מחשבון הצעות מחיר, ״ההצעות שלי״ (רק ההצעות שהוא יצר), הנפקת הצעה/הזמנה במורנינג ושליחת קישור תשלום. אין גישה למחירונים, להגדרות המערכת או להצעות של סוכנים אחרים.",
  admin: "כל מה שסוכן מקבל, ובנוסף: ניהול מחירונים ועלויות, ניהול משתמשים והרשאות, הגדרות המערכת (מורנינג, SMTP, דוחות, מנדיי), היסטוריית ההצעות של כולם, אנליטיקה, ואישור הצעות שנשלחו לבדיקה.",
  operations: "מסכי תפ״י בלבד — מתכוני ייצור ודפי עבודה. במפורש ללא גישה לתמחור, לעלויות, לרווחיות או להגדרות המערכת.",
};

// The granular permissions. These are INDEPENDENT of role — a מנהל מכירות
// without the CRM permission has no CRM, and a סוכן with it does. Each
// `grants` line describes what the toggle actually opens, so this screen can
// answer "what does this button give me" without reading the code.
const PERMISSIONS = [
  {
    key: "can_view_costs",
    label: "עלויות",
    icon: DollarSign,
    grants: "צפייה במרכיבי העלות, הרווח והרווחיות של הצעה (״הצג מרכיבי עלות״ בחלון פרטי ההצעה). בלי ההרשאה הכפתור נעול והמשתמש רואה מחירי מכירה בלבד.",
    // Now genuinely enforced: routes/entities.js strips the cost-bearing keys
    // out of a quote's calculation_data before sending it, so revoking this
    // withholds the data itself rather than merely hiding a button.
    caveat: "נאכף בשרת — נתוני העלות לא נשלחים כלל למשתמש בלי ההרשאה. מנהל מכירות חדש מקבל אותה אוטומטית.",
  },
  {
    key: "can_send_campaigns",
    label: "דיוור",
    icon: Send,
    grants: "פתיחת דיוור ווצאפ המוני (תפוצת מבצעים) וניהול תבניות ורשימות הסרה. הרשאה זו לא מגיעה אוטומטית עם תפקיד מנהל — משלוח ל-200 נמענים הוא הפעולה ההרסנית ביותר במערכת, ולכן היא נשלטת בנפרד לכל משתמש.",
  },
  {
    key: "can_access_crm",
    label: "CRM",
    icon: MessagesSquare,
    grants: "הגישה לכל מודול ה-CRM: ״היום שלי״, לידים, לקוחות, תיבת השיחות והדיוור. בלי ההרשאה המודול לא מופיע בתפריט כלל, גם למנהל מכירות.",
    caveat: "לא חל על תפקיד ״תפעול״ — משתמש תפעול חסום מה-CRM בכל מקרה, גם אם המתג דלוק.",
  },
  {
    key: "can_delete_quotes",
    label: "מחיקת הצעות",
    icon: Trash2,
    grants: "מחיקה סופית של הצעת מחיר מהמערכת. הרשאה צרה בכוונה — היא לא מגיעה עם תפקיד מנהל מכירות, ויש להעניק אותה במפורש.",
  },
];

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
    // Mirrors the server rule: a customer-facing user signs every WhatsApp
    // reply with their full name, so it can't be blank.
    if ((newUser.role === "agent" || newUser.role === "admin") && !newUser.full_name.trim()) {
      return toast.error("יש להזין שם מלא — הוא מופיע כחתימה בהודעות ללקוח");
    }
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
      // The server refuses to demote the last admin (or yourself) with a
      // specific Hebrew explanation — swallowing it behind a generic message
      // left the admin staring at a dropdown that silently snapped back.
      toast.error(err?.message || "שגיאה בעדכון ההרשאה");
      loadUsers();
    }
  };

  // One handler for all three granular permissions (see PERMISSIONS above) —
  // they were three copies of the same four lines, which is how the labels
  // and behaviour drifted apart in the first place. Each is independent of
  // role: a מנהל מכירות without a permission genuinely does not have it.
  //
  // Turning your OWN CRM access off is allowed but removes the module from
  // your sidebar on the next load, so it asks first. This screen lives under
  // הגדרות מנהל rather than inside the CRM, so it stays reachable to switch
  // back on — that is what makes the self-lockout recoverable.
  const handleTogglePermission = async (u, key) => {
    if (key === "can_access_crm" && u.id === currentUser?.id && u.can_access_crm) {
      if (!confirm("לבטל לעצמך את הגישה ל-CRM? הוא ייעלם מהתפריט שלך עד שתדליק שוב כאן.")) return;
    }
    try {
      await base44.adminUsers.update(u.id, { [key]: u[key] ? 0 : 1 });
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
              placeholder="שם מלא — יופיע כחתימה בהודעות ללקוח"
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
          // A real column grid rather than a row of pills. The old layout put
          // each permission in a button whose LABEL flipped between the
          // positive and negative wording ("רואה עלויות" / "לא רואה עלויות"),
          // so every row was a different width, nothing lined up, and telling
          // who has what meant reading all three pills on all ten rows. Fixed
          // columns + a switch means state is read by position and colour.
          <div className="border-2 border-black rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b-2 border-black text-xs text-slate-600">
                  <th className="text-right font-semibold px-3 py-2">משתמש</th>
                  <th className="text-right font-semibold px-3 py-2">תפקיד</th>
                  {PERMISSIONS.map((p) => (
                    <th key={p.key} className="text-center font-semibold px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1" title={p.grants}>
                        <p.icon className="w-3.5 h-3.5" />
                        {p.label}
                      </span>
                    </th>
                  ))}
                  <th className="text-center font-semibold px-3 py-2">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {users.filter((u) => roleFilter === "all" || u.role === roleFilter).map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <p className="text-sm font-semibold text-slate-800">{u.full_name || u.username}</p>
                      <p className="text-xs text-muted-foreground">
                        {u.username}
                        {u.email ? ` · ${u.email}` : ""}
                        {/* Login is by email now — without one this account cannot sign in at all,
                            not merely "can't reset its password" as before. */}
                        {!u.email && <span className="text-amber-600"> · ללא מייל — לא יוכל להתחבר למערכת</span>}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <Select value={u.role} onValueChange={(role) => handleRoleChange(u.id, role)}>
                        <SelectTrigger className="h-9 w-36 bg-background">
                          <SelectValue>{ROLE_LABEL[u.role] || u.role}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((role) => (
                            <SelectItem key={role} value={role}>{ROLE_LABEL[role]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    {PERMISSIONS.map((p) => (
                      <td key={p.key} className="px-3 py-2 text-center">
                        <Switch
                          checked={!!u[p.key]}
                          onCheckedChange={() => handleTogglePermission(u, p.key)}
                          aria-label={`${p.label} — ${u.full_name || u.username}`}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="עריכת כתובת מייל"
                          onClick={() => { setEditEmailFor(u); setEditEmailValue(u.email || ""); }}
                        >
                          <Mail className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="איפוס סיסמה"
                          onClick={() => { setResetPasswordFor(u); setResetPasswordValue(""); }}
                        >
                          <KeyRound className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          title={u.id === currentUser?.id ? "אי אפשר למחוק את המשתמש שלך" : "מחיקת משתמש"}
                          disabled={u.id === currentUser?.id}
                          onClick={() => handleDelete(u)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* The definitions themselves. A tooltip on a column header answers
            "what is this" only while hovering and only one at a time; this
            panel is what someone deciding who gets what actually needs. */}
        <details className="border-2 border-black rounded-xl bg-slate-50/50">
          <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer text-sm font-semibold text-slate-700 select-none">
            <HelpCircle className="w-4 h-4 text-slate-500" />
            מה כל תפקיד והרשאה נותנים
            <ChevronDown className="w-4 h-4 text-slate-400 mr-auto" />
          </summary>
          <div className="px-4 pb-4 space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500">תפקידים — כל משתמש הוא בדיוק אחד מהם</p>
              {ROLE_OPTIONS.map((role) => (
                <div key={role} className="text-xs">
                  <span className="font-semibold text-slate-800">{ROLE_LABEL[role]}: </span>
                  <span className="text-slate-600">{ROLE_DESCRIPTIONS[role]}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500">
                הרשאות — נשלטות בנפרד לכל משתמש ואינן נגזרות מהתפקיד
              </p>
              {PERMISSIONS.map((p) => (
                <div key={p.key} className="text-xs">
                  <span className="font-semibold text-slate-800 inline-flex items-center gap-1">
                    <p.icon className="w-3 h-3" />
                    {p.label}:
                  </span>{" "}
                  <span className="text-slate-600">{p.grants}</span>
                  {p.caveat && <span className="text-amber-700"> {p.caveat}</span>}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-600">
              שים לב: הרשאות ״עלויות״ ו״דיוור״ אינן נדלקות אוטומטית למשתמש חדש — גם לא למנהל מכירות
              חדש. יש להדליק אותן ידנית כאן.
            </p>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              שים לב: מנהל המכירות האחרון לא יכול לרדת מהתפקיד, ומנהל לא יכול להוריד את התפקיד
              מעצמו — אחרת אף אחד לא היה יכול להיכנס להגדרות ולתקן.
            </p>
          </div>
        </details>

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
