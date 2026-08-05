// Splits a sheet of artwork into its separate elements, so each one can be
// background-tuned on its own (see autotune.js) instead of sharing one
// global white cutoff that is always wrong for at least one element.
//
// Each placed photo/graphic on a transparent page is one opaque connected
// component — verified on the real client file: 52% of the page is
// transparent, and the gaps between elements are transparent too. So the
// element boundary is exactly the alpha connected-components boundary; no
// heuristic guessing involved.

const ALPHA_CUT = 128;

// 4-connectivity BFS labeling — same structure as despeckle() in mask.js.
function findComponents(alpha, width, height) {
  const total = width * height;
  const labels = new Int32Array(total).fill(-1);
  const components = [];
  const queue = new Int32Array(total);

  for (let start = 0; start < total; start++) {
    if (alpha[start] < ALPHA_CUT || labels[start] !== -1) continue;
    let head = 0, tail = 0;
    let minX = start % width, maxX = minX, minY = (start / width) | 0, maxY = minY;
    let pixelCount = 0;
    labels[start] = components.length;
    queue[tail++] = start;
    while (head < tail) {
      const p = queue[head++];
      pixelCount++;
      const x = p % width, y = (p / width) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const tryPush = (q) => {
        if (alpha[q] >= ALPHA_CUT && labels[q] === -1) {
          labels[q] = components.length;
          queue[tail++] = q;
        }
      };
      if (x > 0) tryPush(p - 1);
      if (x < width - 1) tryPush(p + 1);
      if (y > 0) tryPush(p - width);
      if (y < height - 1) tryPush(p + width);
    }
    components.push({ minX, minY, maxX, maxY, pixelCount });
  }
  return { labels, components };
}

// Returns bounding boxes (with a small margin) of every element on the page,
// largest first. minPixels drops flyspecks (antialiasing crumbs, stray dots)
// that aren't real elements — well below any real sticker's pixel footprint.
function segmentElements(alpha, width, height, { minPixels = 200, marginPx = 4 } = {}) {
  const { components } = findComponents(alpha, width, height);
  return components
    .filter((c) => c.pixelCount >= minPixels)
    .map((c) => ({
      x: Math.max(0, c.minX - marginPx),
      y: Math.max(0, c.minY - marginPx),
      width: Math.min(width, c.maxX + marginPx + 1) - Math.max(0, c.minX - marginPx),
      height: Math.min(height, c.maxY + marginPx + 1) - Math.max(0, c.minY - marginPx),
      pixelCount: c.pixelCount,
    }))
    .sort((a, b) => b.pixelCount - a.pixelCount);
}

module.exports = { segmentElements, findComponents };
