// Flattens an SVG path `d` string produced by potrace into plain polylines:
// an array of contours, each an array of [x, y] points.
//
// potrace emits M (moveto), C (cubic bezier) and — crucially — L (lineto),
// the last one wherever curve optimisation collapsed a segment to a straight
// edge. Anything with straight sides (a barn, a frame, a rectangular sticker)
// is full of them. An earlier version of this parser assumed M/C only; the L
// tokens were then swallowed into the preceding command's number list, the
// letter parsed as NaN, and whole shapes silently collapsed into each other.
// Hence the explicit, command-by-command tokenizer below.

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

// Splits "M 1 2 C 3 4, 5 6, 7 8 L 9 10 Z" into [{cmd:'M', nums:[...]}, ...].
// Handles every command potrace can emit plus Z, and tolerates lowercase.
function tokenizePath(d) {
  const tokens = [];
  const re = /([MmLlCcZz])([^MmLlCcZz]*)/g;
  let m;
  while ((m = re.exec(d || '')) !== null) {
    const nums = m[2]
      .trim()
      .split(/[\s,]+/)
      .filter((s) => s.length)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    tokens.push({ cmd: m[1], nums });
  }
  return tokens;
}

function flattenPathData(d, curveSamples = 12) {
  const contours = [];
  let current = null;
  let cur = [0, 0];
  let start = [0, 0];

  const finish = () => {
    if (current && current.length > 2) contours.push(current);
    current = null;
  };

  for (const { cmd, nums } of tokenizePath(d)) {
    const upper = cmd.toUpperCase();
    const relative = cmd !== upper;

    if (upper === 'M') {
      finish();
      if (nums.length < 2) continue;
      cur = relative ? [cur[0] + nums[0], cur[1] + nums[1]] : [nums[0], nums[1]];
      start = cur;
      current = [cur];
      // Extra coordinate pairs after an M are implicit L commands per the SVG spec.
      for (let i = 2; i + 1 < nums.length; i += 2) {
        cur = relative ? [cur[0] + nums[i], cur[1] + nums[i + 1]] : [nums[i], nums[i + 1]];
        current.push(cur);
      }
    } else if (upper === 'L' && current) {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        cur = relative ? [cur[0] + nums[i], cur[1] + nums[i + 1]] : [nums[i], nums[i + 1]];
        current.push(cur);
      }
    } else if (upper === 'C' && current) {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        const p1 = relative ? [cur[0] + nums[i], cur[1] + nums[i + 1]] : [nums[i], nums[i + 1]];
        const p2 = relative ? [cur[0] + nums[i + 2], cur[1] + nums[i + 3]] : [nums[i + 2], nums[i + 3]];
        const p3 = relative ? [cur[0] + nums[i + 4], cur[1] + nums[i + 5]] : [nums[i + 4], nums[i + 5]];
        for (let s = 1; s <= curveSamples; s++) {
          current.push(cubicPoint(cur, p1, p2, p3, s / curveSamples));
        }
        cur = p3;
      }
    } else if (upper === 'Z') {
      // Contours are treated as implicitly closed downstream, so Z only ends
      // the current subpath and returns the pen to its start.
      cur = start;
      finish();
    }
  }
  finish();
  return contours;
}

module.exports = { flattenPathData, cubicPoint, tokenizePath };
