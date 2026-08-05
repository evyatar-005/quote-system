// Picks the white-background cutoff independently for ONE element, by tracing
// it at several candidate cutoffs and scoring the result — instead of asking
// the operator to find a single value that works for the whole sheet.
//
// Why per-element: measured on a real client sheet, no single global cutoff
// works for every photo on it. A low cutoff traces every animal as a real
// silhouette but chews into a light-fleeced sheep; a high cutoff leaves the
// sheep smooth but a different photo's background survives whole and traces
// as a rectangle. The failure mode is opposite in each case, so there is no
// compromise value — it has to be decided per element.
//
// The two numbers that make that decision automatically, both confirmed
// against the real file:
//   - fillRatio (traced area ÷ bounding-box area): a rectangle scores ~1.0,
//     any real silhouette scores well below it. This is the disqualifier.
//   - isoperimetric complexity (perimeter² ÷ 4π·area): 1.0 is a circle, and
//     it rises with jaggedness. Across every cutoff tried on the sheep it
//     fell monotonically as background noise was cleaned up — exactly the
//     "how chewed-up is this outline" measure needed to rank the survivors.

const { buildMask } = require('./mask');
const { traceMask } = require('./trace');
const { simplifyContoursMm, keepOuterContours, dropTinyContoursMm, signedArea } = require('./offset');

const CANDIDATE_CUTOFFS = [236, 242, 248, 252, 254];
const MAX_FILL_RATIO = 0.95; // above this, background survived — it's a rectangle, not a subject

function perimeter(contour) {
  let p = 0;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

function isoperimetricComplexity(contour) {
  const area = Math.abs(signedArea(contour));
  if (area <= 0) return Infinity;
  return (perimeter(contour) ** 2) / (4 * Math.PI * area);
}

function fillRatio(contour) {
  const xs = contour.map((p) => p[0]), ys = contour.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  if (w <= 0 || h <= 0) return 1;
  return Math.abs(signedArea(contour)) / (w * h);
}

// Traces a single element crop at a candidate white cutoff and scores it. mm
// units so the scoring thresholds mean the same thing regardless of the
// crop's pixel resolution — simplify/minArea reuse the same pipeline the
// final render uses, so the score reflects the actual output shape.
async function scoreCutoff(elementBuffer, cutoff, { simplifyMm, minAreaMm2, mmPerPx }) {
  const mask = await buildMask(elementBuffer, { threshold: cutoff });
  const { contours } = await traceMask(mask.maskPng, { threshold: 128, turdSize: 2, alphaMax: 1 });
  if (!contours.length) return null;

  const mm = contours.map((c) => c.map(([x, y]) => [x * mmPerPx, y * mmPerPx]));
  const kept = dropTinyContoursMm(keepOuterContours(simplifyContoursMm(mm, simplifyMm, 0.3)), minAreaMm2);
  if (!kept.length) return null;

  const ratios = kept.map(fillRatio);
  if (ratios.some((r) => r > MAX_FILL_RATIO)) return null; // disqualified: a rectangle survived

  const complexities = kept.map(isoperimetricComplexity);
  const medianComplexity = complexities.sort((a, b) => a - b)[complexities.length >> 1];

  return { cutoff, medianComplexity, pieceCount: kept.length };
}

// Returns the best white cutoff for one element crop, or null if every
// candidate was disqualified (the element likely has no white background at
// all — real alpha art, or artwork that bleeds to its own edges).
async function tuneElementCutoff(elementBuffer, opts) {
  const results = [];
  for (const cutoff of CANDIDATE_CUTOFFS) {
    const r = await scoreCutoff(elementBuffer, cutoff, opts);
    if (r) results.push(r);
  }
  if (!results.length) return null;
  results.sort((a, b) => a.medianComplexity - b.medianComplexity);
  return results[0].cutoff;
}

module.exports = { tuneElementCutoff, isoperimetricComplexity, fillRatio, CANDIDATE_CUTOFFS };
