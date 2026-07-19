# Changelog

All notable changes to this project are documented here. Versions follow
[Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

## [1.0.9] - 2026-07-19

Calculator fixes: line-item SKUs sent to Morning, shipping always its own
line, one consolidated product-lock mechanism (fixing a triple-"ערוך" bug),
and payment-adjusted picker prices.

- **Morning line items now carry a SKU** (`sku` field on each income row) —
  fixed-price catalog products (kapa/rollup/glass) use their own per-row
  SKU, everything else its static מק"ט (`MultiProductCalculator.jsx`).
- **Shipping/pickup is now always its own line** in the Morning document
  (`buildLineItems`) — "משלוח לכתובת X" with the real shipping cost, or
  "איסוף עצמי" at ₪0 — instead of being invisible/folded into the total.
- **Fixed a triple-"ערוך" (edit) bug**: locking a product card previously
  went through three separate, overlapping lock mechanisms (`CalculatorForm`'s
  `itemLocked`, `CalculatorTab`'s `baseLocked`, and `MultiProductCalculator`'s
  `lockedIds`), each rendering its own summary/edit control. Consolidated
  into one — `MultiProductCalculator`'s `lockedIds` — with `initialFormData`
  now correctly threaded back down so re-opening a locked card doesn't lose
  what was already entered.
- **Required fields expanded**: client address and document title are now
  required before issuing (matching phone, added in 1.0.6) — a WhatsApp/
  Morning document needs somewhere real to go and a real title.
- **מידה 2+ (extra-size) rows** redesigned to match the main product row's
  single-line Morning-style layout instead of a separate boxed sub-form.
- Catalog picker prices (kapa/rollup/glass) now reflect the order's actual
  payment method (cash vs. installments surcharge) instead of always
  showing the flat cash price, which could mismatch the price actually
  charged once picked.

## [1.0.8] - 2026-07-16

`deploy/UPDATE.ps1` now protects the production database against ever being
lost, including across a full delete-and-reclone of the install folder.

- Every update backs up `database.sqlite` to a location **outside**
  `C:\quote-system` (a sibling folder, `quote-system-backups`) — not just
  the existing in-repo `backups\` copy — so the backup survives even if the
  whole app folder is deleted and re-cloned from scratch.
- If a deploy finds no `database.sqlite` at all (a fresh clone), it now
  automatically restores the last known-good backup from that external
  location before starting the server, instead of booting with an empty,
  freshly-seeded database. Prompted directly by a real incident this
  session: a clean reinstall from GitHub wiped all configured pricing/
  credentials/users because that data only ever lived in the (correctly
  gitignored) database file, never in git.

## [1.0.7] - 2026-07-16

Kapa shelf cost now visible inline where the agent sets the quantity.

- The קאפה ("Kapa") product card shows a live "עלות מדפים" (shelf cost)
  figure next to the shelf-quantity inputs, computed from
  `kapa_shelf_standard_price`/`kapa_shelf_custom_price` — previously this
  was only visible after the fact, folded into the line's total or in the
  separate cost-breakdown views (`CostResults.jsx`, `QuoteDetailsModal.jsx`).
  Now also shown in both the per-product "אישור פרטי מוצר" confirmed card
  (`CalculatorForm.jsx`) and the multi-product collapsed summary row
  (`MultiProductCalculator.jsx`).

## [1.0.6] - 2026-07-16

Required client phone, Morning client-search, automatic WhatsApp delivery
(GreenAPI), a first monday.com admin tab, and order-conversion straight from
the quotes list.

- **Client phone is now required** on every quote (`client_phone` column on
  `signshop_quotes`, enforced in `quoteCreate`) — needed so a document can be
  sent to the client automatically.
- **Client search** on the quote form — typing a name searches Morning's
  existing clients live (`GET /api/morning/clients/search`) via a new
  combobox (`ClientSearchField.jsx`); picking one fills phone/address.
  A brand-new client (not picked from search) is now registered in Morning
  **at quote-save time**, not only when a document is later issued.
- **GreenAPI (WhatsApp) integration** — every Morning document
  created/converted is automatically sent to the client's WhatsApp as a PDF
  (`src/services/greenapi/{client,send}.js`), with its own admin settings
  tab and a `whatsapp_send_log` audit table. Verified against GreenAPI's
  real API docs (`sendFileByUrl`) before implementing.
- **monday.com admin tab** — API token + board/group picker (populated live
  from monday's GraphQL API once a token is saved). Auto-filling a new
  order's fields on "הפוך להזמנה" is intentionally not built yet — it needs
  the real column layout of the target board, inspected once real
  credentials are provided.
- **Quotes list (`/quotes`)** — each row with a Morning document now shows
  its document number/type and a "הצג מסמך" button (PDF in a popup, not a
  new tab), plus a "הפוך להזמנה" button to convert it to an order without
  opening the quote's detail view. Backed by a new batched lookup endpoint
  (`GET /api/morning/quotes/documents`) instead of one call per row.

## [1.0.5] - 2026-07-15

Morning (Green Invoice) integration, self-update from the admin UI, and the
versioning/update infrastructure this release itself ships through.

- **Morning (Green Invoice) API integration** — every quote can now be
  issued as a real accounting document and converted between document
  types, fully through Morning's live API (not a stub):
  - `src/services/morning/{client,sync,mappings}.js` — OAuth-style token
    auth, client lookup/creation, document create/convert, all against
    `https://api.greeninvoice.co.il/api/v1` (with a real sandbox host,
    `sandbox.d.greeninvoice.co.il`, available via a per-account toggle)
  - New DB tables: `morning_credentials`, `morning_clients_map`,
    `morning_documents_map`, `morning_sync_log`
  - `src/routes/morning.js` — `GET/PUT /api/morning/config`,
    `POST /api/morning/quotes/:id/document`, `POST /api/morning/quotes/:id/convert`,
    `GET /api/morning/quotes/:id/history`
  - Admin dashboard: standalone "מורנינג" tab for API credentials
    (client ID/secret masked, sandbox toggle)
  - Quote detail view: "הפוך למסמך" buttons (חשבון עסקה / הזמנה / חשבונית
    מס) with a live action history (`docs/morning-api-reference.md` has the
    full field-mapping reference)
  - **Fixed during live testing:** the vendor's PDF docs described an
    OAuth2 `client_credentials` flow at `api.morning.co` that 404s against
    the real API — corrected to the actual working endpoint
    (`POST /account/token` with `{id, secret}`, same host as everything
    else); the sandbox toggle previously did nothing — now genuinely
    switches API hosts. Verified end-to-end: a real quote document (#524)
    was created against the production Green Invoice account.
- **"About" admin tab** — shows the running version/commit/deploy time
  (`GET /api/version`), a "check for updates" button that diffs the current
  git tag against the latest on `origin` (`GET /api/admin/check-update`),
  and an "update now" button that triggers `deploy/UPDATE.ps1` directly
  from the browser (`POST /api/admin/update`, admin-only, refuses to run if
  the working tree isn't clean).
- Versioning/update infrastructure this release itself is delivered
  through: `GET /api/version`, `CHANGELOG.md`, `docs/qa-checklist.md`,
  `deploy/UPDATE.ps1` (backup → checkout tag → rebuild → health-check →
  auto-rollback on failure), auto-start Scheduled Task hardening.

## [1.0.0] - 2026-07-15

Initial production release.

- Quote calculator (cabinet/door + sign-shop products), Hebrew RTL UI
- Admin dashboard: pricing matrices, cost sections, user management
- Auth: username/password login, forced password change on first login
- Notifications, quote approval/decision flow
- Deployed to company Windows Server 2019 (`C:\quote-system`), Node.js via
  a Scheduled Task (`QuoteSystemServer`)
