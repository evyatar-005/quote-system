import { mm } from './format.js';

/**
 * @param {{parts: import('./solver/types.js').PartDef[], colorMap: Map<string,string>,
 *   placedCounts: Map<string,number>}} props
 */
export default function PartLegend({ parts, colorMap, placedCounts }) {
  return (
    <div className="flex flex-wrap gap-3">
      {parts.map((p) => (
        <div key={p.id} className="flex items-center gap-1.5 text-xs bg-slate-100 rounded-lg px-2 py-1">
          <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: colorMap.get(p.id) }} />
          <span className="font-medium">{p.name}</span>
          <span className="text-slate-500" dir="ltr">
            {mm(p.length)}×{mm(p.width)}
          </span>
          <span className="text-slate-500">
            הוצבו {placedCounts.get(p.id) || 0} מתוך {p.qty}
          </span>
        </div>
      ))}
    </div>
  );
}
