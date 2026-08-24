// InforU (official WhatsApp Business API) config — talks to src/routes/inforu.js.
// Same local request() helper pattern as greenApiClient.js/morningClient.js.

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

/** Current InforU credentials/config (admin only). Throws on failure. */
export async function getInforuConfig() {
  return request('/api/inforu/config');
}

/** Saves InforU credentials/config (admin only). Throws on failure. */
export async function saveInforuConfig(config) {
  return request('/api/inforu/config', { method: 'PUT', body: config });
}

/** Meta-approved templates only (ApprovalStatus filtered server-side). */
export async function listInforuTemplates() {
  return request('/api/inforu/templates');
}

/** Read-only probe of GetWhatsAppChats — the store behind InforU's own chat UI. */
export async function testInforuChats({ days, phone } = {}) {
  return request('/api/inforu/test-chats', { method: 'POST', body: { days, phone } });
}

/** Sends an approved template — the only way to open a 24h session window. */
export async function sendTestTemplate({ to, templateId, parameters }) {
  return request('/api/inforu/test-template', { method: 'POST', body: { to, templateId, parameters } });
}
