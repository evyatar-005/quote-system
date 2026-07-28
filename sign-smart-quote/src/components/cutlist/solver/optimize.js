import { EPS, validateInput, findTooLargeParts } from './geometry.js';
import { packSheetGuillotine } from './guillotine.js';
import { packSheetMaxRects } from './maxrects.js';
import { buildStats } from './stats.js';
import { mulberry32, shuffleWithinGroups } from './rng.js';

const HARD_SHEET_CAP = 500;

const ORDERINGS = [
  'AREA',
  'MAX_SIDE',
  'PERIMETER',
  'WIDTH_THEN_HEIGHT',
  'HEIGHT_THEN_WIDTH',
  'SIDE_DIFF',
  'SQUARENESS',
  'AREA_GROUPED',
];
const SHEET_RULES = ['WASTE_PER_PLACED', 'MAX_UTIL', 'LARGEST_FIRST', 'SMALLEST_FIRST'];
const FIT_RULES = ['BSSF', 'BAF', 'BLSF'];
const SPLIT_RULES = ['MIN_AREA', 'LONGER_LEFTOVER', 'SHORTER_LEFTOVER'];

const QUALITY_BUDGET_MS = { fast: 400, normal: 1200, max: 4000 };

function orderIndices(demand, kind) {
  const idx = demand.map((_, i) => i);
  const keyOf = {
    AREA: (d) => -(d.length * d.width),
    MAX_SIDE: (d) => -Math.max(d.length, d.width),
    PERIMETER: (d) => -(2 * (d.length + d.width)),
    WIDTH_THEN_HEIGHT: (d) => [-d.length, -d.width],
    HEIGHT_THEN_WIDTH: (d) => [-d.width, -d.length],
    SIDE_DIFF: (d) => -Math.abs(d.length - d.width),
    SQUARENESS: (d) => Math.min(d.length, d.width) / Math.max(d.length, d.width),
    AREA_GROUPED: (d) => [d.name, -(d.length * d.width)],
  }[kind];
  idx.sort((a, b) => {
    const ka = keyOf(demand[a]);
    const kb = keyOf(demand[b]);
    if (Array.isArray(ka)) {
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return 0;
    }
    return ka - kb;
  });
  return idx;
}

function candidateKey(trial, rule) {
  const util = trial.usedArea / trial.sheetArea;
  const wastePerPlaced = trial.placedCount > 0 ? (trial.sheetArea - trial.usedArea) / trial.placedCount : Infinity;
  switch (rule) {
    case 'MAX_UTIL':
      return [-util, -trial.usedArea];
    case 'LARGEST_FIRST':
      return [-trial.sheetArea, -util];
    case 'SMALLEST_FIRST':
      return [trial.sheetArea, -util];
    default: // WASTE_PER_PLACED
      return [wastePerPlaced, -util, -trial.usedArea];
  }
}

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - EPS) return true;
    if (a[i] > b[i] + EPS) return false;
  }
  return false;
}

/**
 * Run the greedy "open the best next sheet" loop to exhaustion for one config.
 * @param {import('./types.js').StockDef[]} stocks
 * @param {import('./types.js').DemandEntry[]} initialDemand
 * @param {object} cfg
 * @param {number} kerf
 * @param {'guillotine'|'nest'} mode
 * @returns {{sheets:import('./types.js').SheetLayout[], remaining:import('./types.js').DemandEntry[]}}
 */
function runGreedy(stocks, initialDemand, cfg, kerf, mode) {
  const demand = initialDemand.map((d) => ({ ...d }));
  const inv = new Map(stocks.map((s) => [s.id, s.qty]));
  const pack = mode === 'nest' ? packSheetMaxRects : packSheetGuillotine;
  const sheets = [];

  for (let guard = 0; guard < HARD_SHEET_CAP; guard++) {
    const totalRemaining = demand.reduce((n, d) => n + d.remaining, 0);
    if (totalRemaining === 0) break;

    let best = null;
    let bestKey = null;
    for (const stock of stocks) {
      if ((inv.get(stock.id) || 0) <= 0) continue;
      const trial = pack(stock, demand, cfg, kerf);
      if (trial.placedCount === 0) continue;
      const key = candidateKey(trial, cfg.sheetRule);
      if (!best || lexLess(key, bestKey)) {
        best = trial;
        bestKey = key;
      }
    }
    if (!best) break; // out of usable material

    sheets.push(best);
    inv.set(best.stockId, (inv.get(best.stockId) || 0) - 1);
    for (let i = 0; i < demand.length; i++) demand[i].remaining -= best.usedCounts[i];
  }

  return { sheets, remaining: demand };
}

function solutionScore(sheets, remaining, cfgIndex) {
  const unplacedCount = remaining.reduce((n, d) => n + d.remaining, 0);
  const totalSheetArea = sheets.reduce((n, s) => n + s.sheetArea, 0);
  const totalCuts = sheets.reduce((n, s) => n + s.cuts.length, 0);
  const sumLargestOffcut = sheets.reduce((n, s) => n + (s.largestOffcut ? s.largestOffcut.w * s.largestOffcut.h : 0), 0);
  return [
    unplacedCount,
    Math.round(totalSheetArea),
    sheets.length,
    totalCuts,
    -Math.round(sumLargestOffcut),
    cfgIndex,
  ];
}

