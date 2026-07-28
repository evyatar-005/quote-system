export const EPS = 1e-6;

/**
 * @param {number} pw @param {number} ph @param {number} fw @param {number} fh
 * @returns {boolean}
 */
export function fits(pw, ph, fw, fh) {
  return pw <= fw + EPS && ph <= fh + EPS;
}

/**
 * Best (w,h,rotated) orientation of a part that fits the given free space, or null.
 * Ties (both orientations fit) favor non-rotated.
 * @param {{length:number, width:number}} part
 * @param {boolean} allowRotate
 * @returns {{w:number, h:number, rotated:boolean}[]}
 */
export function orientations(part, allowRotate) {
  const straight = { w: part.length, h: part.width, rotated: false };
  if (!allowRotate || part.length === part.width) return [straight];
  return [straight, { w: part.width, h: part.length, rotated: true }];
}

/**
 * @param {{stocks:import('./types.js').StockDef[], parts:import('./types.js').PartDef[], kerf:number}} raw
 * @returns {{errors:string[], warnings:string[]}}
 */
export function validateInput(raw) {
  const errors = [];
  const warnings = [];
  const { stocks = [], parts = [], kerf } = raw || {};

  if (!Number.isFinite(kerf) || kerf < 0) errors.push('עובי הסכין חייב להיות מספר אי-שלילי');

  const activeStocks = stocks.filter((s) => s.qty > 0);
  if (!activeStocks.length) errors.push('יש להזין לפחות לוח גלם אחד עם מלאי גדול מ-0');
  for (const s of stocks) {
    if (s.qty <= 0) continue;
    if (!Number.isFinite(s.length) || s.length <= 0) errors.push(`מידת אורך לא תקינה עבור "${s.name || s.id}"`);
    if (!Number.isFinite(s.width) || s.width <= 0) errors.push(`מידת רוחב לא תקינה עבור "${s.name || s.id}"`);
  }

  const activeParts = parts.filter((p) => p.qty > 0);
  if (!activeParts.length) errors.push('יש להזין לפחות חלק אחד עם כמות גדולה מ-0');
  for (const p of parts) {
    if (p.qty <= 0) continue;
    if (!Number.isFinite(p.length) || p.length <= 0) errors.push(`מידת אורך לא תקינה עבור "${p.name || p.id}"`);
    if (!Number.isFinite(p.width) || p.width <= 0) errors.push(`מידת רוחב לא תקינה עבור "${p.name || p.id}"`);
    if (p.qty > 999) errors.push(`כמות גדולה מדי (מעל 999) עבור "${p.name || p.id}"`);
  }

  if (errors.length) return { errors, warnings };

  const totalPieces = activeParts.reduce((n, p) => n + p.qty, 0);
  if (totalPieces > 2000) errors.push(`סה"כ ${totalPieces} חתיכות - החישוב תומך עד 2000 חתיכות`);

  const minStockDim = Math.min(...activeStocks.flatMap((s) => [s.length, s.width]));
  if (Number.isFinite(minStockDim) && kerf >= minStockDim) {
    errors.push('עובי הסכין גדול מדי ביחס למידות לוחות הגלם');
  }
  if (kerf > 20) warnings.push('עובי הסכין גבוה מ-20 מ״מ - ייתכן שהוזן ס״מ במקום מ״מ');

  return { errors, warnings };
}

/**
 * @param {import('./types.js').StockDef[]} stocks
 * @param {import('./types.js').PartDef[]} parts
 * @returns {import('./types.js').UnplacedEntry[]}
 */
export function findTooLargeParts(stocks, parts) {
  const activeStocks = stocks.filter((s) => s.qty > 0);
  /** @type {import('./types.js').UnplacedEntry[]} */
  const tooLarge = [];
  for (const p of parts) {
    if (p.qty <= 0) continue;
    const canFitSomewhere = activeStocks.some(
      (s) =>
        (p.length <= s.length + EPS && p.width <= s.width + EPS) ||
        (p.width <= s.length + EPS && p.length <= s.width + EPS)
    );
    if (!canFitSomewhere) tooLarge.push({ id: p.id, name: p.name, count: p.qty, reason: 'TOO_LARGE' });
  }
  return tooLarge;
}
