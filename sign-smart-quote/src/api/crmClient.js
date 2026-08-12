// CRM Phase 1 client — customers + leads. Same hand-written request() shape
// duplicated across greenApiClient.js/morningClient.js, following the
// existing per-feature-client convention rather than a shared module.

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
      if (data?.error) message = data.error;
    } catch {
      // non-JSON error body
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

const buildQuery = (params) => {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') usp.append(k, v);
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
};

export const crmCustomers = {
  list(params) {
    return request(`/api/crm/customers${buildQuery(params)}`);
  },
  get(id) {
    return request(`/api/crm/customers/${id}`);
  },
  create(data) {
    return request('/api/crm/customers', { method: 'POST', body: data });
  },
  update(id, data) {
    return request(`/api/crm/customers/${id}`, { method: 'PUT', body: data });
  },
  merge(id, intoId) {
    return request(`/api/crm/customers/${id}/merge`, { method: 'POST', body: { into_id: intoId } });
  },
  addNote(id, text) {
    return request(`/api/crm/customers/${id}/notes`, { method: 'POST', body: { text } });
  },
  timeline(id) {
    return request(`/api/crm/customers/${id}/timeline`);
  },
};

export const crmLeads = {
  list(params) {
    return request(`/api/crm/leads${buildQuery(params)}`);
  },
  create(data) {
    return request('/api/crm/leads', { method: 'POST', body: data });
  },
  update(id, data) {
    return request(`/api/crm/leads/${id}`, { method: 'PUT', body: data });
  },
  convert(id, quoteId) {
    return request(`/api/crm/leads/${id}/convert`, { method: 'POST', body: { quote_id: quoteId } });
  },
  monthlyStats() {
    return request('/api/crm/leads/stats/monthly');
  },
};
