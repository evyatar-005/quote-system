/**
 * Deterministic PRNG (mulberry32). Same seed → same sequence, forever.
 * @param {number} seed
 * @returns {() => number} generator returning floats in [0,1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle of `arr`, in place, using `rand()` in [0,1).
 * @template T
 * @param {T[]} arr
 * @param {() => number} rand
 * @returns {T[]}
 */
export function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Shuffle only within contiguous runs of `arr` that share the same `keyFn` value.
 * NOTE: when every element has a distinct key (the common case - part types
 * rarely share an exact area) this is a no-op, so it must not be the only
 * perturbation a search relies on. See `perturbOrder`.
 * @template T
 * @param {T[]} arr
 * @param {(item:T) => any} keyFn
 * @param {() => number} rand
 * @returns {T[]}
 */
export function shuffleWithinGroups(arr, keyFn, rand) {
  let start = 0;
  while (start < arr.length) {
    let end = start + 1;
    const key = keyFn(arr[start]);
    while (end < arr.length && keyFn(arr[end]) === key) end++;
    if (end - start > 1) shuffle(arr.slice(start, end), rand).forEach((v, i) => (arr[start + i] = v));
    start = end;
  }
  return arr;
}

/**
 * Produce a genuinely different ordering from `base`. Alternates between a
 * full reshuffle (broad exploration) and a few random swaps (local tweak), so
 * the search keeps finding new candidates instead of re-testing one config.
 * @template T
 * @param {T[]} base
 * @param {() => number} rand
 * @returns {T[]}
 */
export function perturbOrder(base, rand) {
  const arr = base.slice();
  if (arr.length < 2) return arr;
  if (rand() < 0.5) return shuffle(arr, rand);
  const swaps = 1 + Math.floor(rand() * Math.min(3, arr.length - 1));
  for (let s = 0; s < swaps; s++) {
    const i = Math.floor(rand() * arr.length);
    const j = Math.floor(rand() * arr.length);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
