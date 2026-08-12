// Shared number formatting for the campaign-analytics widgets. Kept next to
// the components (not in the page) so all four render "—" for a missing
// value identically — the whole analytics surface distinguishes "no data"
// from "zero", and a stray 0/NaN in one tile undermines every other number.

export const fmtInt = (n) =>
  (n == null ? "—" : new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(n));

export const fmtMoney = (n) => (n == null ? "—" : `₪${fmtInt(n)}`);

export const fmtPct = (n) => (n == null ? "—" : `${n}%`);

export const fmtDays = (n) => (n == null ? "—" : `${n} ימים`);

// first_response_ms → the coarsest unit that still reads naturally.
export function fmtDuration(ms) {
  if (ms == null) return "—";
  const min = ms / 60000;
  if (min < 1) return "פחות מדקה";
  if (min < 60) return `${Math.round(min)} דק׳`;
  const hours = min / 60;
  if (hours < 24) return `${Math.round(hours * 10) / 10} שעות`;
  return `${Math.round((hours / 24) * 10) / 10} ימים`;
}

// 'YYYY-MM-DD' / 'YYYY-MM' → short axis label. Kept short deliberately:
// daily ranges can hold 45 ticks and a full date would overlap.
export const fmtBucket = (b, granularity) =>
  (granularity === "day" ? b.slice(8) + "/" + b.slice(5, 7) : b.slice(5) + "/" + b.slice(2, 4));

export const TOOLTIP_STYLE = {
  direction: "rtl",
  borderRadius: 12,
  border: "1px solid #000",
  fontSize: 12,
};
