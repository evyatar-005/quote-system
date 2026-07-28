import { makeId } from './presets.js';

function stockRow(name, length, width, qty) {
  return { id: makeId('stock'), name, length: String(length), width: String(width), qty: String(qty) };
}
function partRow(name, length, width, qty) {
  return { id: makeId('part'), name, length: String(length), width: String(width), qty: String(qty) };
}

/** Dev-only presets matching the plan's manual test cases (T1-T8), for one-click loading. */
export const TEST_CASES = [
  {
    label: 'T1: ריצוף מדויק (kerf 0)',
    preset: { stocks: [stockRow('S', 1000, 1000, 1)], parts: [partRow('A', 500, 500, 4)], kerf: '0' },
  },
  {
    label: 'T2: מבחן ה-kerf',
    preset: { stocks: [stockRow('S', 1000, 1000, 1)], parts: [partRow('A', 500, 500, 4)], kerf: '5' },
  },
  {
    label: 'T3: סיבוב',
    preset: { stocks: [stockRow('S', 1000, 500, 1)], parts: [partRow('B', 500, 1000, 1)], kerf: '0' },
  },
  {
    label: 'T4a: בחירת מלאי - קטן מנצח',
    preset: {
      stocks: [stockRow('גדול', 2000, 1000, 1), stockRow('קטן', 500, 500, 4)],
      parts: [partRow('C', 500, 500, 4)],
      kerf: '0',
    },
  },
  {
    label: 'T4b: בחירת מלאי - גדול מנצח',
    preset: {
      stocks: [stockRow('גדול', 2000, 1000, 1), stockRow('קטן', 500, 500, 4)],
      parts: [partRow('C', 500, 500, 5)],
      kerf: '0',
    },
  },
  {
    label: 'T5: חלק חורג',
    preset: {
      stocks: [stockRow('S', 3050, 2030, 5)],
      parts: [partRow('D', 4000, 100, 2), partRow('E', 1000, 500, 4)],
      kerf: '0',
    },
  },
  {
    label: 'T6: אזילת מלאי',
    preset: { stocks: [stockRow('S', 1000, 1000, 1)], parts: [partRow('F', 400, 400, 6)], kerf: '3' },
  },
  {
    label: 'T9: RTL ורינדור',
    preset: {
      stocks: [stockRow('S', 3050, 2030, 3)],
      parts: [partRow('שלט כניסה', 300, 1800, 1), partRow('Sign A-3', 297, 420, 5), partRow('לוגו 12', 30, 30, 20)],
      kerf: '3',
    },
  },
];
