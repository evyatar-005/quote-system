# Changelog

All notable changes to this project are documented here. Versions follow
[Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

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
