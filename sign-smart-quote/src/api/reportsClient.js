// Scheduled email reports (admin) — talks to our own backend (src/routes/reports.js).

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
// morningClient.js/smtpClient.js).
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

/** { [reportType]: { enabled, recipients, frequency, time, weekday, day_of_month } } for every known report. Throws on failure. */
export function getReportsConfig() {
  return request('/api/reports/config');
}

/** Saves one report type's schedule/recipients. Throws on failure. */
export function saveReportConfig(reportType, config) {
  return request(`/api/reports/config/${reportType}`, { method: 'PUT', body: config });
}

/** Sends this report right now using its currently saved config. Throws on failure. */
export function sendReportTest(reportType) {
  return request(`/api/reports/test/${reportType}`, { method: 'POST' });
}
