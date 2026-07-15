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
 */
export async function convertMorningDocument(quoteId, toType) {
  return request(`/api/morning/quotes/${quoteId}/convert`, {
    method: 'POST',
    body: { toType },
  });
}

/** Full document + audit-log history for one quote. Throws on failure. */
export async function getMorningHistory(quoteId) {
  return request(`/api/morning/quotes/${quoteId}/history`);
}

/** Client-search autocomplete for the quote form. Throws on failure. */
export async function searchMorningClients(query) {
  const { items } = await request(`/api/morning/clients/search?q=${encodeURIComponent(query)}`);
  return items;
}

/** Latest Morning document per quote id, batched for a list view. Throws on failure. */
export async function getLatestMorningDocuments(quoteIds) {
  return request(`/api/morning/quotes/documents?ids=${quoteIds.join(',')}`);
}

/** Current Morning credentials/config (admin only). Throws on failure. */
export async function getMorningConfig() {
  return request('/api/morning/config');
}

/** Saves Morning credentials/config (admin only). Throws on failure. */
export async function saveMorningConfig(config) {
  return request('/api/morning/config', { method: 'PUT', body: config });
}
