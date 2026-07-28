import { EPS, orientations } from './geometry.js';

/**
 * Split a free rect after placing a pw x ph part at its top-left corner.
 * Pushes 0..2 children into `out` and 0..2 cut segments into `cuts` (if provided).
 * Rectangle merging is intentionally NOT performed: merging free rects across
 * cut-tree branches can produce a layout that is no longer edge-to-edge
 * guillotine-cuttable.
 * @param {import('./types.js').Rect} free
 * @param {number} pw @param {number} ph @param {number} kerf
 * @param {'MIN_AREA'|'LONGER_LEFTOVER'|'SHORTER_LEFTOVER'} rule
 * @param {import('./types.js').Rect[]} out
 * @param {import('./types.js').Cut[]|null} cuts
 * @param {number} depth
 */
export function splitGuillotine(free, pw, ph, kerf, rule, out, cuts, depth) {
  const leftW = free.w - pw - kerf;
  const leftH = free.h - ph - kerf;
  const hasRight = leftW > EPS;
  const hasBottom = leftH > EPS;
  if (!hasRight && !hasBottom) return;

  const usedW = hasRight ? pw + kerf : free.w;
  const usedH = hasBottom ? ph + kerf : free.h;
  const rw = free.w - usedW;
  const rh = free.h - usedH;

  let splitHorizontal;
  switch (rule) {
    case 'SHORTER_LEFTOVER':
      splitHorizontal = rw < rh;
      break;
    case 'LONGER_LEFTOVER':
      splitHorizontal = rw > rh;
      break;
    default:
      splitHorizontal = usedW * rh > rw * usedH; // MIN_AREA
      break;
  }

  if (splitHorizontal) {
    // First cut: horizontal, spans the full width of `free`.
    if (hasBottom) {
      out.push({ x: free.x, y: free.y + ph + kerf, w: free.w, h: leftH });
      if (cuts) cuts.push({ axis: 'y', pos: free.y + ph, a: free.x, b: free.x + free.w, depth });
    }
    // Second cut: vertical, only within the band above the horizontal kerf.
    const topH = hasBottom ? ph : free.h;
    if (hasRight) {
      out.push({ x: free.x + pw + kerf, y: free.y, w: leftW, h: topH });
      if (cuts) cuts.push({ axis: 'x', pos: free.x + pw, a: free.y, b: free.y + topH, depth: depth + 1 });
    }
  } else {
    // First cut: vertical, spans the full height of `free`.
    if (hasRight) {
      out.push({ x: free.x + pw + kerf, y: free.y, w: leftW, h: free.h });
      if (cuts) cuts.push({ axis: 'x', pos: free.x + pw, a: free.y, b: free.y + free.h, depth });
    }
    // Second cut: horizontal, only within the column left of the vertical kerf.
    const leftColW = hasRight ? pw : free.w;
    if (hasBottom) {
      out.push({ x: free.x, y: free.y + ph + kerf, w: leftColW, h: leftH });
      if (cuts) cuts.push({ axis: 'y', pos: free.y + ph, a: free.x, b: free.x + leftColW, depth: depth + 1 });
    }
  }
}

function fitScore(rule, freeW, freeH, w, h) {
  switch (rule) {
    case 'BAF':
      return freeW * freeH - w * h;
    case 'BLSF':
      return Math.max(freeW - w, freeH - h);
    default: // BSSF
      return Math.min(freeW - w, freeH - h);
  }
}

/**
 * Find the best free rect + orientation for `part` across the given free list.
 * @param {import('./types.js').Rect[]} free
 * @param {import('./types.js').DemandEntry} part
 * @param {'BAF'|'BSSF'|'BLSF'} fitRule
 * @returns {{idx:number, w:number, h:number, rotated:boolean}|null}
 */
function bestFit(free, part, fitRule) {
  let best = null;
  let bestKey = null;
  for (let idx = 0; idx < free.length; idx++) {
    const f = free[idx];
    for (const o of orientations(part, true)) {
      if (o.w > f.w + EPS || o.h > f.h + EPS) continue;
      const score = fitScore(fitRule, f.w, f.h, o.w, o.h);
      const key = [score, f.y, f.x, o.rotated ? 1 : 0];
      if (!best || lexLess(key, bestKey)) {
        bestKey = key;
        best = { idx, w: o.w, h: o.h, rotated: o.rotated };
      }
    }
  }
  return best;
}

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - EPS) return true;
    if (a[i] > b[i] + EPS) return false;
  }
  return false;
}

/**
 * Pack one sheet using the guillotine (edge-to-edge) algorithm.
 * @param {import('./types.js').StockDef} stock
 * @param {import('./types.js').DemandEntry[]} demand
 * @param {{order:number[], fitRule:'BAF'|'BSSF'|'BLSF', splitRule:'MIN_AREA'|'LONGER_LEFTOVER'|'SHORTER_LEFTOVER'}} cfg
 * @param {number} kerf
 * @returns {import('./types.js').SheetLayout}
 */
export function packSheetGuillotine(stock, demand, cfg, kerf) {
  /** @type {import('./types.js').Rect[]} */
  let free = [{ x: 0, y: 0, w: stock.length, h: stock.width }];
  /** @type {import('./types.js').Placement[]} */
  const placements = [];
  /** @type {import('./types.js').Cut[]} */
  const cuts = [];
  const counts = new Array(demand.length).fill(0);

  for (const ti of cfg.order) {
    const entry = demand[ti];
    let left = entry.remaining;
    while (left > 0) {
      const best = bestFit(free, entry, cfg.fitRule);
      if (!best) break; // no room for this type on this sheet; won't get better later
      const { idx, w, h, rotated } = best;
      const f = free[idx];
      placements.push({ partId: entry.id, typeIndex: ti, name: entry.name, x: f.x, y: f.y, w, h, rotated });
      free.splice(idx, 1);
      splitGuillotine(f, w, h, kerf, cfg.splitRule, free, cuts, 0);
      counts[ti]++;
      left--;
    }
  }

  return finalizeSheet(stock, placements, free, cuts, counts);
}

/**
 * @param {import('./types.js').StockDef} stock
 * @param {import('./types.js').Placement[]} placements
 * @param {import('./types.js').Rect[]} free
 * @param {import('./types.js').Cut[]} cuts
 * @param {number[]} counts
 * @returns {import('./types.js').SheetLayout}
 */
export function finalizeSheet(stock, placements, free, cuts, counts) {
  const sheetArea = stock.length * stock.width;
  const usedArea = placements.reduce((n, p) => n + p.w * p.h, 0);
  let largestOffcut = null;
  for (const f of free) {
    if (!largestOffcut || f.w * f.h > largestOffcut.w * largestOffcut.h) largestOffcut = f;
  }
  return {
    stockId: stock.id,
    stockName: stock.name,
    sheetW: stock.length,
    sheetH: stock.width,
    placements,
    freeRects: free,
    cuts,
    usedCounts: counts,
    placedCount: placements.length,
    usedArea,
    sheetArea,
    largestOffcut,
  };
}
