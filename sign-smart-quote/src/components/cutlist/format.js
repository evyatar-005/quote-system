/**
 * @param {number} n
 * @returns {string}
 */
export function mm(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString('he-IL', { maximumFractionDigits: 1 })} מ״מ`;
}

/**
 * @param {number} mm2 area in square millimetres
 * @returns {string}
 */
export function sqm(mm2) {
  if (mm2 == null || !Number.isFinite(mm2)) return '—';
  return `${(mm2 / 1_000_000).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} מ״ר`;
}

/**
 * @param {number} x fraction 0..1
 * @returns {string}
 */
export function pct(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/**
 * @param {number} n
 * @returns {string}
 */
export function num(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('he-IL', { maximumFractionDigits: 1 });
}
