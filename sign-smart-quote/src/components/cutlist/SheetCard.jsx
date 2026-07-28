import { forwardRef } from 'react';
import SheetSvg from './SheetSvg.jsx';
import { mm, sqm, pct } from './format.js';

/**
 * One sheet's card: header + SVG + a compact per-part table. This is also
 * the print/PDF page unit (`cutlist-sheet-card` gets `break-after: page`).
 * @param {{layout: import('./solver/types.js').SheetLayout, index:number, total:number,
 *   colorMap: Map<string,string>, showLabels:boolean, showCuts:boolean}} props
 */
const SheetCard = forwardRef(function SheetCard({ layout, index, total, colorMap, showLabels, showCuts }, ref) {
  const util = layout.sheetArea > 0 ? layout.usedArea / layout.sheetArea : 0;
  const counts = new Map();
  for (const p of layout.placements) {
    const key = p.partId;
    const cur = counts.get(key) || { name: p.name, w: p.w, h: p.h, n: 0, color: colorMap.get(key) };
    cur.n += 1;
    counts.set(key, cur);
  }

  return (
    <div ref={ref} className="cutlist-sheet-card border-2 border-slate-900 rounded-xl bg-white p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-semibold">
          לוח {index + 1} מתוך {total} — {layout.stockName}
        </h3>
        <span className="text-sm text-slate-500">
          {mm(layout.sheetW)} × {mm(layout.sheetH)} · ניצולת {pct(util)}
        </span>
      </div>

      <SheetSvg layout={layout} colorMap={colorMap} showLabels={showLabels} showCuts={showCuts} />

      <table className="w-full text-xs mt-3 border-collapse">
        <thead>
          <tr className="text-slate-500 border-b border-slate-200">
            <th className="text-right font-normal py-1"></th>
            <th className="text-right font-normal py-1">חלק</th>
            <th className="text-right font-normal py-1">מידות</th>
            <th className="text-right font-normal py-1">כמות על לוח זה</th>
          </tr>
        </thead>
        <tbody>
          {[...counts.values()].map((c) => (
            <tr key={c.name + c.w + c.h} className="border-b border-slate-100">
              <td className="py-1 pl-2">
                <span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ backgroundColor: c.color }} />
              </td>
              <td className="py-1">{c.name}</td>
              <td className="py-1" dir="ltr">
                {mm(c.w)} × {mm(c.h)}
              </td>
              <td className="py-1">{c.n}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {layout.largestOffcut && layout.largestOffcut.w > 0 && layout.largestOffcut.h > 0 && (
        <p className="text-xs text-slate-500 mt-2">
          שארית גדולה ביותר לשימוש חוזר: {sqm(layout.largestOffcut.w * layout.largestOffcut.h)}
        </p>
      )}
    </div>
  );
});

export default SheetCard;
