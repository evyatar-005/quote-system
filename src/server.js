const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const Database  = require('better-sqlite3');
const { seedSignshop } = require('./db/seed-signshop');
const { seedProduction } = require('./db/seed-production');
const registerAuth     = require('./routes/auth');
const registerEntities = require('./routes/entities');
const registerNotifications = require('./routes/notifications');
const registerMorning  = require('./routes/morning');
const registerUpdate   = require('./routes/update');
const registerGreenApi = require('./routes/greenapi');
const registerMonday   = require('./routes/monday');
const registerAttachments = require('./routes/attachments');
const registerSmtp     = require('./routes/smtp');
const registerCutFile  = require('./routes/cutfile');
const registerProduction = require('./routes/production');
const registerReports  = require('./routes/reports');
const registerCrm      = require('./routes/crm');
const registerMondaySync = require('./routes/mondaySync');
const registerInbox    = require('./routes/inbox');
const registerWhatsapp  = require('./routes/whatsapp');
const registerCampaigns = require('./routes/campaigns');
const registerMyDay    = require('./routes/myDay');
const registerLeadQueue = require('./routes/leadQueue');
const registerDrive     = require('./routes/drive');
const { startCrmJobs } = require('./services/crm/jobs');
const { startReportScheduler } = require('./services/reports/scheduledReports');
const deliveryNotesReport = require('./services/reports/deliveryNotesReport');
const salesReport = require('./services/reports/salesReport');

const PORT    = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, '../database.sqlite');

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
console.log('[db] Connected to', DB_PATH);

// One-time: crm_campaign_spend went from monthly to daily granularity before
// any real spend had been entered (see CLAUDE.md CRM analytics plan) — a
// plain column rename, no data to reshape. Must run BEFORE schema.sql below,
// since schema.sql's CREATE INDEX ... (day) fails if the table still exists
// with the old `month` column. No-ops if the table doesn't exist yet or is
// already renamed.
try { db.exec(`ALTER TABLE crm_campaign_spend RENAME COLUMN month TO day`); } catch (_) {}

