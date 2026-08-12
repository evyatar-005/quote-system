// CRM Phase 5 — the lead pull-queue client: agent claim/release + workspace
// context, and the manager pool/workload/campaign-restriction views. Talks
// to src/routes/leadQueue.js. Same local request() helper pattern as the
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
    let code;
    try { const data = await res.json(); if (data?.error) message = data.error; code = data?.code; } catch {}
    const err = new Error(message);
    err.status = res.status;
    err.code = code;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const leadQueue = {
  claim() { return request('/api/crm/leads/claim', { method: 'POST' }); },
  // Tops the box up to max_claimed_leads in one call; resolves (never throws)
  // on a short pool, returning { claimed, reason, slots }.
  claimFill() { return request('/api/crm/leads/claim-fill', { method: 'POST' }); },
  context(leadId) { return request(`/api/crm/leads/${leadId}/context`); },
  // Find-or-create the lead's WhatsApp thread, so a lead who never wrote still
  // opens as a normal (empty) conversation with a composer.
  openConversation(leadId) { return request(`/api/crm/leads/${leadId}/conversation`, { method: 'POST' }); },
  myClaimedLeads() { return request('/api/crm/my-claimed-leads'); },
  updateMondayField(leadId, columnId, value) {
    return request(`/api/crm/leads/${leadId}/monday-field`, { method: 'PUT', body: { columnId, value } });
  },
  release(leadId) { return request(`/api/crm/leads/${leadId}/release`, { method: 'POST' }); },
  sendDriveFile(leadId, fileId, filename) {
    return request(`/api/crm/leads/${leadId}/send-drive-file`, { method: 'POST', body: { fileId, filename } });
  },

  pool(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/crm/lead-pool${qs ? `?${qs}` : ''}`);
  },
  assign(leadId, username) { return request(`/api/crm/leads/${leadId}/assign`, { method: 'POST', body: { username } }); },
  forceRelease(leadId) { return request(`/api/crm/leads/${leadId}/force-release`, { method: 'POST' }); },
  returnToPool(leadId) { return request(`/api/crm/leads/${leadId}/return-to-pool`, { method: 'POST' }); },
  agentsWorkload() { return request('/api/crm/agents/workload'); },

  campaigns() { return request('/api/crm/campaigns'); },
  campaignAnalytics(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/crm/analytics/campaigns${qs ? `?${qs}` : ''}`);
  },
  campaignSpend(day) {
    return request(`/api/crm/campaign-spend${day ? `?day=${encodeURIComponent(day)}` : ''}`);
  },
  setCampaignSpend(campaign_id, day, amount, notes) {
    return request('/api/crm/campaign-spend', { method: 'PUT', body: { campaign_id, day, amount, notes } });
  },
  campaignsOverview(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/crm/campaigns-overview${qs ? `?${qs}` : ''}`);
  },
  agentCampaigns() { return request('/api/crm/agent-campaigns'); },
  setAgentCampaigns(username, campaignIds) {
    return request(`/api/crm/agent-campaigns/${username}`, { method: 'PUT', body: { campaign_ids: campaignIds } });
  },
};
