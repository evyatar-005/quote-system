// A/B: does Phase D (LNS) actually reduce sheet count? Random jobs, both modes.
import { optimize } from '../src/components/cutlist/solver/optimize.js';
import { verifyLayout } from '../src/components/cutlist/solver/stats.js';
import { mulberry32 } from '../src/components/cutlist/solver/rng.js';

const rand = mulberry32(0xc0ffee);
const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
let better = 0, worse = 0, same = 0, bad = 0, msOn = 0, msOff = 0;

for (let n = 0; n < 60; n++) {
  const types = ri(3, 7);
  const parts = [];
  for (let i = 0; i < types; i++)
    parts.push({ id: 'p' + i, name: 'p' + i, length: ri(200, 1200), width: ri(200, 1000), qty: ri(2, 10) });
  const input = { stocks: [{ id: 'S', name: 'S', length: 2440, width: 1220, qty: 200 }], parts, kerf: ri(0, 4),
                  mode: n % 2 ? 'nest' : 'guillotine' };
  const on = optimize(input, { quality: 'normal', seed: 7 });
  const off = optimize(input, { quality: 'normal', seed: 7, disableLNS: true });
  msOn += on.elapsedMs; msOff += off.elapsedMs;
  const errs = verifyLayout(on, input);
  if (errs.length) { bad++; console.error('INVARIANT', n, errs.slice(0, 2)); }
  if (on.sheets.length < off.sheets.length) better++;
  else if (on.sheets.length > off.sheets.length) { worse++; console.error('REGRESSION at job', n); }
  else same++;
}
console.log({ better, same, worse, invariantViolations: bad,
              msWithLNS: Math.round(msOn), msWithout: Math.round(msOff) });
process.exit(worse || bad ? 1 : 0);
