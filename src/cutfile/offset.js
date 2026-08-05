// Offset Path (step 6 of the Illustrator workflow) + a light corner-rounding
// smoothing pass, done in millimetre space so the delta the user asks for
// (e.g. "1mm bleed") is physically accurate regardless of the source photo's
// pixel resolution.
//
// clipper-lib works in integers, so mm coordinates are scaled up before
// offsetting and back down after. Multi-contour input (outer silhouette +
// holes, as returned by trace.js) is offset as one path set — Clipper reads
// each contour's winding direction to tell inside from outside, which is
// exactly the orientation potrace already produced (outer/holes alternate,
// consistent with the SVG evenodd fill-rule it emits) — no separate
// hole-classification step needed here.

const ClipperLib = require('clipper-lib');

const CLIPPER_SCALE = 1000; // mm -> integer micron-precision units
const ARC_TOLERANCE_MM = 0.02;

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function pointInPolygon([px, py], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

// potrace's output uses fill-rule="evenodd" (parity) to render holes — that
// does NOT guarantee a hole winds opposite to its parent contour, only that
// they overlap. Clipper's offset engine, however, tells solid from hole by
// winding direction (via Area() sign), so feeding it potrace's contours
// as-is silently merges holes into the solid on offset (verified: a donut's
// hole vanished into the outer ring instead of shrinking). This re-orients
// each contour by actual nesting depth (odd depth = hole) so Clipper sees
// the winding convention it expects.
function orientContoursForClipper(contours) {
  const depths = contours.map((c, i) => {
    const probe = c[0];
    let depth = 0;
    contours.forEach((other, j) => {
      if (i !== j && pointInPolygon(probe, other)) depth++;
    });
    return depth;
  });
  return contours.map((c, i) => {
    const isHole = depths[i] % 2 === 1;
    const a = signedArea(c);
    const needsReverse = isHole ? a > 0 : a < 0;
    return needsReverse ? c.slice().reverse() : c;
  });
}

function toClipperPaths(contoursMm) {
  return contoursMm.map((pts) =>
    pts.map(([x, y]) => ({ X: Math.round(x * CLIPPER_SCALE), Y: Math.round(y * CLIPPER_SCALE) }))
  );
}

function fromClipperPaths(paths) {
  return paths.map((path) => path.map((pt) => [pt.X / CLIPPER_SCALE, pt.Y / CLIPPER_SCALE]));
}

// deltaMm > 0 grows the outer silhouette and shrinks holes (bleed / cut line
// outside the artwork); < 0 does the opposite (inset / clipping trim).
function offsetContoursMm(contoursMm, deltaMm) {
  if (!deltaMm) return contoursMm.map((c) => c.slice());
  const oriented = orientContoursForClipper(contoursMm);
  const co = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE_MM * CLIPPER_SCALE);
  co.AddPaths(toClipperPaths(oriented), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const solution = new ClipperLib.Paths();
  co.Execute(solution, deltaMm * CLIPPER_SCALE);
  return fromClipperPaths(solution);
}

// Morphological close+open performed in millimetre space with the offset
// engine itself — the operation that turns a literal trace into something a
// blade can actually cut.
//
// A real production cut file (compare any professionally prepared one) is a
// SIMPLIFIED outline: gaps narrower than the blade's practical radius are
// bridged, hairline protrusions are dropped, corners come out rounded. Chasing
// pixel-accurate fidelity instead produces a contour full of detail no cutter
// can follow — and it is also what leaves compression noise and stippled
// edges in the result at all.
//
// close (+r then -r) bridges gaps and pinholes up to 2r wide; open (-r then
// +r) then removes spikes and slivers thinner than 2r. Net displacement is
// ~zero, so the outline stays on the artwork rather than growing — the
// separate bleed offset is applied afterwards.
function simplifyContoursMm(contoursMm, radiusMm) {
  if (!radiusMm || radiusMm <= 0) return contoursMm;
  const closed = offsetContoursMm(offsetContoursMm(contoursMm, radiusMm), -radiusMm);
  if (!closed.length) return contoursMm;
  const opened = offsetContoursMm(offsetContoursMm(closed, -radiusMm), radiusMm);
  return opened.length ? opened : closed;
}

// Keeps only outermost contours, discarding everything nested inside them.
//
// This is what a die-cut sticker actually is: the blade travels one closed
// loop around each piece. Interior contours — the gap between a chicken's
// legs, the counters of letters in a logo, a light patch in the middle of an
// animal — are detail the cut must ignore, not extra cuts to perform. Any
// professionally prepared cut file shows exactly one outline per piece.
//
// Nesting depth, not winding order, decides this: depth 0 is a piece, any
// deeper contour lies inside one and is dropped.
function keepOuterContours(contours) {
  return contours.filter((c, i) => {
    for (let j = 0; j < contours.length; j++) {
      if (i !== j && pointInPolygon(c[0], contours[j])) return false;
    }
    return true;
  });
}

// Drops contours whose enclosed area is below minAreaMm2. Physical units, so
// the rule is "smaller than this is not a real part" regardless of source
// resolution — the reliable way to discard leftover crumbs and noise blobs.
function dropTinyContoursMm(contoursMm, minAreaMm2) {
  if (!minAreaMm2 || minAreaMm2 <= 0) return contoursMm;
  return contoursMm.filter((c) => Math.abs(signedArea(c)) >= minAreaMm2);
}

// Chaikin corner-cutting — softens the small facets left by offsetting a
// polyline (potrace's own curves are already smooth; this mainly cleans up
// the round-join approximation clipper introduces).
function chaikinSmooth(points, iterations = 1, ratio = 0.25) {
  let pts = points;
  for (let iter = 0; iter < iterations && pts.length > 2; iter++) {
    const next = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p0 = pts[i], p1 = pts[(i + 1) % n];
      next.push([p0[0] + (p1[0] - p0[0]) * ratio, p0[1] + (p1[1] - p0[1]) * ratio]);
      next.push([p0[0] + (p1[0] - p0[0]) * (1 - ratio), p0[1] + (p1[1] - p0[1]) * (1 - ratio)]);
    }
    pts = next;
  }
  return pts;
}

function smoothContours(contours, iterations = 1) {
  if (!iterations) return contours;
  return contours.map((c) => chaikinSmooth(c, iterations));
}

// Separates real holes from separate shapes. A sheet of stickers traces to
// many top-level contours — calling those "holes" (as a naive
// contours.length - 1 does) is actively misleading to the operator checking
// the preview. Nesting depth is the honest test: depth 0/even = its own
// shape, odd = a hole inside one.
function classifyContours(contours) {
  let shapes = 0;
  let holes = 0;
  contours.forEach((c, i) => {
    let depth = 0;
    contours.forEach((other, j) => {
      if (i !== j && pointInPolygon(c[0], other)) depth++;
    });
    if (depth % 2 === 1) holes++;
    else shapes++;
  });
  return { shapes, holes };
}

module.exports = {
  offsetContoursMm, smoothContours, chaikinSmooth,
  simplifyContoursMm, dropTinyContoursMm, keepOuterContours,
  orientContoursForClipper, classifyContours, signedArea, pointInPolygon,
  CLIPPER_SCALE,
};
