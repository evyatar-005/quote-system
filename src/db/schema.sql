PRAGMA foreign_keys = ON;

-- ════════════════════════════════════════════════════════════════════════════
-- SignCalc Pro — sign-shop pricing engine (ported from base44 reference).
-- All IF NOT EXISTS so this file can be re-applied on a live database.sqlite
-- without data loss.
-- ════════════════════════════════════════════════════════════════════════════

-- Key/value mirror of the base44 PricingConfig entity (~70 fields). One row per
-- engine knob; the engine reads these into a plain `config` object.
CREATE TABLE IF NOT EXISTS signshop_config (
  key   TEXT PRIMARY KEY,
  value REAL,
  label TEXT
);

-- Logo tiers: PVC white/black + perspex, priced per m² by thickness.
CREATE TABLE IF NOT EXISTS signshop_price_tiers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_type  TEXT NOT NULL,        -- pvc_white | pvc_black | perspex
  thickness_mm  TEXT NOT NULL,
  price_per_sqm REAL NOT NULL DEFAULT 0,
  min_price     REAL NOT NULL DEFAULT 0,
  agent_min_price_per_sqm REAL NOT NULL DEFAULT 0  -- floor of the agent-adjustable price range (0 = no range, price_per_sqm is fixed)
);

-- Sticker tiers: vinyl/texture, fixed price by area bucket (+ a 999 per-m² row).
CREATE TABLE IF NOT EXISTS signshop_sticker_tiers (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  product_type              TEXT NOT NULL,   -- vinyl_sticker | texture_sticker
  area_sqm                  REAL NOT NULL,
  sticker_price             REAL NOT NULL DEFAULT 0,
  installation_price_center REAL NOT NULL DEFAULT 0,
  installation_price_south  REAL NOT NULL DEFAULT 0
);

-- Paint surcharge tiers (base + step) per paint type.
CREATE TABLE IF NOT EXISTS signshop_paint_tiers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  paint_type       TEXT NOT NULL,            -- single_color | dual_color
  area_from        REAL NOT NULL DEFAULT 0,
  area_to          REAL,
  surcharge        REAL NOT NULL DEFAULT 0,
  tier_description TEXT
);

-- Lightbox size tiers: cost components + selling price by physical size.
CREATE TABLE IF NOT EXISTS signshop_lightbox_tiers (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  size_label            TEXT NOT NULL,
  width_cm              REAL NOT NULL,
  height_cm             REAL NOT NULL,
  frame_cost            REAL NOT NULL DEFAULT 0,
  led_cost              REAL NOT NULL DEFAULT 0,
  transformer_cost      REAL NOT NULL DEFAULT 0,
  selling_base_price    REAL NOT NULL DEFAULT 0,
  selling_price_per_sqm REAL NOT NULL DEFAULT 0
);

-- Base44 auth: users + sessions.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT,
  email         TEXT,
  role          TEXT NOT NULL DEFAULT 'agent',
  -- Forces a password change on next login — set for the seeded demo accounts
  -- and any account an admin creates/resets, so a default/reset password can't
  -- be used past the first real login.
  must_change_password INTEGER NOT NULL DEFAULT 0
);
-- The UNIQUE index on email (partial: WHERE email IS NOT NULL, so legacy rows
-- with no email don't collide with each other) is created in server.js rather
-- than here. This file is executed as one unguarded db.exec on every boot —
-- if a production DB somehow already has two users sharing an email, creating
-- the index here would throw and take the whole server down on startup.
-- server.js checks for duplicates first and only creates the index when safe.

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Lokobond selling-price tiers by area breakpoint: "from X m² and up, price is Y ₪/m²".
-- Sorted by area_from ascending; the calculator picks the highest area_from <= actual area.
CREATE TABLE IF NOT EXISTS signshop_lokobond_area_tiers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_type  TEXT NOT NULL,           -- lokobond_diecut | lokobond_plain
  area_from     REAL NOT NULL DEFAULT 0,
  price_per_sqm REAL NOT NULL DEFAULT 0,
  min_price     REAL NOT NULL DEFAULT 0,  -- floor for this tier — tiny areas (0.1×0.1 מ') would otherwise price near-zero
  agent_min_price_per_sqm REAL NOT NULL DEFAULT 0  -- floor of the agent-adjustable price range (0 = no range, price_per_sqm is fixed)
);

-- Graphics (0000) — flat design/graphics-work time sold as its own line item,
-- selling price only, no cost model (yet) per explicit request.
CREATE TABLE IF NOT EXISTS signshop_graphics_tiers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sku           TEXT NOT NULL DEFAULT '0000',
  description   TEXT NOT NULL,
  price         REAL NOT NULL DEFAULT 0
);

