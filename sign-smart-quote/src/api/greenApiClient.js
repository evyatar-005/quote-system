// GreenAPI (WhatsApp) config — talks to src/routes/greenapi.js. Same local
// request() helper pattern as morningClient.js/systemClient.js.

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

/** Current GreenAPI credentials/config (admin only). Throws on failure. */
export async function getGreenApiConfig() {
  return request('/api/greenapi/config');
}

/** Saves GreenAPI credentials/config (admin only). Throws on failure. */
export async function saveGreenApiConfig(config) {
  return request('/api/greenapi/config', { method: 'PUT', body: config });
}
