// Server version + self-update — talks to src/routes/update.js.
// Same local request() helper pattern as morningClient.js (base44Client
// doesn't export its internal one, so each API module keeps its own).

const TOKEN_KEY = 'auth_token';

const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

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
    } catch {
      // non-JSON error body — keep default message
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Current running version — public, no auth required. */
export async function getVersion() {
  return request('/api/version');
}

/** Fetches origin tags and compares against the currently checked-out tag. Admin only. */
export async function checkForUpdate() {
  return request('/api/admin/check-update');
}

/** Triggers deploy/UPDATE.ps1 on the server. Admin only. */
export async function triggerUpdate() {
  return request('/api/admin/update', { method: 'POST' });
}

/** Tail of the most recent deploy/UPDATE.ps1 transcript. Admin only. */
export async function getUpdateLog() {
  return request('/api/admin/update-log');
}
