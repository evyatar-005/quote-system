import { EPS, orientations } from './geometry.js';

/**
 * Lexicographic "is a < b" over numeric key arrays, with EPS tolerance so
 * float noise can't flip a ranking between otherwise identical runs.
 * @param {number[]} a @param {number[]} b
 * @returns {boolean}
 */
export function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - EPS) return true;
    if (a[i] > b[i] + EPS) return false;
  }
  return false;
}

/**
 * How well a part fills a free rect. Lower is better in every rule.
 * @param {'BAF'|'BSSF'|'BLSF'} rule
 * @param {number} freeW @param {number} freeH @param {number} w @param {number} h
 * @returns {number}
 */
export function fitScore(rule, freeW, freeH, w, h) {
  switch (rule) {
    case 'BAF':
      return freeW * freeH - w * h; // best area fit
    case 'BLSF':
      return Math.max(freeW - w, freeH - h); // best long side fit
    default:
      return Math.min(freeW - w, freeH - h); // BSSF
  }
}

/**
 * Best free rect + orientation for `part`. Also returns the comparison `key`,
 * so callers can rank candidates across different part types.
 * @param {import('./types.js').Rect[]} free
 * @param {{length:number, width:number}} part
 * @param {'BAF'|'BSSF'|'BLSF'} fitRule
 * @returns {{idx:number, w:number, h:number, rotated:boolean, key:number[]}|null}
 */
export function bestFit(free, part, fitRule) {
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
        best = { idx, w: o.w, h: o.h, rotated: o.rotated, key };
      }
    }
  }
  return best;
}

/** Only this many plain-ranked candidates get the (expensive) look-ahead pass. */
const TOP_K = 4;

/**
 * Pick the single best (type, free rect, orientation) across every part type
 * that still has pieces left. Shared by both packers so the ranking logic -
 * including look-ahead - exists in exactly one place.
 *
 * `cfg.lookahead` (a cache from lookahead.js) is optional. When present, the
 * top-K plain-ranked candidates are re-scored by how much area dies in the
 * residual each one creates, which fixes cases where filling a leftover strip
 * with one big piece scores better than the two pieces that actually fit it.
 *
 * The trailing `ti` in every key gives a total order, so ranking is fully
 * deterministic - no PRNG, no Map iteration order, no object identity.
 *
 * @param {import('./types.js').Rect[]} free
 * @param {import('./types.js').DemandEntry[]} demand
 * @param {number[]} remaining
 * @param {number[]} order
 * @param {'BAF'|'BSSF'|'BLSF'} fitRule
 * @param {{lookahead?:{loss:Function}}} [cfg]
 * @param {number} [kerf]
 * @param {'guillotine'|'nest'} [mode]
 * @returns {{ti:number, idx:number, w:number, h:number, rotated:boolean}|null}
 */
export function rankCandidates(free, demand, remaining, order, fitRule, cfg, kerf, mode) {
  /** @type {{ti:number, cand:any, key:number[]}[]} */
  const cands = [];
  for (const ti of order) {
    if (remaining[ti] <= 0) continue;
    const cand = bestFit(free, demand[ti], fitRule);
    if (!cand) continue;
    const area = demand[ti].length * demand[ti].width;
    // fit quality first, then bigger parts first, then positional tie-breaks
    cands.push({ ti, cand, key: [cand.key[0], -area, cand.key[1], cand.key[2], cand.key[3], ti] });
  }
  if (!cands.length) return null;

  cands.sort((a, b) => (lexLess(a.key, b.key) ? -1 : lexLess(b.key, a.key) ? 1 : 0));

  const la = cfg && cfg.lookahead;
  if (la && cands.length > 1) {
    const pool = cands.slice(0, TOP_K);
    let best = null;
    let bestKey = null;
    for (const c of pool) {
      const loss = la.loss(free[c.cand.idx], c.ti, c.cand, demand, remaining, cfg, kerf, mode);
      // loss dominates; the plain key stays as the deterministic tie-break
      const key = [loss, ...c.key];
      if (!best || lexLess(key, bestKey)) {
        bestKey = key;
        best = c;
      }
    }
    return { ti: best.ti, idx: best.cand.idx, w: best.cand.w, h: best.cand.h, rotated: best.cand.rotated };
  }

  const top = cands[0];
  return { ti: top.ti, idx: top.cand.idx, w: top.cand.w, h: top.cand.h, rotated: top.cand.rotated };
}
