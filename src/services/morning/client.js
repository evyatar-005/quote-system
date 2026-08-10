// Low-level Morning (Green Invoice) HTTP client — token acquisition/caching
// and a generic authenticated request helper. No business logic here (that's
// ./sync.js); this module only knows how to talk to the API.

// The PDF docs describe an OAuth2 client_credentials flow at api.morning.co —
// that host 404s on the documented path against the real live API. Verified
// directly (curl) that the actual working auth endpoint is the classic Green
// Invoice one, same host as every other call: POST {API_BASE}/account/token
// with {id, secret} — confirmed by getting a structured 401 "invalid
// credentials" (not 404) back from Green Invoice's own error format when
// probing with placeholder values.
const API_BASE = 'https://api.greeninvoice.co.il/api/v1';
// Confirmed via direct probing (same Green Invoice error-code pattern as
// production: 2014 on a malformed body, 401 on a well-formed-but-fake one) —
// this is the real sandbox host, not a guess. Production credentials will
// not authenticate here and vice versa.
const SANDBOX_API_BASE = 'https://sandbox.d.greeninvoice.co.il/api/v1';

function resolveApiBase(creds) {
  if (creds && creds.base_url) return creds.base_url;
  return creds && creds.sandbox ? SANDBOX_API_BASE : API_BASE;
}

// A transport-level failure (DNS, connection reset, TLS, timeout) surfaces
// from fetch() as a bare "fetch failed" with no detail in the message — the
// real reason is in err.cause, which gets silently dropped once this error
// bubbles up to a `catch (err) { ... err.message }` logger (see sync.js).
// Re-throw with the cause folded into the message so morning_sync_log
// actually records something diagnosable instead of just "fetch failed".
async function safeFetch(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (err) {
    const cause = err.cause;
    const causeDetail = cause ? (cause.code || cause.message || String(cause)) : null;
    const enriched = new Error(`Network error calling Morning (${url}): ${err.message}${causeDetail ? ` — ${causeDetail}` : ''}`);
    enriched.cause = cause;
    throw enriched;
  }
}

// Cached in-memory only (never persisted to the DB) — a token is a short-lived
// credential, and this process restarting is a fine time to just fetch a new one.
let cached = { token: null, expiresAt: 0 };

function getCredentials(db) {
  const row = db.prepare(`SELECT * FROM morning_credentials WHERE id = 1`).get();
  if (!row || !row.client_id) throw new Error('Morning is not configured');
  return row;
}

// Transient transport failures (DNS blip, connection reset, a socket that
// went stale while idle) are common on the *first* call after a quiet
// period — the OS/firewall drops an idle keep-alive connection and the next
// fetch dies before ever reaching Morning, even though a retry a moment
// later succeeds fine. Rather than surface that as a user-facing "fetch
// failed" and make the agent click the button again, retry once,
// transparently, before giving up for real.
async function withTransientRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!err.cause) throw err; // not a transport-level failure — don't mask real errors
    await new Promise((r) => setTimeout(r, 300));
    return fn();
  }
}

async function getAccessToken(db) {
  const now = Date.now();
  // Refresh a bit early (60s) rather than exactly at expiry, so a request that
  // starts right before expiry doesn't race a 401 mid-flight.
  if (cached.token && cached.expiresAt - now > 60 * 1000) return cached.token;

  const creds = getCredentials(db);
  const apiBase = resolveApiBase(creds);
  const res = await withTransientRetry(() => safeFetch(`${apiBase}/account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: creds.client_id, secret: creds.client_secret }),
  }));
  const text = await res.text();
  if (!res.ok) throw new Error(`Morning auth failed (${res.status}): ${text}`);

  const data = JSON.parse(text);
  const token = data.token || data.accessToken;
  if (!token) throw new Error(`Morning auth succeeded but no token in response: ${text}`);
  // No documented expiresAt on this endpoint's response — refresh proactively
  // at 55 minutes rather than assume a full hour.
  const expiresAt = data.expiresAt ? data.expiresAt * 1000 : Date.now() + 55 * 60 * 1000;
  cached = { token, expiresAt };
  return cached.token;
}

async function doRequest(db, method, path, body, token) {
  const creds = db.prepare(`SELECT * FROM morning_credentials WHERE id = 1`).get();
  const apiBase = resolveApiBase(creds);
  const res = await withTransientRetry(() => safeFetch(`${apiBase}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }));
  return res;
}

async function request(db, method, path, body) {
  let token = await getAccessToken(db);
  let res = await doRequest(db, method, path, body, token);

  // A 401 here means the cached token expired mid-lifetime (or was invalidated
  // on Morning's side) — clear it and retry exactly once with a fresh one so a
  // single stale token doesn't fail every call until the next natural refresh.
  if (res.status === 401) {
    cached = { token: null, expiresAt: 0 };
    token = await getAccessToken(db);
    res = await doRequest(db, method, path, body, token);
  }

  if (res.ok) {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  const text = await res.text();
  const err = new Error(`Morning API ${method} ${path} failed (${res.status}): ${text}`);
  err.morningResponse = text;
  throw err;
}

module.exports = { getAccessToken, request };
