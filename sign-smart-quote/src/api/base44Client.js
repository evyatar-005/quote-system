// Hand-written client that talks to our own self-hosted backend while keeping
// the SAME surface the app used with the Base44 SDK: base44.entities.<Name>.*
// and base44.auth.*. No @base44/sdk dependency.

const TOKEN_KEY = 'auth_token';

const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

// Paths where a 401 must NOT trigger the global redirect-to-login below: a
// failed login attempt is a normal, expected 401 (the form shows its own
// "wrong password" message), and /api/auth/me's 401 on app mount is already
// handled gracefully by AuthContext without a jarring full-page reload.
const NO_AUTH_REDIRECT_PATHS = new Set(['/api/auth/login', '/api/auth/me']);

/**
 * Shared fetch helper.
 * - Adds Bearer token from localStorage.
 * - Sets JSON content-type for requests with a body.
 * - Throws an Error with `.status` set on non-2xx responses.
 * - On a 401 from any other endpoint (session expired mid-use), clears the
 *   token and redirects to login instead of leaving the call site to show a
 *   generic error toast with no way back in.
 */
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
    try {
      data = await res.json();
      if (data && data.error) message = data.error;
      else if (data && data.message) message = data.message;
    } catch {
      // non-JSON error body — keep default message
    }
    if (res.status === 401 && !NO_AUTH_REDIRECT_PATHS.has(path)) {
      auth.redirectToLogin();
    }
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  if (res.status === 204) return null;
  // Some endpoints (logout) may return empty body.
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Build the querystring for list/filter: query object + optional sort/limit.
const buildQuery = (query, order, limit) => {
  const params = new URLSearchParams();
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        params.append(key, value);
      }
    }
  }
  if (order) params.append('sort', order);
  if (limit !== undefined && limit !== null) params.append('limit', limit);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};

// Factory: builds a standard entity API for a given Base44 entity name.
const makeEntity = (name) => {
  const base = `/api/entities/${name}`;
  return {
    list(order, limit) {
      return request(`${base}${buildQuery(null, order, limit)}`);
    },
    filter(query, order, limit) {
      return request(`${base}${buildQuery(query, order, limit)}`);
    },
    create(data) {
      return request(base, { method: 'POST', body: data });
    },
    update(id, data) {
      return request(`${base}/${id}`, { method: 'PUT', body: data });
    },
    delete(id) {
      return request(`${base}/${id}`, { method: 'DELETE' });
    },
    bulkCreate(items) {
      return request(`${base}/bulk`, { method: 'POST', body: { items } });
    },
  };
};

const ENTITY_NAMES = [
  'Quote',
  'PricingConfig',
  'PriceTier',
  'StickerPriceTier',
  'PaintSurchargeTier',
  'LightboxSizeTier',
  'LightboxSellingPrice',
  'KapaPriceTier',
  'RollupPriceTier',
  'LokobondAreaTier',
  'GlassPriceTier',
  'NumberPriceTier',
  'GraphicsPriceTier',
  'User',
  // Production recipes (תפ"י) — phase 1, template only, no timing.
  'Station',
  'Operation',
  'Recipe',
  'RecipeStep',
  'Worksheet',
];

const entities = {};
for (const n of ENTITY_NAMES) {
  entities[n] = makeEntity(n);
}

const auth = {
  async me() {
    return request('/api/auth/me');
  },
  async login(email, password) {
    const result = await request('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    if (result && result.token) {
      try {
        localStorage.setItem(TOKEN_KEY, result.token);
      } catch {
        // ignore storage failures
      }
    }
    return result ? result.user : null;
  },
  async logout() {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore — we clear the token regardless
    }
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
  },
  redirectToLogin() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
    window.location.reload();
  },
  async changePassword(currentPassword, newPassword) {
    return request('/api/auth/change-password', {
      method: 'PUT',
      body: { currentPassword, newPassword },
    });
  },
};

const adminUsers = {
  list() {
    return request('/api/admin/users');
  },
  create(data) {
    return request('/api/admin/users', { method: 'POST', body: data });
  },
  update(id, data) {
    return request(`/api/admin/users/${id}`, { method: 'PUT', body: data });
  },
  resetPassword(id, password) {
    return request(`/api/admin/users/${id}/password`, { method: 'PUT', body: { password } });
  },
  delete(id) {
    return request(`/api/admin/users/${id}`, { method: 'DELETE' });
  },
};

