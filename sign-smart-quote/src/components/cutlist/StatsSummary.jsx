import { Card, CardContent } from '@/components/ui/card';
import { sqm, pct, num } from './format.js';

function Tile({ label, value }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-lg font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

/**
 * @param {{stats: import('./solver/types.js').Stats, mode:'guillotine'|'nest',
 *   sheetCount:number, stockNames: Map<string,string>}} props
 */
export default function StatsSummary({ stats, mode, sheetCount, stockNames }) {
  const sheetsUsedText = Object.entries(stats.sheetsUsed)
    .map(([id, n]) => `${stockNames.get(id) || id}: ${n}`)
    .join(' · ');

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="לוחות בשימוש" value={sheetCount} />
        <Tile label="שטח נצרך" value={sqm(stats.totalSheetArea)} />
        <Tile label="שטח חלקים" value={sqm(stats.totalPartArea)} />
        <Tile label="פחת" value={sqm(stats.wasteArea)} />
        <Tile label="ניצולת" value={pct(stats.utilization)} />
        {mode === 'guillotine' && <Tile label="מס׳ חיתוכים" value={num(stats.totalCuts)} />}
        {mode === 'guillotine' && (
          <Tile label="אורך חיתוך כולל" value={`${(stats.totalCutLength / 1000).toLocaleString('he-IL', { maximumFractionDigits: 1 })} מ׳`} />
        )}
      </div>
      {sheetsUsedText && <p className="text-xs text-slate-500 px-1">פירוט לוחות: {sheetsUsedText}</p>}
    </div>
  );
}
