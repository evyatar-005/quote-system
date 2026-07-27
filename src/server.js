const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const Database  = require('better-sqlite3');
const { seedSignshop } = require('./db/seed-signshop');
const registerAuth     = require('./routes/auth');
const registerEntities = require('./routes/entities');
const registerNotifications = require('./routes/notifications');
const registerMorning  = require('./routes/morning');
const registerUpdate   = require('./routes/update');
const registerGreenApi = require('./routes/greenapi');
const registerMonday   = require('./routes/monday');
const registerAttachments = require('./routes/attachments');

const PORT    = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, '../database.sqlite');

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
console.log('[db] Connected to', DB_PATH);

// Ensure SignCalc Pro tables exist (all IF NOT EXISTS — safe on a live DB) and
// seed placeholders only when empty. Never wipes existing data.
db.exec(fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8'));
seedSignshop(db);

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
]) {
  try { db.exec(col); } catch (_) {}
}

// Stores the Morning-returned PDF download link at document-creation time, so
// QuotesHistory can show/open it without an extra Morning API round-trip.
for (const col of [
  'ALTER TABLE morning_documents_map ADD COLUMN document_url TEXT',
]) {
  try { db.exec(col); } catch (_) {}
}

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
const { requireAuth, requireAdmin } = registerAuth(app, db);
registerEntities(app, db, {
  loadConfig,
  upsertConfig,
  requireAuth,
  requireAdmin,
});
registerNotifications(app, db, { requireAuth, requireAdmin });
registerMorning(app, db, { requireAuth, requireAdmin });
registerUpdate(app, db, { requireAuth, requireAdmin });
registerGreenApi(app, db, { requireAuth, requireAdmin });
registerMonday(app, db, { requireAuth, requireAdmin });
registerAttachments(app, db, { requireAuth });

// ─── Version info — read by deploy/UPDATE.ps1's post-deploy smoke check and
// by anyone wanting to confirm which release is live without RDP access ─────
const PKG_VERSION = require('../package.json').version;
const VERSION_FILE = path.join(__dirname, '../VERSION.txt');

app.get('/api/version', (req, res) => {
  let commit = null;
  let deployedAt = null;
  try {
    const info = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    commit = info.commit || null;
    deployedAt = info.deployedAt || null;
  } catch (_) {}
  res.json({ version: PKG_VERSION, commit, deployedAt });
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
  console.log('                                              RollupPriceTier, LokobondAreaTier, GlassPriceTier, PricingConfig, User)');
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
// legacy tables (products/sub_products/product_variants/raw_materials, still defined
// in db/schema.sql) are now unused too — left in place since dropping tables/files
// with zero read path is a cleanup, not a security fix; safe to remove separately.
