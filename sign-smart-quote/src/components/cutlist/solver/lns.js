import { perturbOrder } from './rng.js';

/**
 * Large Neighbourhood Search (ruin & recreate) over a finished solution.
 *
 * Greedy sheet-filling is locally sensible but globally myopic: it commits each
 * sheet the moment it is packed, so a job can finish one sheet over the true
 * optimum with the excess spread across several near-full sheets. `repack.js`
 * only tries to *move pieces out of* a sparse sheet into existing slack; when
 * the slack genuinely is not there, no local repair can help.
 *
 * LNS attacks that directly: take the K emptiest sheets, throw their layouts
 * away entirely, and re-solve just those pieces from scratch with randomized
 * configs. Because the sub-problem is small, many restarts are affordable, and
 * a re-solve that fits the same pieces onto K-1 sheets removes a whole board.
 *
 * Only a STRICTLY better sub-solution is accepted, so this can never regress.
 *
 * @param {import('./types.js').SheetLayout[]} sheets incumbent (never mutated)
 * @param {import('./types.js').DemandEntry[]} demand full demand (for definitions)
 * @param {import('./types.js').StockDef[]} stocks
 * @param {object} cfg winning config shape
 * @param {number} kerf
 * @param {'guillotine'|'nest'} mode
 * @param {() => number} rand seeded PRNG - keeps the whole thing deterministic
 * @param {(stocks, demand, cfg, kerf, mode) => {sheets:any[], remaining:any[]}} runGreedy
 * @param {{budgetLeftMs: () => number, maxRounds?: number, triesPerRound?: number,
 *          lookaheadAllowed?: boolean, sheetRules: string[], fitRules: string[],
 *          splitRules: string[], placementModes: string[]}} opts
 * @returns {{sheets:import('./types.js').SheetLayout[], rounds:number, tries:number}|null}
 */
export function improveByLNS(sheets, demand, stocks, cfg, kerf, mode, rand, runGreedy, opts) {
  if (sheets.length < 2) return null;

  const maxRounds = opts.maxRounds ?? 6;
  const triesPerRound = opts.triesPerRound ?? 24;

  let current = sheets;
  let rounds = 0;
  let tries = 0;
  let improvedEver = false;

  for (let round = 0; round < maxRounds; round++) {
    if (opts.budgetLeftMs() <= 0) break;
    rounds++;

    const subsetIdx = pickSubset(current, round, rand);
    if (subsetIdx.length < 2) break;

    const improved = ruinAndRecreate(
      current,
      subsetIdx,
      demand,
      stocks,
      cfg,
      kerf,
      mode,
      rand,
      runGreedy,
      triesPerRound,
      opts,
      (n) => {
        tries += n;
      }
    );

    if (improved) {
      current = improved;
      improvedEver = true;
      round = -1; // a win changes the landscape - restart the round schedule
      if (current.length < 2) break;
    }
  }

  return improvedEver ? { sheets: current, rounds, tries } : null;
}

/**
 * Choosing WHICH sheets to dissolve is the whole game. Picking the emptiest few
 * is the obvious move and it is usually the wrong one: the emptiest sheet is
 * often empty precisely because its leftovers fit nowhere, and its neighbours by
 * fill-rate have nothing to do with it. The board is saved by re-solving the
 * sheets that COMPETE for the same part types, even when those sheets are the
 * fullest ones - that is where a different split of the same pieces exists.
 *
 * Three strategies are cycled so no single blind spot dominates:
 *  0. RELATED - the emptiest sheet plus the sheets sharing the most part types
 *     with it. This is the one that finds real structural rearrangements.
 *  1. EMPTIEST - the classic; cheap and occasionally decisive.
 *  2. RANDOM   - escapes the other two when both keep landing on the same set.
 */
