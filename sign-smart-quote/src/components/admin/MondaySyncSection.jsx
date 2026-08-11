import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, RefreshCw, Trash2, Plus, GitMerge, Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { listMondayBoards } from "@/api/mondayClient";
import { mondaySync, crmSettings } from "@/api/mondaySyncClient";
import CostSectionCard from "./CostSectionCard";

// CRM Phase 2 admin UI — map monday.com boards (one per campaign) to the CRM
// lead pipeline: pull column mapping (name/phone/email) + push status column
// (which internal lead status writes which label back to the board).
export default function MondaySyncSection() {
  const [loading, setLoading] = useState(true);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [boardMaps, setBoardMaps] = useState([]);
  const [mondayBoards, setMondayBoards] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [columns, setColumns] = useState([]);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [nameCol, setNameCol] = useState("");
  const [phoneCol, setPhoneCol] = useState("");
  const [emailCol, setEmailCol] = useState("");
  const [statusCol, setStatusCol] = useState("");
  const [statusWon, setStatusWon] = useState("");
  const [statusLost, setStatusLost] = useState("");
  const [statusQuoted, setStatusQuoted] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [settings, boards] = await Promise.all([crmSettings.get(), mondaySync.listBoards()]);
      setPollEnabled(!!settings?.monday_poll_enabled);
      setBoardMaps(boards);
      try { setMondayBoards(await listMondayBoards()); } catch { /* monday.com not configured yet */ }
    } catch (err) {
      toast.error(err.message || "טעינת הגדרות הסנכרון נכשלה");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const togglePoll = async (value) => {
    setSavingSettings(true);
    setPollEnabled(value);
    try {
      await crmSettings.update({ monday_poll_enabled: value ? 1 : 0 });
      toast.success(value ? "סנכרון אוטומטי הופעל" : "סנכרון אוטומטי כובה");
    } catch (err) {
      toast.error(err.message || "העדכון נכשל");
      setPollEnabled(!value);
    } finally {
      setSavingSettings(false);
    }
  };

  const onBoardSelect = async (boardId) => {
    setSelectedBoardId(boardId);
    setColumns([]); setNameCol(""); setPhoneCol(""); setEmailCol(""); setStatusCol("");
    if (!boardId) return;
    setLoadingColumns(true);
    try {
      const { columns } = await mondaySync.fetchColumns(boardId);
      setColumns(columns);
    } catch (err) {
      toast.error(err.message || "טעינת העמודות מהבורד נכשלה");
    } finally {
      setLoadingColumns(false);
    }
  };

  const createMap = async () => {
    if (!selectedBoardId) return;
    setCreating(true);
    try {
      const boardName = mondayBoards.find((b) => b.id === selectedBoardId)?.name || "";
      await mondaySync.createBoardMap({
        board_id: selectedBoardId,
        board_name: boardName,
        column_map: { name: nameCol || undefined, phone: phoneCol || undefined, email: emailCol || undefined },
        status_column_id: statusCol || null,
        status_values: { won: statusWon || undefined, lost: statusLost || undefined, quoted: statusQuoted || undefined },
      });
      toast.success("הבורד מופה בהצלחה");
      setSelectedBoardId(""); setColumns([]);
      load();
    } catch (err) {
      toast.error(err.message || "מיפוי הבורד נכשל");
    } finally {
      setCreating(false);
    }
  };

  const pullNow = async (id) => {
    try {
      const r = await mondaySync.pullNow(id);
      toast.success(`נמשכו ${r.pulled} פריטים, ${r.created} לידים חדשים`);
      load();
    } catch (err) {
      toast.error(err.message || "המשיכה נכשלה");
    }
  };

  const pushNow = async (id) => {
    try {
      const r = await mondaySync.pushNow(id);
      toast.success(`נדחפו ${r.pushed} עדכוני סטטוס`);
    } catch (err) {
      toast.error(err.message || "הדחיפה נכשלה");
    }
  };

  const removeMap = async (id) => {
    try {
      await mondaySync.deleteBoardMap(id);
      toast.success("המיפוי הוסר");
      load();
    } catch (err) {
      toast.error(err.message || "ההסרה נכשלה");
    }
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
      icon={<GitMerge className="w-5 h-5" />}
      title="סנכרון לידים מ-monday.com"
      description="משיכת לידים מבורדי קמפיינים לתוך ה-CRM, ודחיפת סטטוס (זכה/אבד) חזרה לבורד"
      defaultOpen
    >
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <div className="text-sm font-semibold text-slate-600">סנכרון אוטומטי</div>
          <p className="text-xs text-muted-foreground">כאשר כבוי, אפשר עדיין למשוך/לדחוף ידנית לכל בורד ממופה</p>
        </div>
        <Switch checked={pollEnabled} onCheckedChange={togglePoll} disabled={savingSettings} />
      </div>

      {boardMaps.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-slate-600">בורדים ממופים</div>
          {boardMaps.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 border border-black rounded-xl px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium truncate">{b.board_name || b.board_id}</div>
                <div className="text-xs text-slate-400">
                  {b.last_polled_at ? `נסרק לאחרונה: ${new Date(b.last_polled_at).toLocaleString("he-IL")}` : "טרם נסרק"}
                  {b.last_error && <span className="text-red-500"> — {b.last_error}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" variant="outline" onClick={() => pullNow(b.id)} className="gap-1"><RefreshCw className="w-3.5 h-3.5" />משוך</Button>
                <Button size="sm" variant="outline" onClick={() => pushNow(b.id)} className="gap-1">דחוף סטטוס</Button>
                <Button size="sm" variant="ghost" onClick={() => removeMap(b.id)}><Trash2 className="w-3.5 h-3.5 text-red-500" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 border-t border-slate-200 pt-4">
        <div className="text-sm font-semibold text-slate-600">מיפוי בורד חדש</div>
        <BoardCombobox boards={mondayBoards} value={selectedBoardId} onChange={onBoardSelect} />

        {loadingColumns && <Loader2 className="w-5 h-5 animate-spin text-slate-400" />}

        {!!columns.length && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ColumnPicker label="עמודת שם" columns={columns} value={nameCol} onChange={setNameCol} />
            <ColumnPicker label="עמודת טלפון" columns={columns} value={phoneCol} onChange={setPhoneCol} />
            <ColumnPicker label="עמודת אימייל" columns={columns} value={emailCol} onChange={setEmailCol} />
            <ColumnPicker label="עמודת סטטוס (לדחיפה חזרה)" columns={columns} value={statusCol} onChange={setStatusCol} />
            {statusCol && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500">ערך הסטטוס עבור "זכינו"</label>
                  <Input dir="rtl" value={statusWon} onChange={(e) => setStatusWon(e.target.value)} placeholder="למשל: זכה" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500">ערך הסטטוס עבור "אבדנו"</label>
                  <Input dir="rtl" value={statusLost} onChange={(e) => setStatusLost(e.target.value)} placeholder="למשל: אבד" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500">ערך הסטטוס עבור "נשלחה הצעה"</label>
                  <Input dir="rtl" value={statusQuoted} onChange={(e) => setStatusQuoted(e.target.value)} placeholder="למשל: נשלחה הצעה" />
                </div>
              </>
            )}
            <div className="sm:col-span-2">
              <Button onClick={createMap} disabled={creating} className="gap-2">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                מפה בורד זה
              </Button>
            </div>
          </div>
        )}
      </div>
    </CostSectionCard>
  );
}

// Searchable board picker — a plain <Select> is unusable once an account has
// dozens/hundreds of boards, so this is a Popover+Command combobox (same
// primitives as shadcn's standard combobox recipe) instead.
function BoardCombobox({ boards, value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = boards.find((b) => b.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          {selected ? selected.name : "בחר בורד מ-monday.com..."}
          <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="חפש בורד לפי שם..." />
          <CommandList>
            <CommandEmpty>לא נמצא בורד</CommandEmpty>
            <CommandGroup>
              {boards.map((b) => (
                <CommandItem
                  key={b.id}
                  value={b.name}
                  onSelect={() => { onChange(b.id); setOpen(false); }}
                >
                  <Check className={`w-4 h-4 ${value === b.id ? "opacity-100" : "opacity-0"}`} />
                  {b.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ColumnPicker({ label, columns, value, onChange }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-slate-500">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="ללא" /></SelectTrigger>
        <SelectContent>
          {columns.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
