// CRM Phase 3 — shared WhatsApp inbox client. Talks to src/routes/inbox.js
// and src/routes/whatsapp.js. Same local request() helper pattern as the
// other feature clients.

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
    try { const data = await res.json(); if (data?.error) message = data.error; } catch {}
    const err = new Error(message);
    err.status = res.status;
    err.data = null;
    try { err.data = await res.clone().json(); } catch {}
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const inbox = {
  listConversations(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return request(`/api/inbox/conversations${qs ? `?${qs}` : ''}`);
  },
  getMessages(conversationId) {
    return request(`/api/inbox/conversations/${conversationId}/messages`);
  },
  updateConversation(id, data) {
    return request(`/api/inbox/conversations/${id}`, { method: 'PUT', body: data });
  },
  claim(id) {
    return request(`/api/inbox/conversations/${id}/claim`, { method: 'POST' });
  },
  heartbeat(id) {
    return request(`/api/inbox/conversations/${id}/heartbeat`, { method: 'POST' });
  },
  release(id) {
    return request(`/api/inbox/conversations/${id}/release`, { method: 'POST' });
  },
  forceClaim(id) {
    return request(`/api/inbox/conversations/${id}/force-claim`, { method: 'POST' });
  },
  leadCandidates(id) {
    return request(`/api/inbox/conversations/${id}/lead-candidates`);
  },
  createLead(id, leadId) {
    return request(`/api/inbox/conversations/${id}/lead`, { method: 'POST', body: leadId ? { lead_id: leadId } : {} });
  },
  sendMessage(id, bodyText) {
    return request(`/api/inbox/conversations/${id}/messages`, { method: 'POST', body: { body: bodyText } });
  },
  streamUrl() {
    return `/api/inbox/stream?token=${encodeURIComponent(getToken() || '')}`;
  },
};

export const whatsapp = {
  getConfig() { return request('/api/whatsapp/config'); },
  setProvider(activeProvider) { return request('/api/whatsapp/config', { method: 'PUT', body: { active_provider: activeProvider } }); },
  test(to, body) { return request('/api/whatsapp/test', { method: 'POST', body: { to, body } }); },
};
