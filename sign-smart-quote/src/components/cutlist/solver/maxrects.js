import { EPS } from './geometry.js';
import { finalizeSheet } from './guillotine.js';
import { bestFit, rankCandidates } from './fit.js';

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

  const remaining = demand.map((d) => d.remaining);
  const minRemainingDim = () => {
    let m = Infinity;
    for (let i = 0; i < demand.length; i++) {
      if (remaining[i] > 0) m = Math.min(m, demand[i].length, demand[i].width);
    }
    return Number.isFinite(m) ? m : 0;
  };

  const place = (ti, idx, w, h, rotated) => {
    const entry = demand[ti];
    const f = free[idx];
    const pos = { x: f.x, y: f.y };
    placements.push({ partId: entry.id, typeIndex: ti, name: entry.name, x: pos.x, y: pos.y, w, h, rotated });

    const inflated = { x: pos.x, y: pos.y, w: w + kerf, h: h + kerf };
    const next = [];
    for (const fr of free) {
      if (!splitFreeNode(fr, inflated, next)) next.push(fr);
    }
    free = next;
    counts[ti]++;
    remaining[ti]--;
    pruneFreeList(free, minRemainingDim());
  };

  if (cfg.placementMode === 'MIXED') {
    for (;;) {
      const best = rankCandidates(free, demand, remaining, cfg.order, cfg.fitRule, cfg, kerf, 'nest');
      if (!best) break;
      place(best.ti, best.idx, best.w, best.h, best.rotated);
    }
  } else {
    for (const ti of cfg.order) {
      while (remaining[ti] > 0) {
        const best = bestFit(free, demand[ti], cfg.fitRule);
        if (!best) break;
        place(ti, best.idx, best.w, best.h, best.rotated);
      }
    }
  }

  return finalizeSheet(stock, placements, free, [], counts);
}
