// Benchmark for the real customer job that exposed the 19-vs-18 gap.
// Run: node scripts/cutlist-bench-18.mjs
//
// Reference: CutList Optimizer produces 18 sheets. Hand-derived lower bound is
// also 18 (1654x980 cannot rotate into a 1485-high sheet, so each of the 12
// needs its own sheet; the 1654x502 strip beside each holds exactly 2x 470x815;
// the remainder is 16.27 m^2 => >=6 more sheets). NOTE that 18 is an AREA bound
// on the remainder, not a proof of geometric feasibility.
//
// Exits non-zero ONLY on an invariant violation or a regression past 19.
// Not reaching 18 is reported, not failed.
import { optimize } from '../src/components/cutlist/solver/optimize.js';
import { verifyLayout } from '../src/components/cutlist/solver/stats.js';

// Stock is the soma-shrunk usable size (2050x1525 plate, 20mm soma band).
const base = {
  stocks: [{ id: 'S', name: 'S', length: 2010, width: 1485, qty: 50 }],
  parts: [
    { id: 'a', name: 'חלק 1', length: 470, width: 815, qty: 36 },
    { id: 'b', name: 'חלק 2', length: 475, width: 868, qty: 6 },
    { id: 'c', name: 'חלק 3', length: 1654, width: 980, qty: 6 },
    { id: 'd', name: 'חלק 4', length: 1460, width: 460, qty: 6 },
    { id: 'e', name: 'חלק 5', length: 1654, width: 980, qty: 6 },
    { id: 'f', name: 'חלק 6', length: 880, width: 980, qty: 6 },
  ],
  kerf: 3,
};

const partArea = base.parts.reduce((n, p) => n + p.length * p.width * p.qty, 0);
console.log('part area        :', (partArea / 1e6).toFixed(2), 'm2');
console.log('sheet area       :', ((2010 * 1485) / 1e6).toFixed(4), 'm2');
console.log('lower bound      : 18 sheets   (CutList Optimizer: 18, we were: 19)');
console.log();

let fail = false;
for (const mode of ['nest', 'guillotine']) {
  const input = { ...base, mode };
  const r = optimize(input, { quality: 'max', seed: 0x5eed });
  const errs = verifyLayout(r, input);
  const unplaced = r.unplaced.reduce((n, u) => n + u.count, 0);

  console.log(mode.padEnd(11), {
    sheets: r.sheets.length,
    util: (r.stats.utilization * 100).toFixed(2) + '%',
    unplaced,
    passes: r.passesRun,
    ms: Math.round(r.elapsedMs),
    cfg: r.cfg,
  });

  if (errs.length) {
    console.error('  INVARIANT VIOLATIONS:', errs.slice(0, 3));
    fail = true;
  }
  if (mode === 'nest' && r.sheets.length > 19) {
    console.error('  REGRESSION: nest mode got worse than the 19-sheet baseline');
    fail = true;
  }
  if (r.sheets.length <= 18) console.log('  -> reached the 18-sheet target');
}

process.exit(fail ? 1 : 0);
