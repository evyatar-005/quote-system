// Outgoing mail — used today only for password-reset links. Credentials live
// in the smtp_credentials table (one row, id=1), same admin-config pattern as
// morning_credentials / greenapi_credentials, since the project has no env-var
// config channel at all.

const nodemailer = require('nodemailer');

function getSmtpConfig(db) {
  return db.prepare(`SELECT * FROM smtp_credentials WHERE id = 1`).get() || null;
}

function isConfigured(db) {
  const row = getSmtpConfig(db);
  return !!(row && row.host && row.from_email);
}

function buildTransport(row) {
  const port = Number(row.port) || 587;
  return nodemailer.createTransport({
    host: row.host,
    port,
    // Derived from the port rather than configured: 465 is the implicit-TLS
    // port and 587/25 are STARTTLS ports, so there is exactly one correct
    // value per port and no reason to make an admin guess it. Getting this
    // wrong fails with an opaque "wrong version number" OpenSSL error.
    secure: port === 465,
    // Force IPv4. smtp.gmail.com advertises AAAA records, and on a host with
    // no working IPv6 route nodemailer picks the v6 address and dies with
    // ENETUNREACH — which looks like bad credentials but isn't.
    family: 4,
    auth: row.username ? { user: row.username, pass: row.password } : undefined,
  });
}

// Throws if not configured or if the send itself fails — callers decide
// whether a failure here should be swallowed (e.g. forgot-password always
// returns a generic response regardless) or surfaced (e.g. the admin test-mail).
async function sendMail(db, { to, subject, html, text }) {
  const row = getSmtpConfig(db);
  if (!row || !row.host || !row.from_email) {
    throw new Error('SMTP is not configured');
  }
  const transport = buildTransport(row);
  const from = row.from_name ? `"${row.from_name}" <${row.from_email}>` : row.from_email;
  await transport.sendMail({ from, to, subject, html, text });
}

function resetPasswordEmail({ fullName, link, minutes }) {
  const greetName = fullName ? fullName : '';
  const subject = 'איפוס סיסמה — מערכת הצעות מחיר';
  const text =
    `שלום ${greetName},\n\n` +
    `התקבלה בקשה לאיפוס הסיסמה שלך.\n` +
    `לקביעת סיסמה חדשה, היכנס לקישור הבא (בתוקף ל-${minutes} דקות):\n${link}\n\n` +
    `אם לא ביקשת זאת, אפשר להתעלם מהודעה זו.`;
  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; color: #1e293b;">
      <p>שלום ${greetName},</p>
      <p>התקבלה בקשה לאיפוס הסיסמה שלך במערכת הצעות המחיר.</p>
      <p>
        <a href="${link}" style="display:inline-block; background:#C9A84C; color:#000; font-weight:bold; padding:10px 20px; border-radius:8px; text-decoration:none;">
          קביעת סיסמה חדשה
        </a>
      </p>
      <p>הקישור בתוקף ל-${minutes} דקות ותקף לשימוש חד-פעמי בלבד.</p>
      <p style="color:#64748b; font-size: 13px;">אם לא ביקשת זאת, אפשר להתעלם מהודעה זו — הסיסמה שלך לא תשתנה.</p>
    </div>`;
  return { subject, html, text };
}

module.exports = { getSmtpConfig, isConfigured, sendMail, resetPasswordEmail };
