// Flattens an SVG path `d` string produced by potrace (only ever emits M and
// C commands, one bezier segment per C, subpaths implicitly closed — the
// first and last point of each M...C...C block coincide, no explicit Z) into
// plain polylines: an array of contours, each an array of [x, y] points.

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

function flattenPathData(d, curveSamples = 12) {
  const tokens = (d || '').match(/[MC][^MC]*/g) || [];
  const contours = [];
  let current = null;
  let cur = [0, 0];

  for (const tok of tokens) {
    const cmd = tok[0];
    const nums = tok
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);

    if (cmd === 'M') {
      if (current && current.length > 2) contours.push(current);
      cur = [nums[0], nums[1]];
      current = [cur];
    } else if (cmd === 'C' && current) {
      // Segments may be chained ("C x1 y1 x2 y2 x y C x1 y1 x2 y2 x y ...")
      // if potrace ever emits more than one per token — handle N*6 numbers.
      for (let i = 0; i + 6 <= nums.length; i += 6) {
        const p1 = [nums[i], nums[i + 1]];
        const p2 = [nums[i + 2], nums[i + 3]];
        const p3 = [nums[i + 4], nums[i + 5]];
        for (let s = 1; s <= curveSamples; s++) {
          current.push(cubicPoint(cur, p1, p2, p3, s / curveSamples));
        }
        cur = p3;
      }
    }
  }
  if (current && current.length > 2) contours.push(current);
  return contours;
}

module.exports = { flattenPathData, cubicPoint };
