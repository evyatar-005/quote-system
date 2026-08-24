// Base44-compatible auth: users + sessions, token bearer auth.
// Passwords hashed with node builtin crypto.scryptSync as `salt:hash` hex.

const crypto = require('crypto');
const mail = require('../services/mail');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — sessions never expired before this
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const MIN_PASSWORD_LENGTH = 8;
const RESET_TTL_MS = 30 * 60 * 1000;   // 30 minutes
const RESET_MAX_PER_HOUR = 3;          // per user — throttles mailbox flooding, not brute force

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Login and every write to users.email go through this, so the value in the
// DB and the value looked up at login always compare equal regardless of how
// the user capitalized it. Must match the one-time UPDATE in server.js that
// normalizes existing rows before the UNIQUE index is created.
function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
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
  // canAccessCrm mirrors the server-side gate exactly (see server.js): the
  // flag alone, with no role bypass — so a revoked מנהל מכירות loses the CRM
  // group from their sidebar too, instead of seeing links that 403.
  return { id: u.id, username: u.username, full_name: u.full_name, email: u.email, role: u.role, mustChangePassword: !!u.must_change_password, canViewCosts: !!u.can_view_costs, canSendCampaigns: !!u.can_send_campaigns, canAccessCrm: !!u.can_access_crm, canDeleteQuotes: !!u.can_delete_quotes };
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
    ['production', 'production123', 'תפ"י לדוגמה', 'production@company.local', 'operations'],
  ];
  let added = 0;
  for (const [username, pw, full_name, email, role] of seeds) {
    const { changes } = ins.run(username, hashPassword(pw), full_name, normalizeEmail(email), role);
    added += changes;
  }
  if (added) console.log(`[auth seed] ${added} משתמשים חדשים הוספו`);
  else console.log('[auth seed] משתמשים קיימים — אין שינויים.');
}

