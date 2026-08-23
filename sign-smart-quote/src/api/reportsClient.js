// Scheduled email reports (admin) — talks to our own backend (src/routes/reports.js).
// A report_type can have several independent schedules at once.

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

/** { [reportType]: Schedule[] } for every known report. Throws on failure. */
export function getReportsConfig() {
  return request('/api/reports/config');
}

/** Creates a new schedule for this report type. Throws on failure. */
export function createSchedule(reportType, schedule) {
  return request(`/api/reports/config/${reportType}`, { method: 'POST', body: schedule });
}

/** Creates a schedule, or updates it if `schedule.id` is already set. Throws on failure. */
export function saveReportConfig(reportType, schedule) {
  return schedule.id
    ? updateSchedule(reportType, schedule.id, schedule)
    : createSchedule(reportType, schedule);
}

/** Updates an existing schedule. Throws on failure. */
export function updateSchedule(reportType, id, schedule) {
  return request(`/api/reports/config/${reportType}/${id}`, { method: 'PUT', body: schedule });
}

/** Deletes a schedule. Throws on failure. */
export function deleteSchedule(reportType, id) {
  return request(`/api/reports/config/${reportType}/${id}`, { method: 'DELETE' });
}

/** Sends this schedule's report right now, using its currently saved config. Throws on failure. */
export function sendReportTest(reportType, id) {
  return request(`/api/reports/test/${reportType}/${id}`, { method: 'POST' });
}

/** On-demand report, no schedule involved: { recipients, fromDate, toDate }. Throws on failure. */
export function generateReport(reportType, { recipients, fromDate, toDate }) {
  return request(`/api/reports/generate/${reportType}`, { method: 'POST', body: { recipients, fromDate, toDate } });
}

/** Renders the report without sending it: { subject, html, count }. Throws on failure. */
export function previewReport(reportType, { fromDate, toDate }) {
  return request(`/api/reports/preview/${reportType}`, { method: 'POST', body: { fromDate, toDate } });
}