// Ensure SignCalc Pro tables exist (all IF NOT EXISTS — safe on a live DB) and
// seed placeholders only when empty. Never wipes existing data.
db.exec(fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8'));

// report_schedules was created (via schema.sql's IF NOT EXISTS) before these
// columns existed on any DB that already booted once during this feature's
// development — bolt them on the same defensive way as every other
// incrementally-added column in this file.
for (const col of [
  'ALTER TABLE report_schedules ADD COLUMN last_sent_at TEXT',
  'ALTER TABLE report_schedules ADD COLUMN last_run_status TEXT',
  'ALTER TABLE report_schedules ADD COLUMN last_run_error TEXT',
]) {
  try { db.exec(col); } catch (_) {}
}

// One-time migration: v1 of scheduled reports (scheduled_reports, one row per
// report_type) → v2 (report_schedules, many rows per report_type). Only runs
// if there's old data AND nothing has been migrated yet, so it's safe to run
// on every boot without duplicating rows.
try {
  const oldRows = db.prepare(`SELECT * FROM scheduled_reports`).all();
  const alreadyMigrated = db.prepare(`SELECT COUNT(*) c FROM report_schedules`).get().c > 0;
  if (oldRows.length && !alreadyMigrated) {
    const insert = db.prepare(
      `INSERT INTO report_schedules (report_type, enabled, recipients, frequency, time, weekday, day_of_month)
       VALUES (@report_type, @enabled, @recipients, @frequency, @time, @weekday, @day_of_month)`
    );
    for (const row of oldRows) insert.run(row);
    console.log(`[db] migrated ${oldRows.length} scheduled_reports row(s) into report_schedules`);
  }
} catch (err) {
  console.error('[db] scheduled_reports -> report_schedules migration failed:', err.message);
}
seedSignshop(db);
seedProduction(db);

// Add Base44 Quote columns to signshop_quotes if they don't exist yet.
for (const col of [
  'ALTER TABLE signshop_quotes ADD COLUMN payment_type TEXT',
  'ALTER TABLE signshop_quotes ADD COLUMN created_by   TEXT',
  'ALTER TABLE signshop_quotes ADD COLUMN parent_quote_number TEXT',
  // Set the first time a manager opens this quote's detail view (QuoteDetailsModal) —
  // lets the quotes-history screen filter to "not yet opened" rows. NULL = never opened.
  'ALTER TABLE signshop_quotes ADD COLUMN viewed_at TEXT',
  // Free-text background the agent writes when sending a quote for review — separate
  // from `notes` (the document title shown on the quote itself), and shown only to
  // the manager in QuotesHistory/QuoteDetailsModal, never on the client-facing document.
  'ALTER TABLE signshop_quotes ADD COLUMN agent_note TEXT',
  // Required going forward (enforced in routes/entities.js quoteCreate) — needed
  // to auto-send the issued Morning document to the client over WhatsApp.
  'ALTER TABLE signshop_quotes ADD COLUMN client_phone TEXT',
  // Optional — auto-filled when a client is picked from the Morning client
  // search, sent on to Morning when a new client gets created from this quote.
  'ALTER TABLE signshop_quotes ADD COLUMN client_address TEXT',
  // Optional — business ID (ח.פ / עוסק מורשה) and email, sent on to Morning
  // as taxId / emails so the saved client record there is complete.
  'ALTER TABLE signshop_quotes ADD COLUMN client_vat_id TEXT',
  'ALTER TABLE signshop_quotes ADD COLUMN client_email TEXT',
  // Full calculator state snapshot (items/formDataMap/itemLabels/client
  // fields) so "שכפל" (My Quotes tab) can reopen a saved quote in the
  // calculator for editing. Separate from calculation_data, which is a
  // write-mostly pricing/margin summary consumed by QuoteDetailsModal —
  // NULL on quotes saved before this existed (duplicate falls back to
  // client-fields-only prefill for those).
  'ALTER TABLE signshop_quotes ADD COLUMN builder_state TEXT',
  // 'new' | 'duplicate' | 'manager_discount' — see schema.sql. Deliberately
  // added WITHOUT a default: SQLite backfills a DEFAULT into every existing
  // row, which would stamp old duplicates and manager revisions as 'new' and
  // destroy the very information the backfill below reconstructs from
  // parent_quote_number + the notes text.
  'ALTER TABLE signshop_quotes ADD COLUMN origin TEXT',
]) {
  try { db.exec(col); } catch (_) {}
}

// One-time backfill of `origin` for quotes saved before the column existed.
// A manager revision is the only flow that writes a "תיקון להצעה …" note, so
// that separates the two parented kinds; everything else is an original.
try {
  db.exec(`
    UPDATE signshop_quotes SET origin = 'manager_discount'
     WHERE origin IS NULL AND parent_quote_number IS NOT NULL AND notes LIKE 'תיקון להצעה%';
    UPDATE signshop_quotes SET origin = 'duplicate'
     WHERE origin IS NULL AND parent_quote_number IS NOT NULL;
    UPDATE signshop_quotes SET origin = 'new' WHERE origin IS NULL;
  `);
} catch (err) {
  console.error('[db] signshop_quotes.origin backfill failed:', err.message);
}

// Stores the Morning-returned PDF download link at document-creation time, so
// QuotesHistory can show/open it without an extra Morning API round-trip.
for (const col of [
  'ALTER TABLE morning_documents_map ADD COLUMN document_url TEXT',
]) {
  try { db.exec(col); } catch (_) {}
}


// Payment-webhook signing secret + structured notification payload — both
// added after morning_credentials/notifications already shipped, so existing
// DBs need the column added explicitly (schema.sql's CREATE TABLE IF NOT
// EXISTS only applies to a brand-new table).
try { db.exec('ALTER TABLE morning_credentials ADD COLUMN webhook_secret TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE notifications ADD COLUMN payload_json TEXT'); } catch (_) {}

// Add stand/mechanism cost column to roll-up tiers if it doesn't exist yet.
try { db.exec('ALTER TABLE signshop_rollup_tiers ADD COLUMN stand_cost REAL NOT NULL DEFAULT 0'); } catch (_) {}

// Add per-tier minimum price to lokobond area tiers if it doesn't exist yet —
// area-based pricing (0.1×0.1 מ' etc.) would otherwise price near-zero.
try { db.exec('ALTER TABLE signshop_lokobond_area_tiers ADD COLUMN min_price REAL NOT NULL DEFAULT 0'); } catch (_) {}

// Add agent-adjustable price-range floor (per m²) to lokobond/foamex/logo tiers —
// lets a sales agent discount down to this price without going below it. 0 = no range.
try { db.exec('ALTER TABLE signshop_price_tiers ADD COLUMN agent_min_price_per_sqm REAL NOT NULL DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE signshop_lokobond_area_tiers ADD COLUMN agent_min_price_per_sqm REAL NOT NULL DEFAULT 0'); } catch (_) {}

// Forces a password change on next login — set for the two seeded demo accounts
// (see routes/auth.js seedUsers) and for any account an admin creates/resets, so a
// leaked/guessed default password can't be used past the first real login.
try { db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0'); } catch (_) {}

// Start of a granular, per-user permission model (independent of the coarse
// agent/admin/operations role) — first slice: who may see cost/price/profit
// breakdowns (QuoteDetailsModal, "הצג מרכיבי עלות"). Existing admins are
// grandfathered in once, on the ALTER itself, so nobody who already had
// access loses it; new users default to 0 and an admin grants it explicitly
// from "ניהול משתמשים".
try {
  db.exec('ALTER TABLE users ADD COLUMN can_view_costs INTEGER NOT NULL DEFAULT 0');
  db.prepare(`UPDATE users SET can_view_costs = 1 WHERE role = 'admin'`).run();
} catch (_) {}

// Login moved from username to email, which means email must be unique.
// Normalize first (trim + lowercase, matching auth.js on every write from now
// on) so a case-only difference like Evyatar@x.com / evyatar@x.com doesn't
// slip past the check below, then only create the UNIQUE index if that leaves
// no collisions. Skipping instead of throwing on a dirty production DB is the
// difference between "email login is ambiguous until an admin fixes the data"
// and "the server never comes back up."
try {
  db.exec(`UPDATE users SET email = TRIM(LOWER(email)) WHERE email IS NOT NULL AND email != TRIM(LOWER(email))`);
  const dupes = db.prepare(
    `SELECT email, COUNT(*) AS n FROM users WHERE email IS NOT NULL AND email != '' GROUP BY email HAVING n > 1`
  ).all();
  if (dupes.length) {
    console.error('[startup] users.email has duplicates — email login will be ambiguous until fixed by an admin:');
    for (const d of dupes) console.error(`  "${d.email}" used by ${d.n} accounts`);
  } else {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL AND email != ''`);
  }
} catch (err) {
  console.error('[startup] email-uniqueness migration failed (continuing anyway):', err.message);
}

// ─── CRM (Phase 1) ────────────────────────────────────────────────────────
// customer_id/lead_id link signshop_quotes to the new CRM tables. Nullable
// and unreferenced by any existing code path: quoteCreate/quoteUpdate derive
// their column list from PRAGMA table_info, so these two columns are simply
// never present in a plain quote save's body — only CRM code writes them.
for (const col of [
  'ALTER TABLE signshop_quotes ADD COLUMN customer_id INTEGER',
  'ALTER TABLE signshop_quotes ADD COLUMN lead_id INTEGER',
]) {
  try { db.exec(col); } catch (_) {}
}

// Backfill customers from the quote history, then only create the partial
// UNIQUE index on phone_e164 if that backfill left no collisions — same
// defensive pattern as idx_users_email_unique above.
try {
  const { backfillCustomers } = require('./services/crm/backfill');
  const result = backfillCustomers(db);
  console.log(`[crm] customers: ${result.total} row(s) (${result.created} created this run, ${result.linked} quotes linked)`);
} catch (err) {
  console.error('[crm] customer backfill failed (continuing anyway):', err.message);
}
try {
  const dupes = db.prepare(
    `SELECT phone_e164, COUNT(*) AS n FROM customers WHERE phone_e164 IS NOT NULL AND phone_e164 != '' AND merged_into_id IS NULL GROUP BY phone_e164 HAVING n > 1`
  ).all();
  if (dupes.length) {
    console.error('[crm] customers.phone_e164 has duplicates — resolve via POST /api/crm/customers/:id/merge:');
    for (const d of dupes) console.error(`  "${d.phone_e164}" used by ${d.n} customers`);
  } else {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_unique ON customers(phone_e164) WHERE phone_e164 IS NOT NULL AND phone_e164 != '' AND merged_into_id IS NULL`);
  }
} catch (err) {
  console.error('[crm] phone-uniqueness index migration failed (continuing anyway):', err.message);
}
// crm_settings — ensure the single settings row exists (admin UI reads/writes it).
try { db.exec(`INSERT OR IGNORE INTO crm_settings (id) VALUES (1)`); } catch (_) {}

// Phase 3 addition to crm_settings (table already existed from Phase 1's
// unguarded CREATE TABLE IF NOT EXISTS, so a plain ALTER is needed here too).
try { db.exec(`ALTER TABLE crm_settings ADD COLUMN wa_webhook_secret TEXT`); } catch (_) {}

// ─── CRM (Phase 4) — bulk broadcasts / דיוור ──────────────────────────────
// Second slice of the granular permission model (after can_view_costs): who
// may START a WhatsApp broadcast. Deliberately NOT implied by the admin role
// at runtime — admins are grandfathered once, here, and can revoke it from
// themselves. A 200-recipient blast is the single most damaging thing a
// misclick can do in this system (WhatsApp ban + 200 annoyed customers).
try {
  db.exec('ALTER TABLE users ADD COLUMN can_send_campaigns INTEGER NOT NULL DEFAULT 0');
  db.prepare(`UPDATE users SET can_send_campaigns = 1 WHERE role = 'admin'`).run();
} catch (_) {}

// Third slice of the granular permission model: who may reach the CRM at all.
// Default 0 for EVERYONE including admins (unlike can_view_costs/can_send_campaigns,
// which grandfather admins) — the CRM is being rolled out to one person first, so
// "closed unless explicitly opened" is the whole point. Grant is by email, the
// login identity, and re-asserted on every boot so a fresh deploy or a restored
// database can't lock the owner out of their own system.
const CRM_OWNER_EMAIL = 'evyatar@fibonacci.co.il';
try { db.exec('ALTER TABLE users ADD COLUMN can_access_crm INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
try {
  const { changes } = db.prepare(
    `UPDATE users SET can_access_crm = 1 WHERE lower(email) = ?`
  ).run(CRM_OWNER_EMAIL);
  console.log(`[auth] CRM access granted to ${CRM_OWNER_EMAIL} (${changes} account${changes === 1 ? '' : 's'} matched)`);
} catch (err) {
  console.error('[auth] CRM owner grant failed:', err.message);
}

// crm_settings already existed (Phase 1 CREATE TABLE IF NOT EXISTS), so these
// are ALTERs, not schema.sql edits. Send window/days are enforced in LOCAL
// time by jobs.js — SQLite's CURRENT_TIMESTAMP is UTC and would be 2-3h off.
for (const col of [
  "ALTER TABLE crm_settings ADD COLUMN send_window_start TEXT NOT NULL DEFAULT '09:00'",
  "ALTER TABLE crm_settings ADD COLUMN send_window_end   TEXT NOT NULL DEFAULT '20:00'",
  "ALTER TABLE crm_settings ADD COLUMN send_days         TEXT NOT NULL DEFAULT '0,1,2,3,4'", // JS getDay(): Sun..Thu
  "ALTER TABLE crm_settings ADD COLUMN optout_footer     TEXT NOT NULL DEFAULT 'להסרה מרשימת הדיוור השב/י: הסר'",
  "ALTER TABLE crm_settings ADD COLUMN optout_reply_text TEXT NOT NULL DEFAULT 'הוסרת מרשימת הדיוור שלנו. לא נשלח לך יותר הודעות שיווקיות.'",
  // consent_source is what makes the consent backfill below idempotent.
  'ALTER TABLE customers ADD COLUMN consent_source TEXT',        // quote_history | manual | inbound | optout
  'ALTER TABLE customers ADD COLUMN consent_updated_at TEXT',
  // A conversation CREATED BY a דיוור is hidden from the shared-inbox list
  // until the customer replies — otherwise one 200-recipient blast buries
  // every real conversation. Set only when the outbox CREATES the
  // conversation; an existing (already-real) one is never flagged, and
  // inbound.js clears the flag on the first inbound message.
  'ALTER TABLE crm_conversations ADD COLUMN is_broadcast_only INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE crm_conversations ADD COLUMN source_campaign_id INTEGER',
  // Follow-up date — the agent's "come back to this lead on X" reminder, and
  // the driver of the "פולואאפים להיום" column on the My Day screen. Pulled
  // from monday's own follow-up date column when the board maps one.
  'ALTER TABLE crm_leads ADD COLUMN follow_up_date TEXT',
]) { try { db.exec(col); } catch (_) {} }
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_leads_followup ON crm_leads(assigned_to, follow_up_date)`); } catch (_) {}

// ─── CRM (Phase 5) — lead pull-queue + Drive materials ────────────────────
// Schema/data prep only, kept even though the routes that use it
// (routes/leadQueue.js, routes/drive.js) aren't committed yet and were
// removed from the requires/registrations below — see the "Restore..." commit.
// Every statement here is either idempotent (ALTER/INDEX IF NOT EXISTS) or
// self-limiting (the two backfills below match nothing once already run), so
// it's inert and safe to boot with, and won't need re-running once the routes
// land.
// crm_settings / crm_leads / monday_* all already exist from earlier phases'
// unguarded CREATE TABLE IF NOT EXISTS, so every one of these is an ALTER
// here, never an edit to schema.sql.
for (const col of [
  // Requirement 3 — the "ממתין לתשובה — איחור" threshold, manager-tunable.
  'ALTER TABLE crm_settings ADD COLUMN reply_overdue_minutes INTEGER NOT NULL DEFAULT 60',
  // Requirement 7 — the concurrent-lead cap, manager-tunable.
  'ALTER TABLE crm_settings ADD COLUMN max_claimed_leads     INTEGER NOT NULL DEFAULT 4',
  // 0 = a claim never auto-expires (the intended default: a lead is freed by
  // an outcome, not by a timer). >0 arms the sweeper in jobs.js as a safety
  // net for an agent who leaves and never comes back.
  'ALTER TABLE crm_settings ADD COLUMN lead_claim_ttl_hours  INTEGER NOT NULL DEFAULT 0',
  // Requirement 5 — the manager can hide "פולואפ להיום" from agents.
  'ALTER TABLE crm_settings ADD COLUMN agents_see_follow_ups INTEGER NOT NULL DEFAULT 1',

  // Agent signature on outgoing WhatsApp replies. WhatsApp itself shows the
  // customer only ONE business identity no matter which agent typed — the
  // only way to reveal who is answering is to put the name in the message
  // body. Applied to agent-typed inbox replies only (never to campaigns or
  // auto-sent documents), so a broadcast can't get signed by whoever
  // happened to trigger it.
  // Default ON: the customer must know which of the 5 agents is answering,
  // and WhatsApp shows them one business identity regardless. A manager can
  // still turn it off in CRM settings, and that choice survives restarts —
  // this default only applies the first time the column is created.
  "ALTER TABLE crm_settings ADD COLUMN agent_signature_enabled  INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE crm_settings ADD COLUMN agent_signature_template TEXT NOT NULL DEFAULT '*{agent}* מפרינטלה:'",

  // The lead's REAL arrival time (monday Item.created_at), not our pull time.
  // crm_leads.created_at is worthless for queue ordering — the existing 525
  // rows all landed inside 4 minutes of one import.
  'ALTER TABLE crm_leads ADD COLUMN source_created_at TEXT',
  // Set exactly once (COALESCE) the first time a lead's status becomes
  // 'quoted' — either via PUT /api/crm/leads/:id or POST .../convert. Needed
  // because updated_at gets overwritten by any later edit, so it can't be
  // trusted as "when did this lead reach a quote" for the קמפיינים funnel.
  'ALTER TABLE crm_leads ADD COLUMN quoted_at TEXT',
  // 'agent' | 'monday' | NULL — see schema.sql. Backfilled below: every
  // existing follow_up_date got there through mondaySync (the only writer
  // until this column existed), so it's safe to default those to 'monday'.
  'ALTER TABLE crm_leads ADD COLUMN follow_up_source TEXT',
  'ALTER TABLE monday_item_map ADD COLUMN monday_created_at TEXT',
  // Cached [{id,title,type}] from the board, so the lead workspace can put a
  // friendly Hebrew title on every raw_json column_value. raw_json stores
  // only column IDs — titles exist nowhere in our DB today.
  'ALTER TABLE monday_board_map ADD COLUMN columns_json TEXT',
]) { try { db.exec(col); } catch (_) {} }

// One-time backfill of follow_up_source for leads that already had a
// follow_up_date before this column existed — see its ALTER above.
try {
  db.exec(`UPDATE crm_leads SET follow_up_source = 'monday' WHERE follow_up_source IS NULL AND follow_up_date IS NOT NULL`);
} catch (err) {
  console.error('[db] crm_leads.follow_up_source backfill failed:', err.message);
}

// Covering index for the pull-queue's hot path (see leadClaims.js nextClaimable).
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_leads_pool
             ON crm_leads(status, assigned_to, source_created_at)`);
} catch (_) {}

// Campaign-analytics indexes — the overview/profitability endpoints scan
// crm_leads once per campaign (and per agent) over a date range, plus one
// spend lookup per bucket.
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_leads_closed_at   ON crm_leads(closed_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_leads_agent_status ON crm_leads(assigned_to, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_campaign_spend_day ON crm_campaign_spend(day)`);
} catch (_) {}


// (A) Release the 524 monday leads from the 'monday-sync' pseudo-owner into
// the claimable pool. Naturally idempotent — after it runs nothing matches.
// The poller itself is fixed in mondaySync.js so this never recurs.
try {
  const { changes } = db.prepare(
    `UPDATE crm_leads SET assigned_to = NULL WHERE assigned_to = 'monday-sync'`
  ).run();
  if (changes) console.log(`[crm] lead pool: released ${changes} lead(s) from the 'monday-sync' pseudo-owner`);
} catch (err) {
  console.error('[crm] monday-sync pool migration failed (continuing anyway):', err.message);
}

// (B) A mapped monday board IS a קמפיין. Nothing ever created the
// crm_campaigns rows, so campaign_id is NULL on every board AND every lead —
// which makes per-agent campaign restrictions a no-op. Create one campaign
// per board, link the board, and backfill the leads through monday_item_map.
try {
  const boards = db.prepare(`SELECT id, board_id, board_name FROM monday_board_map WHERE campaign_id IS NULL`).all();
  for (const b of boards) {
    const name = b.board_name || `בורד ${b.board_id}`;
    let camp = db.prepare(`SELECT id FROM crm_campaigns WHERE name = ?`).get(name);
    if (!camp) {
      const { lastInsertRowid } = db.prepare(
        `INSERT INTO crm_campaigns (name, channel, status) VALUES (?, 'monday', 'active')`
      ).run(name);
      camp = { id: lastInsertRowid };
    }
    db.prepare(`UPDATE monday_board_map SET campaign_id = ? WHERE id = ?`).run(camp.id, b.id);
    db.prepare(
      `UPDATE crm_leads SET campaign_id = ?
        WHERE campaign_id IS NULL
          AND id IN (SELECT lead_id FROM monday_item_map WHERE board_id = ? AND lead_id IS NOT NULL)`
    ).run(camp.id, b.board_id);
  }
  if (boards.length) console.log(`[crm] campaigns: linked ${boards.length} monday board(s)`);
} catch (err) {
  console.error('[crm] board→campaign backfill failed (continuing anyway):', err.message);
}

try {
  const { backfillMarketingConsent } = require('./services/crm/consentBackfill');
  const consentResult = backfillMarketingConsent(db);
  console.log(`[crm] marketing consent: ${consentResult.granted} customer(s) granted via quote history`);
} catch (err) {
  console.error('[crm] consent backfill failed (continuing anyway):', err.message);
}

// ─── SignCalc Pro config — read by the Base44-compatible PricingConfig entity ─
// (registerEntities below needs loadConfig/upsertConfig; the tables themselves
// are seeded by seedSignshop() above and otherwise read/written entirely through
// /api/entities/* — see "Removed" note at the bottom of this file.)

const configRows   = db.prepare(`SELECT key, value, label FROM signshop_config ORDER BY rowid`);
const upsertConfig = db.prepare(`INSERT INTO signshop_config (key, value, label) VALUES (@key, @value, @label)
                                  ON CONFLICT(key) DO UPDATE SET value = @value`);

function loadConfig() {
  return Object.fromEntries(configRows.all().map(r => [r.key, r.value]));
}

// ═══════════════════════════════════════════════════════════════════════════
// Base44-compatible API — auth + generic entities (frontend SDK shim target)
// ═══════════════════════════════════════════════════════════════════════════
const { requireAuth, requireAdmin, requireOperations, requireCampaigns, userFromRequest } = registerAuth(app, db);
registerEntities(app, db, {
  loadConfig,
  upsertConfig,
  requireAuth,
  requireAdmin,
  requireOperations,
});
registerNotifications(app, db, { requireAuth, requireAdmin });
registerMorning(app, db, { requireAuth, requireAdmin });
registerUpdate(app, db, { requireAuth, requireAdmin });
registerGreenApi(app, db, { requireAuth, requireAdmin });
registerMonday(app, db, { requireAuth, requireAdmin });
registerAttachments(app, db, { requireAuth });
registerSmtp(app, db, { requireAuth, requireAdmin });
registerReports(app, db, { requireAuth, requireAdmin });
registerCutFile(app, db, { requireAuth });
registerProduction(app, db, { requireOperations });
// ─── CRM access gate ──────────────────────────────────────────────────────
// ONE guard in front of every CRM path instead of swapping requireAuth for a
// stricter middleware in each of the ~90 CRM route handlers: a single mount
// point can't be forgotten, and it also covers CRM routes added later.
// Mounted BEFORE the CRM registrations below so it runs first. Public webhook
// paths are exempt — WhatsApp and monday.com POST to them unauthenticated, and
// gating those would silently stop inbound messages and board sync.
const CRM_PATH_PREFIXES = ['/api/crm', '/api/inbox', '/api/campaigns', '/api/drive', '/api/monday-sync'];
const CRM_PUBLIC_PATHS = ['/api/whatsapp/webhooks', '/api/monday-sync/webhooks'];
app.use((req, res, next) => {
  const path = req.path || '';
  if (!CRM_PATH_PREFIXES.some((p) => path.startsWith(p))) return next();
  if (CRM_PUBLIC_PATHS.some((p) => path.startsWith(p))) return next();
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (!user.can_access_crm) {
    return res.status(403).json({ error: 'להרשאת כניסה פנה לאביתר', code: 'crm_forbidden' });
  }
  req.user = user;
  next();
});

registerCrm(app, db, { requireAuth, requireAdmin });
registerMondaySync(app, db, { requireAdmin });
registerInbox(app, db, { requireAuth, requireAdmin });
registerWhatsapp(app, db, { requireAuth, requireAdmin });
registerCampaigns(app, db, { requireAuth, requireAdmin, requireCampaigns });
registerMyDay(app, db, { requireAuth });
registerLeadQueue(app, db, { requireAuth, requireAdmin });
registerDrive(app, db, { requireAuth, requireAdmin });

startReportScheduler(db, {
  [deliveryNotesReport.REPORT_TYPE]: deliveryNotesReport.sendReport,
  [salesReport.REPORT_TYPE]: salesReport.sendReport,
});
startCrmJobs(db);

// ─── Version info — read by deploy/UPDATE.ps1's post-deploy smoke check and
// by anyone wanting to confirm which release is live without RDP access ─────
const PKG_VERSION = require('../package.json').version;
const VERSION_FILE = path.join(__dirname, '../VERSION.txt');

app.get('/api/version', (req, res) => {
  let commit = null;
  let deployedAt = null;
  let tag = null;
  try {
    // Windows PowerShell 5.1's `Set-Content -Encoding utf8` writes a BOM, and
    // JSON.parse throws on a leading ﻿. The catch below swallowed it, so
    // commit/deployedAt silently read as null on every real deploy while
    // looking fine locally, where no VERSION.txt exists at all.
    const raw = fs.readFileSync(VERSION_FILE, 'utf8').replace(/^﻿/, '');
    const info = JSON.parse(raw);
    commit = info.commit || null;
    deployedAt = info.deployedAt || null;
    tag = info.tag || null;
  } catch (_) {}
  res.json({ version: PKG_VERSION, commit, deployedAt, tag });
});

// ─── Static frontend (sign-smart-quote/dist) ─────────────────────────────────

// Vite fingerprints every built JS/CSS file (e.g. index-Ccnoi4ni.js), so those
// are safe to cache forever — a new build always gets a new filename. index.html
// is NOT fingerprinted though, and browsers were caching it across rebuilds,
// so a hard refresh was needed to see any change. Force it to always revalidate.
const CLIENT_DIST = path.join(__dirname, '../sign-smart-quote/dist');
app.use(express.static(CLIENT_DIST, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// catch-all: any non-API route returns the SPA's index.html
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(CLIENT_DIST, 'index.html'));
});

// ─── 404 fallback (API routes only — SPA routes handled above) ──────────────

app.use((req, res) => {
  res.status(404).json({ error: `No route: ${req.method} ${req.path}` });
});

// ─── Error handler — turns any uncaught route error into JSON instead of an
// HTML error page, so the frontend's error parsing never breaks on a crash ───
app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.path}:`, err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  console.log('[server] Routes:');
  console.log('  POST   /api/auth/login              GET  /api/auth/me');
  console.log('  POST   /api/auth/logout              PUT  /api/auth/change-password');
  console.log('  GET/POST/PUT/DELETE /api/entities/:name   (Quote, PriceTier, StickerPriceTier, PaintSurchargeTier,');
  console.log('                                              LightboxSizeTier, LightboxSellingPrice, KapaPriceTier,');
  console.log('                                              RollupPriceTier, LokobondAreaTier, GlassPriceTier, NumberPriceTier, PricingConfig, User,');
  console.log('                                              Station, Operation, Recipe, RecipeStep, Worksheet — production recipes / תפ"י)');
  console.log('  PUT    /api/entities/WorksheetStep/:id      (תפ"י operator toggling a resolved worksheet step)');
  console.log('  GET    /api/production/orders                (price-free approved-quote list for תפ"י, requireOperations)');
  console.log('  GET    /api/admin/users              POST/PUT/DELETE /api/admin/users/:id');
  console.log('  GET    /api/notifications            PUT  /api/notifications/:id/read');
  console.log('  POST   /api/quotes/:id/decision      (manager approve/reject)');
  console.log('  GET/POST /api/quotes/:id/attachments  DELETE /api/quotes/:id/attachments/:attId  (agent reference files)');
  console.log('  GET    /api/version                  (running version/commit/deployedAt)');
  console.log('  GET/PUT /api/morning/config           POST /api/morning/quotes/:id/document|convert  GET /api/morning/quotes/:id/history');
  console.log('  GET    /api/morning/clients/search    (client-search autocomplete for the quote form)');
  console.log('  GET    /api/admin/check-update        POST /api/admin/update');
  console.log('  GET/PUT /api/greenapi/config          (WhatsApp auto-send credentials)');
  console.log('  GET/PUT /api/monday/config            GET /api/monday/boards|boards/:id/groups');
  console.log('  POST   /api/auth/forgot-password      POST /api/auth/reset-password');
  console.log('  GET/PUT /api/smtp/config               POST /api/smtp/test');
  console.log('  POST   /api/cutfile/upload             POST /api/cutfile/:jobId/trace  GET /api/cutfile/:jobId/source|export  (cut-file generator)');
  console.log('  GET/POST/PUT /api/crm/customers[/:id]  POST /api/crm/customers/:id/merge|notes  GET .../timeline  (CRM Phase 1)');
  console.log('  GET/POST/PUT /api/crm/leads[/:id]      POST /api/crm/leads/:id/convert');
  console.log('  GET/PUT /api/crm/settings              (WhatsApp/telephony provider, monday poll toggle)');
  console.log('  GET/POST/PUT/DELETE /api/monday-sync/boards[/:id]  GET .../:boardId/columns  POST .../:id/pull|push');
  console.log('  POST   /api/monday-sync/webhooks/items  (public, monday.com item-change webhook)');
  console.log('  GET    /api/inbox/conversations         GET .../:id/messages  PUT .../:id');
  console.log('  POST   /api/inbox/conversations/:id/claim|heartbeat|release|force-claim|messages');
  console.log('  GET    /api/inbox/stream                (SSE, shared inbox live updates)');
  console.log('  GET/PUT /api/whatsapp/config             POST /api/whatsapp/test');
  console.log('  GET/POST /api/whatsapp/webhooks/:provider (public, inbound WhatsApp)');
  console.log('  GET/POST/PUT/DELETE /api/campaigns/templates[/:id]  POST .../preview  (message_templates)');
  console.log('  POST   /api/campaigns/audience/preview  (דיוור targeting — join-heavy preview query)');
  console.log('  GET/POST/PUT /api/campaigns[/:id]       POST .../build|start|pause|resume|cancel|test-send');
  console.log('  GET/POST/DELETE /api/campaigns/optouts[/:id]  (opt-out register)');
});

// ─── Removed (2026-07-07 pre-launch cleanup) ─────────────────────────────────
// The legacy cabinet/door CRUD (/api/products, /api/sub-products, /api/variants,
// /api/quote/calculate, /api/admin/tree, /api/raw-materials, /api/simulator/config),
// the McGyver Hebrew-NLP chat endpoints (/api/chat, /api/chat/pdf), and the entire
// /api/signshop/* namespace (bootstrap/config/calculate/tier CRUD/quotes) were all
// confirmed to have ZERO references anywhere in sign-smart-quote/src (verified by
// grep before deletion) — fully superseded by /api/entities/* and the frontend's
// own client-side pricing engine (src/components/calculator/useCalculator.jsx).
// They were also completely unauthenticated, which was the top pre-launch security
// finding. Deleting unreachable code closes that hole outright instead of patching
// dead routes. The backend engine they used to call (./engine/signCalc.js) and the
// legacy tables (products/sub_products/product_variants/raw_materials) were removed
// separately (2026-08-09).
