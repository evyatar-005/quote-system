import { useRef, useState } from 'react';
import { Printer, Download, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import StatsSummary from './StatsSummary.jsx';
import PartLegend from './PartLegend.jsx';
import SheetCard from './SheetCard.jsx';
import { exportSheetsToPdf } from './exportPdf.js';
import { usePrintMode } from './usePrintMode.js';
import { makeColorMap } from './palette.js';

/**
 * @param {{result: import('./solver/types.js').OptimizeResult, parts: object[],
 *   showLabels:boolean, showCuts:boolean}} props
 */
export default function ResultsPanel({ result, parts, showLabels, showCuts }) {
  const { print } = usePrintMode();
  const [exporting, setExporting] = useState(false);
  const statsRef = useRef(null);
  const sheetRefs = useRef([]);
  sheetRefs.current = [];

  const colorMap = makeColorMap(parts);
  const stockNames = new Map(result.sheets.map((s) => [s.stockId, s.stockName]));

  const placedCounts = new Map();
  for (const sheet of result.sheets) {
    for (const p of sheet.placements) placedCounts.set(p.partId, (placedCounts.get(p.partId) || 0) + 1);
  }

  const handleDownloadPdf = async () => {
    setExporting(true);
    try {
      await exportSheetsToPdf({
        nodes: [statsRef.current, ...sheetRefs.current.filter(Boolean)],
        title: 'תוכנית חיתוך',
        fileName: `תוכנית-חיתוך-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
    } catch (err) {
      console.error(err);
      toast.error('ייצוא ה-PDF נכשל');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="cutlist-no-print flex items-center gap-2">
        <Button type="button" className="gap-2" onClick={print}>
          <Printer className="w-4 h-4" /> הדפסה / שמירה כ-PDF
        </Button>
        <Button type="button" variant="outline" className="gap-2" onClick={handleDownloadPdf} disabled={exporting}>
          <Download className="w-4 h-4" /> {exporting ? 'מייצא...' : 'הורד PDF'}
        </Button>
        <span className="text-xs text-slate-400 mr-auto">
          נבדקו {result.passesRun} וריאציות ב-{Math.round(result.elapsedMs)}ms
        </span>
      </div>

      {result.unplaced.length > 0 && (
        <div className="cutlist-no-print bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold mb-1">חלקים שלא הוצבו</p>
            <ul className="list-disc pr-4 space-y-0.5">
              {result.unplaced.map((u) => (
                <li key={u.id}>
                  {u.name} — {u.count} יח׳ ({u.reason === 'TOO_LARGE' ? 'לא נכנס לאף לוח גלם' : 'חסר במלאי'})
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="cutlist-print-root">
        <div ref={statsRef} className="bg-white p-2">
          <StatsSummary stats={result.stats} mode={result.mode} sheetCount={result.sheets.length} stockNames={stockNames} />
          <div className="mt-3">
            <PartLegend parts={parts} colorMap={colorMap} placedCounts={placedCounts} />
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
          {result.sheets.map((layout, i) => (
            <SheetCard
              key={i}
              ref={(el) => (sheetRefs.current[i] = el)}
              layout={layout}
              index={i}
              total={result.sheets.length}
              colorMap={colorMap}
              showLabels={showLabels}
              showCuts={showCuts}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
