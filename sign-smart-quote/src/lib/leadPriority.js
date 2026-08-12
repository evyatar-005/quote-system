// Turns the flat my_leads array from GET /api/crm/my-day into an ordered work
// queue. Every lead lands in exactly one bucket; the bucket decides where it
// sits on the screen, what the badge says, and what the row's primary CTA is.
// Pure + synchronous so MyDay can re-rank on every 60s refresh for free.

const HOUR = 3600 * 1000;
const STALE_HOURS = 48;

// Order here IS the on-screen order.
export const BUCKETS = {
  overdue_followup: { group: "now", tone: "red" },
  unread: { group: "now", tone: "amber" },
  due_today: { group: "today", tone: "amber" },
  never_contacted: { group: "today", tone: "blue" },
  stale: { group: "waiting", tone: "slate" },
  waiting_quote: { group: "waiting", tone: "slate" },
  scheduled: { group: "waiting", tone: "slate" },
};

const BUCKET_ORDER = Object.keys(BUCKETS);

export const GROUPS = [
  { key: "now", title: "דורש טיפול עכשיו" },
  { key: "today", title: "היום" },
  { key: "waiting", title: "בהמתנה" },
];

// SQLite hands back 'YYYY-MM-DD HH:MM:SS' with no zone marker. Timestamps
// written by CURRENT_TIMESTAMP are UTC, while follow_up_date is entered by the
// agent as Israel wall-clock (see the datetime('now','localtime') comparison in
// routes/myDay.js) — so the two are parsed differently on purpose.
function parseUtc(s) {
  if (!s) return null;
  const d = new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
  return isNaN(d) ? null : d;
}

function parseLocal(s) {
  if (!s) return null;
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  return isNaN(d) ? null : d;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function relativeTime(iso, now = new Date()) {
  const d = parseUtc(iso);
  if (!d) return "";
  const mins = Math.round((now - d) / 60000);
  if (mins < 1) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.round(hours / 24);
  return days === 1 ? "אתמול" : `לפני ${days} ימים`;
}

function hhmm(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function ddmm(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Live countdown to a scheduled follow-up, for the rail's per-lead timer.
// Returns null when there's nothing to count down to. `urgent` marks the last
// hour — the window where the agent should stop what they're doing.
export function followUpCountdown(lead, now = new Date()) {
  const due = parseLocal(lead.follow_up_date);
  if (!due) return null;
  const secs = Math.round((due - now) / 1000);
  if (secs <= 0) return { text: "עכשיו", urgent: true, overdue: true };
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return { text: `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`, urgent: true };
  }
  const hours = Math.round(secs / 3600);
  if (hours < 24) return { text: `בעוד ${hours} שעות`, urgent: false };
  const days = Math.round(hours / 24);
  return { text: days === 1 ? "מחר" : `בעוד ${days} ימים`, urgent: false };
}

function classify(lead, now) {
  const followUp = parseLocal(lead.follow_up_date);
  const lastMessage = parseUtc(lead.last_message_at);

  if (followUp && followUp <= now) {
    return { bucket: "overdue_followup", badge: `פולואפ באיחור · ${ddmm(followUp)} ${hhmm(followUp)}`, action: "חזור ללקוח" };
  }
  if (lead.unread_count > 0) {
    return { bucket: "unread", badge: `הלקוח ענה · ${lead.unread_count}`, action: "השב" };
  }
  if (followUp && isSameDay(followUp, now)) {
    return { bucket: "due_today", badge: `פולואפ היום ${hhmm(followUp)}`, action: "חזור ללקוח" };
  }
  if (!lead.last_outbound_at) {
    return { bucket: "never_contacted", badge: "טרם יצרת קשר", action: "צור קשר" };
  }
  if (lead.quote_id) {
    return { bucket: "waiting_quote", badge: "ממתין להחלטת לקוח", action: "בדוק סטטוס" };
  }
  if (lastMessage && now - lastMessage > STALE_HOURS * HOUR) {
    const days = Math.round((now - lastMessage) / (24 * HOUR));
    return { bucket: "stale", badge: `ללא מענה ${days} ימים`, action: "תזכורת" };
  }
  if (followUp) {
    return { bucket: "scheduled", badge: `פולואפ ב-${ddmm(followUp)}`, action: "פתח" };
  }
  return { bucket: "scheduled", badge: "בטיפול", action: "פתח" };
}

// Returns leads enriched with { bucket, tone, group, badge, action } and sorted
// by bucket priority, then oldest-waiting first inside each bucket.
export function rankLeads(leads = [], now = new Date()) {
  return leads
    .map((lead) => {
      const { bucket, badge, action } = classify(lead, now);
      return { ...lead, bucket, badge, action, tone: BUCKETS[bucket].tone, group: BUCKETS[bucket].group };
    })
    .sort((a, b) => {
      const byBucket = BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket);
      if (byBucket !== 0) return byBucket;
      const at = parseUtc(a.last_message_at) || parseUtc(a.claimed_at) || 0;
      const bt = parseUtc(b.last_message_at) || parseUtc(b.claimed_at) || 0;
      return at - bt;
    });
}

// Groups the ranked list for rendering; empty groups are dropped.
export function groupRanked(ranked) {
  return GROUPS
    .map((g) => ({ ...g, leads: ranked.filter((l) => l.group === g.key) }))
    .filter((g) => g.leads.length > 0);
}
