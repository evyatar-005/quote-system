// The single source of truth for lead statuses, on the server side.
//
// These ARE the monday board's own statuses. Before this, the CRM had six
// generic statuses of its own and every board needed a hand-maintained
// mapping from its labels onto them — which is how thousands of leads ended
// up stuck at 'new' (an unmapped label silently meant "no status"), and how a
// board using several wordings for the same thing became impossible to
// express. Adopting the board's list removes the translation layer entirely:
// the label on the board and the status here are the same thing.
//
// `kind` is the one piece the board cannot tell us and the analytics cannot
// work without: whether a status means the deal is still open, was won, or was
// lost. Everything that used to test `status IN ('won','lost','disqualified')`
// now asks this table instead, so adding a stage later is one row here rather
// than a hunt through 11 files.
//
// `key` is a stable ASCII slug, never the Hebrew label: it goes into SQL, into
// URLs and into saved filters, and a label the business renames on the board
// must not invalidate stored rows.

const LEAD_STATUSES = [
  { key: 'new',           label: 'ליד חדש',                  kind: 'open', order: 10 },
  { key: 'contact_1',     label: 'ניסיון ליצירת קשר - 1',    kind: 'open', order: 20 },
  { key: 'contact_2',     label: 'ניסיון ליצירת קשר - 2',    kind: 'open', order: 30 },
  { key: 'whatsapp_sent', label: 'נשלחה הודעה ווצאפ',        kind: 'open', order: 40 },
  { key: 'follow_up',     label: 'פולואפ',                    kind: 'open', order: 50 },
  { key: 'in_sales',      label: 'בתהליך מכירה',              kind: 'open', order: 60 },
  { key: 'quoted',        label: 'נשלחה הצעת מחיר',           kind: 'open', order: 70 },
  { key: 'won',           label: 'עסקה נסגרה',                kind: 'won',  order: 80 },
  { key: 'lost_price',    label: 'לא רלוונטי - מחיר',         kind: 'lost', order: 90 },
  { key: 'lost_distance', label: 'לא רלוונטי - מרחק',         kind: 'lost', order: 100 },
  { key: 'lost_other',    label: 'לא רלוונטי - אחר',          kind: 'lost', order: 110 },
];

const BY_KEY = new Map(LEAD_STATUSES.map((s) => [s.key, s]));
const BY_LABEL = new Map(LEAD_STATUSES.map((s) => [s.label, s]));

const keysOfKind = (kind) => LEAD_STATUSES.filter((s) => s.kind === kind).map((s) => s.key);

const OPEN_KEYS = keysOfKind('open');
const WON_KEYS = keysOfKind('won');
const LOST_KEYS = keysOfKind('lost');
// "Finished", either way — the set that used to be spelled out as
// ('won','lost','disqualified') at 25 different call sites.
const CLOSED_KEYS = [...WON_KEYS, ...LOST_KEYS];

// Ready-made SQL fragments. Built from the list above so a new status can
// never be added to the app without every query already knowing about it.
const sqlList = (keys) => keys.map((k) => `'${k}'`).join(',');
const CLOSED_SQL = sqlList(CLOSED_KEYS);
const OPEN_SQL = sqlList(OPEN_KEYS);
const WON_SQL = sqlList(WON_KEYS);
const LOST_SQL = sqlList(LOST_KEYS);

const isClosed = (key) => CLOSED_KEYS.includes(key);
const isWon = (key) => WON_KEYS.includes(key);
const labelOf = (key) => (BY_KEY.get(key) || {}).label || key;
// Pull direction: a board label maps straight onto a status now, no
// configuration involved. Kept tolerant of stray whitespace because the value
// comes from free text someone typed on a board.
const statusForLabel = (label) => {
  const hit = BY_LABEL.get((label || '').toString().trim());
  return hit ? hit.key : null;
};

// Historic values, from when the CRM had its own six generic statuses. Applied
// once by the migration in server.js. 'contacted' becomes בתהליך מכירה because
// that was the label the old mapping pushed back to monday for it, and the two
// therefore already meant the same thing in practice.
const LEGACY_STATUS_MAP = {
  contacted: 'in_sales',
  lost: 'lost_price',
  disqualified: 'lost_other',
};

module.exports = {
  LEAD_STATUSES, BY_KEY, OPEN_KEYS, WON_KEYS, LOST_KEYS, CLOSED_KEYS,
  CLOSED_SQL, OPEN_SQL, WON_SQL, LOST_SQL,
  isClosed, isWon, labelOf, statusForLabel, LEGACY_STATUS_MAP,
};
