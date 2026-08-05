// Builds a black/white bitmap (PNG buffer) from an uploaded image, ready for
// potrace to trace — the automated equivalent of Illustrator's "Image Trace,
// Black & White, Threshold 254" step.
//
// Real client artwork mixes two kinds of "background" in the same file, and
// handling only one of them produces badly wrong cut lines:
//
//   1. Alpha transparency — a cut-out PNG, or the unpainted area of a PDF page.
//   2. Painted white — a JPEG photo has NO alpha channel at all, so a
//      cut-out-looking animal saved as JPEG is really an opaque RECTANGLE
//      with white pixels around the subject. Place several of those on a
//      transparent PDF page (the common "sheet of stickers" layout) and an
//      alpha-only mask yields one rectangle per photo instead of one contour
//      per animal.
//
// So background is defined as "transparent OR near-white, and reachable from
// outside the artwork" — a single flood fill seeded from every transparent
// pixel and from the image border at once. Reachability is what protects
// light detail *inside* a subject (a white shirt, the sheep's fleece): it is
// enclosed by darker pixels, so the fill never gets to it.

const sharp = require('sharp');

const ALPHA_OPAQUE_MIN = 250;  // alpha at/above this counts as fully painted
const ALPHA_CUT = 128;         // transparency is unambiguous — no need to tune it
const PROCESS_MAX_DIM = 1600;  // longest side, px — plenty for a smooth cut contour

// Separable max/min filters over a square structuring element. Small radii
// only, so the naive O(n·r) form is fine and far easier to verify than a
// sliding-window deque.
function morphPass(src, width, height, radius, pick) {
  const total = width * height;
  const tmp = new Uint8Array(total);
  const out = new Uint8Array(total);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let v = src[row + x];
      for (let d = -radius; d <= radius; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= width) continue;
        v = pick(v, src[row + xx]);
      }
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let v = tmp[y * width + x];
      for (let d = -radius; d <= radius; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= height) continue;
        v = pick(v, tmp[yy * width + x]);
      }
      out[y * width + x] = v;
    }
  }
  return out;
}

const dilate = (src, w, h, r) => morphPass(src, w, h, r, Math.max);
const erode = (src, w, h, r) => morphPass(src, w, h, r, Math.min);

// close = fill pinholes and bridge a dithered/stippled edge into solid.
// open  = shave off the thin fringe that closing leaves behind.
// Run in that order, this collapses a stippled or soft-alpha border — the
// "lattice of little squares" around an element — into one clean outline,
// which despeckling alone cannot do because each speck of such a border is
// too large to qualify as noise on its own.
function morphClean(subject, width, height, radius) {
  if (radius <= 0) return subject;
  const closed = erode(dilate(subject, width, height, radius), width, height, radius);
  return dilate(erode(closed, width, height, radius), width, height, radius);
}

// Picks the white cutoff from the image itself instead of making the operator
// guess it. Set it too low and mid-tones inside an element get eaten (a horse
// breaks into separate legs, a barn loses its cream door); too high and a
// dirty background survives. Neither failure is something a user can be
// expected to diagnose from a slider.
//
// Background level is read from wherever a painted region *begins*, which is
// two different places depending on the file:
//
//   - the image border, for a flat photo that fills the whole frame; and
//   - the opaque side of every transparent boundary, for the common sheet
//     layout where each element is a separate opaque rectangle (a placed JPEG,
//     which has no alpha of its own) surrounded by transparent page.
//
// Sampling only the outer border, as a first version did, misreads that second
// case completely: the page edge is transparent, so it concludes there is no
// white to remove and traces each photo's rectangle instead of the artwork
// inside it. Both sample sets are collected here.
//
// If the collected population isn't predominantly bright, the artwork bleeds
// to its own edges and there is no white background — report null so the
// caller leaves white alone.
function autoWhiteCut(gray, alpha, width, height) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 400));
  const push = (p) => { if (alpha[p] >= ALPHA_CUT) samples.push(gray[p]); };
  for (let x = 0; x < width; x += step) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += step) {
    push(y * width);
    push(y * width + width - 1);
  }

  // Opaque pixels that touch a transparent one — the outer rim of each placed
  // element, i.e. that element's own background.
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const p = y * width + x;
      if (alpha[p] < ALPHA_CUT) continue;
      if (alpha[p - 1] < ALPHA_CUT || alpha[p + 1] < ALPHA_CUT
          || alpha[p - width] < ALPHA_CUT || alpha[p + width] < ALPHA_CUT) {
        samples.push(gray[p]);
      }
    }
  }

  if (samples.length < 20) return null;

  samples.sort((a, b) => a - b);
  const median = samples[samples.length >> 1];
  if (median < 200) return null; // border isn't a light background

  // 10th percentile of the border population: low enough to swallow the
  // compression noise that makes a "white" background range over ~15 levels,
  // high enough not to reach into the artwork's own light tones.
  const p10 = samples[Math.floor(samples.length * 0.1)];
  return Math.max(200, Math.min(252, p10 - 4));
}

