// Turns the dense polylines the tracing pipeline works in into compact smooth
// Bézier curves for export.
//
// Everything upstream (offset, simplify, boolean ops via clipper) needs plain
// polygons, so contours are carried as polylines all the way through and only
// converted here, at the very edge. Without this step the exporter emits every
// flattened sample as a separate lineto: measured on a real job that was
// ~50,000 points and a 500KB SVG, against 275 points and 213 curves in a
// professionally prepared cut file for comparable artwork — roughly 180× the
// data for a visibly worse line. Files that heavy are slow to open and can
// fail outright in Illustrator/RIP software.
//
// Two stages: Ramer-Douglas-Peucker drops samples that lie on an existing
// line within a physical tolerance, then Catmull-Rom→Bézier converts the
// survivors into smooth cubics passing through each remaining point.

// Perpendicular distance from p to segment ab.
function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Iterative Ramer-Douglas-Peucker — recursion would blow the stack on the
// tens of thousands of points a full sheet produces.
function rdpSimplify(points, epsilon) {
  if (points.length < 3 || epsilon <= 0) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    if (last <= first + 1) continue;
    let maxDist = -1, index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = pointSegmentDistance(points[i], points[first], points[last]);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist > epsilon && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

// Catmull-Rom through the points, expressed as cubic Béziers. Treated as a
// closed loop, so the tangent at the seam is continuous like everywhere else
// — a cut contour is always closed, and a corner at the arbitrary start point
// would be visible in the cut.
function contourToBezier(points, decimals = 3) {
  const n = points.length;
  const f = (v) => v.toFixed(decimals);
  if (n < 3) {
    if (!n) return '';
    return `M ${f(points[0][0])} ${f(points[0][1])} Z`;
  }

  const at = (i) => points[((i % n) + n) % n];
  let d = `M ${f(points[0][0])} ${f(points[0][1])}`;

  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    // Standard Catmull-Rom → Bézier control points (tension 1/6).
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${f(c1[0])} ${f(c1[1])}, ${f(c2[0])} ${f(c2[1])}, ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}

// toleranceMm is a real-world tolerance: how far the exported curve may sit
// from the traced polyline. 0.05mm is well inside any cutter's mechanical
// accuracy, so nothing visible is lost.
function contoursToBezierPathD(contours, { toleranceMm = 0.05, decimals = 3 } = {}) {
  return contours
    .map((c) => contourToBezier(rdpSimplify(c, toleranceMm), decimals))
    .filter(Boolean)
    .join(' ');
}

module.exports = { rdpSimplify, contourToBezier, contoursToBezierPathD, pointSegmentDistance };
