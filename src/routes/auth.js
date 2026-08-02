// Base44-compatible auth: users + sessions, token bearer auth.
// Passwords hashed with node builtin crypto.scryptSync as `salt:hash` hex.

const crypto = require('crypto');
const mail = require('../services/mail');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — sessions never expired before this
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const MIN_PASSWORD_LENGTH = 6;
const RESET_TTL_MS = 30 * 60 * 1000;   // 30 minutes
const RESET_MAX_PER_HOUR = 3;          // per user — throttles mailbox flooding, not brute force

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── password helpers ─────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, full_name: u.full_name, email: u.email, role: u.role, mustChangePassword: !!u.must_change_password };
}

// ── idempotent seed of the two demo users ────────────────────────────────────
// must_change_password = 1 on both — a leaked/guessed default (admin123/agent123)
// is only ever usable to reach the forced change-password screen, nothing else.
function seedUsers(db) {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO users (username, password_hash, full_name, email, role, must_change_password) VALUES (?, ?, ?, ?, ?, 1)`
  );
  const seeds = [
    ['admin', 'admin123', 'מנהל מכירות', 'admin@company.local', 'admin'],
    ['agent', 'agent123', 'סוכן לדוגמה',  'agent@company.local', 'agent'],
  ];
  let added = 0;
  for (const [username, pw, full_name, email, role] of seeds) {
    const { changes } = ins.run(username, hashPassword(pw), full_name, email, role);
    added += changes;
  }
  if (added) console.log(`[auth seed] ${added} משתמשים חדשים הוספו`);
  else console.log('[auth seed] משתמשים קיימים — אין שינויים.');
}

module.exports = function registerAuth(app, db) {
  seedUsers(db);

  const userByName    = db.prepare(`SELECT * FROM users WHERE username = ?`);
  const userById       = db.prepare(`SELECT * FROM users WHERE id = ?`);
  const insSession    = db.prepare(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`);
  const sessionByToken = db.prepare(`SELECT * FROM sessions WHERE token = ?`);
  const delSession    = db.prepare(`DELETE FROM sessions WHERE token = ?`);

  function bearerToken(req) {
    const h = req.headers['authorization'] || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : null;
  }

  function userFromRequest(req) {
    const token = bearerToken(req);
    if (!token) return null;
    const session = sessionByToken.get(token);
    if (!session) return null;
    // Sessions never expired before this — enforce a 7-day absolute TTL, lazily
    // deleting the row once it's past that so a leaked token isn't valid forever.
    // SQLite's CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" (UTC, no separator) —
    // normalize to ISO 8601 before parsing so this doesn't get read as local time.
    const age = Date.now() - new Date(session.created_at.replace(' ', 'T') + 'Z').getTime();
    if (age > SESSION_TTL_MS) {
      delSession.run(token);
      return null;
    }
    return userById.get(session.user_id) || null;
  }

  // middleware
  function requireAuth(req, res, next) {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  }

  function requireAdmin(req, res, next) {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    req.user = user;
    next();
  }

  // ── Login rate limiting ───────────────────────────────────────────────────────
  // In-memory is fine here — single-process app, and a restart resetting the
  // counters is an acceptable tradeoff for not adding a dependency/table for this.
  const loginAttempts = new Map(); // username → { count, lockedUntil }

  function checkLoginLock(username) {
    const entry = loginAttempts.get(username);
    if (!entry) return null;
    if (entry.lockedUntil && entry.lockedUntil > Date.now()) {
      return Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    }
    if (entry.lockedUntil && entry.lockedUntil <= Date.now()) loginAttempts.delete(username);
    return null;
  }

  function recordLoginFailure(username) {
    const entry = loginAttempts.get(username) || { count: 0, lockedUntil: null };
    entry.count += 1;
    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
      entry.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
      entry.count = 0;
    }
    loginAttempts.set(username, entry);
  }

  function clearLoginFailures(username) {
    loginAttempts.delete(username);
  }

  // ── POST /api/auth/login ────────────────────────────────────────────────────
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(401).json({ error: 'invalid credentials' });

    const lockedForSeconds = checkLoginLock(username);
    if (lockedForSeconds) {
      return res.status(429).json({ error: `too many failed attempts — try again in ${lockedForSeconds}s` });
    }

    const u = userByName.get(username);
    if (!u || !verifyPassword(password, u.password_hash)) {
      recordLoginFailure(username);
      return res.status(401).json({ error: 'invalid credentials' });
    }
    clearLoginFailures(username);
    const token = crypto.randomBytes(24).toString('hex');
    insSession.run(token, u.id);
    console.log(`[POST /api/auth/login] "${username}" (${u.role}) → session`);
    res.json({ token, user: publicUser(u) });
  });

  // ── GET /api/auth/me ──────────────────────────────────────────────────────────
  app.get('/api/auth/me', (req, res) => {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    res.json(publicUser(user));
  });

  // ── POST /api/auth/logout ─────────────────────────────────────────────────────
  app.post('/api/auth/logout', (req, res) => {
    const token = bearerToken(req);
    if (token) delSession.run(token);
    res.json({ ok: true });
  });

  // ── PUT /api/auth/change-password — self-service, clears must_change_password ──
  app.put('/api/auth/change-password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !verifyPassword(currentPassword, req.user.password_hash)) {
      return res.status(401).json({ error: 'current password is incorrect' });
    }
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`)
      .run(hashPassword(newPassword), req.user.id);
    console.log(`[PUT /api/auth/change-password] "${req.user.username}" סיסמה עודכנה`);
    res.json({ ok: true });
  });

  // ── Password reset (forgot-password) ──────────────────────────────────────────
  const insResetToken   = db.prepare(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`);
  const countRecentResets = db.prepare(`SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > datetime('now', '-1 hour')`);
  const invalidatePriorResets = db.prepare(`UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL`);
  const resetByHash     = db.prepare(`SELECT * FROM password_resets WHERE token_hash = ?`);
  const markResetUsed   = db.prepare(`UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?`);
  const setUserPassword = db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`);
  const delSessionsForUser = db.prepare(`DELETE FROM sessions WHERE user_id = ?`);

  // ── POST /api/auth/forgot-password ─────────────────────────────────────────
  // Always responds with the same generic { ok: true } regardless of whether
  // the username exists, has an email, or SMTP send fails — otherwise this
  // endpoint becomes a username enumeration oracle.
  app.post('/api/auth/forgot-password', async (req, res) => {
    const { username } = req.body || {};
    const GENERIC = { ok: true, message: 'אם קיים משתמש כזה עם כתובת מייל רשומה, נשלח אליו קישור לאיפוס הסיסמה.' };
    if (!username || !username.trim()) return res.json(GENERIC);

    const user = userByName.get(username.trim());
    if (!user || !user.email) {
      console.log(`[POST /api/auth/forgot-password] "${username}" — no matching user/email, generic response`);
      return res.json(GENERIC);
    }

    const { n } = countRecentResets.get(user.id);
    if (n >= RESET_MAX_PER_HOUR) {
      console.log(`[POST /api/auth/forgot-password] "${username}" — rate limited (${n} in last hour)`);
      return res.json(GENERIC);
    }

    try {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
      invalidatePriorResets.run(user.id);
      insResetToken.run(user.id, hashToken(token), expiresAt);

      const smtp = mail.getSmtpConfig(db);
      const baseUrl = (smtp && smtp.app_base_url) ? smtp.app_base_url.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`;
      const link = `${baseUrl}/reset-password?token=${token}`;
      const { subject, html, text } = mail.resetPasswordEmail({ fullName: user.full_name, link, minutes: RESET_TTL_MS / 60000 });
      await mail.sendMail(db, { to: user.email, subject, html, text });
      console.log(`[POST /api/auth/forgot-password] "${username}" — reset email sent`);
    } catch (err) {
      // Swallowed on purpose — response stays generic either way.
      console.error(`[POST /api/auth/forgot-password] "${username}" — send failed:`, err.message);
    }
    res.json(GENERIC);
  });

  // ── POST /api/auth/reset-password ───────────────────────────────────────────
  app.post('/api/auth/reset-password', (req, res) => {
    const { token, newPassword } = req.body || {};
    const INVALID = { error: 'הקישור אינו תקף או שפג תוקפו' };
    if (!token || !newPassword) return res.status(400).json(INVALID);

    const record = resetByHash.get(hashToken(token));
    if (!record || record.used_at || new Date(record.expires_at).getTime() < Date.now()) {
      return res.status(400).json(INVALID);
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const user = userById.get(record.user_id);
    if (!user) return res.status(400).json(INVALID);

    setUserPassword.run(hashPassword(newPassword), user.id);
    markResetUsed.run(record.id);
    delSessionsForUser.run(user.id);
    clearLoginFailures(user.username);
    console.log(`[POST /api/auth/reset-password] "${user.username}" — password reset, sessions invalidated`);
    res.json({ ok: true });
  });

  // ── Admin user management ─────────────────────────────────────────────────────
  const allUsers    = db.prepare(`SELECT id, username, full_name, email, role FROM users ORDER BY id`);
  const insertUser  = db.prepare(`INSERT INTO users (username, password_hash, full_name, email, role, must_change_password) VALUES (?, ?, ?, ?, ?, 1)`);
  const updateUser  = db.prepare(`UPDATE users SET full_name = ?, email = ?, role = ? WHERE id = ?`);
  const updatePassword = db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`);
  const deleteUserStmt = db.prepare(`DELETE FROM users WHERE id = ?`);
  const ROLES = new Set(['admin', 'agent']);

  // GET /api/admin/users
  app.get('/api/admin/users', requireAdmin, (req, res) => {
    console.log('[GET /api/admin/users]');
    res.json({ users: allUsers.all() });
  });

  // POST /api/admin/users
  app.post('/api/admin/users', requireAdmin, (req, res) => {
    const { username, password, full_name = '', email = '', role = 'agent' } = req.body || {};
    if (!username?.trim())  return res.status(400).json({ error: 'username required' });
    if (!password || password.length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    if (!ROLES.has(role))   return res.status(400).json({ error: 'role must be admin or agent' });
    if (userByName.get(username.trim())) return res.status(409).json({ error: 'username already exists' });
    // New accounts always start with must_change_password = 1 (see insertUser) —
    // the admin-set password here is only ever meant to get the new user to their
    // first real login.
    const { lastInsertRowid } = insertUser.run(username.trim(), hashPassword(password), full_name, email, role);
    const created = userById.get(lastInsertRowid);
    console.log(`[POST /api/admin/users] id=${created.id} "${created.username}" (${created.role})`);
    res.status(201).json({ user: publicUser(created) });
  });

  // PUT /api/admin/users/:id — update role / full_name / email
  app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id must be integer' });
    const existing = userById.get(id);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    const full_name = req.body.full_name ?? existing.full_name ?? '';
    const email     = req.body.email     ?? existing.email     ?? '';
    const role      = req.body.role      ?? existing.role;
    if (!ROLES.has(role)) return res.status(400).json({ error: 'role must be admin or agent' });
    updateUser.run(full_name, email, role, id);
    const updated = userById.get(id);
    console.log(`[PUT /api/admin/users/${id}] role="${updated.role}"`);
    res.json({ user: publicUser(updated) });
  });

  // PUT /api/admin/users/:id/password — reset password (forces a change on next login)
  app.put('/api/admin/users/:id/password', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id must be integer' });
    const existing = userById.get(id);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    const { password } = req.body || {};
    if (!password || password.length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    updatePassword.run(hashPassword(password), id);
    console.log(`[PUT /api/admin/users/${id}/password] סיסמה עודכנה — יידרש שינוי בכניסה הבאה`);
    res.json({ ok: true });
  });

  // DELETE /api/admin/users/:id
  app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id must be integer' });
    const existing = userById.get(id);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    if (existing.id === req.user.id) return res.status(400).json({ error: 'cannot delete your own account' });
    deleteUserStmt.run(id);
    console.log(`[DELETE /api/admin/users/${id}] נמחק "${existing.username}"`);
    res.json({ deleted: true, id });
  });

  return { requireAuth, requireAdmin, hashPassword, verifyPassword, publicUser };
};

module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
