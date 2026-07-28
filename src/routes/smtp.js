// SMTP credential config (admin) + a test-send endpoint — same pattern as
// routes/morning.js's config endpoints. Password is never returned in GET.

const mail = require('../services/mail');

module.exports = function registerSmtp(app, db, deps) {
  const { requireAdmin } = deps;

  const credRow = db.prepare(`SELECT * FROM smtp_credentials WHERE id = 1`);

  // ── GET /api/smtp/config ────────────────────────────────────────────────────
  app.get('/api/smtp/config', requireAdmin, (req, res) => {
    const row = credRow.get();
    res.json({
      configured: !!(row && row.host && row.from_email),
      host: (row && row.host) || '',
      port: (row && row.port) || 587,
      secure: !!(row && row.secure),
      username: (row && row.username) || '',
      password_masked: row && row.password ? '••••' + row.password.slice(-4) : '',
      from_email: (row && row.from_email) || '',
      from_name: (row && row.from_name) || '',
      app_base_url: (row && row.app_base_url) || '',
    });
  });

  // ── PUT /api/smtp/config ────────────────────────────────────────────────────
  app.put('/api/smtp/config', requireAdmin, (req, res) => {
    const { host, port, secure, username, password, from_email, from_name, app_base_url } = req.body || {};
    const existing = credRow.get();
    // Blank/omitted password means "leave it as-is" — same convention as
    // /api/morning/config, so an admin can edit other fields without re-pasting it.
    const passwordToStore = (password && password.trim())
      ? password.trim()
      : (existing ? existing.password : null);

    db.prepare(
      `INSERT INTO smtp_credentials (id, host, port, secure, username, password, from_email, from_name, app_base_url)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET host=excluded.host, port=excluded.port, secure=excluded.secure,
         username=excluded.username, password=excluded.password, from_email=excluded.from_email,
         from_name=excluded.from_name, app_base_url=excluded.app_base_url, updated_at=CURRENT_TIMESTAMP`
    ).run(
      host || null,
      port || 587,
      secure ? 1 : 0,
      username || null,
      passwordToStore,
      from_email || null,
      from_name || null,
      app_base_url || null
    );

    console.log(`[PUT /api/smtp/config] host="${host || ''}" from_email="${from_email || ''}"`);
    res.json({ ok: true });
  });

  // ── POST /api/smtp/test — sends a real test email to the calling admin ─────
  app.post('/api/smtp/test', requireAdmin, async (req, res) => {
    if (!req.user.email) {
      return res.status(400).json({ error: 'למשתמש המחובר אין כתובת מייל רשומה' });
    }
    try {
      await mail.sendMail(db, {
        to: req.user.email,
        subject: 'בדיקת הגדרות SMTP — מערכת הצעות מחיר',
        text: 'זוהי הודעת בדיקה. אם קיבלת אותה, הגדרות ה-SMTP תקינות.',
        html: '<div dir="rtl">זוהי הודעת בדיקה. אם קיבלת אותה, הגדרות ה-SMTP תקינות.</div>',
      });
      console.log(`[POST /api/smtp/test] sent to "${req.user.email}"`);
      res.json({ ok: true });
    } catch (err) {
      console.error('[POST /api/smtp/test] failed:', err.message);
      res.status(400).json({ error: err.message });
    }
  });
};
