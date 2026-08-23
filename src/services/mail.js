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
//
// Returns nodemailer's info object. This matters: nodemailer only THROWS when
// every recipient was rejected. If the server accepts some addresses and
// rejects others, the send "succeeds" and the rejected ones are reported only
// in info.rejected — so a caller that ignores the return value tells the admin
// "sent successfully" for mail that partly never went anywhere.
// Never let bookkeeping break an actual send — a failure to write the audit
// row must not turn a delivered mail into a thrown error.
function logMailAttempt(db, entry) {
  try {
    db.prepare(
      `INSERT INTO mail_log (context, to_addresses, subject, success, accepted, rejected, response, error_message, from_address)
       VALUES (@context, @to_addresses, @subject, @success, @accepted, @rejected, @response, @error_message, @from_address)`
    ).run({
      context: entry.context || null,
      to_addresses: entry.to || null,
      subject: entry.subject || null,
      success: entry.success ? 1 : 0,
      accepted: (entry.accepted || []).join(', ') || null,
      rejected: (entry.rejected || []).join(', ') || null,
      response: entry.response || null,
      error_message: entry.errorMessage || null,
      from_address: entry.from || null,
    });
  } catch (err) {
    console.error('[mail] failed to write mail_log row:', err.message);
  }
}

async function sendMail(db, { to, subject, html, text, context }) {
  const row = getSmtpConfig(db);
  if (!row || !row.host || !row.from_email) {
    logMailAttempt(db, { context, to, subject, success: false, errorMessage: 'SMTP is not configured' });
    throw new Error('SMTP is not configured');
  }
  const transport = buildTransport(row);
  const from = row.from_name ? `"${row.from_name}" <${row.from_email}>` : row.from_email;

  let info;
  try {
    info = await transport.sendMail({ from, to, subject, html, text });
  } catch (err) {
    logMailAttempt(db, { context, to, subject, from, success: false, errorMessage: err.message });
    throw err;
  }

  const rejected = info?.rejected || [];
  const accepted = info?.accepted || [];
  if (rejected.length) {
    console.error(`[mail] server REJECTED ${rejected.length} recipient(s): ${rejected.join(', ')} — response: ${info?.response || '(none)'}`);
  }
  console.log(`[mail] from="${from}" accepted=[${accepted.join(', ')}] response="${info?.response || ''}"`);
  // Accepted-but-nothing-delivered is the exact failure this log exists for,
  // so a send with zero accepted recipients is recorded as a failure even
  // though nodemailer resolved.
  logMailAttempt(db, {
    context, to, subject, from,
    success: accepted.length > 0 && rejected.length === 0,
    accepted, rejected,
    response: info?.response || '',
  });
  return info;
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

function recentMailLog(db, limit = 30) {
  return db.prepare(`SELECT * FROM mail_log ORDER BY id DESC LIMIT ?`).all(limit);
}

module.exports = { getSmtpConfig, isConfigured, sendMail, resetPasswordEmail, recentMailLog };
