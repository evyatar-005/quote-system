import { bestFit } from './fit.js';
import { splitGuillotine, finalizeSheet } from './guillotine.js';
import { splitFreeNode, pruneFreeList } from './maxrects.js';

/**
 * Try to empty the least-full sheet by redistributing its pieces into the free
 * space still left on the other sheets. Greedy sheet-filling reliably leaves a
 * sparse tail sheet (e.g. one holding 3 pieces at 38% while every other sheet
 * sits near 80%); when those few pieces do fit elsewhere, dropping that sheet
 * saves a whole board.
 *
 * Returns a NEW sheet array if a sheet was eliminated, otherwise null. Pure
 * with respect to its inputs - the caller's layouts are never mutated, so a
 * failed attempt costs nothing.
 *
 * @param {import('./types.js').SheetLayout[]} sheets
 * @param {import('./types.js').DemandEntry[]} demand
 * @param {{fitRule:string, splitRule:string}} cfg
 * @param {number} kerf
 * @param {'guillotine'|'nest'} mode
 * @param {number} maxAttempts how many of the emptiest sheets to try
 * @returns {import('./types.js').SheetLayout[]|null}
 */
export function eliminateSparseSheet(sheets, demand, cfg, kerf, mode, maxAttempts = 3) {
  if (sheets.length < 2) return null;

  const byEmptiest = sheets
    .map((s, i) => ({ i, fill: s.sheetArea > 0 ? s.usedArea / s.sheetArea : 0 }))
    .sort((a, b) => a.fill - b.fill);

  for (const { i: victimIdx } of byEmptiest.slice(0, maxAttempts)) {
    const result = tryRedistribute(sheets, victimIdx, demand, cfg, kerf, mode);
    if (result) return result;
  }
  return null;
}

function tryRedistribute(sheets, victimIdx, demand, cfg, kerf, mode) {
  const victim = sheets[victimIdx];
  if (!victim.placements.length) return null;

  // Working copies of every other sheet's mutable packing state.
  const work = sheets.map((s, i) =>
    i === victimIdx
      ? null
      : {
          stock: { id: s.stockId, name: s.stockName, length: s.sheetW, width: s.sheetH },
          free: s.freeRects.map((r) => ({ ...r })),
          placements: s.placements.map((p) => ({ ...p })),
          cuts: s.cuts.map((c) => ({ ...c })),
          counts: s.usedCounts.slice(),
        }
  );

  // Hardest pieces first - a piece that only fits in one spot must claim it
  // before an easier piece takes it.
  const toMove = victim.placements
    .slice()
    .sort((a, b) => b.w * b.h - a.w * a.h);

  for (const p of toMove) {
    // Must re-fit against the ORIGINAL part definition, not the dimensions as
    // currently placed: `cand.rotated` is reported relative to whatever is
    // passed in, and the layout's rotated flag is defined against the original.
    const def = demand[p.typeIndex];
    const part = { length: def.length, width: def.width };
    let target = null;
    let targetKey = null;

    for (let si = 0; si < work.length; si++) {
      const w = work[si];
      if (!w) continue;
      const cand = bestFit(w.free, part, cfg.fitRule);
      if (!cand) continue;
      // Prefer the tightest fit; `si` keeps it deterministic.
      const key = [cand.key[0], cand.key[1], cand.key[2], si];
      if (!target || lexLessLocal(key, targetKey)) {
        targetKey = key;
        target = { si, cand };
      }
    }

    if (!target) return null; // a piece has nowhere to go - abandon this attempt

    const w = work[target.si];
    const f = w.free[target.cand.idx];
    w.placements.push({
      partId: p.partId,
      typeIndex: p.typeIndex,
      name: p.name,
      x: f.x,
      y: f.y,
      w: target.cand.w,
      h: target.cand.h,
      rotated: target.cand.rotated,
    });
    w.counts[p.typeIndex] = (w.counts[p.typeIndex] || 0) + 1;

    if (mode === 'guillotine') {
      w.free.splice(target.cand.idx, 1);
      splitGuillotine(f, target.cand.w, target.cand.h, kerf, cfg.splitRule, w.free, w.cuts, 0);
    } else {
      const inflated = { x: f.x, y: f.y, w: target.cand.w + kerf, h: target.cand.h + kerf };
      const next = [];
      for (const fr of w.free) {
        if (!splitFreeNode(fr, inflated, next)) next.push(fr);
      }
      w.free = next;
      pruneFreeList(w.free, 0);
    }
  }

  // Every piece found a home - rebuild without the victim.
  return work
    .filter(Boolean)
    .map((w) => finalizeSheet(w.stock, w.placements, w.free, w.cuts, w.counts));
}

function lexLessLocal(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}
