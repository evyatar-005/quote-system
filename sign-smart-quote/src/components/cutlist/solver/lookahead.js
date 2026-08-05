import { EPS } from './geometry.js';
import { bestFit } from './fit.js';
import { splitGuillotine } from './guillotine.js';
import { splitFreeNode, pruneFreeList } from './maxrects.js';

/** How many extra pieces to greedily fit into the residual before scoring it. */
const DEPTH = 4;
/** Only the top-K plain-scored candidates get the (expensive) look-ahead. */
export const TOP_K = 4;
/** Above these sizes look-ahead is skipped entirely - a heuristic, not correctness. */
const MAX_PIECES_FOR_LOOKAHEAD = 800;
const MAX_TYPES_FOR_LOOKAHEAD = 60;

/**
 * @param {import('./types.js').DemandEntry[]} demand
 * @param {number[]} remaining
 * @returns {boolean}
 */
export function lookaheadWorthwhile(demand, remaining) {
  if (demand.length > MAX_TYPES_FOR_LOOKAHEAD) return false;
  let pieces = 0;
  for (const r of remaining) pieces += r;
  return pieces <= MAX_PIECES_FOR_LOOKAHEAD;
}

/**
 * Dead area left in `f` after placing `cand` there and then greedily filling
 * whatever residual that creates. Lower is better.
 *
 * This exists because the plain fit rules score only the CURRENT placement's
 * slack, which ranks parts backwards whenever a residual is better served by
 * two pieces than one. Worked example (the case that motivated this): a
 * 1654x502 strip scores 2x 470x815 as 64,208 dead vs 158,708 for a single
 * 1460x460 - yet BSSF/BAF/BLSF all prefer the 1460x460 (or worse, a 475x868).
 *
 * Pure: operates on a throwaway free list seeded with `f` alone and a copy of
 * the remaining counters, so it never touches solver state (required for
 * determinism).
 *
 * @param {import('./types.js').Rect} f
 * @param {number} ti
 * @param {{w:number, h:number}} cand
 * @param {import('./types.js').DemandEntry[]} demand
 * @param {number[]} remaining
 * @param {{fitRule:'BAF'|'BSSF'|'BLSF', splitRule:string, order:number[]}} cfg
 * @param {number} kerf
 * @param {'guillotine'|'nest'} mode
 * @returns {number} dead area in mm^2
 */
export function lookaheadLoss(f, ti, cand, demand, remaining, cfg, kerf, mode) {
  const region = f.w * f.h;
  /** @type {import('./types.js').Rect[]} */
  let sand = [{ x: 0, y: 0, w: f.w, h: f.h }];
  const virt = remaining.slice();
  let filled = 0;

  const applyOne = (idx, w, h) => {
    const rect = sand[idx];
    if (mode === 'guillotine') {
      sand.splice(idx, 1);
      splitGuillotine(rect, w, h, kerf, cfg.splitRule, sand, null, 0);
    } else {
      const inflated = { x: rect.x, y: rect.y, w: w + kerf, h: h + kerf };
      const next = [];
      for (const fr of sand) {
        if (!splitFreeNode(fr, inflated, next)) next.push(fr);
      }
      sand = next;
      pruneFreeList(sand, minRemainingDim(demand, virt));
    }
    filled += w * h;
  };

  applyOne(0, cand.w, cand.h);
  virt[ti]--;

  for (let d = 0; d < DEPTH; d++) {
    if (!sand.length) break;
    let pick = null;
    let pickKey = null;
    for (const tj of cfg.order) {
      if (virt[tj] <= 0) continue;
      const c = bestFit(sand, demand[tj], cfg.fitRule);
      if (!c) continue;
      const key = [c.key[0], -(demand[tj].length * demand[tj].width), c.key[1], c.key[2], c.key[3], tj];
      if (!pick || lexLessLocal(key, pickKey)) {
        pick = { tj, c };
        pickKey = key;
      }
    }
    if (!pick) break;
    applyOne(pick.c.idx, pick.c.w, pick.c.h);
    virt[pick.tj]--;
  }

  return region - filled;
}

function lexLessLocal(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - EPS) return true;
    if (a[i] > b[i] + EPS) return false;
  }
  return false;
}

function minRemainingDim(demand, remaining) {
  let m = Infinity;
  for (let i = 0; i < demand.length; i++) {
    if (remaining[i] > 0) m = Math.min(m, demand[i].length, demand[i].width);
  }
  return Number.isFinite(m) ? m : 0;
}

/**
 * Memo wrapper. The same residual shape is queried over and over (identical
 * sheets produce identical strips), so caching on the geometry + demand
 * signature is what keeps look-ahead affordable.
 */
export function createLookaheadCache() {
  const memo = new Map();
  return {
    loss(f, ti, cand, demand, remaining, cfg, kerf, mode) {
      // remaining counts change over time, so include a cheap signature of
      // which types are still live - shape alone would return stale answers.
      let sig = '';
      for (let i = 0; i < remaining.length; i++) sig += (remaining[i] > 0 ? '1' : '0');
      const key = `${f.w}|${f.h}|${ti}|${cand.w}|${cand.h}|${sig}`;
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      const val = lookaheadLoss(f, ti, cand, demand, remaining, cfg, kerf, mode);
      memo.set(key, val);
      return val;
    },
  };
}
