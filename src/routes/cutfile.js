// Automated cut-file generator — the Illustrator "Image Trace → Expand →
// Smooth Line → compare & fix → Offset Path" workflow the graphic designer
// currently does by hand for every element, done server-side: upload once,
// then cheaply re-trace/re-offset as the UI's sliders move, and export the
// result as SVG / DXF / PDF (PDF carries the cut line on a CutContour spot
// color, the format the cutter/RIP expects).
//
// deps: { requireAuth } — same as attachments.js; both agent and admin roles
// may use this (it's a production tool for the graphic designer, not admin-only).

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { buildMask } = require('../cutfile/mask');
const { traceMask } = require('../cutfile/trace');
const { offsetContoursMm, smoothContours } = require('../cutfile/offset');
const { exportSvg, contoursToPathD } = require('../cutfile/export-svg');
const { exportDxf } = require('../cutfile/export-dxf');
const { exportPdf } = require('../cutfile/export-pdf');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads/cutfiles');
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const JOB_TTL_MS = 24 * 60 * 60 * 1000; // stale upload/preview cleanup

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function mimeFromExt(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

module.exports = function registerCutFile(app, db, deps) {
  const { requireAuth } = deps;
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

  const insertHistory = db.prepare(
    `INSERT INTO cut_files (job_id, original_name, mime_type, width_cm, params_json, created_by) VALUES (?, ?, ?, ?, ?, ?)`
  );

  // In-memory job cache, keyed by jobId — repeated slider drags re-run only
  // potrace + offset (tens of ms), not the mask extraction. Rebuilt from the
  // on-disk original on a cache miss (e.g. after a server restart), so a job
  // stays usable across restarts as long as its upload folder still exists.
  const jobCache = new Map();

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const jobId = crypto.randomBytes(12).toString('hex');
      req.cutfileJobId = jobId;
      const dir = path.join(UPLOAD_ROOT, jobId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 10) || '.png';
      cb(null, `original${ext}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE, files: 1 },
    fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
  });

  async function loadJob(jobId) {
    if (!/^[a-f0-9]+$/.test(jobId || '')) return null; // reject path-traversal-shaped ids outright
    let job = jobCache.get(jobId);
    if (job) return job;
    const dir = path.join(UPLOAD_ROOT, jobId);
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('original'));
    if (!files.length) return null;
    const originalPath = path.join(dir, files[0]);
    const { maskPng, width, height, hasAlpha } = await buildMask(fs.readFileSync(originalPath), {});
    job = { originalPath, originalMime: mimeFromExt(files[0]), maskPng, maskWidth: width, maskHeight: height, hasAlpha, createdAt: Date.now() };
    jobCache.set(jobId, job);
    return job;
  }

  // POST /api/cutfile/upload — multipart, field "image"
  app.post('/api/cutfile/upload', requireAuth, (req, res) => {
    upload.single('image')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'no image uploaded (PNG/JPG/WEBP only)' });
      const jobId = req.cutfileJobId;
      try {
        const { maskPng, width, height, hasAlpha } = await buildMask(fs.readFileSync(req.file.path), {});
        jobCache.set(jobId, {
          originalPath: req.file.path,
          originalMime: req.file.mimetype,
          maskPng, maskWidth: width, maskHeight: height, hasAlpha,
          createdAt: Date.now(),
        });
        console.log(`[POST /api/cutfile/upload] job=${jobId} ${width}x${height} hasAlpha=${hasAlpha} by "${req.user.username}"`);
        res.status(201).json({ jobId, width, height, hasAlpha });
      } catch (e) {
        res.status(400).json({ error: `could not read image: ${e.message}` });
      }
    });
  });

  // GET /api/cutfile/:jobId/source — original image bytes, for the QA overlay
  // preview. Auth-gated like everything here, so the client must fetch() with
  // the bearer header and blob-URL the result — a plain <img src> can't send
  // an Authorization header (same constraint as the existing attachment viewer).
  app.get('/api/cutfile/:jobId/source', requireAuth, async (req, res) => {
    const job = await loadJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.setHeader('Content-Type', job.originalMime);
    fs.createReadStream(job.originalPath).pipe(res);
  });

  async function computeContours(job, params) {
    const threshold = num(params.threshold, 128);
    const turdSize = num(params.turdSize, 2);
    const alphaMax = num(params.alphaMax, 1);
    const smoothing = Math.max(0, Math.round(num(params.smoothing, 1)));
    const offsetMm = num(params.offsetMm, 0);
    const widthCm = num(params.widthCm, 10);
    const holeMode = params.holeMode === 'detect' ? 'detect' : 'protect';

    // threshold/holeMode change the mask itself — everything else (turdSize,
    // alphaMax, smoothing, offsetMm) only affects the cheap trace/offset pass
    // that runs on top of it, so avoid re-deriving the mask unless it must.
    let maskPng = job.maskPng, maskWidth = job.maskWidth, maskHeight = job.maskHeight;
    if (threshold !== 128 || holeMode !== 'protect') {
      const rebuilt = await buildMask(fs.readFileSync(job.originalPath), { threshold, holeMode });
      maskPng = rebuilt.maskPng; maskWidth = rebuilt.width; maskHeight = rebuilt.height;
    }

    const { contours } = await traceMask(maskPng, { threshold, turdSize, alphaMax });
    if (!contours.length) return null;

    const mmPerPx = (widthCm * 10) / maskWidth;
    const mmContours = contours.map((c) => c.map(([x, y]) => [x * mmPerPx, y * mmPerPx]));
    const widthMm = maskWidth * mmPerPx;
    const heightMm = maskHeight * mmPerPx;

    const smoothed = smoothContours(mmContours, smoothing);
    const cutPath = offsetContoursMm(smoothed, offsetMm);

    return { tracePath: smoothed, cutPath, widthMm, heightMm };
  }

  // POST /api/cutfile/:jobId/trace — recompute + return path data for the
  // browser preview. Fired on every slider change (debounced client-side).
  app.post('/api/cutfile/:jobId/trace', requireAuth, async (req, res) => {
    const job = await loadJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'job not found' });
    try {
      const result = await computeContours(job, req.body || {});
      if (!result) return res.status(422).json({ error: 'no shape found — lower the threshold or check the image' });
      res.json({
        tracePathD: contoursToPathD(result.tracePath),
        cutPathD: contoursToPathD(result.cutPath),
        widthMm: result.widthMm,
        heightMm: result.heightMm,
        holes: Math.max(0, result.cutPath.length - 1),
      });
    } catch (e) {
      console.error(`[POST /api/cutfile/${req.params.jobId}/trace]`, e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/cutfile/:jobId/export?format=svg|dxf|pdf&threshold=..&offsetMm=..&widthCm=..
  // Same params as /trace, as a query string since this is a plain download.
  app.get('/api/cutfile/:jobId/export', requireAuth, async (req, res) => {
    const job = await loadJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const format = String(req.query.format || 'svg').toLowerCase();
    if (!['svg', 'dxf', 'pdf'].includes(format)) {
      return res.status(400).json({ error: 'format must be svg, dxf, or pdf' });
    }
    try {
      const result = await computeContours(job, req.query);
      if (!result) return res.status(422).json({ error: 'no shape found — lower the threshold or check the image' });

      let body, contentType;
      if (format === 'svg') {
        body = exportSvg({ contours: result.cutPath, widthMm: result.widthMm, heightMm: result.heightMm });
        contentType = 'image/svg+xml';
      } else if (format === 'dxf') {
        body = exportDxf({ contours: result.cutPath, widthMm: result.widthMm, heightMm: result.heightMm });
        contentType = 'application/dxf';
      } else {
        body = Buffer.from(await exportPdf({ contours: result.cutPath, widthMm: result.widthMm, heightMm: result.heightMm }));
        contentType = 'application/pdf';
      }

      try {
        insertHistory.run(req.params.jobId, path.basename(job.originalPath), job.originalMime, num(req.query.widthCm, null), JSON.stringify(req.query), req.user.username);
      } catch (_) { /* history is best-effort, never blocks the download */ }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="cutfile-${req.params.jobId}.${format}"`);
      res.send(body);
      console.log(`[GET /api/cutfile/${req.params.jobId}/export] format=${format} by "${req.user.username}"`);
    } catch (e) {
      console.error(`[GET /api/cutfile/${req.params.jobId}/export] format=${format}`, e);
      res.status(500).json({ error: e.message });
    }
  });

  // Best-effort hourly cleanup — jobs older than JOB_TTL_MS are dropped from
  // memory and their upload folder deleted. .unref() so this never keeps the
  // process alive on its own.
  setInterval(() => {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [jobId, job] of jobCache) {
      if (job.createdAt < cutoff) jobCache.delete(jobId);
    }
    try {
      for (const dir of fs.readdirSync(UPLOAD_ROOT)) {
        const full = path.join(UPLOAD_ROOT, dir);
        const stat = fs.statSync(full);
        if (stat.isDirectory() && stat.mtimeMs < cutoff) fs.rmSync(full, { recursive: true, force: true });
      }
    } catch (_) {}
  }, 60 * 60 * 1000).unref();
};
