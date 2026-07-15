// Morning ("חשבונית ירוקה") integration — PLACEHOLDER.
//
// There is no live Morning API key/account yet. This module exists so every
// call site (the agent's "הנפק הצעת מחיר" button, the manager's approval
// flow) already has the right shape to call once real credentials show up —
// only `issueQuoteToMorning` below needs to become a real `fetch` call then.
//
// TODO once Morning API access exists:
//   1. Get the API key + base URL + the exact quote-creation endpoint from
//      Morning's docs (https://www.greeninvoice.co.il/ API, likely).
//   2. Map our Quote fields → Morning's expected request body. Best guess so
//      far (confirm against their real schema before wiring this up):
//        client_name        → client.name
//        quote_number       → description / externalId
//      line_items[].description/quantity/unitPrice → income[] rows
//        price_before_vat   → amount (before tax)
//        price_with_vat     → total (after tax)
//        payment_type       → paymentType / installments count
//   3. Store the API key server-side (never in the frontend) — add a
//      `/api/morning/issue-quote` backend route that holds the real secret
//      and proxies the call, instead of calling Morning directly from here.

/**
 * Attempts to issue a quote through Morning. Currently always resolves with
 * `{ issued: false, reason: 'not_configured' }` — never throws — so callers
 * can show a clear "not connected yet" message instead of a crash.
 */
export async function issueQuoteToMorning(quote) {
  console.info('[morningClient] Would issue to Morning (API not connected yet):', {
    quote_number: quote.quote_number,
    client_name: quote.client_name,
    price_before_vat: quote.price_before_vat,
    price_with_vat: quote.price_with_vat,
    payment_type: quote.payment_type,
  });
  return { issued: false, reason: 'not_configured' };
}
