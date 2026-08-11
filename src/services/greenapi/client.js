// Low-level GreenAPI (WhatsApp) HTTP client. apiUrl/mediaUrl are account-
// specific hosts shown in the GreenAPI console — not a fixed domain, so they
// always come from the DB, same as Morning's base_url override.

function getCredentials(db) {
  const row = db.prepare(`SELECT * FROM greenapi_credentials WHERE id = 1`).get();
  if (!row || !row.instance_id || !row.api_token || !row.api_url) {
    throw new Error('GreenAPI is not configured');
  }
  return row;
}

// Converts a local phone number (e.g. "050-1234567") into GreenAPI's chatId
// format ("972501234567@c.us") — strips non-digits, drops a leading 0, and
// assumes Israel (972) unless the number already carries a country code.
function toChatId(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return null;
  let national = digits;
  if (national.startsWith('972')) national = national.slice(3);
  else if (national.startsWith('0')) national = national.slice(1);
  return `972${national}@c.us`;
}

async function sendText(db, { chatId, message }) {
  const creds = getCredentials(db);
  const base = creds.api_url.replace(/\/$/, '');
  const res = await fetch(`${base}/waInstance${creds.instance_id}/sendMessage/${creds.api_token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GreenAPI sendMessage failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

async function sendFileByUrl(db, { chatId, urlFile, fileName, caption }) {
  const creds = getCredentials(db);
  const base = (creds.media_url || creds.api_url).replace(/\/$/, '');
  const res = await fetch(`${base}/waInstance${creds.instance_id}/sendFileByUrl/${creds.api_token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, urlFile, fileName, caption }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GreenAPI sendFileByUrl failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

module.exports = { toChatId, sendText, sendFileByUrl };
