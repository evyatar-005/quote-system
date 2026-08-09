// SMTP config (admin) + password-reset flow — talks to our own backend
// (src/routes/smtp.js, src/routes/auth.js forgot/reset endpoints).

const TOKEN_KEY = 'auth_token';

const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

// Mirrors base44Client.js's `request` helper — kept local here since
// base44Client doesn't export its internal helper (same convention as
// morningClient.js).
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

/** Current SMTP credentials/config (admin only). Throws on failure. */
export function getSmtpConfig() {
  return request('/api/smtp/config');
}

/** Saves SMTP credentials/config (admin only). Throws on failure. */
export function saveSmtpConfig(config) {
  return request('/api/smtp/config', { method: 'PUT', body: config });
}

/** Sends a real test email to the calling admin. Throws on failure. */
export function sendSmtpTest() {
  return request('/api/smtp/test', { method: 'POST' });
}

/** Sends today's delivery-note report right now, ignoring the 17:00 schedule. Throws on failure. */
export function sendDailyReportTest() {
  return request('/api/smtp/test-daily-report', { method: 'POST' });
}

/**
 * Requests a password-reset email. Always resolves with a generic
 * { ok, message } — the backend never reveals whether the username exists.
 */
export function forgotPassword(email) {
  return request('/api/auth/forgot-password', { method: 'POST', body: { email } });
}

/** Sets a new password from a reset-email token. Throws on failure (invalid/expired token). */
export function resetPassword(token, newPassword) {
  return request('/api/auth/reset-password', { method: 'POST', body: { token, newPassword } });
}