// Removes subject islands smaller than minArea px². JPEG compression leaves
// near-white pixels scattered either side of the background cutoff, so the
// flood fill stops on the darker ones and leaves a lattice of tiny unreached
// specks behind — which then trace as hundreds of little squares across the
// artwork. Dropping small connected components erases that lattice without
// touching any real element.
function despeckle(subject, width, height, minArea) {
  if (minArea <= 1) return;
  const total = width * height;
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  const component = new Int32Array(total);

  for (let start = 0; start < total; start++) {
    if (!subject[start] || seen[start]) continue;
    let head = 0, tail = 0, size = 0;
    seen[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const p = queue[head++];
      component[size++] = p;
      const x = p % width;
      const y = (p / width) | 0;
      if (x > 0)          { const q = p - 1;     if (subject[q] && !seen[q]) { seen[q] = 1; queue[tail++] = q; } }
      if (x < width - 1)  { const q = p + 1;     if (subject[q] && !seen[q]) { seen[q] = 1; queue[tail++] = q; } }
      if (y > 0)          { const q = p - width; if (subject[q] && !seen[q]) { seen[q] = 1; queue[tail++] = q; } }
      if (y < height - 1) { const q = p + width; if (subject[q] && !seen[q]) { seen[q] = 1; queue[tail++] = q; } }
    }
    if (size < minArea) {
      for (let i = 0; i < size; i++) subject[component[i]] = 0;
    }
  }
}

