PRAGMA foreign_keys = ON;

-- Independent raw material cost catalog — NOT used by the pricing engine
CREATE TABLE IF NOT EXISTS raw_materials (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT    NOT NULL,
  sku   TEXT,
  price REAL    NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  sku        TEXT,
  min_width  INTEGER NOT NULL DEFAULT 0,
  min_height INTEGER NOT NULL DEFAULT 0,
  min_price  REAL    NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sub_products (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  sku        TEXT
);

CREATE TABLE IF NOT EXISTS product_variants (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sub_product_id INTEGER NOT NULL REFERENCES sub_products(id) ON DELETE CASCADE,
  thickness      TEXT    NOT NULL,
  price_per_sqm  REAL    NOT NULL,
  minimum_price  REAL    NOT NULL DEFAULT 0
);

-- ════════════════════════════════════════════════════════════════════════════
-- SignCalc Pro — sign-shop pricing engine (ported from base44 reference).
-- Additive + isolated: lives alongside the cabinet/door tables above, never
-- touched by the legacy /api/quote/calculate path. All IF NOT EXISTS so this
-- file can be re-applied on a live database.sqlite without data loss.
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

-- In-app notifications for sales agents — e.g. "your quote was approved by the
-- manager and is ready to issue" or "your quote was rejected". recipient_username
-- ties back to users.username (not email — several accounts have no email set).
CREATE TABLE IF NOT EXISTS notifications (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_username  TEXT NOT NULL,
  quote_id            INTEGER,
  quote_number        TEXT,
  type                TEXT NOT NULL,     -- 'approved' | 'rejected'
  message             TEXT NOT NULL,
  is_read             INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ════════════════════════════════════════════════════════════════════════════
-- Morning (Green Invoice) integration — quote → order/invoice document sync.
-- ════════════════════════════════════════════════════════════════════════════

-- Single row (id=1) holding the API key pair. client_secret is stored in
-- plaintext here (same trust boundary as database.sqlite itself, which is
-- gitignored and never leaves the host) — never returned as-is over the API.
CREATE TABLE IF NOT EXISTS morning_credentials (
  id            INTEGER PRIMARY KEY,
  client_id     TEXT,
  client_secret TEXT,
  base_url      TEXT,
  sandbox       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

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

-- SQLite doesn't auto-index FK-like columns — these are all looked up by value.
CREATE INDEX IF NOT EXISTS idx_notifications_recipient  ON notifications(recipient_username);
CREATE INDEX IF NOT EXISTS idx_sub_products_product      ON sub_products(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_sub      ON product_variants(sub_product_id);
CREATE INDEX IF NOT EXISTS idx_signshop_quotes_created_by ON signshop_quotes(created_by);
CREATE INDEX IF NOT EXISTS idx_quote_attachments_quote     ON signshop_quote_attachments(quote_id);
CREATE INDEX IF NOT EXISTS idx_morning_documents_map_quote ON morning_documents_map(quote_id);
CREATE INDEX IF NOT EXISTS idx_morning_sync_log_quote      ON morning_sync_log(quote_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_send_log_quote     ON whatsapp_send_log(quote_id);
