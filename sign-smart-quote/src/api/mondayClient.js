// monday.com config + board/group discovery — talks to src/routes/monday.js.
// Same local request() helper pattern as the other integration API modules.

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

export async function getMondayConfig() {
  return request('/api/monday/config');
}

export async function saveMondayConfig(config) {
  return request('/api/monday/config', { method: 'PUT', body: config });
}

export async function listMondayBoards() {
  const { boards } = await request('/api/monday/boards');
  return boards;
}

export async function listMondayGroups(boardId) {
  const { groups } = await request(`/api/monday/boards/${boardId}/groups`);
  return groups;
}
