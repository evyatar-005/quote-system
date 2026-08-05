import { EPS } from './geometry.js';
import { bestFit, lexLess, rankCandidates } from './fit.js';

// Re-exported for callers that historically imported them from here.
export { bestFit, lexLess };

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

/**
 * Across ALL part types that still have pieces left, find the single best
 * (type, free rect, orientation) placement. This is what lets a sheet
 * interleave different part types instead of exhausting one type at a time -
 * the type-at-a-time order tends to make one type claim whole full-width
 * bands, leaving only a thin strip for everything else.
 * Ties prefer the larger part (classic best-fit-decreasing behavior).
 *
 * When `cfg.lookahead` is supplied, the top-K plain-scored candidates are
 * re-ranked by how much area dies in the residual they create - see
 * lookahead.js for why the plain fit rules alone rank some cases backwards.
 * @param {import('./types.js').Rect[]} free
 * @param {import('./types.js').DemandEntry[]} demand
 * @param {number[]} remaining parallel to `demand`
 * @param {number[]} order type indices to consider
 * @param {'BAF'|'BSSF'|'BLSF'} fitRule
 * @param {object} [cfg] full config; only `cfg.lookahead` is read here
 * @param {number} [kerf]
 * @param {'guillotine'|'nest'} [mode]
 * @returns {{ti:number, idx:number, w:number, h:number, rotated:boolean}|null}
 */
export function pickGlobalBest(free, demand, remaining, order, fitRule, cfg, kerf, mode) {
  return rankCandidates(free, demand, remaining, order, fitRule, cfg, kerf, mode);
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
  const free = [{ x: 0, y: 0, w: stock.length, h: stock.width }];
  /** @type {import('./types.js').Placement[]} */
  const placements = [];
  /** @type {import('./types.js').Cut[]} */
  const cuts = [];
  const counts = new Array(demand.length).fill(0);

  const place = (ti, idx, w, h, rotated) => {
    const entry = demand[ti];
    const f = free[idx];
    placements.push({ partId: entry.id, typeIndex: ti, name: entry.name, x: f.x, y: f.y, w, h, rotated });
    free.splice(idx, 1);
    splitGuillotine(f, w, h, kerf, cfg.splitRule, free, cuts, 0);
    counts[ti]++;
  };

  if (cfg.placementMode === 'MIXED') {
    const remaining = demand.map((d) => d.remaining);
    for (;;) {
      const best = pickGlobalBest(free, demand, remaining, cfg.order, cfg.fitRule, cfg, kerf, 'guillotine');
      if (!best) break;
      place(best.ti, best.idx, best.w, best.h, best.rotated);
      remaining[best.ti]--;
    }
  } else {
    for (const ti of cfg.order) {
      let left = demand[ti].remaining;
      while (left > 0) {
        const best = bestFit(free, demand[ti], cfg.fitRule);
        if (!best) break; // no room for this type on this sheet; won't get better later
        place(ti, best.idx, best.w, best.h, best.rotated);
        left--;
      }
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
