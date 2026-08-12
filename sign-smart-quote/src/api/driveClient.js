// CRM Phase 5 §7/§8 — Google Drive marketing-materials browsing + config.
// Talks to src/routes/drive.js. Same local request() helper pattern as the
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
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const drive = {
  getConfig() { return request('/api/drive/config'); },
  updateConfig(data) { return request('/api/drive/config', { method: 'PUT', body: data }); },
  test() { return request('/api/drive/test', { method: 'POST' }); },
  listFiles(folderId) { return request(`/api/drive/files${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`); },
};
