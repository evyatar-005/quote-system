import { EPS, validateInput, findTooLargeParts } from './geometry.js';
import { packSheetGuillotine } from './guillotine.js';
import { packSheetMaxRects } from './maxrects.js';
import { buildStats } from './stats.js';
import { mulberry32, perturbOrder } from './rng.js';
import { createLookaheadCache, lookaheadWorthwhile } from './lookahead.js';
import { eliminateSparseSheet } from './repack.js';
import { improveByLNS } from './lns.js';

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
// BY_TYPE exhausts one part type before starting the next (cheap, but one type
// can claim whole bands and strand the rest); MIXED re-picks the globally best
// part at every placement, so types interleave. Neither dominates, so both are
// swept and the global objective picks the winner.
const PLACEMENT_MODES = ['BY_TYPE', 'MIXED'];

const QUALITY_BUDGET_MS = { fast: 400, normal: 1200, max: 4000 };

// Phase A sweeps placementMode x sheetRule x fitRule at order=AREA.
const PHASE_A_PASSES = PLACEMENT_MODES.length * SHEET_RULES.length * FIT_RULES.length;
// Headroom so deterministic runs also exercise the phases after Phase A.
const DETERMINISTIC_EXTRA_PASSES = 16;
// Fraction of the time budget Phase C may spend, leaving the rest for Phase D.
const PHASE_C_BUDGET_SHARE = 0.7;

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

  // Greedy filling leaves a sparse tail sheet; if its few pieces fit in the
  // slack on the other sheets, we save a whole board. Only attempted when
  // everything was placed - with unplaced pieces the sheet count isn't the
  // binding problem.
  let finalSheets = sheets;
  if (demand.every((d) => d.remaining === 0)) {
    for (let round = 0; round < 3; round++) {
      const reduced = eliminateSparseSheet(finalSheets, demand, cfg, kerf, mode);
      if (!reduced) break;
      finalSheets = reduced;
    }
  }

  return { sheets: finalSheets, remaining: demand };
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
  // Phase A is exactly PHASE_A_PASSES configs. The cap used to be that exact
  // number, which meant deterministic runs - i.e. the entire test suite - never
  // executed a single pass of any later phase, so anything added after Phase A
  // was untested dead code. Keep Phase A whole (so its expectations are stable)
  // and leave headroom for the phases that follow.
  const maxPasses = opts.deterministic ? PHASE_A_PASSES + DETERMINISTIC_EXTRA_PASSES : Infinity;

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
  let winningPlacementMode = PLACEMENT_MODES[0];
  let winningLookahead = 0;

  // Look-ahead only pays off when it can actually re-rank candidates, and it
  // costs a mini-pack per candidate, so it is gated on problem size.
  const lookaheadAllowed = lookaheadWorthwhile(demand, demand.map((d) => d.remaining));

  const tryConfig = (cfg) => {
    if (nowMs() - t0 > budgetMs || passesRun >= maxPasses) return false;
    // A fresh cache per pass: entries are only valid for one packing run.
    const runCfg = cfg.lookahead ? { ...cfg, lookahead: createLookaheadCache() } : cfg;
    const { sheets, remaining } = runGreedy(stocks, demand, runCfg, kerf, mode);
    const score = solutionScore(sheets, remaining, cfgIndex++);
    passesRun++;
    if (!bestScore || lexLess(score, bestScore)) {
      bestScore = score;
      bestSheets = sheets;
      bestRemaining = remaining;
      winningSheetRule = cfg.sheetRule;
      winningFitRule = cfg.fitRule;
      winningSplitRule = cfg.splitRule;
      winningPlacementMode = cfg.placementMode;
      winningLookahead = cfg.lookahead ? 1 : 0;
    }
    return true;
  };

  const splitRulesForMode = mode === 'nest' ? [SPLIT_RULES[0]] : SPLIT_RULES;

  // Phase A: fix order=AREA, sweep placementMode x sheetRule x fitRule.
  const baseOrder = orderIndices(demand, 'AREA');
  outerA: for (const placementMode of PLACEMENT_MODES) {
    for (const sheetRule of SHEET_RULES) {
      for (const fitRule of FIT_RULES) {
        const ok = tryConfig({ order: baseOrder, sheetRule, fitRule, splitRule: SPLIT_RULES[0], placementMode });
        if (!ok) break outerA;
      }
    }
  }

  // Phase A2: re-run the most promising shapes with look-ahead scoring. Phase A
  // has already run in full without it, so a valid incumbent always exists and
  // `cfgIndex` (the last tie-break in solutionScore) keeps the earlier, cheaper
  // config on an exact tie - look-ahead can only win by being strictly better.
  // Look-ahead only re-ranks when several types compete for one rect, so it is
  // paired with MIXED placement; BY_TYPE gets one pass for completeness.
  if (lookaheadAllowed) {
    outerA2: for (const placementMode of PLACEMENT_MODES) {
      for (const fitRule of FIT_RULES) {
        const ok = tryConfig({
          order: baseOrder,
          sheetRule: winningSheetRule,
          fitRule,
          splitRule: winningSplitRule,
          placementMode,
          lookahead: true,
        });
        if (!ok) break outerA2;
        if (placementMode === 'BY_TYPE') break; // look-ahead needs competing types
      }
    }
  }

  // Phase B: lock best sheetRule/fitRule/placementMode found so far,
  // sweep all orderings x split rules.
  outerB: for (const orderKind of ORDERINGS) {
    const order = orderIndices(demand, orderKind);
    for (const splitRule of splitRulesForMode) {
      const ok = tryConfig({
        order,
        sheetRule: winningSheetRule,
        fitRule: winningFitRule,
        splitRule,
        placementMode: winningPlacementMode,
        lookahead: winningLookahead === 1,
      });
      if (!ok) break outerB;
      const rem = bestRemaining.reduce((n, d) => n + d.remaining, 0);
      if (rem === 0 && bestScore) {
        const util = bestSheets.reduce((n, s) => n + s.usedArea, 0) / bestSheets.reduce((n, s) => n + s.sheetArea, 1);
        if (util > 0.995) break outerB;
      }
    }
  }

  // Phase C: randomized restarts around the best config found so far. Every
  // knob gets jittered (order, sheet rule, fit rule, placement mode) so this
  // phase actually explores - an earlier version only reshuffled within
  // equal-area groups, which is a no-op whenever part areas differ (i.e. most
  // real jobs), so it silently re-tested one config until the stall guard fired.
  const STALL_LIMIT = 4000;
  const bestOrderSoFar = orderIndices(demand, 'AREA');
  let passesSinceImprovement = 0;
  // Leave a slice of the budget for Phase D - otherwise randomized restarts,
  // which only stop on the stall guard, would consume all of it.
  const phaseCBudget = budgetMs === Infinity ? Infinity : budgetMs * PHASE_C_BUDGET_SHARE;
  while (nowMs() - t0 <= phaseCBudget && passesRun < maxPasses && passesSinceImprovement < STALL_LIMIT) {
    const perturbed = perturbOrder(bestOrderSoFar, rand);
    const sheetRule = rand() < 0.3 ? SHEET_RULES[Math.floor(rand() * SHEET_RULES.length)] : winningSheetRule;
    const fitRule = rand() < 0.3 ? FIT_RULES[Math.floor(rand() * FIT_RULES.length)] : winningFitRule;
    const splitRule =
      rand() < 0.3 ? splitRulesForMode[Math.floor(rand() * splitRulesForMode.length)] : winningSplitRule;
    const placementMode = rand() < 0.3 ? PLACEMENT_MODES[Math.floor(rand() * PLACEMENT_MODES.length)] : winningPlacementMode;
    const lookahead = lookaheadAllowed && (rand() < 0.25 ? !winningLookahead : winningLookahead === 1);
    const scoreBefore = bestScore;
    const ok = tryConfig({ order: perturbed, sheetRule, fitRule, splitRule, placementMode, lookahead });
    if (!ok) break;
    passesSinceImprovement = bestScore !== scoreBefore ? 0 : passesSinceImprovement + 1;
  }

  // Phase D: ruin & recreate on the incumbent. Phases A-C each build a solution
  // in one greedy sweep and keep the best; none of them can revisit a committed
  // sheet. That is exactly the failure mode left after look-ahead - a job can
  // land one board over the optimum with the excess spread across sheets that
  // are individually near-full, so no local repair reaches it. LNS dissolves the
  // emptiest few sheets and re-solves that sub-problem from scratch, which is
  // affordable precisely because it is small. Strict improvement only.
  // `disableLNS` exists so benchmarks can measure this phase's contribution in
  // isolation; nothing in the app sets it.
  if (!opts.disableLNS && bestSheets.length > 1 && bestRemaining.every((d) => d.remaining === 0)) {
    const lnsCfg = {
      order: baseOrder,
      sheetRule: winningSheetRule,
      fitRule: winningFitRule,
      splitRule: winningSplitRule,
      placementMode: winningPlacementMode,
      lookahead: winningLookahead === 1,
    };
    // runGreedy takes a live cache object for look-ahead, not a flag.
    const runGreedyForLNS = (s, d, c, k, m) =>
      runGreedy(s, d, c.lookahead ? { ...c, lookahead: createLookaheadCache() } : c, k, m);

    const lnsBudget = budgetMs;
    const improved = improveByLNS(bestSheets, demand, stocks, lnsCfg, kerf, mode, rand, runGreedyForLNS, {
      budgetLeftMs: () => lnsBudget - (nowMs() - t0),
      lookaheadAllowed,
      sheetRules: SHEET_RULES,
      fitRules: FIT_RULES,
      splitRules: splitRulesForMode,
      placementModes: PLACEMENT_MODES,
      maxRounds: opts.deterministic ? 4 : 8,
      triesPerRound: opts.deterministic ? 16 : 40,
    });
    if (improved) {
      bestSheets = improved.sheets;
      passesRun += improved.tries;
    }
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
    cfg: {
      sheetRule: winningSheetRule,
      fitRule: winningFitRule,
      splitRule: winningSplitRule,
      placementMode: winningPlacementMode,
      lookahead: winningLookahead,
    },
    sheets: bestSheets,
    unplaced,
    stats: buildStats(bestSheets, unplaced, parts),
    warnings,
  };
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
