import { EPS, orientations } from './geometry.js';
import { finalizeSheet } from './guillotine.js';

/**
 * Split `free` against a used rect (already kerf-inflated). Pushes up to 4
 * remaining fragments into `out`. Returns true if `free` intersected `used`
 * (meaning the caller should drop the original `free` from the list).
 * @param {import('./types.js').Rect} free
 * @param {import('./types.js').Rect} used
 * @param {import('./types.js').Rect[]} out
 * @returns {boolean}
 */
export function splitFreeNode(free, used, out) {
  if (
    used.x >= free.x + free.w - EPS ||
    used.x + used.w <= free.x + EPS ||
    used.y >= free.y + free.h - EPS ||
    used.y + used.h <= free.y + EPS
  ) {
    return false;
  }

  if (used.x < free.x + free.w - EPS && used.x + used.w > free.x + EPS) {
    if (used.y > free.y + EPS && used.y < free.y + free.h - EPS) {
      out.push({ x: free.x, y: free.y, w: free.w, h: used.y - free.y }); // above
    }
    if (used.y + used.h < free.y + free.h - EPS) {
      out.push({ x: free.x, y: used.y + used.h, w: free.w, h: free.y + free.h - (used.y + used.h) }); // below
    }
  }
  if (used.y < free.y + free.h - EPS && used.y + used.h > free.y + EPS) {
    if (used.x > free.x + EPS && used.x < free.x + free.w - EPS) {
      out.push({ x: free.x, y: free.y, w: used.x - free.x, h: free.h }); // left
    }
    if (used.x + used.w < free.x + free.w - EPS) {
      out.push({ x: used.x + used.w, y: free.y, w: free.x + free.w - (used.x + used.w), h: free.h }); // right
    }
  }
  return true;
}

const contains = (a, b) =>
  b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.w <= a.x + a.w + EPS && b.y + b.h <= a.y + a.h + EPS;

/**
 * Drop free rects smaller than `minDim` in either dimension, and drop any
 * free rect fully contained in another (keeps the list short for perf).
 * @param {import('./types.js').Rect[]} free
 * @param {number} minDim
 */
export function pruneFreeList(free, minDim) {
  for (let i = 0; i < free.length; i++) {
    if (free[i].w < minDim - EPS || free[i].h < minDim - EPS) {
      free.splice(i, 1);
      i--;
      continue;
    }
    for (let j = i + 1; j < free.length; j++) {
      if (contains(free[j], free[i])) {
        free.splice(i, 1);
        i--;
        break;
      }
      if (contains(free[i], free[j])) {
        free.splice(j, 1);
        j--;
      }
    }
  }
}

function fitScoreBSSF(freeW, freeH, w, h) {
  return Math.min(freeW - w, freeH - h);
}

function bestFit(free, part) {
  let best = null;
  let bestKey = null;
  for (let idx = 0; idx < free.length; idx++) {
    const f = free[idx];
    for (const o of orientations(part, true)) {
      if (o.w > f.w + EPS || o.h > f.h + EPS) continue;
      const score = fitScoreBSSF(f.w, f.h, o.w, o.h);
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
 * Pack one sheet using MaxRects/BSSF (free nesting - no guillotine constraint).
 * Kerf is applied by inflating each placed rect by `kerf` on +x/+y before
 * pruning the free-rect list, guaranteeing >= kerf separation between parts.
 * @param {import('./types.js').StockDef} stock
 * @param {import('./types.js').DemandEntry[]} demand
 * @param {{order:number[]}} cfg
 * @param {number} kerf
 * @returns {import('./types.js').SheetLayout}
 */
export function packSheetMaxRects(stock, demand, cfg, kerf) {
  /** @type {import('./types.js').Rect[]} */
  let free = [{ x: 0, y: 0, w: stock.length, h: stock.width }];
  /** @type {import('./types.js').Placement[]} */
  const placements = [];
  const counts = new Array(demand.length).fill(0);

  const minRemainingDim = () => {
    let m = Infinity;
    for (const d of demand) {
      if (d.remaining > 0) m = Math.min(m, d.length, d.width);
    }
    return Number.isFinite(m) ? m : 0;
  };

  for (const ti of cfg.order) {
    const entry = demand[ti];
    let left = entry.remaining;
    while (left > 0) {
      const best = bestFit(free, entry);
      if (!best) break;
      const { idx, w, h, rotated } = best;
      const f = free[idx];
      const pos = { x: f.x, y: f.y };
      placements.push({ partId: entry.id, typeIndex: ti, name: entry.name, x: pos.x, y: pos.y, w, h, rotated });

      const inflated = { x: pos.x, y: pos.y, w: w + kerf, h: h + kerf };
      const next = [];
      for (const fr of free) {
        if (!splitFreeNode(fr, inflated, next)) next.push(fr);
      }
      free = next;
      pruneFreeList(free, minRemainingDim());

      counts[ti]++;
      left--;
    }
  }

  return finalizeSheet(stock, placements, free, [], counts);
}
