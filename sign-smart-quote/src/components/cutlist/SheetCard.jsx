import { forwardRef, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import SheetSvg from './SheetSvg.jsx';
import { mm, sqm, pct } from './format.js';

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * One sheet's card: header + SVG + a compact per-part table. This is also
 * the print/PDF page unit (`cutlist-sheet-card` gets `break-after: page`).
 * Clicking the SVG opens it full-size in a dialog for a close, detailed look.
 * @param {{layout: import('./solver/types.js').SheetLayout, index:number, total:number,
 *   colorMap: Map<string,string>, showLabels:boolean, showCuts:boolean}} props
 */
const SheetCard = forwardRef(function SheetCard(
  { layout, index, total, colorMap, strokeMap, showLabels, showCuts, somaSheetBand = 0, somaPartBand = 0 },
  ref
) {
  const [zoomed, setZoomed] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragState = useRef(null);
  const util = layout.sheetArea > 0 ? layout.usedArea / layout.sheetArea : 0;

  const resetZoom = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };
  const openZoom = () => {
    resetZoom();
    setZoomed(true);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    setScale((s) => clamp(s - e.deltaY * 0.0015, MIN_ZOOM, MAX_ZOOM));
  };
  const handlePointerDown = (e) => {
    if (scale <= 1) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e) => {
    if (!dragState.current) return;
    const { startX, startY, panX, panY } = dragState.current;
    setPan({ x: panX + (e.clientX - startX) / scale, y: panY + (e.clientY - startY) / scale });
  };
  const handlePointerUp = () => {
    dragState.current = null;
  };
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
          {mm(layout.sheetW + 2 * somaSheetBand)} × {mm(layout.sheetH + 2 * somaSheetBand)}
          {somaSheetBand > 0 && <> (שימושי {mm(layout.sheetW)} × {mm(layout.sheetH)})</>} · ניצולת {pct(util)}
        </span>
      </div>

      <button
        type="button"
        onClick={openZoom}
        className="group relative block w-full cursor-zoom-in"
        aria-label="הגדל את הפלטה"
      >
        <SheetSvg layout={layout} colorMap={colorMap} strokeMap={strokeMap} showLabels={showLabels} showCuts={showCuts} somaSheetBand={somaSheetBand} somaPartBand={somaPartBand} />
        <span className="cutlist-no-print absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/5 transition-colors rounded">
          <ZoomIn className="w-8 h-8 text-slate-700 opacity-0 group-hover:opacity-70 transition-opacity" />
        </span>
      </button>

      <Dialog open={zoomed} onOpenChange={setZoomed}>
        <DialogContent className="max-w-[95vw] w-full max-h-[95vh] p-4 flex flex-col">
          <div className="flex items-center justify-between gap-2 cutlist-no-print">
            <DialogTitle>
              לוח {index + 1} מתוך {total} — {layout.stockName}
            </DialogTitle>
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setScale((s) => clamp(s - 0.5, MIN_ZOOM, MAX_ZOOM))}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setScale((s) => clamp(s + 0.5, MIN_ZOOM, MAX_ZOOM))}>
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={resetZoom}>
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div
            className="flex-1 overflow-hidden rounded"
            style={{ touchAction: 'none', cursor: scale > 1 ? 'grab' : 'default' }}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ transform: `scale(${scale}) translate(${pan.x}px, ${pan.y}px)`, transformOrigin: 'center center' }}
            >
              <SheetSvg
                layout={layout}
                colorMap={colorMap}
                strokeMap={strokeMap}
                showLabels={showLabels}
                showCuts={showCuts}
                somaSheetBand={somaSheetBand}
                somaPartBand={somaPartBand}
                className="w-auto h-auto max-w-full max-h-[80vh] mx-auto block"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
                {mm(c.w - 2 * somaPartBand)} × {mm(c.h - 2 * somaPartBand)}
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
