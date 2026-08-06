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

const { buildMask, buildMaskPerElement } = require('../cutfile/mask');
const { isPdf, pdfToPng } = require('../cutfile/rasterize');
const { traceMask } = require('../cutfile/trace');
const {
  offsetContoursMm, smoothContours, classifyContours,
  simplifyContoursMm, dropTinyContoursMm, keepOuterContours,
} = require('../cutfile/offset');
const { exportSvg, contoursToPathD } = require('../cutfile/export-svg');
const { exportDxf } = require('../cutfile/export-dxf');
const { exportPdf } = require('../cutfile/export-pdf');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads/cutfiles');

// Every raster format sharp can decode in this build — deliberately wider than
// the original PNG/JPG/WEBP. A sign shop receives client artwork in whatever
// the client happened to send: .jfif straight out of a browser download, .heic
// from an iPhone, .avif, .gif, .tif. Rejecting those outright (with multer's
// silent drop, which surfaces only as an unexplained "no image uploaded")
// was the single biggest usability failure of the first version.
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'image/bmp', 'image/tiff', 'image/avif', 'image/heic', 'image/heif',
  'image/svg+xml',
  'application/pdf',
]);
// Some OS/browser combinations report an empty or generic mimetype
// (application/octet-stream) for an otherwise perfectly valid image — e.g.
// files that arrived via WhatsApp/clipboard/network share and were renamed
// without the OS re-sniffing content type. Falling back to the extension
// avoids rejecting a real image outright; sharp still fails loudly in
// buildMask() if the bytes aren't actually decodable.
const ALLOWED_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.jfif', '.webp', '.gif',
  '.bmp', '.tif', '.tiff', '.avif', '.heic', '.heif', '.svg',
  // PDF is accepted and rasterized on the way in (see cutfile/rasterize.js) —
  // clients send artwork as PDF constantly.
  '.pdf',
]);
// Design formats that still can't be read directly. Recognised only so the
// error can say "export it to PNG/PDF" instead of a generic rejection.
// (.ai is usually PDF-compatible internally, but not reliably, so it stays
// here rather than being silently handed to the PDF renderer.)
const VECTOR_EXT = new Set(['.ai', '.eps', '.psd', '.cdr', '.indd']);
const MAX_FILE_SIZE = 20 * 1024 * 1024;
// Must match buildMask's own default — the cached mask is built with it, and
// computeContours only re-derives the mask when a request differs from it.
const DEFAULT_THRESHOLD = 240;
// JPEG encodes in 8x8 blocks, so compression artifacts in a near-white area
// form ~64px islands. The default sits comfortably above that.
const DEFAULT_SPECKLE = 300;
const JOB_TTL_MS = 24 * 60 * 60 * 1000; // stale upload/preview cleanup

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// busboy (under multer) hands over the multipart filename as a latin1-decoded
// string, so a Hebrew name like "פרינטלה.pdf" arrives as mojibake ("×¤×¨×...")
// and gets echoed straight back into the error message the user reads.
// Re-interpret those bytes as UTF-8. Pure-ASCII names round-trip unchanged.
function decodeFilename(name) {
  if (!name) return '';
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.includes('�') ? name : decoded; // keep original if it wasn't UTF-8
  } catch {
    return name;
  }
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
    // multer drops a rejected file silently — req.file just comes back
    // undefined, indistinguishable from "no file was sent at all". Record why
    // on the request so the handler can return a specific reason instead of a
    // generic message the user can't act on.
    fileFilter: (req, file, cb) => {
      const name = decodeFilename(file.originalname);
      const ext = path.extname(name).toLowerCase();
      const accepted = ALLOWED_MIME.has(file.mimetype) || ALLOWED_EXT.has(ext);
      if (!accepted) {
        req.cutfileRejected = { name, mimetype: file.mimetype, ext };
        console.warn(`[cutfile] rejected "${name}" mimetype="${file.mimetype}" ext="${ext}"`);
      }
      cb(null, accepted);
    },
  });

  // Everything downstream (mask, trace, and the browser's <img> preview) needs
  // raster bytes. A PDF is rendered to PNG once here, and that PNG — not the
  // original file — becomes the job's working image: an <img> cannot display a
  // PDF blob, and re-rendering on every slider change would be wasteful.
  async function readRaster(filePath) {
    const raw = fs.readFileSync(filePath);
    if (!isPdf(raw)) return { buffer: raw, rasterMime: mimeFromExt(filePath), pageCount: null };
    const { png, pageCount } = await pdfToPng(raw);
    return { buffer: png, rasterMime: 'image/png', pageCount };
  }

  async function loadJob(jobId) {
    if (!/^[a-f0-9]+$/.test(jobId || '')) return null; // reject path-traversal-shaped ids outright
    let job = jobCache.get(jobId);
    if (job) return job;
    const dir = path.join(UPLOAD_ROOT, jobId);
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('original'));
    if (!files.length) return null;
    const originalPath = path.join(dir, files[0]);
    const { buffer, rasterMime } = await readRaster(originalPath);
    const { maskPng, width, height, hasAlpha, whiteCut } = await buildMaskPerElement(buffer, {});
    job = {
      originalPath, rasterBuffer: buffer, rasterMime,
      maskPng, maskWidth: width, maskHeight: height, hasAlpha, whiteCut, createdAt: Date.now(),
    };
    jobCache.set(jobId, job);
    return job;
  }

  // POST /api/cutfile/upload — multipart, field "image"
  app.post('/api/cutfile/upload', requireAuth, (req, res) => {
    upload.single('image')(req, res, async (err) => {
      if (err) {
        console.error(`[POST /api/cutfile/upload] multer error:`, err.message);
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) {
        const rejected = req.cutfileRejected;
        console.error(`[POST /api/cutfile/upload] no req.file — rejected=${JSON.stringify(rejected || null)} content-type="${req.headers['content-type']}"`);
        if (rejected) {
          if (VECTOR_EXT.has(rejected.ext)) {
            return res.status(400).json({
              error: `הקובץ "${rejected.name}" הוא קובץ וקטורי/עיצוב (${rejected.ext}) ולא תמונה. יש לייצא אותו קודם ל-PNG או JPG ואז להעלות.`,
            });
          }
          return res.status(400).json({
            error: `סוג הקובץ אינו נתמך: "${rejected.name}" (${rejected.mimetype || 'סוג לא ידוע'}). נתמכים: PNG, JPG, WEBP, GIF, BMP, TIFF, AVIF, HEIC.`,
          });
        }
        return res.status(400).json({ error: 'לא התקבל קובץ. נסו לבחור את התמונה שוב.' });
      }
      const originalName = decodeFilename(req.file.originalname);
      console.log(`[POST /api/cutfile/upload] received "${originalName}" mimetype="${req.file.mimetype}" size=${req.file.size}`);
      const jobId = req.cutfileJobId;
      try {
        const { buffer, rasterMime, pageCount } = await readRaster(req.file.path);
        const { maskPng, width, height, hasAlpha, whiteCut } = await buildMaskPerElement(buffer, {});
        jobCache.set(jobId, {
          originalPath: req.file.path,
          rasterBuffer: buffer,
          rasterMime,
          maskPng, maskWidth: width, maskHeight: height, hasAlpha, whiteCut,
          createdAt: Date.now(),
        });
        console.log(`[POST /api/cutfile/upload] job=${jobId} ${width}x${height} hasAlpha=${hasAlpha}${pageCount ? ` pdfPages=${pageCount}` : ''} by "${req.user.username}"`);
        res.status(201).json({
          jobId, width, height, hasAlpha,
          // Non-null only for PDFs. >1 tells the UI to warn that only the
          // first page became a cut file, rather than silently dropping the rest.
          pdfPageCount: pageCount,
        });
      } catch (e) {
        // Reached when the extension looked fine but the bytes aren't
        // decodable (truncated download, cloud placeholder file that was never
        // synced locally, renamed non-image, password-protected PDF).
        console.error(`[POST /api/cutfile/upload] could not decode "${originalName}":`, e.message);
        res.status(400).json({ error: `לא ניתן לקרוא את הקובץ "${originalName}". ייתכן שהוא פגום, מוגן בסיסמה, או שהוא קובץ מ-OneDrive/Drive שלא הורד למחשב בפועל.` });
      }
    });
  });

  // GET /api/cutfile/:jobId/source — the working raster image, for the QA
  // overlay preview. Serves the rasterized bytes rather than the file on disk:
  // for a PDF upload those differ, and an <img> can't render a PDF blob.
  // Auth-gated like everything here, so the client must fetch() with the
  // bearer header and blob-URL the result — a plain <img src> can't send an
  // Authorization header (same constraint as the existing attachment viewer).
  app.get('/api/cutfile/:jobId/source', requireAuth, async (req, res) => {
    const job = await loadJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.setHeader('Content-Type', job.rasterMime);
    res.send(job.rasterBuffer);
  });

  async function computeContours(job, params) {
    // 'auto' (default) lets buildMask measure the background off the image
    // border. A number is an explicit manual override.
    const threshold = (params.threshold === undefined || params.threshold === 'auto' || params.threshold === '')
      ? 'auto'
      : num(params.threshold, 'auto');
    const turdSize = num(params.turdSize, 2);
    // Speckle slider doubles as the mask-level despeckle size. potrace's own
    // turdSize only drops tiny traced paths; killing the islands before the
    // trace is what actually clears a JPEG-noise lattice.
    const speckleArea = Math.max(0, Math.round(num(params.speckleArea, DEFAULT_SPECKLE)));
    const cleanupRadius = Math.max(0, Math.min(12, Math.round(num(params.cleanupRadius, 2))));
    const blurSigma = Math.max(0, Math.min(15, num(params.blurSigma, 0)));
    // The two knobs that make the result look like a real production cut file
    // rather than a literal trace: how far to simplify, and how small a piece
    // is still a piece. Both in physical units.
    // Merge bridges gaps and unifies an element's parts; despike only shaves
    // slivers and must stay small, or it severs thin features (animal legs).
    const simplifyMm = Math.max(0, Math.min(20, num(params.simplifyMm, 2.5)));
    const despikeMm = Math.max(0, Math.min(3, num(params.despikeMm, 0.3)));
    const minAreaMm2 = Math.max(0, num(params.minAreaMm2, 25));
    // ONE control for interior cuts, because the two it replaces were coupled:
    // dropping "outer only" alone did nothing while hole detection stayed off,
    // so no combination the operator could find actually produced an interior
    // cut. Both are now driven together.
    //
    // Default OFF, on failure asymmetry: cutting a hole that shouldn't be cut
    // destroys the sticker (a cow's white patch, a sheep's fleece all read as
    // enclosed light regions), while a missing hole is visible and fixable by
    // flipping this on. Brightness alone cannot tell a letter's counter from
    // light detail inside a photo — both are enclosed and both are pale — so
    // this stays a per-job decision rather than a guess.
    const cutInnerHoles = params.cutInnerHoles === true || params.cutInnerHoles === 'true';
    const outerOnly = !cutInnerHoles;
    const alphaMax = num(params.alphaMax, 1);
    const smoothing = Math.max(0, Math.round(num(params.smoothing, 1)));
    const offsetMm = num(params.offsetMm, 0);
    const widthCm = num(params.widthCm, 10);
    // Follows cutInnerHoles: enclosed light regions only become holes when
    // interior cuts were actually asked for.
    const holeMode = cutInnerHoles ? 'detect' : 'protect';
    // Defaults to on: the common real-world upload is artwork whose subject
    // sits on white, including opaque JPEG photos placed on a transparent
    // page, where leaving white in place traces each photo's rectangle
    // instead of the subject inside it.
    const removeWhite = params.removeWhite === undefined
      ? true
      : !(params.removeWhite === false || params.removeWhite === 'false');

    // threshold/holeMode/removeWhite change the mask itself — everything else
    // (turdSize, alphaMax, smoothing, offsetMm) only affects the cheap
    // trace/offset pass on top of it, so avoid re-deriving the mask unless
    // one of those three differs from what the cached mask was built with.
    let maskPng = job.maskPng, maskWidth = job.maskWidth, maskHeight = job.maskHeight;
    let whiteCut = job.whiteCut;
    if (threshold !== 'auto' || holeMode !== 'protect' || removeWhite !== true
        || speckleArea !== DEFAULT_SPECKLE || cleanupRadius !== 2 || blurSigma !== 0) {
      const rebuilt = await buildMask(job.rasterBuffer, {
        threshold, holeMode, removeWhite, speckleArea, cleanupRadius, blurSigma,
      });
      maskPng = rebuilt.maskPng; maskWidth = rebuilt.width; maskHeight = rebuilt.height;
      whiteCut = rebuilt.whiteCut;
    }

    // The mask is already pure black/white, so potrace gets a fixed mid-grey
    // cutoff — the user-facing `threshold` applies to background detection in
    // buildMask, not here, and feeding it in twice would double-apply it.
    const { contours } = await traceMask(maskPng, { threshold: 128, turdSize, alphaMax });
    if (!contours.length) return null;

    const mmPerPx = (widthCm * 10) / maskWidth;
    const mmContours = contours.map((c) => c.map(([x, y]) => [x * mmPerPx, y * mmPerPx]));
    const widthMm = maskWidth * mmPerPx;
    const heightMm = maskHeight * mmPerPx;

    // Order matters. Simplify FIRST, in millimetres, so gap-bridging and
    // spike-removal are judged against the real blade radius rather than
    // pixels; then drop anything too small to be a genuine part; then apply
    // the bleed; and only then do the cosmetic point-level smoothing.
    const simplified = simplifyContoursMm(mmContours, simplifyMm, despikeMm);
    // Outer-only is the die-cut default: one closed loop per piece. Turning it
    // off is the opt-in for artwork that genuinely needs interior cuts (a
    // hanging hole, the counter of a letter cut right through).
    const silhouetted = outerOnly ? keepOuterContours(simplified) : simplified;
    const kept = dropTinyContoursMm(silhouetted, minAreaMm2);
    if (!kept.length) return null;
    const cutPath = smoothContours(offsetContoursMm(kept, offsetMm), smoothing);

    return { tracePath: smoothContours(kept, smoothing), cutPath, widthMm, heightMm, whiteCut };
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
        // shapes vs holes, not a raw contour count — a sheet of stickers is
        // many shapes, not one shape full of holes.
        ...classifyContours(result.cutPath),
        // What the automatic background measurement settled on, so the panel
        // can show it instead of leaving the operator guessing.
        whiteCut: result.whiteCut ?? null,
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
        body = exportSvg({ contours: result.cutPath, netContours: result.tracePath, widthMm: result.widthMm, heightMm: result.heightMm });
        contentType = 'image/svg+xml';
      } else if (format === 'dxf') {
        body = exportDxf({ contours: result.cutPath, netContours: result.tracePath, widthMm: result.widthMm, heightMm: result.heightMm });
        contentType = 'application/dxf';
      } else {
        body = Buffer.from(await exportPdf({ contours: result.cutPath, netContours: result.tracePath, widthMm: result.widthMm, heightMm: result.heightMm }));
        contentType = 'application/pdf';
      }

      try {
        insertHistory.run(req.params.jobId, path.basename(job.originalPath), job.rasterMime, num(req.query.widthCm, null), JSON.stringify(req.query), req.user.username);
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
