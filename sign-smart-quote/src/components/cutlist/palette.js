const BRAND_HUES = [43, 336, 191, 100, 248]; // gold, pink, teal, green, purple

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
 * duplicate names still get distinct colors).
 * @param {number} i
 * @returns {string} '#rrggbb'
 */
export function partColor(i) {
  const cycle = Math.floor(i / 5);
  const h = (BRAND_HUES[i % 5] + 17 * cycle) % 360;
  const s = 42 - (cycle % 2) * 8;
  const l = 54 - (cycle % 3) * 7;
  return hslToHex(h, s, l);
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
