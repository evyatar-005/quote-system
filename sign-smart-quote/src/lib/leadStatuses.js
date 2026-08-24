// The single source of truth for lead statuses on the CLIENT side.
//
// This is a hand-kept mirror of src/services/crm/leadStatuses.js (the server's
// copy). It cannot import it: that file is CommonJS under src/, outside the
// Vite bundle's reach. Keep the two lists identical — key, label and kind — or
// the UI will show a status the API rejects.
//
// These ARE the monday board's own statuses. The CRM used to keep six generic
// statuses of its own plus a hand-maintained mapping from each board's labels
// onto them; the board's list is now the list, so no translation layer exists.
//
// `kind` is what the board itself cannot tell us and analytics cannot work
// without: open / won / lost. Anything that used to spell out
// ('won','lost','disqualified') asks isClosed() instead, so a new stage later
// is one row here rather than a hunt through a dozen components.
//
// `key` is a stable ASCII slug, never the Hebrew label: it goes into query
// strings and saved filters, and renaming a label on the board must not
// invalidate stored rows.

export const LEAD_STATUSES = [
  { key: 'new',           label: 'ליד חדש',                kind: 'open' },
  { key: 'contact_1',     label: 'ניסיון ליצירת קשר - 1',  kind: 'open' },
  { key: 'contact_2',     label: 'ניסיון ליצירת קשר - 2',  kind: 'open' },
  { key: 'whatsapp_sent', label: 'נשלחה הודעה ווצאפ',      kind: 'open' },
  { key: 'follow_up',     label: 'פולואפ',                 kind: 'open' },
  { key: 'in_sales',      label: 'בתהליך מכירה',           kind: 'open' },
  { key: 'quoted',        label: 'נשלחה הצעת מחיר',        kind: 'open' },
  { key: 'won',           label: 'עסקה נסגרה',             kind: 'won'  },
  { key: 'lost_price',    label: 'לא רלוונטי - מחיר',      kind: 'lost' },
  { key: 'lost_distance', label: 'לא רלוונטי - מרחק',      kind: 'lost' },
  { key: 'lost_other',    label: 'לא רלוונטי - אחר',       kind: 'lost' },
];

export const LEAD_STATUS_KEYS = LEAD_STATUSES.map((s) => s.key);

const keysOfKind = (kind) => LEAD_STATUSES.filter((s) => s.kind === kind).map((s) => s.key);

export const OPEN_KEYS = keysOfKind('open');
export const WON_KEYS = keysOfKind('won');
export const LOST_KEYS = keysOfKind('lost');
// "Finished", either way.
export const CLOSED_KEYS = [...WON_KEYS, ...LOST_KEYS];

export const isClosed = (key) => CLOSED_KEYS.includes(key);
export const isWon = (key) => WON_KEYS.includes(key);
export const isLost = (key) => LOST_KEYS.includes(key);
export const isOpen = (key) => OPEN_KEYS.includes(key);

// Label lookup, as a plain object so existing `STATUS_LABELS[x]` call sites
// keep working unchanged.
export const STATUS_LABELS = Object.fromEntries(LEAD_STATUSES.map((s) => [s.key, s.label]));

export const labelOf = (key) => STATUS_LABELS[key] || key;

// Badge palette. The seven open stages walk one hue ramp — blue for
// "untouched / just reaching out", amber for "we're mid-conversation",
// violet for "the offer is out" — so an agent can read progress by colour
// without reading the words. Won is the app's usual emerald; the three lost
// stages are deliberately muted and near-identical, because *which* flavour
// of lost it was matters in a report, not in a table scan.
export const STATUS_TONE = {
  new:           'bg-blue-50 text-blue-700 border-blue-200',
  contact_1:     'bg-sky-50 text-sky-700 border-sky-200',
  contact_2:     'bg-cyan-50 text-cyan-700 border-cyan-200',
  whatsapp_sent: 'bg-teal-50 text-teal-700 border-teal-200',
  follow_up:     'bg-amber-50 text-amber-700 border-amber-200',
  in_sales:      'bg-orange-50 text-orange-700 border-orange-200',
  quoted:        'bg-violet-50 text-violet-700 border-violet-200',
  won:           'bg-emerald-50 text-emerald-700 border-emerald-200',
  lost_price:    'bg-rose-50 text-rose-600 border-rose-200',
  lost_distance: 'bg-slate-100 text-slate-500 border-slate-200',
  lost_other:    'bg-slate-100 text-slate-500 border-slate-200',
};

export const toneOf = (key) => STATUS_TONE[key] || STATUS_TONE.new;

// Historic values from the six-generic-status era. The server migrated the
// rows once, but a stale bookmark, a saved filter or a cached page can still
// hand us an old key — normalise instead of rendering a blank badge.
export const LEGACY_STATUS_MAP = {
  contacted: 'in_sales',
  lost: 'lost_price',
  disqualified: 'lost_other',
};

export const normalizeStatus = (key) => LEGACY_STATUS_MAP[key] || key;
