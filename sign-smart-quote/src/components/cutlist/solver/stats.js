import { EPS } from './geometry.js';

/**
 * @param {import('./types.js').SheetLayout[]} sheets
 * @param {import('./types.js').UnplacedEntry[]} unplaced
 * @param {import('./types.js').PartDef[]} parts
 * @returns {import('./types.js').Stats}
 */
export function buildStats(sheets, unplaced, parts) {
  /** @type {Object<string,number>} */
  const sheetsUsed = {};
  let totalSheetArea = 0;
  let totalCuts = 0;
  let totalCutLength = 0;
  let sumLargestOffcut = 0;

  for (const s of sheets) {
    sheetsUsed[s.stockId] = (sheetsUsed[s.stockId] || 0) + 1;
    totalSheetArea += s.sheetArea;
    totalCuts += s.cuts.length;
    for (const c of s.cuts) totalCutLength += c.b - c.a;
    if (s.largestOffcut) sumLargestOffcut += s.largestOffcut.w * s.largestOffcut.h;
  }

  const tooLargeIds = new Set(unplaced.filter((u) => u.reason === 'TOO_LARGE').map((u) => u.id));
  const totalPartArea = parts
    // Rows with just a name typed in and no dimensions yet (qty=0, length/width
    // NaN) must contribute 0, not NaN - and NaN * 0 is NaN in JS, so skipping
    // them explicitly (rather than relying on the qty factor) is required.
    .filter((p) => !tooLargeIds.has(p.id) && p.qty > 0 && Number.isFinite(p.length) && Number.isFinite(p.width))
    .reduce((n, p) => n + p.length * p.width * p.qty, 0);

  const placed = sheets.reduce((n, s) => n + s.usedArea, 0);
  const utilization = totalSheetArea > 0 ? placed / totalSheetArea : 0;

  return {
    sheetsUsed,
    totalSheetArea,
    totalPartArea,
    wasteArea: totalSheetArea - placed,
    utilization,
    totalCuts,
    totalCutLength,
    sumLargestOffcut,
  };
}

/**
 * Recursively verify that `rects` sitting inside `region` can be produced by
 * a sequence of full-span guillotine cuts. This does NOT trust the packer's
 * own bookkeeping - it independently re-derives cuttability from geometry.
 * @param {import('./types.js').Rect} region
 * @param {import('./types.js').Rect[]} rects
 * @returns {boolean}
 */
export function isGuillotineCuttable(region, rects) {
  if (rects.length <= 1) return true;

  const xs = new Set();
  const ys = new Set();
  for (const r of rects) {
    xs.add(r.x);
    xs.add(r.x + r.w);
    ys.add(r.y);
    ys.add(r.y + r.h);
  }

  for (const c of xs) {
    if (c <= region.x + EPS || c >= region.x + region.w - EPS) continue;
    if (!rects.every((r) => r.x + r.w <= c + EPS || r.x >= c - EPS)) continue;
    const L = rects.filter((r) => r.x + r.w <= c + EPS);
    const R = rects.filter((r) => r.x >= c - EPS);
    if (!L.length || !R.length) continue;
    if (
      isGuillotineCuttable({ ...region, w: c - region.x }, L) &&
      isGuillotineCuttable({ ...region, x: c, w: region.x + region.w - c }, R)
    ) {
      return true;
    }
  }
  for (const c of ys) {
    if (c <= region.y + EPS || c >= region.y + region.h - EPS) continue;
    if (!rects.every((r) => r.y + r.h <= c + EPS || r.y >= c - EPS)) continue;
    const T = rects.filter((r) => r.y + r.h <= c + EPS);
    const B = rects.filter((r) => r.y >= c - EPS);
    if (!T.length || !B.length) continue;
    if (
      isGuillotineCuttable({ ...region, h: c - region.y }, T) &&
      isGuillotineCuttable({ ...region, y: c, h: region.y + region.h - c }, B)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Independent invariant check over an OptimizeResult. Returns a list of
 * human-readable violations (empty = OK). Intended for dev-mode console
 * assertions and the node sanity script - never trusts the solver's own
 * counters.
 * @param {import('./types.js').OptimizeResult} result
 * @param {import('./types.js').SolverInput} input
 * @returns {string[]}
 */
export function verifyLayout(result, input) {
  const errors = [];
  const kerf = result.kerf;
  const invUsed = {};

  for (const [si, sheet] of result.sheets.entries()) {
    invUsed[sheet.stockId] = (invUsed[sheet.stockId] || 0) + 1;

    for (const p of sheet.placements) {
      if (p.x < -EPS || p.y < -EPS || p.x + p.w > sheet.sheetW + EPS || p.y + p.h > sheet.sheetH + EPS) {
        errors.push(`sheet ${si}: placement ${p.partId} out of bounds`);
      }
      const part = input.parts.find((pp) => pp.id === p.partId);
      if (part) {
        const straight = Math.abs(p.w - part.length) < EPS && Math.abs(p.h - part.width) < EPS;
        const swapped = Math.abs(p.w - part.width) < EPS && Math.abs(p.h - part.length) < EPS;
        if (!straight && !swapped) errors.push(`sheet ${si}: placement ${p.partId} dims don't match part def`);
        if (swapped && !straight && !p.rotated) errors.push(`sheet ${si}: placement ${p.partId} rotated flag wrong`);
      }
    }

    const kerfMargin = Math.max(0, kerf - EPS);
    for (let i = 0; i < sheet.placements.length; i++) {
      for (let j = i + 1; j < sheet.placements.length; j++) {
        const a = sheet.placements[i];
        const b = sheet.placements[j];
        const sep =
          a.x + a.w <= b.x + kerfMargin + EPS ||
          b.x + b.w <= a.x + kerfMargin + EPS ||
          a.y + a.h <= b.y + kerfMargin + EPS ||
          b.y + b.h <= a.y + kerfMargin + EPS;
        if (!sep) errors.push(`sheet ${si}: placements ${a.partId}/${b.partId} violate kerf separation`);
      }
    }

    const sumArea = sheet.placements.reduce((n, p) => n + p.w * p.h, 0);
    if (Math.abs(sumArea - sheet.usedArea) > 1) errors.push(`sheet ${si}: usedArea bookkeeping mismatch`);

    if (result.mode === 'guillotine') {
      const region = { x: 0, y: 0, w: sheet.sheetW, h: sheet.sheetH };
      if (!isGuillotineCuttable(region, sheet.placements)) errors.push(`sheet ${si}: layout is not guillotine-cuttable`);
    }
  }

  for (const stock of input.stocks) {
    if ((invUsed[stock.id] || 0) > stock.qty + EPS) errors.push(`stock ${stock.id}: used more sheets than inventory`);
  }

  const placedByType = new Map();
  for (const sheet of result.sheets) {
    for (const p of sheet.placements) placedByType.set(p.partId, (placedByType.get(p.partId) || 0) + 1);
  }
  const unplacedByType = new Map(result.unplaced.map((u) => [u.id, u.count]));
  for (const part of input.parts) {
    const placed = placedByType.get(part.id) || 0;
    const unplacedCount = unplacedByType.get(part.id) || 0;
    if (placed + unplacedCount !== part.qty) {
      errors.push(`part ${part.id}: conservation violated (placed ${placed} + unplaced ${unplacedCount} != qty ${part.qty})`);
    }
  }

  return errors;
}
