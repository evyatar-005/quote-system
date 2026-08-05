// Throwaway sanity script for the cut-list solver. Run with:
//   node scripts/cutlist-sanity.mjs
// Not part of the build; safe to delete or keep around for regression checks.
import { optimize } from '../src/components/cutlist/solver/optimize.js';
import { verifyLayout } from '../src/components/cutlist/solver/stats.js';
import { mulberry32 } from '../src/components/cutlist/solver/rng.js';
import { packSheetMaxRects } from '../src/components/cutlist/solver/maxrects.js';
import { createLookaheadCache } from '../src/components/cutlist/solver/lookahead.js';

let failures = 0;
let passed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failures++;
    console.error(`FAIL ${name}: ${detail || ''}`);
  }
}

function stock(id, length, width, qty, name = id) {
  return { id, name, length, width, qty };
}
function part(id, length, width, qty, name = id) {
  return { id, name, length, width, qty };
}

function run(input, opts = {}) {
  const result = optimize(input, { deterministic: true, ...opts });
  const errs = verifyLayout(result, input);
  if (errs.length) {
    failures++;
    console.error(`INVARIANT VIOLATIONS: ${JSON.stringify(errs)}`);
  }
  return result;
}

function placedCount(result) {
  return result.sheets.reduce((n, s) => n + s.placedCount, 0);
}
function unplacedCount(result, id) {
  const u = result.unplaced.find((x) => x.id === id);
  return u ? u.count : 0;
}

console.log('--- T1: exact tiling, kerf 0 ---');
{
  const input = { stocks: [stock('S', 1000, 1000, 1)], parts: [part('A', 500, 500, 4)], kerf: 0, mode: 'guillotine' };
  const r = run(input);
  check('T1 sheets', r.sheets.length === 1, r.sheets.length);
  check('T1 placed', placedCount(r) === 4, placedCount(r));
  check('T1 unplaced', r.unplaced.length === 0, JSON.stringify(r.unplaced));
  check('T1 utilization 100%', Math.abs(r.stats.utilization - 1) < 1e-6, r.stats.utilization);
  check('T1 cuts = 3', r.sheets[0].cuts.length === 3, r.sheets[0].cuts.length);
}

console.log('--- T2: kerf reality check ---');
{
  const input = { stocks: [stock('S', 1000, 1000, 1)], parts: [part('A', 500, 500, 4)], kerf: 5, mode: 'guillotine' };
  const r = run(input);
  check('T2 placed = 1', placedCount(r) === 1, placedCount(r));
  check('T2 unplaced = 3', unplacedCount(r, 'A') === 3, unplacedCount(r, 'A'));
  check('T2 utilization 25%', Math.abs(r.stats.utilization - 0.25) < 1e-6, r.stats.utilization);
}

console.log('--- T3: rotation ---');
{
  const input = { stocks: [stock('S', 1000, 500, 1)], parts: [part('B', 500, 1000, 1)], kerf: 0, mode: 'guillotine' };
  const r = run(input);
  check('T3 placed = 1', placedCount(r) === 1, placedCount(r));
  check('T3 rotated', r.sheets[0]?.placements[0]?.rotated === true, JSON.stringify(r.sheets[0]?.placements));
  check('T3 utilization 100%', Math.abs(r.stats.utilization - 1) < 1e-6, r.stats.utilization);
}

console.log('--- T4a: stock choice, small wins ---');
{
  const input = {
    stocks: [stock('big', 2000, 1000, 1), stock('small', 500, 500, 4)],
    parts: [part('C', 500, 500, 4)],
    kerf: 0,
    mode: 'guillotine',
  };
  const r = run(input);
  const smallUsed = r.stats.sheetsUsed.small || 0;
  const bigUsed = r.stats.sheetsUsed.big || 0;
  check('T4a small=4', smallUsed === 4, smallUsed);
  check('T4a big=0', bigUsed === 0, bigUsed);
  check('T4a area 1.0m2', Math.abs(r.stats.totalSheetArea - 1_000_000) < 1, r.stats.totalSheetArea);
}

console.log('--- T4b: stock choice, large wins ---');
{
  const input = {
    stocks: [stock('big', 2000, 1000, 1), stock('small', 500, 500, 4)],
    parts: [part('C', 500, 500, 5)],
    kerf: 0,
    mode: 'guillotine',
  };
  const r = run(input);
  const bigUsed = r.stats.sheetsUsed.big || 0;
  check('T4b big=1', bigUsed === 1, bigUsed);
  check('T4b placed=5', placedCount(r) === 5, placedCount(r));
  check('T4b area 2.0m2', Math.abs(r.stats.totalSheetArea - 2_000_000) < 1, r.stats.totalSheetArea);
}

console.log('--- T5: oversize part ---');
{
  const input = {
    stocks: [stock('S', 3050, 2030, 5)],
    parts: [part('D', 4000, 100, 2), part('E', 1000, 500, 4)],
    kerf: 0,
    mode: 'guillotine',
  };
  const r = run(input);
  check('T5 D too large', r.unplaced.some((u) => u.id === 'D' && u.reason === 'TOO_LARGE'), JSON.stringify(r.unplaced));
  check('T5 E all placed', placedCount(r) === 4, placedCount(r));
}

