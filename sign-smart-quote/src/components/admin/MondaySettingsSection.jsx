import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Loader2, Save, LayoutGrid, X } from "lucide-react";
import { toast } from "sonner";
import { getMondayConfig, saveMondayConfig, listMondayBoards, listMondayGroups } from "@/api/mondayClient";
import CostSectionCard from "./CostSectionCard";

export default function MondaySettingsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [apiToken, setApiToken] = useState("");
  const [tokenMasked, setTokenMasked] = useState("");
  const [boardId, setBoardId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [boards, setBoards] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);

  const loadBoards = async () => {
    setLoadingBoards(true);
    try {
      setBoards(await listMondayBoards());
    } catch (err) {
      toast.error(err?.message || "שגיאה בטעינת הבורדים מ-monday.com");
    }
    setLoadingBoards(false);
  };

  const loadGroups = async (id) => {
    if (!id) { setGroups([]); return; }
    setLoadingGroups(true);
    try {
      setGroups(await listMondayGroups(id));
    } catch (err) {
      toast.error(err?.message || "שגיאה בטעינת הקבוצות מהבורד");
    }
    setLoadingGroups(false);
  };

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getMondayConfig();
        setConfigured(cfg.configured);
        setTokenMasked(cfg.api_token_masked || "");
        setBoardId(cfg.board_id || "");
        setGroupId(cfg.group_id || "");
        if (cfg.configured) {
          await loadBoards();
          if (cfg.board_id) await loadGroups(cfg.board_id);
        }
      } catch {
        toast.error("שגיאה בטעינת הגדרות monday.com");
      }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveMondayConfig({ api_token: apiToken, board_id: boardId, group_id: groupId });
      setApiToken("");
      setTokenMasked(result?.api_token_masked || tokenMasked);
      setConfigured(true);
      toast.success("הגדרות monday.com נשמרו בהצלחה");
      await loadBoards();
    } catch (err) {
      toast.error(err?.message || "שגיאה בשמירת הגדרות monday.com");
    }
    setSaving(false);
  };

  const handleBoardChange = async (id) => {
    setBoardId(id);
    setGroupId("");
    await loadGroups(id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <CostSectionCard
      icon={<LayoutGrid className="w-5 h-5" />}
      title="הגדרות monday.com"
      description="חיבור לבורד ההזמנות ב-monday.com — יצירת הזמנה בבורד תיבנה בשלב הבא, לאחר בדיקת מבנה הבורד"
      defaultOpen
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-sm font-semibold text-slate-600">API Token</label>
          <Input
            type="password"
            dir="ltr"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder={tokenMasked ? `נוכחי: ${tokenMasked}` : "מהגדרות חשבון monday.com → API"}
          />
          <p className="text-xs text-muted-foreground">השדה נשאר ריק אם לא מזינים ערך חדש — כך שהטוקן הקיים לא נמחק</p>
        </div>

        {configured && (
          <>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-600">בורד</label>
              <div className="flex gap-1.5">
                <Select value={boardId} onValueChange={handleBoardChange} disabled={loadingBoards}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingBoards ? "טוען..." : "בחר בורד"} />
                  </SelectTrigger>
                  <SelectContent>
                    {boards.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {boardId && (
                  <Button type="button" variant="outline" size="icon" title="נקה בחירה" onClick={() => { setBoardId(""); setGroupId(""); setGroups([]); }}>
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-600">קבוצה בתוך הבורד</label>
              <div className="flex gap-1.5">
                <Select value={groupId} onValueChange={setGroupId} disabled={!boardId || loadingGroups}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingGroups ? "טוען..." : "בחר קבוצה"} />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {groupId && (
                  <Button type="button" variant="outline" size="icon" title="נקה בחירה" onClick={() => setGroupId("")}>
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <Button onClick={handleSave} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? "שומר..." : "שמור"}
      </Button>
    </CostSectionCard>
  );
}
