# Morning (Green Invoice) API — reference summary

Source: official Morning API docs (morning API Documentation 2.0.0), provided
by the business owner. This file summarizes only the parts used by this
project's integration (`src/services/morning/*`, `src/routes/morning.js`).
For anything not covered here, consult the full docs directly.

## Base URLs

- **Everything, including auth:** `https://api.greeninvoice.co.il/api/v1`

**Correction (2026-07-15) — verified against the live API, not just the PDF
docs:** the PDF ("morning API Documentation 2.0.0") describes an OAuth 2.0
`client_credentials` flow at `https://api.morning.co/idp/v1/oauth/token`.
That host/path returned a plain `404` against the real API when this
integration was first tested with real credentials — it is not live (yet, or
for this account). The actual working auth endpoint, confirmed by probing it
directly and getting Green Invoice's own structured error codes back (`2014`
"invalid key data" on a malformed body, `401` "invalid credentials" on a
well-formed-but-fake one) instead of a generic 404, is the classic Green
Invoice endpoint documented below. `src/services/morning/client.js` uses
this corrected endpoint, not the PDF's.

## Authentication

`POST /account/token` (on `api.greeninvoice.co.il`, same host as every other call)

Request body:
```json
{ "id": "<API Key Client ID>", "secret": "<API Key Client Secret>" }
```

Response (field name not confirmed against a real success response yet —
client.js accepts either `token` or `accessToken`):
```json
{ "token": "<JWT>" }
```

- The token has no documented expiry on this endpoint; `client.js` refreshes
  proactively after 55 minutes rather than assuming a full hour.
- Send it as `Authorization: Bearer <token>` on every subsequent call.
- A `401` on any authenticated call means the token expired or was
  invalidated — request a new one and retry once (already implemented).

## Documents

`POST /documents` — create a document. Key fields:
- `type` (required) — see Document Type codes below
- `lang` ("he"/"en"), `currency` (3-letter code, e.g. "ILS")
- `vatType` (0 = default, 1 = exempt, 2 = mixed)
- `income[]` — line items: `{ description, quantity, price, currency, vatType, catalogNum?, itemId? }`
- `client` — inline client object, or `{ id: "<existing client id>" }`
- `linkedDocumentIds` — array of existing document IDs this one relates to
  (e.g. converting a quote into an order/invoice)
- `linkType` — `"link"` (related) or `"cancel"` (cancels the other document)
- `date`, `dueDate` (`YYYY-MM-DD`)

Response: created document, including its `id`, `number`, `url` (download
links per language).

`POST /documents/search` — paginated search with filters: `type[]`,
`status[]`, `clientId`, `clientName`, `fromDate`/`toDate`, etc.

`GET /documents/{id}` — fetch a single document (includes `linkedDocuments`,
`income`, `payment`, `url`).

`GET /documents/{id}/linked` — documents linked to a given document.

`GET /documents/types?lang=he` — `{ id, name }` pairs, localized.

### Document Type codes (`DocumentType`)
| Code | Hebrew | Used for |
|---|---|---|
| 10  | הצעת מחיר       | Quote |
| 20  | חשבון / אישור תשלום | |
| 100 | הזמנה           | Order |
| 200 | תעודת משלוח     | |
| 210 | תעודת החזרה     | |
| 300 | חשבון עסקה      | Deal invoice |
| 305 | חשבונית מס      | Tax invoice |
| 320 | חשבונית מס / קבלה | Tax invoice + receipt |
| 330 | חשבונית זיכוי   | Credit note |
| 400 | קבלה            | Receipt |
| 405 | קבלה על תרומה   | |
| 410 | ביטול תרומה     | |
| 500 | הזמנת רכש       | |
| 600 | קבלת פיקדון     | |
| 610 | משיכת פיקדון    | |

### VAT type (`DocumentVatType`)
| Value | Meaning |
|---|---|
| 0 | Default (based on business type) |
| 1 | Exempt (VAT-free) |
| 2 | Mixed |

### Currency — this project only ever uses `ILS` (שקל).

## Clients

`POST /clients` — create. Key fields: `name` (required), `taxId`, `address`,
`city`, `zip`, `country` (default `IL`), `phone`, `mobile`, `emails[]`.

`POST /clients/search` — filters: `name`, `active`, `email`, `contactPerson`,
`labels[]`. Paginated (`page`, `pageSize`).

`GET /clients/{id}` / `PUT /clients/{id}` / `DELETE /clients/{id}`.

This project has no local "customers" table — `signshop_quotes.client_name`
is free text. `morning_clients_map` caches `client_name → Morning client id`
so we don't re-search/re-create on every call.

## Items (catalog) — not used in this integration

Morning supports a reusable item catalog (`/items`), but this project sends
line items inline on each document (`income[]`) built from the quote's own
`line_items` JSON — no catalog sync needed for the current scope.

## Errors

Error responses are in Hebrew. Common ones relevant here:
- `401` — token expired/invalid → re-authenticate.
- `2410` — missing `client` field on a document create request.
- `2413` — must provide at least one service/item row.
- `2429` — linked document not found (bad `linkedDocumentIds`).

## Explicitly out of scope for this integration

Suppliers, Expenses, Payments (hosted forms / saved card tokens), Partners
(multi-user OAuth), Webhooks, and the Reference (countries/currencies/business
categories) endpoints all exist in the full API but are not used here — this
project only needs Documents + Clients for quote → order/invoice conversion.