console.log('--- T6: inventory exhaustion ---');
{
  const input = { stocks: [stock('S', 1000, 1000, 1)], parts: [part('F', 400, 400, 6)], kerf: 3, mode: 'guillotine' };
  const r = run(input);
  check('T6 placed = 4', placedCount(r) === 4, placedCount(r));
  check('T6 unplaced = 2', unplacedCount(r, 'F') === 2, unplacedCount(r, 'F'));
  check('T6 utilization 64%', Math.abs(r.stats.utilization - 0.64) < 1e-6, r.stats.utilization);
}

console.log('--- T7: nest vs guillotine ---');
{
  const baseInput = {
    stocks: [stock('S', 1000, 1000, 1)],
    parts: [part('R', 750, 250, 4), part('SQ', 500, 500, 1)],
    kerf: 0,
  };
  const gr = run({ ...baseInput, mode: 'guillotine' });
  const nr = run({ ...baseInput, mode: 'nest' });
  check('T7 guillotine R placed 4', placedCount(gr) === 4, placedCount(gr));
  check('T7 nest >= guillotine', placedCount(nr) >= placedCount(gr), `${placedCount(nr)} vs ${placedCount(gr)}`);
}

console.log('--- T8: determinism ---');
{
  const input = { stocks: [stock('S', 1000, 1000, 3)], parts: [part('A', 300, 200, 10)], kerf: 2, mode: 'guillotine' };
  const r1 = run(input, { seed: 42 });
  const r2 = run(input, { seed: 42 });
  check('T8 deterministic', JSON.stringify(r1.sheets) === JSON.stringify(r2.sheets), 'mismatch');
}

console.log('--- T14: look-ahead makes a leftover strip take 2 small parts, not 1 big ---');
{
  // A 1654x980 part leaves a 1654x502 strip that fits EITHER one 1460x460 OR
  // two 470x815 (rotated). Every plain fit rule prefers the 1460x460, which
  // leaves ~95k mm2 more dead. This asserts the packer directly: at the
  // optimize() level both outcomes tie on the objective (same sheet count,
  // same unplaced count), so the sweep is free to pick either.
  const demand = [
    { id: 'big', name: 'big', length: 1654, width: 980, remaining: 1, i: 0 },
    { id: 'small', name: 'small', length: 470, width: 815, remaining: 2, i: 1 },
    { id: 'mid', name: 'mid', length: 1460, width: 460, remaining: 1, i: 2 },
  ];
  const st = stock('S', 2010, 1485, 1);
  const mk = (la) => ({
    order: [0, 1, 2], fitRule: 'BSSF', splitRule: 'MIN_AREA', placementMode: 'MIXED',
    ...(la ? { lookahead: createLookaheadCache() } : {}),
  });
  const plain = packSheetMaxRects(st, demand.map((d) => ({ ...d })), mk(false), 3);
  const ahead = packSheetMaxRects(st, demand.map((d) => ({ ...d })), mk(true), 3);
  const count = (r) => r.placements.reduce((m, p) => ((m[p.name] = (m[p.name] || 0) + 1), m), {});
  const a = count(ahead);
  check('T14 look-ahead seats the big part', a.big === 1, JSON.stringify(a));
  check('T14 look-ahead pairs 2 smalls in the strip', a.small === 2, JSON.stringify(a));
  check(
    'T14 look-ahead beats plain fit rules',
    ahead.usedArea > plain.usedArea,
    `plain ${(plain.usedArea / plain.sheetArea * 100).toFixed(1)}% vs ahead ${(ahead.usedArea / ahead.sheetArea * 100).toFixed(1)}%`
  );
}

console.log('--- Fuzz: randomized inputs, both modes ---');
{
  const rand = mulberry32(123456);
  const kerfs = [0, 1, 3.2, 10];
  let fuzzCases = 0;
  for (let iter = 0; iter < 200; iter++) {
    const nStocks = 1 + Math.floor(rand() * 5);
    const stocks = [];
    for (let i = 0; i < nStocks; i++) {
      stocks.push(stock(`s${i}`, 300 + Math.floor(rand() * 2700), 300 + Math.floor(rand() * 1700), 1 + Math.floor(rand() * 5)));
    }
    const nParts = 1 + Math.floor(rand() * 15);
    const parts = [];
    for (let i = 0; i < nParts; i++) {
      parts.push(part(`p${i}`, 50 + Math.floor(rand() * 900), 50 + Math.floor(rand() * 900), 1 + Math.floor(rand() * 10)));
    }
    const kerf = kerfs[Math.floor(rand() * kerfs.length)];
    const mode = rand() < 0.5 ? 'guillotine' : 'nest';
    const input = { stocks, parts, kerf, mode };
    const result = optimize(input, { deterministic: true, seed: iter });
    const errs = verifyLayout(result, input);
    fuzzCases++;
    if (errs.length) {
      failures++;
      console.error(`FUZZ iter ${iter} (${mode}, kerf ${kerf}): ${JSON.stringify(errs)}`);
      console.error(JSON.stringify(input));
    }
  }
  check('fuzz completed', fuzzCases === 200, fuzzCases);
}

console.log(`\n${passed} checks passed, ${failures} failed.`);
if (failures > 0) process.exit(1);