/**
 * @param {import('./types.js').SolverInput} input
 * @param {{quality?:'fast'|'normal'|'max', seed?:number, deterministic?:boolean}} opts
 * @returns {import('./types.js').OptimizeResult}
 */
export function optimize(input, opts = {}) {
  const t0 = nowMs();
  const { stocks, parts, kerf, mode } = input;
  const quality = opts.quality || 'normal';
  const seed = Number.isFinite(opts.seed) ? opts.seed : 0x5eed;
  const budgetMs = opts.deterministic ? Infinity : QUALITY_BUDGET_MS[quality] ?? QUALITY_BUDGET_MS.normal;
  const maxPasses = opts.deterministic ? 24 : Infinity;

  const { errors, warnings } = validateInput({ stocks, parts, kerf });
  if (errors.length) {
    return {
      ok: false,
      mode,
      kerf,
      seed,
      passesRun: 0,
      elapsedMs: nowMs() - t0,
      cfg: null,
      sheets: [],
      unplaced: [],
      stats: buildStats([], [], []),
      warnings: errors,
    };
  }

  const tooLarge = findTooLargeParts(stocks, parts);
  const tooLargeIds = new Set(tooLarge.map((t) => t.id));
  const activeParts = parts.filter((p) => p.qty > 0 && !tooLargeIds.has(p.id));
  const demand = activeParts.map((p, i) => ({
    id: p.id,
    name: p.name,
    length: p.length,
    width: p.width,
    remaining: p.qty,
    i,
  }));

  const rand = mulberry32(seed);
  let bestSheets = [];
  let bestRemaining = demand;
  let bestScore = null;
  let cfgIndex = 0;
  let passesRun = 0;

  let winningSheetRule = SHEET_RULES[0];
  let winningFitRule = FIT_RULES[0];
  let winningSplitRule = SPLIT_RULES[0];

  const tryConfig = (cfg) => {
    if (nowMs() - t0 > budgetMs || passesRun >= maxPasses) return false;
    const { sheets, remaining } = runGreedy(stocks, demand, cfg, kerf, mode);
    const score = solutionScore(sheets, remaining, cfgIndex++);
    passesRun++;
    if (!bestScore || lexLess(score, bestScore)) {
      bestScore = score;
      bestSheets = sheets;
      bestRemaining = remaining;
      winningSheetRule = cfg.sheetRule;
      winningFitRule = cfg.fitRule;
      winningSplitRule = cfg.splitRule;
    }
    return true;
  };

  const splitRulesForMode = mode === 'nest' ? [SPLIT_RULES[0]] : SPLIT_RULES;

  // Phase A: fix order=AREA, sweep sheetRule x fitRule.
  const baseOrder = orderIndices(demand, 'AREA');
  outerA: for (const sheetRule of SHEET_RULES) {
    for (const fitRule of FIT_RULES) {
      const ok = tryConfig({ order: baseOrder, sheetRule, fitRule, splitRule: SPLIT_RULES[0] });
      if (!ok) break outerA;
    }
  }

  // Phase B: lock best sheetRule/fitRule found so far via the running best,
  // sweep all orderings x split rules.
  outerB: for (const orderKind of ORDERINGS) {
    const order = orderIndices(demand, orderKind);
    for (const splitRule of splitRulesForMode) {
      const ok = tryConfig({ order, sheetRule: winningSheetRule, fitRule: winningFitRule, splitRule });
      if (!ok) break outerB;
      const rem = bestRemaining.reduce((n, d) => n + d.remaining, 0);
      if (rem === 0 && bestScore) {
        const util = bestSheets.reduce((n, s) => n + s.usedArea, 0) / bestSheets.reduce((n, s) => n + s.sheetArea, 1);
        if (util > 0.995) break outerB;
      }
    }
  }

  // Phase C: perturb the best-so-far ordering with seeded shuffles within
  // equal-area groups, occasionally swapping the sheet rule.
  const bestOrderSoFar = orderIndices(demand, 'AREA');
  while (nowMs() - t0 <= budgetMs && passesRun < maxPasses) {
    const perturbed = shuffleWithinGroups(
      bestOrderSoFar.slice(),
      (i) => Math.round(demand[i].length * demand[i].width),
      rand
    );
    const sheetRule = rand() < 0.15 ? SHEET_RULES[Math.floor(rand() * SHEET_RULES.length)] : winningSheetRule;
    const ok = tryConfig({ order: perturbed, sheetRule, fitRule: winningFitRule, splitRule: winningSplitRule });
    if (!ok) break;
  }

  /** @type {import('./types.js').UnplacedEntry[]} */
  const unplaced = [
    ...tooLarge,
    ...bestRemaining
      .filter((d) => d.remaining > 0)
      .map((d) => /** @type {import('./types.js').UnplacedEntry} */ ({ id: d.id, name: d.name, count: d.remaining, reason: 'NO_MATERIAL' })),
  ];

  return {
    ok: true,
    mode,
    kerf,
    seed,
    passesRun,
    elapsedMs: nowMs() - t0,
    cfg: { sheetRule: winningSheetRule, fitRule: winningFitRule },
    sheets: bestSheets,
    unplaced,
    stats: buildStats(bestSheets, unplaced, parts),
    warnings,
  };
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
