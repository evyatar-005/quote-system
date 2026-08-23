// Minimal Google Drive v3 client — no googleapis dependency, just fetch.
// Auth is a single API key restricted to Drive API, against a folder shared
// "anyone with the link" (see CLAUDE.md CRM plan Phase 5 §7 — the deliberate
// choice over a service account for a folder we WANT world-readable).

const GOOGLE_DOC_MIME_PREFIX = 'application/vnd.google-apps.';
const EXPORT_MIME = 'application/pdf';

function getCredentials(db) {
  const row = db.prepare(`SELECT * FROM google_drive_credentials WHERE id = 1`).get();
  if (!row || !row.api_key || !row.root_folder_id) {
    throw new Error('Google Drive אינו מוגדר');
  }
  return row;
}

async function driveFetch(path, params, apiKey) {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  url.searchParams.set('key', apiKey);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Drive API failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res;
}

// Lists a folder's direct children, refreshing drive_file_cache. The cache
// doubles as the allow-list that keeps /api/drive/files from becoming an
// open proxy into the caller's whole Drive — see routes/drive.js.
async function listFolder(db, folderId) {
  const creds = getCredentials(db);
  const res = await driveFetch('files', {
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,size,modifiedTime,thumbnailLink)',
    pageSize: 200,
  }, creds.api_key);
  const { files = [] } = await res.json();

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM drive_file_cache WHERE folder_id = ?`).run(folderId);
    const ins = db.prepare(`
      INSERT INTO drive_file_cache (folder_id, file_id, name, mime_type, size_bytes, modified_time, is_folder)
      VALUES (@folder_id, @file_id, @name, @mime_type, @size_bytes, @modified_time, @is_folder)
    `);
    for (const f of files) {
      ins.run({
        folder_id: folderId, file_id: f.id, name: f.name, mime_type: f.mimeType,
        size_bytes: f.size ? Number(f.size) : null, modified_time: f.modifiedTime || null,
        is_folder: f.mimeType === `${GOOGLE_DOC_MIME_PREFIX}folder` ? 1 : 0,
      });
    }
  });
  tx();
  return files.map(f => ({
    id: f.id, name: f.name, mimeType: f.mimeType,
    sizeBytes: f.size ? Number(f.size) : null, modifiedTime: f.modifiedTime || null,
    isFolder: f.mimeType === `${GOOGLE_DOC_MIME_PREFIX}folder`,
    // Short-lived signed URL, not cached to disk — fetched fresh on every
    // listFolder call (this function never serves from drive_file_cache).
    thumbnailLink: f.thumbnailLink || null,
  }));
}

// folderId must be the configured root, or a folder we've already listed
// under it — never an arbitrary caller-supplied id.
function isAllowedFolder(db, folderId, rootFolderId) {
  if (folderId === rootFolderId) return true;
  return !!db.prepare(`SELECT 1 FROM drive_file_cache WHERE file_id = ? AND is_folder = 1`).get(folderId);
}

// Downloads a file's bytes. Google-native docs (Sheets/Docs/Slides) have no
// binary — they MUST go through /export, or alt=media returns 403.
async function downloadFile(db, fileId) {
  const creds = getCredentials(db);
  const metaRes = await driveFetch(`files/${fileId}`, { fields: 'id,name,mimeType,size' }, creds.api_key);
  const meta = await metaRes.json();

  const maxBytes = (creds.max_send_mb || 16) * 1024 * 1024;
  if (meta.size && Number(meta.size) > maxBytes) {
    throw new Error(`הקובץ (${Math.round(meta.size / 1024 / 1024)}MB) חורג מהמגבלה (${creds.max_send_mb || 16}MB)`);
  }

  const isGoogleNative = (meta.mimeType || '').startsWith(GOOGLE_DOC_MIME_PREFIX);
  const fileRes = isGoogleNative
    ? await driveFetch(`files/${fileId}/export`, { mimeType: EXPORT_MIME }, creds.api_key)
    : await driveFetch(`files/${fileId}`, { alt: 'media' }, creds.api_key);

  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const filename = isGoogleNative ? `${meta.name}.pdf` : meta.name;
  const mimeType = isGoogleNative ? EXPORT_MIME : meta.mimeType;
  return { buffer, filename, mimeType };
}

module.exports = { listFolder, isAllowedFolder, downloadFile, getCredentials };
