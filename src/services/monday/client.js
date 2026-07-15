// Low-level monday.com GraphQL client. Verified directly against monday's
// official API docs before writing this (not just assumed knowledge) —
// single endpoint, POST, GraphQL body, raw token (no "Bearer" prefix) in the
// Authorization header.
const API_URL = 'https://api.monday.com/v2';

function getCredentials(db) {
  const row = db.prepare(`SELECT * FROM monday_credentials WHERE id = 1`).get();
  if (!row || !row.api_token) throw new Error('monday.com is not configured');
  return row;
}

async function request(db, query, variables) {
  const creds = getCredentials(db);
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: creds.api_token },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`monday.com API failed (${res.status}): ${text}`);
  const data = JSON.parse(text);
  if (data.errors) throw new Error(`monday.com API error: ${JSON.stringify(data.errors)}`);
  return data.data;
}

module.exports = { request, getCredentials };