// holeMode:
//   'protect' (default) — only background reachable from outside is removed,
//                         so enclosed light areas stay part of the subject.
//   'detect'            — every background-like pixel is removed, reachable or
//                         not, so fully enclosed light regions become holes
//                         (a letter O, a hanging hole). Risks eating light
//                         interior detail, which is why it isn't the default.
// removeWhite: set false for artwork whose subject really is white-on-
//   transparent, where treating white as background would erase it.
// threshold is the white-background cutoff on the 0-255 grey scale: any pixel
// at or above it counts as background. Lower it to bite further into a dirty,
// JPEG-noisy white; raise it to protect a subject that is itself near-white
// (white fleece, a white shirt). It genuinely moves in both directions —
// an earlier version clamped it so it could only ever get stricter, which
// left no way at all to clean up a noisy scan.
// speckleArea drops subject islands smaller than this many px².
// cleanupRadius drives the morphological close+open described above.
// blurSigma pre-averages the image before any thresholding. This is the one
// thing that reliably kills a dithered / stippled / checkerboard edge: such a
// pattern alternates either side of the cutoff pixel by pixel, so thresholding
// it directly yields a lattice of tiny islands, and morphology can only bridge
// gaps narrower than its radius. Averaging first turns the whole band into one
// consistent value that falls cleanly on a single side of the cutoff.
// threshold = 'auto' (the default) measures the background off the image
// border; a number overrides it manually.
async function buildMask(inputBuffer, {
  threshold = 'auto', holeMode = 'protect', removeWhite = true,
  speckleArea = 60, cleanupRadius = 2, blurSigma = 0,
} = {}) {
  let pipeline = sharp(inputBuffer)
    .rotate() // apply EXIF orientation before anything else
    .resize({ width: PROCESS_MAX_DIM, height: PROCESS_MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha();
  if (blurSigma > 0) pipeline = pipeline.blur(blurSigma);
  const resized = await pipeline.raw().toBuffer({ resolveWithObject: true });

  const { data, info } = resized;
  const { width, height, channels } = info; // channels === 4 after ensureAlpha
  const total = width * height;

  const alpha = new Uint8Array(total);
  const gray = new Uint8Array(total);
  for (let p = 0, i = 0; p < total; p++, i += channels) {
    alpha[p] = data[i + 3];
    gray[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
  }

  let transparentCount = 0;
  for (let p = 0; p < total; p++) if (alpha[p] < ALPHA_OPAQUE_MIN) transparentCount++;
  const hasAlpha = transparentCount / total > 0.02;

  const auto = threshold === 'auto' || threshold === null || threshold === undefined;
  const measured = auto ? autoWhiteCut(gray, alpha, width, height) : null;
  // auto with no light border => nothing to remove; leave white intact rather
  // than eating into artwork that bleeds off the edge.
  const effectiveRemoveWhite = removeWhite && !(auto && measured === null);
  const whiteCut = auto ? (measured ?? 255) : Math.max(100, Math.min(255, threshold));

  const isTransparent = (p) => alpha[p] < ALPHA_CUT;
  const isWhitish = (p) => effectiveRemoveWhite && alpha[p] >= ALPHA_CUT && gray[p] >= whiteCut;
  const isBackgroundLike = (p) => isTransparent(p) || isWhitish(p);

  const bg = new Uint8Array(total);

  if (holeMode === 'detect') {
    for (let p = 0; p < total; p++) if (isBackgroundLike(p)) bg[p] = 1;
  } else {
    // Flood fill from everything already known to be outside: every
    // transparent pixel (the page/canvas around the artwork) and any
    // background-like pixel on the image border (for a flat photo that fills
    // the frame and has no transparency at all).
    const queue = new Int32Array(total);
    let head = 0, tail = 0;

    for (let p = 0; p < total; p++) {
      if (isTransparent(p)) { bg[p] = 1; queue[tail++] = p; }
    }
    const seedBorder = (p) => { if (!bg[p] && isBackgroundLike(p)) { bg[p] = 1; queue[tail++] = p; } };
    for (let x = 0; x < width; x++) { seedBorder(x); seedBorder((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { seedBorder(y * width); seedBorder(y * width + width - 1); }

    while (head < tail) {
      const p = queue[head++];
      const x = p % width;
      const y = (p / width) | 0;
      // 4-connectivity: an 8-connected fill leaks through single-pixel
      // diagonal gaps in antialiased edges and eats into the subject.
      if (x > 0)          { const q = p - 1;     if (!bg[q] && isBackgroundLike(q)) { bg[q] = 1; queue[tail++] = q; } }
      if (x < width - 1)  { const q = p + 1;     if (!bg[q] && isBackgroundLike(q)) { bg[q] = 1; queue[tail++] = q; } }
      if (y > 0)          { const q = p - width; if (!bg[q] && isBackgroundLike(q)) { bg[q] = 1; queue[tail++] = q; } }
      if (y < height - 1) { const q = p + width; if (!bg[q] && isBackgroundLike(q)) { bg[q] = 1; queue[tail++] = q; } }
    }
  }

  let subject = new Uint8Array(total);
  for (let p = 0; p < total; p++) subject[p] = bg[p] ? 0 : 1;
  // Morphology first (turns a stippled border into either solid or nothing),
  // then despeckle removes whatever isolated crumbs survive.
  subject = morphClean(subject, width, height, cleanupRadius);
  despeckle(subject, width, height, speckleArea);

  // potrace's default color mapping traces dark pixels — encode subject=black.
  const maskRaw = Buffer.alloc(total);
  for (let p = 0; p < total; p++) maskRaw[p] = subject[p] ? 0 : 255;

  const maskPng = await sharp(maskRaw, { raw: { width, height, channels: 1 } }).png().toBuffer();
  // whiteCut is reported back so the UI can show the operator what the
  // automatic measurement actually chose.
  return { maskPng, width, height, hasAlpha, whiteCut: effectiveRemoveWhite ? whiteCut : null, auto };
}

module.exports = { buildMask, PROCESS_MAX_DIM };
