// CRM Phase 2 — monday.com board-mapping admin client. Talks to
// src/routes/mondaySync.js. Same local request() helper pattern as
// mondayClient.js / crmClient.js.

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
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const mondaySync = {
  listBoards() { return request('/api/monday-sync/boards'); },
  // Retroactive status completion from stored monday snapshots — preview and
  // apply are separate calls so thousands of leads are never changed unseen.
  backfillPreview() { return request('/api/monday-sync/backfill/preview'); },
  backfillApply() { return request('/api/monday-sync/backfill', { method: 'POST' }); },
  fetchColumns(boardId) { return request(`/api/monday-sync/boards/${boardId}/columns`); },
  createBoardMap(data) { return request('/api/monday-sync/boards', { method: 'POST', body: data }); },
  updateBoardMap(id, data) { return request(`/api/monday-sync/boards/${id}`, { method: 'PUT', body: data }); },
  deleteBoardMap(id) { return request(`/api/monday-sync/boards/${id}`, { method: 'DELETE' }); },
  pullNow(id) { return request(`/api/monday-sync/boards/${id}/pull`, { method: 'POST' }); },
  pushNow(id) { return request(`/api/monday-sync/boards/${id}/push`, { method: 'POST' }); },
  syncLog() { return request('/api/monday-sync/log'); },
};

export const crmSettings = {
  get() { return request('/api/crm/settings'); },
  update(data) { return request('/api/crm/settings', { method: 'PUT', body: data }); },
};
