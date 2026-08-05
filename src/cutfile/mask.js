// Builds a black/white bitmap (PNG buffer) from an uploaded image, ready for
// potrace to trace — the automated equivalent of Illustrator's "Image Trace,
// Black & White, Threshold 254" step.
//
// Source images arrive in two flavours (both must be supported — mixed input):
//   - PNG with real transparency  → mask = alpha channel thresholded
//   - flat JPG/PNG on a white/near-white background, no usable alpha
//                                  → mask = everything NOT flood-reachable
//                                    from the four image corners through
//                                    near-white pixels. This is what keeps a
//                                    white shirt/highlight *inside* the
//                                    subject from being eaten along with the
//                                    background.
//
// Large photos are downscaled before tracing — the output is a smoothed
// vector contour, not a pixel-perfect silhouette, so working at full camera
// resolution buys nothing but slow flood-fills and sluggish slider previews.

const sharp = require('sharp');

const ALPHA_COVERAGE_MIN = 0.02; // ≥2% non-opaque pixels ⇒ treat alpha as real
const LIGHT_THRESHOLD = 245;     // 0-255 — how "white" counts as background
const PROCESS_MAX_DIM = 1600;    // longest side, px — plenty for a smooth cut contour

// holeMode only matters for the no-alpha (flood-fill) path — a flat JPG gives
// no way to tell "intentional hole" (a logo's letter O) apart from "light
// detail that's still part of the subject" (a white shirt) by brightness
// alone. Both requirements were requested, so this is exposed as a UI toggle
// rather than silently guessed:
//   'protect' (default) — only background reachable from the 4 image corners
//                          is erased; light regions fully enclosed by the
//                          subject are kept (safe default for photos).
//   'detect'             — every near-white pixel is background, corner-
//                          reachable or not, so enclosed light regions become
//                          holes (needed for a flat-JPG letter/logo with a
//                          real hole; risks eating light interior detail).
// Alpha-channel PNGs are unaffected — holes already work correctly there
// since transparency is read per-pixel, corner-reachability never enters it.
async function buildMask(inputBuffer, { threshold = 128, holeMode = 'protect' } = {}) {
  const resized = await sharp(inputBuffer)
    .rotate() // apply EXIF orientation before anything else
    .resize({ width: PROCESS_MAX_DIM, height: PROCESS_MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = resized;
  const { width, height, channels } = info; // channels === 4 after ensureAlpha

  let transparentCount = 0;
  for (let i = 3; i < data.length; i += channels) {
    if (data[i] < 250) transparentCount++;
  }
  const hasAlpha = transparentCount / (width * height) > ALPHA_COVERAGE_MIN;

  const subject = new Uint8Array(width * height); // 1 = part of the subject

  if (hasAlpha) {
    for (let p = 0, i = 3; p < width * height; p++, i += channels) {
      subject[p] = data[i] >= threshold ? 1 : 0;
    }
  } else {
    const gray = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < width * height; p++, i += channels) {
      gray[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }

    const isBg = new Uint8Array(width * height);

    if (holeMode === 'detect') {
      for (let p = 0; p < width * height; p++) isBg[p] = gray[p] >= LIGHT_THRESHOLD ? 1 : 0;
    } else {
      const stack = [];
      const seed = (x, y) => {
        const idx = y * width + x;
        if (!isBg[idx] && gray[idx] >= LIGHT_THRESHOLD) { isBg[idx] = 1; stack.push(idx); }
      };
      seed(0, 0); seed(width - 1, 0); seed(0, height - 1); seed(width - 1, height - 1);

      while (stack.length) {
        const idx = stack.pop();
        const x = idx % width, y = (idx / width) | 0;
        if (x > 0) seed(x - 1, y);
        if (x < width - 1) seed(x + 1, y);
        if (y > 0) seed(x, y - 1);
        if (y < height - 1) seed(x, y + 1);
      }
    }

    for (let p = 0; p < width * height; p++) subject[p] = isBg[p] ? 0 : 1;
  }

  // potrace's default color mapping traces dark pixels — encode subject=black.
  const maskRaw = Buffer.alloc(width * height);
  for (let p = 0; p < width * height; p++) maskRaw[p] = subject[p] ? 0 : 255;

  const maskPng = await sharp(maskRaw, { raw: { width, height, channels: 1 } }).png().toBuffer();
  return { maskPng, width, height, hasAlpha };
}

module.exports = { buildMask, PROCESS_MAX_DIM };
