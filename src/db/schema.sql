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

-- Kapa add-on deals ("מבצעים") — a fixed-quantity package price for one of
-- the 4 kapa add-ons (standard/custom shelf, legs, colored shelf). mode
-- 'override' replaces the regular qty × unit-price entirely; 'additive'
-- adds the deal price on top of the regular qty × unit-price.
CREATE TABLE IF NOT EXISTS signshop_kapa_deals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_key  TEXT NOT NULL,   -- standardShelf | customShelf | legs | coloredShelf
  qty          REAL NOT NULL DEFAULT 1,
  price        REAL NOT NULL DEFAULT 0,
  mode         TEXT NOT NULL DEFAULT 'additive'  -- additive | override
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
  agent_note       TEXT,  -- free-text background from the agent when sending for review; manager-only, never shown on the client-facing document
  -- How this quote came into being, so a list can say WHY two rows look like the
  -- same deal. 'new' = built from scratch; 'duplicate' = "שכפל" of an existing
  -- quote; 'manager_discount' = saved out of the manager review screen after a
  -- discount/pricing-mode change. The last two always carry parent_quote_number
  -- and supersede that parent in every count.
  origin           TEXT DEFAULT 'new'
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

-- InforU (official WhatsApp Business API, a Meta-approved BSP) credentials —
-- one row, admin-only, same shape as greenapi_credentials.
CREATE TABLE IF NOT EXISTS inforu_credentials (
  id         INTEGER PRIMARY KEY,
  username   TEXT,
  api_token  TEXT,
  base_url   TEXT,   -- NULL = https://capi.inforu.co.il
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Raw PullData responses, written BEFORE anything is parsed out of them.
-- InforU's inbound pull is DESTRUCTIVE: once pulled, a message is gone from
-- their queue forever, so a parse bug must never be able to lose a customer's
-- message. Rows are tiny and are never pruned.
--
-- NOTE: replaying a batch after fixing a bug creates DUPLICATE crm_messages —
-- inbound carries no provider message id, so there is no idempotency key to
-- dedupe on. Recovery is a deliberate manual operation, not automatic.
CREATE TABLE IF NOT EXISTS inforu_pull_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pull_type  TEXT NOT NULL,
  raw_json   TEXT NOT NULL,
  item_count INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

-- Every outgoing mail attempt, success or failure, with the mail server's own
-- answer. Exists because this system is administered by people with no shell
-- access to the host: without a persisted record, a send that SMTP accepted
-- but never delivered (or accepted for only some recipients) is invisible —
-- the UI just says "sent" and the truth lives only in console output nobody
-- can read. `accepted`/`rejected` come straight from nodemailer's info.
CREATE TABLE IF NOT EXISTS mail_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  context       TEXT,               -- e.g. 'report:delivery_notes', 'smtp-test'
  to_addresses  TEXT,
  subject       TEXT,
  success       INTEGER NOT NULL,
  accepted      TEXT,               -- comma-separated, from the mail server
  rejected      TEXT,               -- comma-separated, from the mail server
  response      TEXT,               -- raw SMTP response line
  error_message TEXT,
  from_address  TEXT,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
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
  days_of_week   TEXT,                            -- daily only; CSV of 0=Sunday..6=Saturday, NULL/empty = every day
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

-- ════════════════════════════════════════════════════════════════════════════
-- CRM — Phase 1: unified customer record + lead pipeline + campaigns.
-- Additive only: signshop_quotes keeps every client_* column it has; the new
-- customer_id/lead_id columns on it (added via ALTER in server.js) are
-- nullable and backfilled, so every existing quote code path keeps working
-- untouched. Later CRM phases (Monday sync, omni-channel inbox, WhatsApp
-- campaigns, telephony, agent metrics) add their own tables the same way.
-- ════════════════════════════════════════════════════════════════════════════

-- The one customer record everything else will hang off. phone_e164 is the
-- join key across channels (WhatsApp chatId, caller-ID, quote client_phone) —
-- always normalized via services/crm/phone.js, never raw input.
CREATE TABLE IF NOT EXISTS customers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name       TEXT NOT NULL,
  phone_e164         TEXT,
  phone_raw          TEXT,
  email              TEXT,
  vat_id             TEXT,
  address            TEXT,
  company            TEXT,
  source             TEXT,               -- quote_backfill | monday | whatsapp_inbound | call_inbound | manual
  owner_username     TEXT,
  status             TEXT NOT NULL DEFAULT 'active',   -- active | archived | blocked
  morning_client_id  TEXT,
  tags               TEXT,
  notes              TEXT,
  marketing_consent  INTEGER NOT NULL DEFAULT 0,        -- 0 = no bulk marketing sends (see CRM plan §10.4)
  merged_into_id     INTEGER REFERENCES customers(id),  -- non-NULL = this row is a dedupe tombstone
  created_by         TEXT,
  created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_e164);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_username);
