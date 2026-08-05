// Red is reserved exclusively for the soma (CNC registration) markings, so part
// fills are restricted to the COOL half of the wheel - green through blue.
// Everything that could be mistaken for the red marking is excluded outright:
// red (~0), orange (~30), amber/gold (~45), magenta/pink (~330) and the warm
// purples (~270-320) that read reddish at low saturation.
const SAFE_HUE_LO = 95; // yellow-green
const SAFE_HUE_HI = 250; // indigo-blue

// Well-separated hues inside the safe band, ordered so adjacent part types
// land far apart on the wheel and stay easy to tell apart.
const COOL_HUES = [205, 150, 110, 185, 232, 168, 128, 218];

const clampHue = (h) => Math.min(SAFE_HUE_HI, Math.max(SAFE_HUE_LO, h));

/**
 * @param {number} h @param {number} s @param {number} l
 * @returns {string} '#rrggbb'
 */
export function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n) =>
    Math.round(f(n) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

/**
 * Stable color for a part definition, keyed by its row index (not name -
 * duplicate names still get distinct colors). Always a soft, cool tone:
 * saturation stays low and lightness high enough to be easy on the eyes,
 * and the hue never leaves the green-to-blue band (see SAFE_HUE_*), so the
 * red soma markings always stand out against it.
 * @param {number} i
 * @returns {string} '#rrggbb'
 */
function partHsl(i) {
  const n = COOL_HUES.length;
  const cycle = Math.floor(i / n);
  // Past the first n types, jitter the hue slightly (staying inside the band)
  // and step lightness/saturation so repeats stay distinguishable.
  const jitter = (cycle % 2 === 0 ? 1 : -1) * Math.min(cycle * 7, 21);
  return {
    h: clampHue(COOL_HUES[i % n] + jitter),
    s: 34 - (cycle % 3) * 6, // 34 / 28 / 22 - muted, never vivid
    l: 76 - (cycle % 4) * 5, // 76 / 71 / 66 / 61 - light, low glare
  };
}

export function partColor(i) {
  const { h, s, l } = partHsl(i);
  return hslToHex(h, s, l);
}

/** Darker companion of `partColor(i)`, for the part outline. */
export function partStroke(i) {
  const { h, s, l } = partHsl(i);
  return hslToHex(h, Math.min(60, s + 12), Math.max(28, l - 34));
}

/**
 * @param {{id:string}[]} parts
 * @returns {Map<string,string>}
 */
export function makeColorMap(parts) {
  const map = new Map();
  parts.forEach((p, i) => map.set(p.id, partColor(i)));
  return map;
}