function pickSubset(sheets, round, rand) {
  const n = sheets.length;
  const strategy = round % 3;
  const k = Math.min(n, strategy === 0 ? Math.min(8, Math.max(3, Math.ceil(n / 2))) : 2 + (round % 3));

  const fill = (s) => (s.sheetArea > 0 ? s.usedArea / s.sheetArea : 0);
  const byEmptiest = sheets.map((s, i) => ({ i, f: fill(s) })).sort((a, b) => a.f - b.f).map((e) => e.i);

  if (strategy === 1) return byEmptiest.slice(0, k);

  if (strategy === 2) {
    const pool = sheets.map((_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, k);
  }

  // RELATED: anchor on the emptiest sheet, then rank every other sheet by how
  // much of the anchor's part mix it also carries.
  const anchor = byEmptiest[0];
  const anchorTypes = new Set();
  sheets[anchor].usedCounts.forEach((c, ti) => {
    if (c > 0) anchorTypes.add(ti);
  });

  const scored = sheets
    .map((s, i) => {
      if (i === anchor) return null;
      let shared = 0;
      s.usedCounts.forEach((c, ti) => {
        if (c > 0 && anchorTypes.has(ti)) shared += c;
      });
      return { i, shared, f: fill(s) };
    })
    .filter(Boolean)
    // Most shared pieces first; emptier breaks ties; index keeps it deterministic.
    .sort((a, b) => b.shared - a.shared || a.f - b.f || a.i - b.i);

  return [anchor, ...scored.slice(0, k - 1).map((e) => e.i)];
}

function ruinAndRecreate(
  sheets,
  subsetIdx,
  demand,
  stocks,
  cfg,
  kerf,
  mode,
  rand,
  runGreedy,
  triesPerRound,
  opts,
  countTries
) {
  const inSubset = new Set(subsetIdx);

  // "Ruin": the pieces those sheets were holding become free-floating demand.
  // Index alignment with the global demand array is preserved so `usedCounts`
  // from the re-solve stays meaningful.
  const subDemand = demand.map((d) => ({ ...d, remaining: 0 }));
  let pieceCount = 0;
  for (const si of subsetIdx) {
    const counts = sheets[si].usedCounts;
    for (let ti = 0; ti < counts.length; ti++) {
      subDemand[ti].remaining += counts[ti] || 0;
      pieceCount += counts[ti] || 0;
    }
  }
  if (!pieceCount) return null;

  // Only the boards those sheets consumed are available - so any full re-solve
  // is, at worst, a wash, and a solution using fewer of them is a strict win.
  const subQty = new Map();
  for (const si of subsetIdx) {
    subQty.set(sheets[si].stockId, (subQty.get(sheets[si].stockId) || 0) + 1);
  }
  const subStocks = stocks.filter((s) => subQty.has(s.id)).map((s) => ({ ...s, qty: subQty.get(s.id) }));
  if (!subStocks.length) return null;

  const baseArea = subsetIdx.reduce((n, si) => n + sheets[si].sheetArea, 0);
  const baseCount = subsetIdx.length;
  const baseOrder = demand.map((_, i) => i).sort((a, b) => subDemand[b].remaining - subDemand[a].remaining);

  let best = null;
  let n = 0;

  for (let t = 0; t < triesPerRound; t++) {
    if (opts.budgetLeftMs() <= 0) break;
    n++;

    // Try the incumbent config verbatim first, then randomized variants - the
    // point of LNS is to reach arrangements the main sweep's orderings cannot.
    const trial =
      t === 0
        ? { ...cfg, order: sortByArea(demand) }
        : {
            order: perturbOrder(t % 2 === 0 ? sortByArea(demand) : baseOrder, rand),
            sheetRule: opts.sheetRules[Math.floor(rand() * opts.sheetRules.length)],
            fitRule: opts.fitRules[Math.floor(rand() * opts.fitRules.length)],
            splitRule: opts.splitRules[Math.floor(rand() * opts.splitRules.length)],
            placementMode: opts.placementModes[Math.floor(rand() * opts.placementModes.length)],
            lookahead: opts.lookaheadAllowed && rand() < 0.5,
          };

    const { sheets: got, remaining } = runGreedy(subStocks, subDemand, trial, kerf, mode);
    if (remaining.some((d) => d.remaining > 0)) continue; // did not fit - useless

    const area = got.reduce((a, s) => a + s.sheetArea, 0);
    if (got.length < baseCount || (got.length === baseCount && area < baseArea)) {
      if (!best || got.length < best.length) best = got;
      if (got.length < baseCount - 1) break; // saved two boards; unlikely to beat
    }
  }

  countTries(n);
  if (!best) return null;

  return [...sheets.filter((_, i) => !inSubset.has(i)), ...best];
}

function sortByArea(demand) {
  return demand.map((_, i) => i).sort((a, b) => demand[b].length * demand[b].width - demand[a].length * demand[a].width);
}
