// Morning ("חשבונית ירוקה") integration — talks to our own backend, which
// holds the real Morning API credentials and proxies every call
// (`src/routes/morning.js`). Nothing here ever touches Morning directly.

const TOKEN_KEY = 'auth_token';

const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

// Mirrors base44Client.js's `request` helper (same auth header + JSON error
// shape) so every fetch in the app behaves consistently — kept local here
// since base44Client doesn't export its internal helper.
async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(path, opts);

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
      else if (data && data.message) message = data.message;
    } catch {
      // non-JSON error body — keep default message
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Issues (creates) a Morning quote document for this quote. Never throws —
 * the call site (agent's "הנפק הצעת מחיר" button) doesn't wrap this in its
 * own try/catch beyond an outer one for the Quote.create call, so a thrown
 * error here would surface as a worse, generic failure instead of the clear
 * "not connected" / reason message the UI already knows how to show.
 */
export async function issueQuoteToMorning(quote) {
  try {
    const document = await request(`/api/morning/quotes/${quote.id}/document`, {
      method: 'POST',
      body: { type: 'quote' },
    });
    return { issued: true, document };
  } catch (err) {
    return { issued: false, reason: err?.message || 'unknown_error' };
  }
}

/**
 * Converts (or creates, if none exists yet) this quote's Morning document to
 * `toType`. Throws on failure — the manager-side caller in
 * QuoteDetailsModal.jsx catches it and shows a toast.
 *
 * `options` lets callers pass `clientEmail`/`clientVatId` (optional — enriches
 * Morning's client card when supplied, never required). Each key is only
 * included in the body when explicitly provided, keeping this backward
 * compatible with the original 2-arg call shape.
 */
export async function convertMorningDocument(quoteId, toType, { clientEmail, clientVatId } = {}) {
  return request(`/api/morning/quotes/${quoteId}/convert`, {
    method: 'POST',
    body: {
      toType,
      ...(clientEmail !== undefined ? { clientEmail } : {}),
      ...(clientVatId !== undefined ? { clientVatId } : {}),
    },
  });
}

/**
 * Generates a standalone Morning payment link for this quote (POST
 * /payments/form on the backend) — independent of any order/quote document
 * already issued; Morning only creates its own receipt once the customer
 * actually pays, so this never converts or closes an existing order. Throws
 * on failure (e.g. no payment plugin configured on the Morning account).
 */
export async function createPaymentLink(quoteId) {
  const { url } = await request(`/api/morning/quotes/${quoteId}/payment-link`, { method: 'POST' });
  return url;
}

/** Full document + audit-log history for one quote. Throws on failure. */
export async function getMorningHistory(quoteId) {
  return request(`/api/morning/quotes/${quoteId}/history`);
}

/** Client-search autocomplete for the quote form. `query` may be empty — omitting
 * the `q` param entirely then lists Morning's clients (browse mode). Throws on failure. */
export async function searchMorningClients(query) {
  const q = (query || "").trim();
  const { items } = await request(`/api/morning/clients/search${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return items;
}

/** Explicitly creates (or updates) a Morning client right away — used by the
 * calculator's "לקוח חדש" flow. Throws on failure. */
export async function createMorningClient({ name, phone, address, vatId, email, paymentTerms }) {
  return request(`/api/morning/clients`, {
    method: "POST",
    body: { name, phone, address, vatId, email, paymentTerms },
  });
}

/** Latest Morning document per quote id, batched for a list view. Throws on failure. */
export async function getLatestMorningDocuments(quoteIds) {
  return request(`/api/morning/quotes/documents?ids=${quoteIds.join(',')}`);
}

/**
 * Quotes/orders issued straight from Morning, with no quote in this system
 * behind them: { quotesCount, ordersCount, ordersRevenue, orders[] }.
 * Revenue only — those documents carry no cost breakdown of ours, so there is
 * deliberately no profit figure to read. Throws on failure.
 */
export async function getMorningDirectActivity({ fromDate, toDate } = {}) {
  const params = new URLSearchParams();
  if (fromDate) params.set('fromDate', fromDate);
  if (toDate) params.set('toDate', toDate);
  const qs = params.toString();
  return request(`/api/morning/direct-activity${qs ? `?${qs}` : ''}`);
}

/** Current Morning credentials/config (admin only). Throws on failure. */
export async function getMorningConfig() {
  return request('/api/morning/config');
}

/** Saves Morning credentials/config (admin only). Throws on failure. */
export async function saveMorningConfig(config) {
  return request('/api/morning/config', { method: 'PUT', body: config });
}