module.exports = function registerAuth(app, db) {
  seedUsers(db);

  const userByName    = db.prepare(`SELECT * FROM users WHERE username = ?`);
  const userByEmail    = db.prepare(`SELECT * FROM users WHERE email = ?`);
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

  // Presence heartbeat, piggy-backed on ordinary authenticated traffic so no
  // client can forget to send it. Throttled in memory to one write per user
  // per minute: this runs on EVERY authenticated request, and an unthrottled
  // UPDATE per request would turn every poll into a disk write. Purely
  // advisory — used by the lead auto-router to avoid handing a lead to an
  // agent who isn't working right now; never gates access.
  const lastSeenWrittenAt = new Map();
  const PRESENCE_WRITE_INTERVAL_MS = 60 * 1000;
  function touchPresence(user) {
    const now = Date.now();
    const previous = lastSeenWrittenAt.get(user.username) || 0;
    if (now - previous < PRESENCE_WRITE_INTERVAL_MS) return;
    lastSeenWrittenAt.set(user.username, now);
    try {
      db.prepare(`UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`).run(user.id);
    } catch (err) {
      console.error('[presence] failed to update last_seen_at:', err.message);
    }
  }

  // middleware
  function requireAuth(req, res, next) {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    touchPresence(user);
    next();
  }

  function requireAdmin(req, res, next) {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    req.user = user;
    next();
  }

  // Production/תפ"י staff (graphic operators, floor lead, production manager) —
  // needs to read/edit recipes and worksheets, but must NOT get the pricing/
  // commission access requireAdmin implies. admin also passes, since an admin
  // can do everything operations can.
  function requireOperations(req, res, next) {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    if (user.role !== 'admin' && user.role !== 'operations') return res.status(403).json({ error: 'forbidden' });
    req.user = user;
    next();
  }

  // Bulk-WhatsApp-broadcast permission — explicitly NOT satisfied by role
  // alone (unlike requireOperations, admin does not implicitly pass here at
  // request time; it's only grandfathered once in server.js and can be
  // revoked). A 200-recipient blast is the single most damaging thing a
  // misclick can do in this system (WhatsApp ban risk + 200 annoyed
  // customers) — see CLAUDE.md CRM plan Phase 4.
  function requireCampaigns(req, res, next) {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    if (!user.can_send_campaigns) return res.status(403).json({ error: 'אין לך הרשאה לשליחת דיוור' });
    req.user = user;
    next();
  }

  // ── Login rate limiting ───────────────────────────────────────────────────────
  // In-memory is fine here — single-process app, and a restart resetting the
  // counters is an acceptable tradeoff for not adding a dependency/table for this.
  // Keyed by (normalized) email now that login no longer uses username.
  const loginAttempts = new Map(); // email → { count, lockedUntil }

  function checkLoginLock(email) {
    const entry = loginAttempts.get(email);
    if (!entry) return null;
    if (entry.lockedUntil && entry.lockedUntil > Date.now()) {
      return Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    }
    if (entry.lockedUntil && entry.lockedUntil <= Date.now()) loginAttempts.delete(email);
    return null;
  }

  function recordLoginFailure(email) {
    const entry = loginAttempts.get(email) || { count: 0, lockedUntil: null };
    entry.count += 1;
    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
      entry.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
      entry.count = 0;
    }
    loginAttempts.set(email, entry);
  }

  function clearLoginFailures(email) {
    loginAttempts.delete(email);
  }

  // ── POST /api/auth/login ────────────────────────────────────────────────────
  // Identifies by email now, not username — username is kept only as an
  // internal reference (still required/unique in the DB, still shown in the
  // admin users list) but is no longer how anyone signs in.
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    const normalized = normalizeEmail(email);
    if (!normalized || !password) return res.status(401).json({ error: 'invalid credentials' });

    const lockedForSeconds = checkLoginLock(normalized);
    if (lockedForSeconds) {
      return res.status(429).json({ error: `too many failed attempts — try again in ${lockedForSeconds}s` });
    }

    const u = userByEmail.get(normalized);
    if (!u || !verifyPassword(password, u.password_hash)) {
      recordLoginFailure(normalized);
      return res.status(401).json({ error: 'invalid credentials' });
    }
    clearLoginFailures(normalized);
    const token = crypto.randomBytes(24).toString('hex');
    insSession.run(token, u.id);
    console.log(`[POST /api/auth/login] "${normalized}" (${u.role}) → session`);
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
    const { email } = req.body || {};
    const normalized = normalizeEmail(email);
    const GENERIC = { ok: true, message: 'אם קיים משתמש כזה עם כתובת מייל רשומה, נשלח אליו קישור לאיפוס הסיסמה.' };
    if (!normalized) return res.json(GENERIC);

    // Looked up by the same normalized email login uses, so "forgot password"
    // and "sign in" always agree on which account an address refers to.
    const user = userByEmail.get(normalized);
    if (!user) {
      console.log(`[POST /api/auth/forgot-password] "${normalized}" — no matching user, generic response`);
      return res.json(GENERIC);
    }

    const { n } = countRecentResets.get(user.id);
    if (n >= RESET_MAX_PER_HOUR) {
      console.log(`[POST /api/auth/forgot-password] "${normalized}" — rate limited (${n} in last hour)`);
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
      console.log(`[POST /api/auth/forgot-password] "${normalized}" — reset email sent`);
    } catch (err) {
      // Swallowed on purpose — response stays generic either way.
      console.error(`[POST /api/auth/forgot-password] "${normalized}" — send failed:`, err.message);
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
    // Login lockouts are now keyed by email (see /api/auth/login), not username.
    if (user.email) clearLoginFailures(user.email);
    console.log(`[POST /api/auth/reset-password] "${user.username}" — password reset, sessions invalidated`);
    res.json({ ok: true });
  });

  // ── Admin user management ─────────────────────────────────────────────────────
  const allUsers    = db.prepare(`SELECT id, username, full_name, email, role, can_view_costs, can_send_campaigns, can_access_crm, can_delete_quotes FROM users ORDER BY id`);
  const insertUser  = db.prepare(`INSERT INTO users (username, password_hash, full_name, email, role, can_access_crm, can_view_costs, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`);
  const updateUser  = db.prepare(`UPDATE users SET full_name = ?, email = ?, role = ?, can_view_costs = ?, can_send_campaigns = ?, can_access_crm = ?, can_delete_quotes = ? WHERE id = ?`);
  const updatePassword = db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`);
  const deleteUserStmt = db.prepare(`DELETE FROM users WHERE id = ?`);
  const ROLES = new Set(['admin', 'agent', 'operations']);

  // GET /api/admin/users
  app.get('/api/admin/users', requireAdmin, (req, res) => {
    console.log('[GET /api/admin/users]');
    res.json({ users: allUsers.all() });
  });

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // POST /api/admin/users
  app.post('/api/admin/users', requireAdmin, (req, res) => {
    const { username, password, full_name = '', email = '', role = 'agent' } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    if (!username?.trim())  return res.status(400).json({ error: 'username required' });
    // Required now, not optional: login is by email, so an account created
    // without one would be permanently unreachable.
    if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) return res.status(400).json({ error: 'valid email required' });
    if (!password || password.length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    if (!ROLES.has(role))   return res.status(400).json({ error: 'role must be admin, agent, or operations' });
    // Required for customer-facing roles: full_name is what gets prefixed to
    // every outgoing WhatsApp reply (crm_settings.agent_signature_template),
    // so an account without one would either sign the customer's message with
    // a technical username or not sign at all. operations staff never message
    // customers, so they stay exempt.
    if ((role === 'agent' || role === 'admin') && !full_name.trim()) {
      return res.status(400).json({ error: 'שם מלא הוא שדה חובה — הוא מופיע כחתימה בהודעות ללקוח' });
    }
    if (userByName.get(username.trim())) return res.status(409).json({ error: 'username already exists' });
    if (userByEmail.get(normalizedEmail)) return res.status(409).json({ error: 'email already exists' });
    // New accounts always start with must_change_password = 1 (see insertUser) —
    // the admin-set password here is only ever meant to get the new user to their
    // first real login.
    // A new מנהל מכירות starts with the CRM open — the whole role runs on it,
    // and a manager who silently can't see it is the exact confusion this
    // permission caused before it had a toggle. Anyone else starts closed.
    // Either way it's just the starting value; הגדרות משתמשים owns it after.
    // can_view_costs is now ENFORCED server-side (entities.js strips cost fields
    // from quote payloads without it), so a new מנהל מכירות starting closed would
    // silently lose the analytics and profitability screens their role exists for.
    // Granted on creation for admins only — same starting-value convention as
    // can_access_crm above. Deliberately NOT extended to can_send_campaigns: a
    // 200-recipient blast stays opt-in for everyone.
    const { lastInsertRowid } = insertUser.run(username.trim(), hashPassword(password), full_name, normalizedEmail, role, role === 'admin' ? 1 : 0, role === 'admin' ? 1 : 0);
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
    const emailProvided = req.body.email !== undefined;
    const email = emailProvided ? normalizeEmail(req.body.email) : existing.email;
    const role  = req.body.role ?? existing.role;
    if (!ROLES.has(role)) return res.status(400).json({ error: 'role must be admin, agent, or operations' });
    // Blank is allowed here (unlike creation) so an admin can clear a wrong
    // address without being forced to supply a replacement in the same request —
    // the amber "no email" warning in the users list is the guard against
    // leaving it that way by accident.
    if (emailProvided && email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'valid email required' });
    if (emailProvided && email) {
      const other = userByEmail.get(email);
      if (other && other.id !== id) return res.status(409).json({ error: 'email already exists' });
    }
    const canViewCosts = req.body.can_view_costs !== undefined ? (req.body.can_view_costs ? 1 : 0) : existing.can_view_costs;
    const canSendCampaigns = req.body.can_send_campaigns !== undefined ? (req.body.can_send_campaigns ? 1 : 0) : existing.can_send_campaigns;
    // Deliberately not re-derived from `role`: changing someone's role must not
    // silently hand back CRM access that was revoked on purpose.
    const canAccessCrm = req.body.can_access_crm !== undefined ? (req.body.can_access_crm ? 1 : 0) : existing.can_access_crm;
    const canDeleteQuotes = req.body.can_delete_quotes !== undefined ? (req.body.can_delete_quotes ? 1 : 0) : existing.can_delete_quotes;

    // Demoting the last remaining admin locks the whole organisation out of
    // every settings screen — including this one, which is the only way back.
    // Deleting yourself was already blocked; changing your own role away from
    // admin was not, which was the same lockout by another route.
    if (existing.role === 'admin' && role !== 'admin') {
      const otherAdmins = db.prepare(`SELECT COUNT(*) n FROM users WHERE role = 'admin' AND id != ?`).get(id).n;
      if (otherAdmins === 0) {
        return res.status(409).json({ error: 'זהו מנהל המכירות האחרון — שינוי התפקיד שלו ינעל את כולם מחוץ להגדרות. יש למנות מנהל נוסף קודם.' });
      }
      if (req.user.id === id) {
        return res.status(409).json({ error: 'אי אפשר להוריד לעצמך את תפקיד מנהל המכירות. בקש ממנהל אחר לעשות זאת.' });
      }
    }

    updateUser.run(full_name, email, role, canViewCosts, canSendCampaigns, canAccessCrm, canDeleteQuotes, id);
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

  // userFromRequest is exported so server.js can mount the CRM access gate as a
  // path-prefix middleware (one guard for every /api/crm|inbox|campaigns|drive
  // route) without re-implementing bearer-token → user resolution.
  return { requireAuth, requireAdmin, requireOperations, requireCampaigns, hashPassword, verifyPassword, publicUser, userFromRequest };
};

module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
