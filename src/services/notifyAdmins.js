// Notifies every admin ("מנהל מכירות") when an agent sends a quote for
// review — in-app (notifications table, same one the approve/reject decision
// already uses) AND by email. Kept as its own module rather than threading
// notifications.js's insertNotif through deps, since registerEntities (the
// only caller) runs before registerNotifications in server.js.

const mail = require('./mail');

function notifyAdminsOfSentQuote(db, quote) {
  const admins = db.prepare(`SELECT username, email FROM users WHERE role = 'admin'`).all();
  if (!admins.length) return;

  const message = `הצעה ${quote.quote_number} (${quote.client_name}) נשלחה לבדיקה ע״י ${quote.created_by} וממתינה לאישור הנחה.`;
  const insertNotif = db.prepare(
    `INSERT INTO notifications (recipient_username, quote_id, quote_number, type, message) VALUES (?, ?, ?, 'sent', ?)`
  );
  for (const admin of admins) insertNotif.run(admin.username, quote.id, quote.quote_number, message);

  // Email is best-effort — a missing/broken SMTP config must never affect the
  // quote save itself, same fire-and-forget convention as the Morning client
  // registration a few lines above this call site in entities.js.
  const emails = admins.map((a) => a.email).filter(Boolean);
  if (!emails.length) return;

  const subject = `הצעת מחיר ${quote.quote_number} ממתינה לאישור הנחה`;
  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; color: #1e293b;">
      <p>שלום,</p>
      <p>הסוכן <strong>${quote.created_by}</strong> שלח הצעת מחיר לבדיקה:</p>
      <ul>
        <li>מס׳ הצעה: <strong>${quote.quote_number}</strong></li>
        <li>לקוח: ${quote.client_name}</li>
        <li>סכום (לפני מע״מ): ₪ ${Number(quote.price_before_vat || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</li>
      </ul>
      <p>ניתן לבדוק ולאשר/לדחות בלשונית "הצעות לבדיקה" בממשק הניהול.</p>
    </div>`;
  const text = `הצעה ${quote.quote_number} (${quote.client_name}) מאת ${quote.created_by} ממתינה לאישור הנחה.`;

  mail.sendMail(db, { to: emails.join(', '), subject, html, text })
    .catch((err) => console.error(`[notifyAdmins] email failed for quote #${quote.id}:`, err.message));
}

module.exports = { notifyAdminsOfSentQuote };