const notifications = {
  list() {
    return request('/api/notifications');
  },
  markRead(id) {
    return request(`/api/notifications/${id}/read`, { method: 'PUT' });
  },
  markAllRead() {
    return request('/api/notifications/read-all', { method: 'PUT' });
  },
  remove(id) {
    return request(`/api/notifications/${id}`, { method: 'DELETE' });
  },
  removeAll() {
    return request('/api/notifications', { method: 'DELETE' });
  },
};

const quotes = {
  decide(id, decision, quoteNumber) {
    return request(`/api/quotes/${id}/decision`, { method: 'POST', body: { decision, quoteNumber } });
  },
  // Reference images/PDFs an agent attaches to a quote (e.g. a photo of the
  // client's wall) so the manager reviewing it can see what it's actually for.
  listAttachments(quoteId) {
    return request(`/api/quotes/${quoteId}/attachments`);
  },
  // multipart upload — bypasses the shared JSON `request()` helper (needs
  // FormData, not a JSON body), but still attaches the same Bearer token.
  async uploadAttachments(quoteId, files) {
    const formData = new FormData();
    for (const f of files) formData.append('files', f);
    const token = getToken();
    const res = await fetch(`/api/quotes/${quoteId}/attachments`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!res.ok) {
      let message = `Upload failed with status ${res.status}`;
      try { const data = await res.json(); if (data?.error) message = data.error; } catch {}
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
  deleteAttachment(quoteId, attachmentId) {
    return request(`/api/quotes/${quoteId}/attachments/${attachmentId}`, { method: 'DELETE' });
  },
  // Fetched (not a plain <a href>/<img src>) because the file route needs the
  // Bearer token, which only an authenticated fetch() call can attach.
  async fetchAttachmentBlob(quoteId, attachmentId) {
    const token = getToken();
    const res = await fetch(`/api/quotes/${quoteId}/attachments/${attachmentId}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
    return res.blob();
  },
};

// Automated cut-file generator — upload once, then cheaply re-trace as the
// UI's sliders move, and download the result. Every route here needs the
// Bearer token, which rules out a plain <img src>/<a href> for the image
// preview and file downloads (same constraint as quotes.fetchAttachmentBlob
// above) — both go through fetch() + blob instead.
const cutfile = {
  async upload(file) {
    const formData = new FormData();
    formData.append('image', file);
    const token = getToken();
    const res = await fetch('/api/cutfile/upload', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!res.ok) {
      let message = `Upload failed with status ${res.status}`;
      try { const data = await res.json(); if (data?.error) message = data.error; } catch {}
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
  trace(jobId, params) {
    return request(`/api/cutfile/${jobId}/trace`, { method: 'POST', body: params });
  },
  async fetchSourceBlob(jobId) {
    const token = getToken();
    const res = await fetch(`/api/cutfile/${jobId}/source`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
    return res.blob();
  },
  async downloadExport(jobId, format, params) {
    const token = getToken();
    const qs = new URLSearchParams({ ...params, format }).toString();
    const res = await fetch(`/api/cutfile/${jobId}/export?${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let message = `Export failed with status ${res.status}`;
      try { const data = await res.json(); if (data?.error) message = data.error; } catch {}
      throw new Error(message);
    }
    return res.blob();
  },
};

// Production/תפ"י board — price-free approved-order list, and the one
// WorksheetStep mutation (toggle included / swap performer-station) that
// entities.WorksheetStep can't cover: the server only exposes PUT for it
// (a worksheet step is created only as part of Worksheet.create's resolved
// proposal, never created/listed/deleted standalone), so makeEntity's
// list/create/delete would just 404 if used here.
const production = {
  orders() {
    return request('/api/production/orders');
  },
  updateStep(id, data) {
    return request(`/api/entities/WorksheetStep/${id}`, { method: 'PUT', body: data });
  },
};

export const base44 = { entities, auth, adminUsers, notifications, quotes, cutfile, production };
