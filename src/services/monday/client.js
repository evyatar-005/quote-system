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

// Uploads a file into a monday.com "file" column — a separate REST-ish
// multipart endpoint (NOT the plain GraphQL /v2 endpoint above), per monday's
// documented file-upload API: POST /v2/file with `query` (a mutation whose
// $file variable is the upload) and the binary itself under `variables[file]`.
async function uploadFileToColumn(db, { itemId, columnId, fileUrl, fileName }) {
  const creds = getCredentials(db);
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) throw new Error(`failed to download source file (${fileRes.status})`);
  const blob = await fileRes.blob();

  const form = new FormData();
  form.append('query', `mutation ($file: File!) { add_file_to_column (item_id: ${Number(itemId)}, column_id: "${columnId}", file: $file) { id } }`);
  form.append('variables[file]', blob, fileName || 'document.pdf');

  const res = await fetch(`${API_URL}/file`, {
    method: 'POST',
    headers: { Authorization: creds.api_token },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`monday.com file upload failed (${res.status}): ${text}`);
  const data = JSON.parse(text);
  if (data.errors) throw new Error(`monday.com file upload error: ${JSON.stringify(data.errors)}`);
  return data.data;
}

module.exports = { request, getCredentials, uploadFileToColumn };
