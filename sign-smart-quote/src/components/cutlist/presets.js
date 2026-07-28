let uidCounter = 0;
export function makeId(prefix) {
  uidCounter += 1;
  return `${prefix}-${uidCounter}-${Math.floor(Math.random() * 1e6)}`;
}

export function emptyStockRow() {
  return { id: makeId('stock'), name: '', length: '', width: '', qty: '' };
}
export function emptyPartRow() {
  return { id: makeId('part'), name: '', length: '', width: '', qty: '' };
}

/** A sample project matching a typical PVC-board job, for the "טען דוגמה" button. */
export function sampleInput() {
  return {
    stocks: [
      { id: makeId('stock'), name: 'PVC 3050x2030', length: '3050', width: '2030', qty: '5' },
      { id: makeId('stock'), name: 'PVC 1500x1000 (מלאי קטן)', length: '1500', width: '1000', qty: '3' },
    ],
    parts: [
      { id: makeId('part'), name: 'שלט כניסה', length: '1140', width: '1950', qty: '2' },
      { id: makeId('part'), name: 'לוגו קיר', length: '600', width: '400', qty: '4' },
      { id: makeId('part'), name: 'שילוט A-3', length: '297', width: '420', qty: '10' },
      { id: makeId('part'), name: 'מדף פנימי', length: '800', width: '250', qty: '6' },
    ],
    kerf: '5',
  };
}