-- Glass (extra clear) tiers: fixed size catalog, cost + selling price set directly per size
-- (like kapa/rollup) — no per-sqm formula, glass panels are bought pre-cut to size.
CREATE TABLE IF NOT EXISTS signshop_glass_tiers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  product_type   TEXT NOT NULL DEFAULT 'glass_extra_clear',
  sku            TEXT NOT NULL,
  description    TEXT NOT NULL,
  width_cm       REAL NOT NULL DEFAULT 0,
  height_cm      REAL NOT NULL DEFAULT 0,
  cost_price     REAL NOT NULL DEFAULT 0,  -- vendor cost per sheet (מחירון עלות)
  selling_price  REAL NOT NULL DEFAULT 0   -- customer selling price per sheet
);

-- Kapa (foam board) tiers: fixed price by max size + cut type.
CREATE TABLE IF NOT EXISTS signshop_kapa_tiers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sku           TEXT NOT NULL,
  description   TEXT NOT NULL,
  max_width_m   REAL NOT NULL DEFAULT 0,
  max_height_m  REAL NOT NULL DEFAULT 0,
  cut_type      TEXT NOT NULL DEFAULT 'straight', -- straight | die_cut
  price         REAL NOT NULL DEFAULT 0
);

-- Laser-cut number/digit tiers: priced per single digit by height + perspex
-- thickness (not per m² like the logo family) — admin adds new height/thickness
-- rows freely from the UI, there's no fixed hardcoded list like other families.
CREATE TABLE IF NOT EXISTS signshop_number_tiers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  product_type   TEXT NOT NULL,   -- numbers_perspex_clear | _black | _white | _milky | _mirror | _metallic
  height_cm      REAL NOT NULL DEFAULT 0,
  thickness_mm   TEXT NOT NULL,
  price_per_unit REAL NOT NULL DEFAULT 0,
  min_price      REAL NOT NULL DEFAULT 0
);

-- Roll-up banner tiers: magnetic + regular, fixed size, quantity-discount pricing
-- (unit 1 / unit 2 / unit 3-and-up each has its own price, no formula — set directly).
CREATE TABLE IF NOT EXISTS signshop_rollup_tiers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  product_type       TEXT NOT NULL,        -- rollup_magnetic | rollup_regular
  sku                TEXT NOT NULL,
  description        TEXT NOT NULL,
  width_m            REAL NOT NULL DEFAULT 0,
  height_m           REAL NOT NULL DEFAULT 0,
  paper_cost_per_sqm REAL NOT NULL DEFAULT 0,
  stand_cost         REAL NOT NULL DEFAULT 0,  -- cost of the physical stand/mechanism for this size, flat per unit
  price_unit_1       REAL NOT NULL DEFAULT 0,
  price_unit_2       REAL NOT NULL DEFAULT 0,
  price_unit_3_plus  REAL NOT NULL DEFAULT 0
);

-- Lightbox selling prices (base44 LightboxSellingPrice entity).
CREATE TABLE IF NOT EXISTS signshop_lightbox_selling_prices (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  sub_type              TEXT,
  size_label            TEXT,
  selling_base_price    REAL DEFAULT 0,
  selling_price_per_sqm REAL DEFAULT 0
);

-- Saved quotes (base44 Quote entity).
CREATE TABLE IF NOT EXISTS signshop_quotes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_number     TEXT,
  client_name      TEXT,
  product_category TEXT,
  price_before_vat REAL,
  price_with_vat   REAL,
  line_items       TEXT,
  calculation_data TEXT,
  notes            TEXT,
  status           TEXT DEFAULT 'draft',
  created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
  payment_type     TEXT,
  created_by       TEXT,
  parent_quote_number TEXT,
  viewed_at        TEXT,  -- set the first time a manager opens this quote's detail view; NULL = not yet opened
  agent_note       TEXT   -- free-text background from the agent when sending for review; manager-only, never shown on the client-facing document
);

