import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, RefreshCw, Trash2, Plus, GitMerge, Check, ChevronsUpDown, X } from "lucide-react";
import { toast } from "sonner";
import { listMondayBoards } from "@/api/mondayClient";
import { STATUS_LABELS, STATUS_TONE } from "@/pages/CrmLeads";
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
  // One entry per internal status, each holding a LIST of board labels — a
  // real board spells the same meaning several ways ("לא רלוונטי - מחיר / מרחק /
  // אחר" are all "lost"), and one-label-per-status left every other label
  // unmapped, so those items stayed 'new' forever.
  const [statusMap, setStatusMap] = useState({});
  const [quoteFileCol, setQuoteFileCol] = useState("");
  const [followUpCol, setFollowUpCol] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editColumns, setEditColumns] = useState([]);
  const [editQuoteFileCol, setEditQuoteFileCol] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  // Status and follow-up could only ever be chosen while FIRST mapping a board.
  // Once it was in the list there was no way back in — the only edit button
  // covered the quote-file column — so a board mapped without them stayed
  // permanently unable to push status or pull follow-up dates. All five boards
  // here are in exactly that state. These make an existing map fully editable.
  const [editStatusCol, setEditStatusCol] = useState("");
  const [editStatusMap, setEditStatusMap] = useState({});
  const [editFollowUpCol, setEditFollowUpCol] = useState("");
  const [editPhoneCol, setEditPhoneCol] = useState("");
  const [editEmailCol, setEditEmailCol] = useState("");

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
    setColumns([]); setNameCol(""); setPhoneCol(""); setEmailCol(""); setStatusCol(""); setQuoteFileCol(""); setFollowUpCol("");
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
        column_map: { name: nameCol || undefined, phone: phoneCol || undefined, email: emailCol || undefined, quote_file: quoteFileCol || undefined, follow_up: followUpCol || undefined },
        status_column_id: statusCol || null,
        status_values: serializeStatusValues(statusMap),
      });
      toast.success("הבורד מופה בהצלחה");
      setSelectedBoardId(""); setColumns([]); setQuoteFileCol(""); setStatusMap({});
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
      // statusPulled was computed by the server and then thrown away here, so
      // a pull that updated statuses looked identical to one that did nothing
      // ("0 לידים חדשים") — which is the whole point of the pull side, since
      // the sync is idempotent and re-pulling a known board creates nothing
      // by design. Reported explicitly, including the zero case, so "nothing
      // changed" is a statement rather than an absence.
      const statuses = r.statusPulled ?? 0;
      const parts = [
        `נמשכו ${r.pulled} פריטים`,
        `${r.created} לידים חדשים`,
        `${statuses} סטטוסים עודכנו`,
      ];
      if (r.created === 0 && statuses === 0) {
        // "0 סטטוסים עודכנו" has several different causes and the admin has no
        // way to tell them apart from the outside. The server now reports why,
        // so say it instead of the reassuring-but-useless "הכול כבר מסונכרן".
        let why = "";
        if (!r.hasStatusColumn) {
          why = "לא הוגדרה עמודת סטטוס לבורד";
        } else if (!r.mappedLabelCount) {
          why = "אף תווית לא ממופה";
        } else if (r.unmappedLabels?.length) {
          const top = r.unmappedLabels.map((u) => `״${u.label}״ (${u.count})`).join(", ");
          why = `תוויות שאינן ממופות: ${top}`;
        } else if (r.skippedNotNew) {
          why = `${r.skippedNotNew} לידים כבר לא בסטטוס ״חדש״ — סטטוס מקומי לא נדרס`;
        } else if (r.itemsWithoutLead) {
          why = `${r.itemsWithoutLead} פריטים אינם מקושרים לליד`;
        } else if (!r.itemsWithLabel) {
          why = "לאף פריט אין ערך בעמודת הסטטוס";
        } else {
          why = "הכול כבר מסונכרן";
        }
        toast.success(`${parts.join(", ")} — ${why}`, { duration: 12000 });
      } else {
        toast.success(parts.join(", "));
      }
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

  // Lets an admin add/change the "quote file" column on a board that was
  // already mapped before this field existed, without deleting and
  // recreating the whole mapping.
  const startEdit = async (board) => {
    setEditingId(board.id);
    setEditColumns([]);
    try {
      const { columns } = await mondaySync.fetchColumns(board.board_id);
      setEditColumns(columns);
      const existing = JSON.parse(board.column_map || "{}");
      setEditQuoteFileCol(existing.quote_file || "");
      setEditPhoneCol(existing.phone || "");
      setEditEmailCol(existing.email || "");
      setEditFollowUpCol(existing.follow_up || "");
      setEditStatusCol(board.status_column_id || "");
      let sv = {};
      try { sv = JSON.parse(board.status_values || "{}"); } catch (_) { sv = {}; }
      setEditStatusMap(normalizeStatusValues(sv));
    } catch (err) {
      toast.error(err.message || "טעינת העמודות מהבורד נכשלה");
    }
  };

  const saveEdit = async (board) => {
    setSavingEdit(true);
    try {
      const existing = JSON.parse(board.column_map || "{}");
      // Spread `existing` first so any key this form doesn't expose (name, and
      // anything added later) survives the round-trip instead of being dropped.
      const saved = await mondaySync.updateBoardMap(board.id, {
        column_map: {
          ...existing,
          quote_file: editQuoteFileCol || undefined,
          phone: editPhoneCol || undefined,
          email: editEmailCol || undefined,
          follow_up: editFollowUpCol || undefined,
        },
        status_column_id: editStatusCol || null,
        status_values: serializeStatusValues(editStatusMap),
      });
      // Re-seed the form from the SERVER's response and keep it open, rather
      // than closing and trusting a refetch. Closing on save made a failed or
      // partial write indistinguishable from a successful one: the panel went
      // back to the collapsed row, and re-opening it showed "ללא" again with
      // no way to tell whether the save never landed or was never sent — the
      // exact confusion reported here. Now the values on screen after saving
      // ARE the stored ones.
      const savedMap = (() => { try { return JSON.parse(saved.column_map || "{}"); } catch (_) { return {}; } })();
      const savedStatus = (() => { try { return JSON.parse(saved.status_values || "{}"); } catch (_) { return {}; } })();
      setEditPhoneCol(savedMap.phone || "");
      setEditEmailCol(savedMap.email || "");
      setEditQuoteFileCol(savedMap.quote_file || "");
      setEditFollowUpCol(savedMap.follow_up || "");
      setEditStatusCol(saved.status_column_id || "");
      setEditStatusMap(normalizeStatusValues(savedStatus));
      toast.success("המיפוי נשמר");
      load();
    } catch (err) {
      toast.error(err.message || "העדכון נכשל");
    } finally {
      setSavingEdit(false);
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
          {boardMaps.map((b) => {
            const mappedQuoteFile = JSON.parse(b.column_map || "{}").quote_file;
            // Status push fails SILENTLY when it isn't fully configured:
            // pushBoard() returns early with no status column, and skips any
            // individual status whose monday label is blank — no error, no log
            // row, nothing in the UI. A board can sit for months looking
            // healthy ("נסרק לאחרונה" is green, pulls work fine) while nothing
            // the agents do ever reaches monday. Spelled out here because it is
            // the one part of the sync that cannot report its own failure.
            const statusValues = (() => { try { return JSON.parse(b.status_values || "{}"); } catch (_) { return {}; } })();
            const normalized = normalizeStatusValues(statusValues);
            // Honest counts for the many-to-one model: how many of the six
            // internal statuses carry at least one board label, and how many
            // labels are mapped in total. "3 מתוך 3" meant nothing once a
            // single status can hold a whole list of labels.
            const mappedStatuses = INTERNAL_STATUSES.filter((k) => (normalized[k] || []).length);
            const totalLabels = mappedStatuses.reduce((n, k) => n + normalized[k].length, 0);
            const pushOff = !b.status_column_id || mappedStatuses.length === 0;
            return (
              <div key={b.id} className="border border-black rounded-xl px-3 py-2 text-sm space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{b.board_name || b.board_id}</div>
                    <div className="text-xs text-slate-400">
                      {b.last_polled_at ? `נסרק לאחרונה: ${new Date(b.last_polled_at).toLocaleString("he-IL")}` : "טרם נסרק"}
                      {b.last_error && <span className="text-red-500"> — {b.last_error}</span>}
                      {" · "}
                      {mappedQuoteFile ? <span className="text-emerald-600">קובץ הצעת מחיר ממופה</span> : <span className="text-amber-600">אין מיפוי לקובץ הצעת מחיר</span>}
                    </div>
                    <div className="text-xs mt-0.5">
                      {pushOff ? (
                        <span className="text-red-600 font-medium">
                          ⚠ דחיפת סטטוס ל-monday לא פעילה —{" "}
                          {!b.status_column_id ? "לא נבחרה עמודת סטטוס" : "אף סטטוס לא מופה לתווית בבורד"}.
                          שינויי סטטוס ב-CRM לא יגיעו לבורד.
                        </span>
                      ) : mappedStatuses.length < INTERNAL_STATUSES.length ? (
                        <span className="text-amber-600">
                          מיפוי חלקי — {mappedStatuses.length} מתוך {INTERNAL_STATUSES.length} סטטוסים ממופים
                          ({totalLabels} תוויות בסה"כ). חסר: {INTERNAL_STATUSES.filter((k) => !(normalized[k] || []).length)
                            .map((k) => STATUS_LABELS[k]).join(", ")}
                        </span>
                      ) : (
                        <span className="text-emerald-600">
                          כל {INTERNAL_STATUSES.length} הסטטוסים ממופים ({totalLabels} תוויות בסה"כ)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => pullNow(b.id)} className="gap-1"><RefreshCw className="w-3.5 h-3.5" />משוך</Button>
                    <Button size="sm" variant="outline" onClick={() => pushNow(b.id)} className="gap-1">דחוף סטטוס</Button>
                    <Button size="sm" variant="outline" onClick={() => startEdit(b)}>ערוך מיפוי</Button>
                    <Button size="sm" variant="ghost" onClick={() => removeMap(b.id)}><Trash2 className="w-3.5 h-3.5 text-red-500" /></Button>
                  </div>
                </div>
                {editingId === b.id && (
                  <div className="border-t border-slate-100 pt-3 space-y-3">
                    {editColumns.length === 0 ? (
                      <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                    ) : (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <ColumnPicker label="עמודת טלפון" columns={editColumns} value={editPhoneCol} onChange={setEditPhoneCol} />
                          <ColumnPicker label="עמודת אימייל" columns={editColumns} value={editEmailCol} onChange={setEditEmailCol} />
                          <ColumnPicker label="עמודת קובץ הצעת מחיר" columns={editColumns} value={editQuoteFileCol} onChange={setEditQuoteFileCol} />
                          {/* Pull-side: what fills the lead's follow_up_date, which
                              is what the "פולואפ באיחור" tile counts. Unmapped =
                              the date on the board is never read at all. */}
                          <ColumnPicker label="עמודת תאריך פולואפ" columns={editColumns} value={editFollowUpCol} onChange={setEditFollowUpCol} />
                        </div>

                        <div className="border-t border-slate-100 pt-3 space-y-3">
                          <div className="text-xs font-semibold text-slate-600">
                            דחיפת סטטוס חזרה ל-monday
                          </div>
                          <ColumnPicker label="עמודת הסטטוס בבורד" columns={editColumns} value={editStatusCol} onChange={setEditStatusCol} />
                          {editStatusCol && (
                            <StatusMappingEditor
                              labels={editColumns.find((c) => c.id === editStatusCol)?.labels || []}
                              value={editStatusMap}
                              onChange={setEditStatusMap}
                            />
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => saveEdit(b)} disabled={savingEdit}>
                            {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : "שמור"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>ביטול</Button>
                          <span className="text-[11px] text-muted-foreground">
                            תאריכי פולואפ קיימים ייכנסו במשיכה הבאה — אפשר ללחוץ ״משוך״ מיד אחרי השמירה.
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-3 border-t border-slate-200 pt-4">
        <div className="text-sm font-semibold text-slate-600">מיפוי בורד חדש</div>
        <BoardCombobox boards={mondayBoards} value={selectedBoardId} onChange={onBoardSelect} />

        {loadingColumns && <Loader2 className="w-5 h-5 animate-spin text-slate-400" />}

        {!!columns.length && (
          <>
            {/* Full column dump — table view, exactly as the board defines them,
                so nothing needs to be guessed before mapping the fields below. */}
            <div className="border border-black rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-right px-2 py-1.5 font-semibold text-slate-600">עמודה</th>
                    <th className="text-right px-2 py-1.5 font-semibold text-slate-600">סוג</th>
                    <th className="text-right px-2 py-1.5 font-semibold text-slate-600">ערכים אפשריים</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {columns.map((c) => (
                    <tr key={c.id}>
                      <td className="px-2 py-1.5">{c.title}</td>
                      <td className="px-2 py-1.5 text-slate-400">{c.type}</td>
                      <td className="px-2 py-1.5 text-slate-500">{c.labels?.length ? c.labels.join(", ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ColumnPicker label="עמודת שם" columns={columns} value={nameCol} onChange={setNameCol} />
            <ColumnPicker label="עמודת טלפון" columns={columns} value={phoneCol} onChange={setPhoneCol} />
            <ColumnPicker label="עמודת אימייל" columns={columns} value={emailCol} onChange={setEmailCol} />
            <ColumnPicker label="עמודת קובץ הצעת מחיר (לדחיפה חזרה)" columns={columns} value={quoteFileCol} onChange={setQuoteFileCol} />
            <ColumnPicker label="עמודת תאריך פולואפ" columns={columns} value={followUpCol} onChange={setFollowUpCol} />
            <ColumnPicker
              label="עמודת סטטוס (לדחיפה חזרה)"
              columns={columns}
              value={statusCol}
              onChange={(v) => { setStatusCol(v); setStatusMap({}); }}
            />
            {statusCol && (
              <div className="sm:col-span-2">
                <StatusMappingEditor
                  labels={columns.find((c) => c.id === statusCol)?.labels || []}
                  value={statusMap}
                  onChange={setStatusMap}
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <Button onClick={createMap} disabled={creating} className="gap-2">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                מפה בורד זה
              </Button>
            </div>
            </div>
          </>
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

// --- Status mapping: MANY board labels -> ONE internal status ----------------

// The CRM's own six statuses, in pipeline order, so the editor reads like the
// funnel top-down instead of in whatever order the saved JSON happens to be.
const INTERNAL_STATUSES = ["new", "contacted", "quoted", "won", "lost", "disqualified"];

// Saved data comes in two shapes: the legacy single string ("עסקה נסגרה") and
// the current array. Everything else here works in arrays only, so this is the
// single place the legacy shape is tolerated — reading is lenient, saving
// (serializeStatusValues) always writes arrays.
function normalizeStatusValues(raw) {
  const out = {};
  for (const [internal, value] of Object.entries(raw || {})) {
    const list = (Array.isArray(value) ? value : [value])
      .map((l) => (l == null ? "" : String(l).trim()))
      .filter(Boolean);
    if (list.length) out[internal] = Array.from(new Set(list));
  }
  return out;
}

// Statuses with no labels are omitted entirely rather than sent as empty
// arrays — the backend already treats "absent" as unmapped, and an empty array
// would only be a second way of spelling the same thing.
function serializeStatusValues(map) {
  const out = {};
  for (const k of INTERNAL_STATUSES) {
    const list = (map && map[k]) || [];
    if (list.length) out[k] = list;
  }
  return out;
}

// One row per internal status: its coloured CRM badge plus a chip list of every
// board label that should map onto it. Same add/remove interaction as
// RecipientsEditor (Enter or the + button adds, X removes), with clickable
// suggestions drawn from the status column's real label bank when monday gave
// us one (fetchColumns returns `labels` per column).
function StatusMappingEditor({ labels, value, onChange }) {
  const map = value || {};
  // A board label may only mean ONE thing, so anything already used elsewhere
  // is hidden from the other rows' suggestions — mapping the same label twice
  // would make the pull direction depend on Map insertion order.
  const used = new Set(INTERNAL_STATUSES.flatMap((k) => map[k] || []));

  const setFor = (internal, list) => onChange({ ...map, [internal]: list });
  const add = (internal, label) => {
    const clean = (label || "").trim();
    if (!clean || used.has(clean)) return;
    setFor(internal, [...(map[internal] || []), clean]);
  };
  const remove = (internal, label) =>
    setFor(internal, (map[internal] || []).filter((l) => l !== label));

  return (
    <div className="space-y-2" dir="rtl">
      <div className="text-xs text-slate-500">
        לכל סטטוס פנימי אפשר לשייך כמה תוויות מהבורד. במשיכה — כל אחת מהן תזוהה כסטטוס הזה.
        בדחיפה חזרה ל-monday נכתבת <b>התווית הראשונה</b> בלבד (מסומנת ב-★).
      </div>
      {!labels.length && (
        <div className="text-xs text-amber-600">
          לעמודה זו אין רשימת תוויות מוכנה — יש להקליד את שם התווית ידנית, בדיוק כפי שהיא מופיעה בבורד.
        </div>
      )}
      {INTERNAL_STATUSES.map((internal) => (
        <StatusMappingRow
          key={internal}
          internal={internal}
          chips={map[internal] || []}
          suggestions={labels.filter((l) => !used.has(l))}
          onAdd={(l) => add(internal, l)}
          onRemove={(l) => remove(internal, l)}
        />
      ))}
    </div>
  );
}

function StatusMappingRow({ internal, chips, suggestions, onAdd, onRemove }) {
  const [input, setInput] = useState("");
  // Reuses CrmLeads' palette so a status looks identical here and in the leads
  // table — the mapping is meant to be scannable by colour.
  const tone = STATUS_TONE[internal] || STATUS_TONE.new;
  const submit = () => { onAdd(input); setInput(""); };

  return (
    <div className="border border-slate-200 rounded-xl p-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[11px] px-2 py-0.5 rounded-full border shrink-0 ${tone}`}>
          {STATUS_LABELS[internal] || internal}
        </span>
        {chips.length === 0 ? (
          <span className="text-[11px] text-slate-400">לא ממופה</span>
        ) : (
          chips.map((label, i) => (
            <span
              key={label}
              className={`flex items-center gap-1.5 text-xs rounded-full border pr-2 pl-1 py-0.5 ${tone}`}
            >
              {/* The first chip is the one pushed back to monday, so the
                  canonical spelling is visible without reading the note. */}
              {i === 0 && <span title="התווית שתיכתב חזרה ל-monday">★</span>}
              {label}
              <button
                type="button"
                onClick={() => onRemove(label)}
                className="p-0.5 rounded-full hover:bg-black/10"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <Input
          dir="rtl"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder="שם התווית בבורד"
          className="flex-1 h-8 text-xs"
        />
        <Button type="button" size="sm" variant="outline" onClick={submit} className="gap-1 shrink-0">
          <Plus className="w-3.5 h-3.5" /> הוסף
        </Button>
      </div>
      {!!suggestions.length && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => onAdd(l)}
              className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50"
            >
              + {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
