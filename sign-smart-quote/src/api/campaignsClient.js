// CRM Phase 4 — bulk WhatsApp broadcasts (דיוור), templates, opt-outs.
// Talks to src/routes/campaigns.js. Same local request() helper pattern as
// the other feature clients.

const TOKEN_KEY = 'auth_token';
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };

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
    let data = null;
    try { data = await res.json(); if (data?.error) message = data.error; } catch {}
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const templates = {
  list(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return request(`/api/campaigns/templates${qs ? `?${qs}` : ''}`);
  },
  create(data) { return request('/api/campaigns/templates', { method: 'POST', body: data }); },
  update(id, data) { return request(`/api/campaigns/templates/${id}`, { method: 'PUT', body: data }); },
  remove(id) { return request(`/api/campaigns/templates/${id}`, { method: 'DELETE' }); },
  // agentIsMe makes {{agent}} resolve to the logged-in user instead of the
  // customer's account owner — for 1:1 quick replies. Omit it for campaigns.
  preview(body, customerId, agentIsMe) {
    return request('/api/campaigns/templates/preview', {
      method: 'POST',
      body: { body, customer_id: customerId, agent_is_me: agentIsMe || undefined },
    });
  },
};

export const audience = {
  preview(filters) { return request('/api/campaigns/audience/preview', { method: 'POST', body: { filters } }); },
};

export const campaigns = {
  list() { return request('/api/campaigns'); },
  get(id) { return request(`/api/campaigns/${id}`); },
  create(data) { return request('/api/campaigns', { method: 'POST', body: data }); },
  update(id, data) { return request(`/api/campaigns/${id}`, { method: 'PUT', body: data }); },
  build(id) { return request(`/api/campaigns/${id}/build`, { method: 'POST' }); },
  start(id, confirmCount) { return request(`/api/campaigns/${id}/start`, { method: 'POST', body: { confirm_count: confirmCount } }); },
  pause(id) { return request(`/api/campaigns/${id}/pause`, { method: 'POST' }); },
  resume(id) { return request(`/api/campaigns/${id}/resume`, { method: 'POST' }); },
  cancel(id) { return request(`/api/campaigns/${id}/cancel`, { method: 'POST' }); },
  testSend(id, to) { return request(`/api/campaigns/${id}/test-send`, { method: 'POST', body: { to } }); },
};

export const optouts = {
  list(q) { return request(`/api/campaigns/optouts${q ? `?q=${encodeURIComponent(q)}` : ''}`); },
  create(phone, reason) { return request('/api/campaigns/optouts', { method: 'POST', body: { phone, reason } }); },
  remove(id) { return request(`/api/campaigns/optouts/${id}`, { method: 'DELETE' }); },
};