-- Reference images/PDFs an agent attaches when saving/sending a quote (e.g. a
-- photo of the client's wall, a PDF spec sheet) so the manager reviewing a
-- discount request can see what the quote is actually for. The file bytes
-- live on disk under uploads/quote-attachments/ (see src/routes/attachments.js) —
-- only metadata is stored here.
CREATE TABLE IF NOT EXISTS signshop_quote_attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id      INTEGER NOT NULL REFERENCES signshop_quotes(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,   -- random on-disk filename — never trust the original name as a path
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size          INTEGER NOT NULL DEFAULT 0,
  uploaded_by   TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Automated cut-file generator (Image Trace + Offset Path automation) — one
-- row per exported download, kept for history/audit only. The actual traced
-- geometry is never persisted; job_id points at a temp folder under
-- uploads/cutfiles/ that's cleaned up ~24h after upload (see routes/cutfile.js).
CREATE TABLE IF NOT EXISTS cut_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        TEXT NOT NULL,
  original_name TEXT,
  mime_type     TEXT,
  width_cm      REAL,
  params_json   TEXT,   -- trace/offset parameters used for this export, for support/debugging
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- In-app notifications for sales agents — e.g. "your quote was approved by the
-- manager and is ready to issue" or "your quote was rejected". recipient_username
-- ties back to users.username (not email — several accounts have no email set).
CREATE TABLE IF NOT EXISTS notifications (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_username  TEXT NOT NULL,
  quote_id            INTEGER,
  quote_number        TEXT,
  type                TEXT NOT NULL,     -- 'approved' | 'rejected' | 'sent' (agent → admin, awaiting a discount decision) | 'payment_received'
  message             TEXT NOT NULL,
  is_read             INTEGER NOT NULL DEFAULT 0,
  -- Structured extras a given notification type needs beyond plain text —
  -- e.g. 'payment_received' stores { receiptUrl, amount } here so the bell
  -- can render a direct "הורד קבלה" link without a second API round-trip.
  -- NULL for every type that doesn't need it.
  payload_json        TEXT,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ════════════════════════════════════════════════════════════════════════════
-- Morning (Green Invoice) integration — quote → order/invoice document sync.
-- ════════════════════════════════════════════════════════════════════════════

-- Single row (id=1) holding the API key pair. client_secret is stored in
-- plaintext here (same trust boundary as database.sqlite itself, which is
-- gitignored and never leaves the host) — never returned as-is over the API.
CREATE TABLE IF NOT EXISTS morning_credentials (
  id             INTEGER PRIMARY KEY,
  client_id      TEXT,
  client_secret  TEXT,
  base_url       TEXT,
  sandbox        INTEGER NOT NULL DEFAULT 1,
  -- Signing secret configured for this webhook in Morning's own UI (Developer
  -- Tools → Webhooks) — used to best-effort verify the x-webhook-signature
  -- header on incoming payment webhooks. Optional: left blank, incoming
  -- webhooks are still processed, just unverified.
  webhook_secret TEXT,
  updated_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

-- One row per payment link generated via POST /payments/form (createPaymentForm
-- in services/morning/sync.js) — lets the payment/received webhook look up
-- which quote a payment belongs to (Morning's payload only carries its own
-- payment id, never our quote id), and holds the resulting receipt once found.
CREATE TABLE IF NOT EXISTS morning_payment_requests (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id             INTEGER NOT NULL,
  morning_payment_id   TEXT NOT NULL UNIQUE,
  status               TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'paid'
  amount               REAL,
  paid_at              TEXT,
  transaction_json     TEXT,
  receipt_document_id  TEXT,
  receipt_number       TEXT,
  receipt_url          TEXT,
  created_at           TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_morning_payment_requests_quote      ON morning_payment_requests(quote_id);
CREATE INDEX IF NOT EXISTS idx_morning_payment_requests_payment_id ON morning_payment_requests(morning_payment_id);

-- Caches local free-text client_name → Morning client id so ensureMorningClient
-- doesn't re-search/re-create a client on every document call.
CREATE TABLE IF NOT EXISTS morning_clients_map (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  local_client_name TEXT NOT NULL UNIQUE,
  morning_client_id TEXT NOT NULL,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

-- One row per Morning document created/converted from a local quote. A quote
-- can have several rows over its lifetime (quote -> order -> invoice), each
-- linked back to the previous one via linked_from_id.
CREATE TABLE IF NOT EXISTS morning_documents_map (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id               INTEGER NOT NULL,
  morning_document_id    TEXT NOT NULL,
  morning_document_type  INTEGER NOT NULL,
  morning_document_number TEXT,
  linked_from_id         INTEGER,
  created_at             TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Audit trail of every create/convert attempt, success or failure, for support.
CREATE TABLE IF NOT EXISTS morning_sync_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id      INTEGER,
  action        TEXT NOT NULL,
  request_json  TEXT,
  response_json TEXT,
  success       INTEGER NOT NULL,
  error_message TEXT,
  created_by    TEXT,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

-- monday.com credentials + chosen destination for new-order items — one row,
-- admin-only, same shape as morning_credentials.
CREATE TABLE IF NOT EXISTS monday_credentials (
  id          INTEGER PRIMARY KEY,
  api_token   TEXT,
  board_id    TEXT,
  group_id    TEXT,
  updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- GreenAPI (WhatsApp) credentials — one row, admin-only, same shape as
-- morning_credentials.
CREATE TABLE IF NOT EXISTS greenapi_credentials (
  id           INTEGER PRIMARY KEY,
  instance_id  TEXT,
  api_token    TEXT,
  api_url      TEXT,
  media_url    TEXT,
  updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Audit trail of every automatic WhatsApp send attempt, success or failure.
CREATE TABLE IF NOT EXISTS whatsapp_send_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id            INTEGER,
  morning_document_id TEXT,
  phone               TEXT,
  success             INTEGER NOT NULL,
  error_message       TEXT,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Password reset tokens — only the sha256 hash of the raw token is stored, so
-- a leaked DB file alone can't be used to forge a reset. Raw token lives only
-- in the emailed link.
CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- SMTP credentials for outgoing mail (password-reset links, etc.) — one row,
-- admin-only, same shape as morning_credentials/greenapi_credentials.
CREATE TABLE IF NOT EXISTS smtp_credentials (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  host         TEXT,
  port         INTEGER DEFAULT 587,
  secure       INTEGER DEFAULT 0,
  username     TEXT,
  password     TEXT,
  from_email   TEXT,
  from_name    TEXT,
  app_base_url TEXT,
  updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

-- One row per SCHEDULE (src/services/reports/) — a report_type can have
-- several independent schedules at once (e.g. a daily digest AND a monthly
-- rollup of the same report), which is why this isn't keyed on report_type
-- alone (that was v1's scheduled_reports table — superseded, see the
-- migration in server.js). Deliberately generic (not specific columns per
-- report) so adding a new report type is a new report_type value, not a
-- schema change. recipients is comma/newline/semicolon-separated, parsed by
-- parseRecipients() — never a JSON array, to keep the admin UI's plain-text
-- paste-a-list workflow trivial.
CREATE TABLE IF NOT EXISTS report_schedules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  report_type    TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  recipients     TEXT,
  frequency      TEXT NOT NULL DEFAULT 'daily',  -- daily | weekly | monthly
  time           TEXT NOT NULL DEFAULT '17:00',
  weekday        INTEGER NOT NULL DEFAULT 0,      -- 0=Sunday..6=Saturday, weekly only
  day_of_month   INTEGER NOT NULL DEFAULT 1,      -- 1-31, monthly only (clamped to month length)
  -- Written by scheduledReports.runAndRecord() after every send attempt —
  -- automatic (scheduler tick) or manual ("שלח עכשיו לבדיקה") — so the admin
  -- UI can show "did this actually run" rather than only "is it turned on".
  last_sent_at   TEXT,
  last_run_status TEXT,  -- 'success' | 'error', NULL = never run
  last_run_error TEXT,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_report_schedules_type ON report_schedules(report_type);

-- v1 of scheduled reports (one row per report_type, one schedule each) — kept
-- only so server.js can migrate any already-configured schedule into
-- report_schedules on first boot after the upgrade. No longer written to.
CREATE TABLE IF NOT EXISTS scheduled_reports (
  report_type  TEXT PRIMARY KEY,
  enabled      INTEGER NOT NULL DEFAULT 0,
  recipients   TEXT,
  frequency    TEXT NOT NULL DEFAULT 'daily',
  time         TEXT NOT NULL DEFAULT '17:00',
  weekday      INTEGER NOT NULL DEFAULT 0,
  day_of_month INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ════════════════════════════════════════════════════════════════════════════
-- Production recipes (תפ"י) — phase 1: recipe = ORDERED template of steps per
-- product_type, no timing/hours yet. Instance ("worksheet") = frozen copy of
-- the template after a תפ"י operator has resolved alt_groups/optional steps
-- for one specific quote. Additive, isolated from the pricing engine above.
-- ════════════════════════════════════════════════════════════════════════════

-- Physical stations/machines: ווטק5, אר-3, לייזר, סומא, חדר צבע, ידני, ספק חוץ.
CREATE TABLE IF NOT EXISTS production_stations (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  key  TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other'  -- print | cut | finish | external | other
);

-- Vocabulary of operations (קדם הדפסה, הדפסה, חיתוך, קילוף, הדבקת 3M, ...).
CREATE TABLE IF NOT EXISTS production_operations (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  key  TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

-- One recipe per product_type (the calculator's productType key, e.g.
-- 'lokobond_diecut', 'pvc_white') — NOT per family/SKU, since sibling
-- product_types in the same family can need different stations (005: perspex
-- goes to laser, PVC goes to soma).
CREATE TABLE IF NOT EXISTS production_recipes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_type TEXT NOT NULL UNIQUE,
  notes        TEXT
);

-- The recipe template's steps. alt_group lets a תפ"י choose between
-- interchangeable options that share the same group value — covers both an
-- order swap (001 לוקובונד: print-then-cut vs cut-then-print) and a station
-- swap (013 שטיח: אר-3 vs ווטק5) with the same mechanism.
CREATE TABLE IF NOT EXISTS production_recipe_steps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id      INTEGER NOT NULL REFERENCES production_recipes(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  operation_key  TEXT    NOT NULL REFERENCES production_operations(key),
  station_key    TEXT    REFERENCES production_stations(key),
  performer      TEXT    NOT NULL DEFAULT 'in_house',  -- in_house | external
  is_optional    INTEGER NOT NULL DEFAULT 0,
  condition_text TEXT,   -- free text, e.g. "רק בדייקאט", "רק אם נבחר גוון"
  alt_group      TEXT,   -- steps sharing this value are mutually-exclusive alternatives
  notes          TEXT
);

-- A frozen, per-quote instance of the resolved recipe — what actually gets
-- printed and handed to the floor. Recipes keep changing; a worksheet, once
-- created, must not silently drift when the template is edited later.
CREATE TABLE IF NOT EXISTS production_worksheets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id     INTEGER NOT NULL REFERENCES signshop_quotes(id) ON DELETE CASCADE,
  line_index   INTEGER NOT NULL DEFAULT 0,  -- which line item within the quote
  product_type TEXT NOT NULL,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS production_worksheet_steps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  worksheet_id   INTEGER NOT NULL REFERENCES production_worksheets(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  operation_key  TEXT    NOT NULL,
  station_key    TEXT,
  performer      TEXT    NOT NULL DEFAULT 'in_house',
  included       INTEGER NOT NULL DEFAULT 1,  -- final תפ"י decision for an optional/alt step
  auto_reason    TEXT,    -- why resolveRecipe() proposed this, e.g. "חלק גדול ⇒ הדפסה לפני חיתוך"
  notes          TEXT
);

-- SQLite doesn't auto-index FK-like columns — these are all looked up by value.
CREATE INDEX IF NOT EXISTS idx_notifications_recipient  ON notifications(recipient_username);
CREATE INDEX IF NOT EXISTS idx_signshop_quotes_created_by ON signshop_quotes(created_by);
CREATE INDEX IF NOT EXISTS idx_quote_attachments_quote     ON signshop_quote_attachments(quote_id);
CREATE INDEX IF NOT EXISTS idx_morning_documents_map_quote ON morning_documents_map(quote_id);
CREATE INDEX IF NOT EXISTS idx_morning_sync_log_quote      ON morning_sync_log(quote_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_send_log_quote     ON whatsapp_send_log(quote_id);
CREATE INDEX IF NOT EXISTS idx_recipe_steps_recipe          ON production_recipe_steps(recipe_id);
CREATE INDEX IF NOT EXISTS idx_worksheets_quote              ON production_worksheets(quote_id);
CREATE INDEX IF NOT EXISTS idx_worksheet_steps_worksheet     ON production_worksheet_steps(worksheet_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token       ON password_resets(token_hash);
