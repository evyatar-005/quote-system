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

module.exports = { offsetContoursMm, smoothContours, chaikinSmooth, orientContoursForClipper, signedArea, CLIPPER_SCALE };