CREATE INDEX IF NOT EXISTS idx_customers_name  ON customers(display_name);
-- The partial UNIQUE index on phone_e164 is created in server.js, not here —
-- same reasoning as idx_users_email_unique: a live DB's backfill can produce
-- duplicates, and this file is exec'd unguarded at every boot.

CREATE TABLE IF NOT EXISTS crm_campaigns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  channel    TEXT,                       -- facebook | google | landing | offline
  status     TEXT NOT NULL DEFAULT 'active',   -- active | paused | ended
  started_at TEXT,
  ended_at   TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per inbound opportunity, always attached to a customer.
CREATE TABLE IF NOT EXISTS crm_leads (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id    INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  campaign_id    INTEGER REFERENCES crm_campaigns(id),
  source         TEXT NOT NULL DEFAULT 'manual',   -- monday | whatsapp | call | manual | quote
  external_ref   TEXT,       -- monday item id, ad click id, ...
  status         TEXT NOT NULL DEFAULT 'new',      -- new | contacted | quoted | won | lost | disqualified
  lost_reason    TEXT,
  assigned_to    TEXT,       -- users.username
  title          TEXT,
  notes          TEXT,
  quote_id       INTEGER REFERENCES signshop_quotes(id),
  value_estimate REAL,
  -- Metrics anchors: first_touch_at is written exactly once, by a single
  -- touchLead() helper, so "time to first response" can never drift.
  first_touch_at TEXT,
  first_touch_by TEXT,
  closed_at      TEXT,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Who last set follow_up_date — 'agent' (our UI, PUT .../follow-up) or
  -- 'monday' (mondaySync's poll). The poller must never overwrite an agent's
  -- own schedule with monday's (usually date-only, sometimes empty) value —
  -- see mondaySync.js's updateFollowUp.
  follow_up_source TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_leads_customer ON crm_leads(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_status   ON crm_leads(status);
CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned ON crm_leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_leads_campaign ON crm_leads(campaign_id);
-- Makes a future Monday-sync poller idempotent: one lead per (source, external_ref).
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_leads_ext ON crm_leads(source, external_ref)
  WHERE external_ref IS NOT NULL;

-- Cross-cutting note/audit trail for a customer or lead (manual notes today;
-- status-change/assignment/merge entries land here in later CRM phases too).
CREATE TABLE IF NOT EXISTS crm_activity_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER,
  lead_id      INTEGER,
  type         TEXT NOT NULL,   -- note | status_change | assignment | merge | quote_linked
  summary      TEXT,
  payload_json TEXT,
  actor        TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_crm_activity_customer ON crm_activity_log(customer_id, created_at);

-- One-row CRM settings, admin-edited — same pattern as morning_credentials/
-- greenapi_credentials. Fields for later phases (WhatsApp/telephony provider,
-- queue pacing, lock TTLs) are included now so later phases are pure ALTER-free
-- additions of new tables, not schema churn on this one.
CREATE TABLE IF NOT EXISTS crm_settings (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  whatsapp_provider        TEXT NOT NULL DEFAULT 'greenapi',  -- greenapi | meta_cloud | none
  bulk_provider             TEXT,                              -- NULL = same as whatsapp_provider
  telephony_provider        TEXT NOT NULL DEFAULT 'none',
  monday_poll_enabled       INTEGER NOT NULL DEFAULT 0,
  global_daily_send_cap     INTEGER NOT NULL DEFAULT 300,
  queue_min_delay_sec       INTEGER NOT NULL DEFAULT 25,
  queue_max_delay_sec       INTEGER NOT NULL DEFAULT 90,
  idle_timeout_sec          INTEGER NOT NULL DEFAULT 300,
  lock_ttl_sec              INTEGER NOT NULL DEFAULT 120,
  auto_optout_keywords      TEXT NOT NULL DEFAULT 'הסר,הסירו,STOP,UNSUBSCRIBE',
  updated_at                TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ════════════════════════════════════════════════════════════════════════════
-- CRM — Phase 2: two-way monday.com sync. A board maps to one crm_campaigns
-- row; column_map/status_values are resolved from the REAL board via
-- GET /api/monday-sync/boards/:boardId/columns, never guessed (a wrong
-- column id would silently write into the wrong field on the board).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS monday_board_map (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id          TEXT NOT NULL UNIQUE,
  board_name        TEXT,
  campaign_id       INTEGER REFERENCES crm_campaigns(id),
  column_map        TEXT NOT NULL DEFAULT '{}',   -- {"phone":"phone_1","email":"email_2","name":"name"}
  status_column_id  TEXT,                          -- the status column we PUSH won/lost/quoted into
  status_values     TEXT NOT NULL DEFAULT '{}',    -- {"won":"זכה","lost":"אבד","quoted":"נשלחה הצעה"}
  pull_enabled      INTEGER NOT NULL DEFAULT 1,
  push_enabled      INTEGER NOT NULL DEFAULT 1,
  poll_minutes      INTEGER NOT NULL DEFAULT 10,
  last_polled_at    TEXT,
  last_error        TEXT,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per monday item ever pulled — makes the poller idempotent
-- (UNIQUE(board_id, monday_item_id)) and lets the pusher know what it last
-- wrote so it never re-pushes an identical status.
CREATE TABLE IF NOT EXISTS monday_item_map (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id            TEXT NOT NULL,
  monday_item_id      TEXT NOT NULL,
  lead_id             INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
  customer_id         INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  last_pulled_at      TEXT,
  last_pushed_at      TEXT,
  last_pushed_status  TEXT,
  raw_json            TEXT,
  UNIQUE (board_id, monday_item_id)
);
CREATE INDEX IF NOT EXISTS idx_monday_item_map_lead ON monday_item_map(lead_id);

CREATE TABLE IF NOT EXISTS monday_sync_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  direction       TEXT NOT NULL,      -- pull | push | webhook
  board_id        TEXT,
  monday_item_id  TEXT,
  lead_id         INTEGER,
  success         INTEGER NOT NULL,
  request_json    TEXT,
  response_json   TEXT,
  error_message   TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_monday_sync_log_item ON monday_sync_log(monday_item_id);

-- ════════════════════════════════════════════════════════════════════════════
-- CRM — Phase 3: channel-agnostic conversations + shared WhatsApp inbox.
-- One conversation per (customer, channel, channel_thread_id); locking is
-- DB-authoritative (conversation_id as PRIMARY KEY on the lock table) so two
-- agents can never hold the same thread regardless of what the realtime
-- layer (SSE) does or doesn't deliver. See CLAUDE.md CRM plan §2, §6.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS crm_conversations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id       INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  lead_id           INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
  channel           TEXT NOT NULL DEFAULT 'whatsapp',   -- whatsapp | email | sms | internal
  provider          TEXT,                                -- greenapi | meta_cloud
  channel_thread_id TEXT NOT NULL,                        -- provider's own thread handle (GreenAPI chatId)
  subject           TEXT,
  status            TEXT NOT NULL DEFAULT 'open',         -- open | pending | closed
  assigned_to       TEXT,                                 -- sticky owner (users.username) — distinct from the transient lock
  unread_count      INTEGER NOT NULL DEFAULT 0,
  last_message_at   TEXT,
  last_inbound_at   TEXT,
  last_outbound_at  TEXT,
  first_response_ms INTEGER,
  closed_at         TEXT,
  closed_by         TEXT,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_conv_thread ON crm_conversations(channel, channel_thread_id);
CREATE INDEX IF NOT EXISTS idx_crm_conv_customer ON crm_conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_conv_status ON crm_conversations(status, last_message_at);

CREATE TABLE IF NOT EXISTS crm_messages (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id       INTEGER NOT NULL REFERENCES crm_conversations(id) ON DELETE CASCADE,
  direction             TEXT NOT NULL,     -- in | out
  body                  TEXT,
  media_url             TEXT,
  media_mime            TEXT,
  media_filename        TEXT,
  message_type          TEXT NOT NULL DEFAULT 'text',    -- text | image | document | audio | video | template | system
  provider              TEXT,
  provider_message_id   TEXT,
  status                TEXT NOT NULL DEFAULT 'received', -- queued | sent | delivered | read | failed | received
  error_message         TEXT,
  sent_by               TEXT,             -- users.username on outbound, NULL on inbound
  campaign_id           INTEGER,          -- non-NULL = bulk-campaign message (wa_campaigns, added in a later phase)
  raw_json              TEXT,
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_crm_messages_conv ON crm_messages(conversation_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_messages_provider_id
  ON crm_messages(provider, provider_message_id) WHERE provider_message_id IS NOT NULL;

-- Shared-inbox claiming: conversation_id is the PRIMARY KEY (not a history
-- table) — the DB itself, not app logic, guarantees at most one live holder.
CREATE TABLE IF NOT EXISTS crm_conversation_locks (
  conversation_id INTEGER PRIMARY KEY REFERENCES crm_conversations(id) ON DELETE CASCADE,
  username        TEXT NOT NULL,
  acquired_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  heartbeat_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_locks_user ON crm_conversation_locks(username);

-- Closed lock spans — raw input for a future "avg handling time" metric
-- (Phase 6). Written whenever a lock is released/closed/expired/stolen.
CREATE TABLE IF NOT EXISTS crm_conversation_handling (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  username        TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  end_reason      TEXT,    -- released | closed | expired | stolen
  duration_sec    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conv_handling_user ON crm_conversation_handling(username, started_at);

-- Single outbound queue — every WhatsApp send (1:1 reply today; bulk
-- campaigns in a later phase) goes through here so pacing/rate-limits are
-- enforced in exactly one place. priority: 1:1 replies = 10 (near-immediate).
CREATE TABLE IF NOT EXISTS wa_send_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  provider        TEXT,             -- NULL = whatever is active at drain time
  channel         TEXT NOT NULL DEFAULT 'whatsapp',
  to_e164         TEXT NOT NULL,
  conversation_id INTEGER REFERENCES crm_conversations(id) ON DELETE CASCADE,
  message_id      INTEGER REFERENCES crm_messages(id) ON DELETE CASCADE,
  campaign_id     INTEGER,
  recipient_id    INTEGER,
  payload_json    TEXT NOT NULL,    -- {kind:'text'|'media'|'template', ...} as passed to the adapter
  priority        INTEGER NOT NULL DEFAULT 100,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | sending | sent | failed | cancelled
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_wa_queue_ready ON wa_send_queue(status, next_attempt_at, priority);

-- ════════════════════════════════════════════════════════════════════════════
-- CRM — Phase 4: bulk WhatsApp broadcasts ("דיוור"), reusable templates, and
-- the opt-out register.
--
-- Naming, deliberately: crm_campaigns = a LEAD SOURCE ("קמפיין"). wa_campaigns
-- = an OUTBOUND BLAST ("דיוור"). They are joined, not confused: a דיוור can
-- target everyone whose lead came from a given קמפיין.
--
-- Sends never bypass wa_send_queue — a דיוור is just N queued rows at priority
-- 100, paced by the drainer in jobs.js. There is no second sender.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS message_templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'marketing',  -- marketing | service | utility
  channel       TEXT NOT NULL DEFAULT 'whatsapp',
  body          TEXT NOT NULL,      -- may contain {{name}} {{first_name}} {{company}} {{agent}} {{last_quote_date}}
  media_url     TEXT,               -- non-NULL = send as media with `body` as the caption
  media_filename TEXT,
  provider_template_name TEXT,      -- Meta Cloud pre-approved id; NULL for GreenAPI (supportsTemplates=false)
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_message_templates_active ON message_templates(is_active, category);

-- The legal record of "do not market to this number". Keyed by phone_e164, NOT
-- customer_id: the same person may exist under two customer rows before a
-- merge, and an inbound reply arrives carrying only a phone number. Rows are
-- never hard-deleted — an opt-IN writes revoked_at and keeps the history.
CREATE TABLE IF NOT EXISTS crm_opt_outs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_e164  TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  channel     TEXT NOT NULL DEFAULT 'whatsapp',
  source      TEXT NOT NULL DEFAULT 'keyword',  -- keyword | manual | import | complaint
  keyword     TEXT,        -- the exact inbound text that triggered it (audit)
  message_id  INTEGER,     -- crm_messages.id of the triggering inbound message
  campaign_id INTEGER,     -- wa_campaigns.id being reacted to, when known
  actor       TEXT,        -- users.username for source='manual'
  revoked_at  TEXT,        -- non-NULL = re-subscribed; suppression applies only when NULL
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_crm_opt_outs_phone ON crm_opt_outs(phone_e164, revoked_at);

-- One row per דיוור. audience_json is the SAVED FILTER (not the resolved list)
-- so the wizard can be reopened and re-run; the resolved list is frozen into
-- wa_campaign_recipients at build time. `body` is a SNAPSHOT of the template —
-- editing a template later must never change an already-sent דיוור.
CREATE TABLE IF NOT EXISTS wa_campaigns (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft',  -- draft|ready|running|paused|completed|cancelled
  template_id    INTEGER REFERENCES message_templates(id),
  body           TEXT NOT NULL,
  media_url      TEXT,
  media_filename TEXT,
  audience_json  TEXT NOT NULL DEFAULT '{}',
  daily_cap      INTEGER,        -- NULL = only crm_settings.global_daily_send_cap applies
  -- Denormalized progress counters, maintained by the drainer: the campaigns
  -- list must not COUNT() over wa_campaign_recipients once per row.
  total_count    INTEGER NOT NULL DEFAULT 0,
  sent_count     INTEGER NOT NULL DEFAULT 0,
  failed_count   INTEGER NOT NULL DEFAULT 0,
  skipped_count  INTEGER NOT NULL DEFAULT 0,   -- excluded at build time
  replied_count  INTEGER NOT NULL DEFAULT 0,
  optout_count   INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT NOT NULL,
  approved_by    TEXT,           -- who pressed "שלח" (a can_send_campaigns holder)
  started_at     TEXT,
  completed_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wa_campaigns_status ON wa_campaigns(status, created_at);

-- The frozen recipient list, written once at build time then flipped by the
-- drainer. UNIQUE(campaign_id, phone_e164) is what makes "same person under
-- two customer rows" impossible to double-send.
CREATE TABLE IF NOT EXISTS wa_campaign_recipients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id   INTEGER NOT NULL REFERENCES wa_campaigns(id) ON DELETE CASCADE,
  customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  phone_e164    TEXT NOT NULL,
  display_name  TEXT,
  rendered_body TEXT NOT NULL,  -- {{placeholders}} already substituted + footer applied = the exact final text
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|queued|sent|failed|skipped|replied|opted_out
  skip_reason   TEXT,           -- opted_out | no_consent | no_phone | duplicate | blocked
  conversation_id INTEGER REFERENCES crm_conversations(id) ON DELETE SET NULL,
  message_id    INTEGER REFERENCES crm_messages(id) ON DELETE SET NULL,
  queue_id      INTEGER,        -- wa_send_queue.id, for cancel-on-pause
  error_message TEXT,
  sent_at       TEXT,
  replied_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wa_recipients_campaign ON wa_campaign_recipients(campaign_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_recipients_unique ON wa_campaign_recipients(campaign_id, phone_e164);

-- ════════════════════════════════════════════════════════════════════════════
-- CRM — Phase 5: the lead pull-queue ("משוך ליד"), per-agent campaign scoping,
-- and the Drive-backed marketing-materials sender.
--
-- The claim model mirrors Phase 3's conversation locking, with ONE difference:
-- a conversation lock is a 2-minute heartbeat; a lead claim is an OUTCOME
-- lock — released when the agent produces a result (follow-up / lost / quote),
-- not when they stop typing. Hence expires_at is NULLABLE here.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS crm_lead_claims (
  lead_id     INTEGER PRIMARY KEY REFERENCES crm_leads(id) ON DELETE CASCADE,
  username    TEXT NOT NULL,
  acquired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TEXT              -- NULL = never auto-expires (the normal case)
);
CREATE INDEX IF NOT EXISTS idx_crm_lead_claims_user ON crm_lead_claims(username);

-- Closed claim spans — input for "טופל לאחרונה ע״י" and agent metrics.
CREATE TABLE IF NOT EXISTS crm_lead_handling (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id      INTEGER NOT NULL,
  username     TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  end_reason   TEXT,   -- released | follow_up_set | quoted | won | lost | disqualified | expired | stolen
  duration_sec INTEGER
);
CREATE INDEX IF NOT EXISTS idx_crm_lead_handling_lead ON crm_lead_handling(lead_id, id);
CREATE INDEX IF NOT EXISTS idx_crm_lead_handling_user ON crm_lead_handling(username, started_at);

-- Per-agent campaign scoping. NO rows for a username = UNRESTRICTED (draws
-- the globally oldest lead regardless of board). One or more rows = restricted
-- to exactly those campaigns. Allow-list only; no deny-list.
CREATE TABLE IF NOT EXISTS crm_agent_campaigns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL,
  campaign_id INTEGER NOT NULL REFERENCES crm_campaigns(id) ON DELETE CASCADE,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (username, campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_agent_campaigns_user ON crm_agent_campaigns(username);

-- Manually-entered DAILY ad spend per campaign — the ONLY source of cost
-- data for campaign ROI (nothing pulls spend from Facebook/Google; a manager
-- types it in). Without a row for a given campaign+day, that campaign's
-- CPL/CPA/ROAS render as "—" rather than dividing by zero. Daily (not
-- monthly) so it lines up exactly with any custom date range in the
-- profitability table, no substr('YYYY-MM') bucketing needed.
CREATE TABLE IF NOT EXISTS crm_campaign_spend (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES crm_campaigns(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,          -- 'YYYY-MM-DD'
  amount      REAL NOT NULL,
  notes       TEXT,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (campaign_id, day)
);
CREATE INDEX IF NOT EXISTS idx_crm_campaign_spend_day ON crm_campaign_spend(day);

-- Google Drive — same one-row / masked-GET / blank-means-keep credential
-- pattern as morning_credentials, greenapi_credentials, smtp_credentials.
CREATE TABLE IF NOT EXISTS google_drive_credentials (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  auth_mode      TEXT NOT NULL DEFAULT 'api_key',  -- api_key | service_account (reserved)
  api_key        TEXT,
  root_folder_id TEXT,                              -- the link-shared "חומרי שיווק" folder
  sa_json        TEXT,                              -- reserved for auth_mode='service_account'
  cache_ttl_sec  INTEGER NOT NULL DEFAULT 300,
  max_send_mb    INTEGER NOT NULL DEFAULT 16,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Admin-managed "quick sends" — a link or short text (Instagram, website,
-- catalog, ...) an agent can push to a lead's WhatsApp in one click, shown
-- alongside the Drive file browser in the same "חומרי שיווק" panel.
-- `content` is sent to the customer verbatim as a text message.
CREATE TABLE IF NOT EXISTS crm_quick_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,
  content    TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drive_file_cache (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id     TEXT NOT NULL,
  file_id       TEXT NOT NULL,
  name          TEXT,
  mime_type     TEXT,
  size_bytes    INTEGER,
  modified_time TEXT,
  is_folder     INTEGER NOT NULL DEFAULT 0,
  fetched_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (folder_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_drive_file_cache_folder ON drive_file_cache(folder_id, fetched_at);

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

-- One row per raw-material line item extracted, with confidence, from Morning
-- purchase-order documents (type 500). Populated by a one-off scan script,
-- not by the app itself — kept here so the table exists via the normal
-- schema.sql bootstrap instead of a manual ALTER. See docs/morning-api-reference.md.
CREATE TABLE IF NOT EXISTS raw_materials_scan (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  morning_document_id  TEXT NOT NULL,
  document_number      TEXT,
  document_date        TEXT,
  supplier_name        TEXT,
  line_description      TEXT NOT NULL,
  material_name         TEXT,
  length_cm             REAL,
  width_cm               REAL,
  thickness_mm            REAL,
  color                     TEXT,
  finish                     TEXT,
  quantity                   REAL,
  unit_price                  REAL,
  total_price                  REAL,
  currency                      TEXT DEFAULT 'ILS',
  confidence                     TEXT NOT NULL DEFAULT 'medium', -- high | medium
  created_at                      TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_raw_materials_scan_doc ON raw_materials_scan(morning_document_id);

-- Glow signs (004 "שילוט פולט אור") — a fixed catalog of standard photoluminescent
-- safety signs (name + standard size + artwork thumbnail), scraped from the
-- supplier catalog. Unlike kapa/glass/rollup this is NOT a per-row price list:
-- every glow sign is priced off ONE global ₪/מ"ר set in the admin config
-- (glow_price_per_sqm), by explicit request — the rows exist so an agent can
-- pick the right artwork and get its name + dimensions onto the quote line
-- without typing them.
CREATE TABLE IF NOT EXISTS signshop_glow_signs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL DEFAULT 'כללי',
  name        TEXT NOT NULL,
  width_cm    REAL NOT NULL DEFAULT 0,
  height_cm   REAL NOT NULL DEFAULT 0,
  image_file  TEXT NOT NULL DEFAULT '',  -- filename under client public/glow-signs/
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0
);

-- Vista (014 "שילוט משרדי ויסטה") — the Vista System 2026 catalog, kept in the
-- three levels the catalog itself is built on:
--   family  → משפחה   (Vista Classic / Square / Nova / Light ...)
--   product → מוצר    ("Wall Signs - Portrait", "Directories") — one per row here
--   size    → מידה    (V100, V300, F420 ...) — one row per size in the table below
-- A Vista product comes in many frame heights at different prices, so the price
-- lives on the SIZE, never on the product.
CREATE TABLE IF NOT EXISTS signshop_vista_products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family      TEXT NOT NULL DEFAULT '',
  family_he   TEXT NOT NULL DEFAULT '',   -- folder label in the agent's picker
  name        TEXT NOT NULL,               -- vendor's English section name
  name_he     TEXT NOT NULL DEFAULT '',    -- Hebrew label shown to the agent
  page_from   INTEGER NOT NULL DEFAULT 0, -- source pages in the 2026 catalog
  page_to     INTEGER NOT NULL DEFAULT 0,
  image_file  TEXT NOT NULL DEFAULT '',   -- filename under client public/vista-pages/
  -- 1 = the size list was NOT read off this product's own catalog page (that
  -- page is vector art with no text layer) but inherited from its family, so it
  -- may list sizes this particular product doesn't ship in. Shown as a warning
  -- in the admin table; clear it once the list has been checked against the PDF.
  sizes_inherited INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0
);

-- One frame size of one Vista product. `code` is the vendor model code and is
-- also the height in mm (V300 = 300mm) — that is Vista's own naming rule, not
-- an assumption: the catalog prints "V300 (A3)" and "V11 (279)" side by side.
-- price 0 = never configured; the calculator refuses to quote it rather than
-- selling it for nothing (same guard as every other family here).
CREATE TABLE IF NOT EXISTS signshop_vista_sizes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES signshop_vista_products(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  height_mm   REAL NOT NULL DEFAULT 0,
  price       REAL NOT NULL DEFAULT 0,   -- selling price per unit (₪)
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vista_sizes_product ON signshop_vista_sizes(product_id);
