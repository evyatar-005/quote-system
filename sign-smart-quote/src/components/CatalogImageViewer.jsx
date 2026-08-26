// Click-to-enlarge viewer for vendor catalog pages (Vista 014).
//
// The grid/row thumbnails are 360px wide — enough to recognise a product, far
// too small to read a size chart off. This shows the 1600px render and lets the
// agent zoom into it, because even at 1600px a full page holds a 3×4 grid of
// drawings and the model codes sit at maybe 40px wide when the page is fitted
// to the screen. Fit-to-screen alone was the original mistake here.
//
// It also pages through the product's whole spread: the chart an agent wants is
// usually not on the page used as the product's photo.
import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

export const catalogThumb = (file) => (file ? `/vista-pages/${file}` : null);
// The renders are served with a one-year immutable cache, and the enlarge
// images were re-rendered at a higher resolution under the SAME filenames — a
// browser that saw the old ones would keep them forever. The marker below is
// what busts that; bump it whenever the large renders are regenerated.
const LARGE_REV = "1600";
export const catalogLarge = (file) => (file ? `/vista-pages/large/${file}?v=${LARGE_REV}` : null);
const pageFile = (n) => `p${String(n).padStart(3, "0")}.jpg`;

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

export default function CatalogImageViewer({ open, onClose, title, subtitle, pageFrom, pageTo }) {
  const first = Number(pageFrom) || 0;
  const last = Math.max(Number(pageTo) || first, first);

  const [page, setPage] = useState(first);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const stageRef = useRef(null);

  const resetView = useCallback(() => { setZoom(1); setOffset({ x: 0, y: 0 }); }, []);

  useEffect(() => { if (open) { setPage(first); resetView(); } }, [open, first, resetView]);
  // Changing page always returns to fit — carrying a pan offset across pages
  // lands the agent looking at an empty margin of the next drawing.
  useEffect(() => { resetView(); }, [page, resetView]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      // RTL page: ArrowLeft advances, ArrowRight goes back.
      if (e.key === "ArrowLeft") setPage((p) => Math.min(last, p + 1));
      if (e.key === "ArrowRight") setPage((p) => Math.max(first, p - 1));
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(MAX_ZOOM, z + 0.5));
      if (e.key === "-") setZoom((z) => Math.max(MIN_ZOOM, z - 0.5));
      if (e.key === "0") resetView();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, first, last, onClose, resetView]);

  // Wheel zooms toward the pointer rather than the image centre, so zooming in
  // on one drawing in a grid of twelve keeps that drawing under the cursor.
  //
  // Bound natively with { passive: false } rather than as React's onWheel:
  // React registers wheel listeners as passive, so preventDefault() there is
  // ignored and the page behind the overlay scrolls while you zoom.
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const ratio = next / z;
      setOffset((o) => (next === MIN_ZOOM
        ? { x: 0, y: 0 }
        : { x: cx - (cx - o.x) * ratio, y: cy - (cy - o.y) * ratio }));
      return next;
    });
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!open || !el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open, onWheel, page]);

  const onPointerDown = (e) => {
    if (zoom <= MIN_ZOOM) return;
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
  };
  const endDrag = () => { dragRef.current = null; };

  if (!open || !first) return null;

  const multi = last > first;
  const btn = "p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white";

  return (
    <div dir="rtl" className="fixed inset-0 z-[200] flex flex-col bg-slate-900/90">
      <div className="flex items-center gap-3 text-white shrink-0 px-4 py-2 bg-slate-900/60">
        <div className="min-w-0">
          <div className="text-lg font-bold truncate">{title}</div>
          {subtitle && <div className="text-sm text-slate-300 truncate">{subtitle}</div>}
        </div>

        <div className="mr-auto flex items-center gap-1.5">
          <button type="button" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 0.5))} disabled={zoom <= MIN_ZOOM} className={btn} title="הקטן (−)">
            <ZoomOut className="w-5 h-5" />
          </button>
          <span className="text-sm tabular-nums w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.5))} disabled={zoom >= MAX_ZOOM} className={btn} title="הגדל (+)">
            <ZoomIn className="w-5 h-5" />
          </button>
          <button type="button" onClick={resetView} className={btn} title="התאם למסך (0)">
            <Maximize2 className="w-5 h-5" />
          </button>

          {multi && (
            <>
              <span className="w-px h-6 bg-white/20 mx-1" />
              <button type="button" onClick={() => setPage((p) => Math.max(first, p - 1))} disabled={page <= first} className={btn} title="עמוד קודם">
                <ChevronRight className="w-5 h-5" />
              </button>
              <span className="text-sm tabular-nums">עמוד {page} · {first}–{last}</span>
              <button type="button" onClick={() => setPage((p) => Math.min(last, p + 1))} disabled={page >= last} className={btn} title="עמוד הבא">
                <ChevronLeft className="w-5 h-5" />
              </button>
            </>
          )}
          {!multi && <span className="text-sm mx-1">עמוד {page}</span>}

          <span className="w-px h-6 bg-white/20 mx-1" />
          <button type="button" onClick={onClose} className={btn} title="סגור (Esc)">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className="flex-1 min-h-0 overflow-hidden flex items-center justify-center touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        style={{ cursor: zoom > MIN_ZOOM ? (dragRef.current ? "grabbing" : "grab") : "zoom-in" }}
        onDoubleClick={() => (zoom > MIN_ZOOM ? resetView() : setZoom(2.5))}
      >
        <img
          src={catalogLarge(pageFile(page))}
          alt={title || ""}
          draggable={false}
          className="max-h-full max-w-full object-contain rounded bg-white shadow-2xl select-none"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: dragRef.current ? "none" : "transform 90ms linear",
          }}
          // The large render only exists for pages inside a product's spread;
          // anything else falls back to the thumbnail rather than a broken icon.
          onError={(e) => { e.currentTarget.src = catalogThumb(pageFile(page)); }}
        />
      </div>

      <div className="shrink-0 text-center text-xs text-slate-400 py-1.5">
        גלגלת העכבר מקרבת · גרירה מזיזה · לחיצה כפולה מקרבת/מאפסת · ← → מחליפים עמוד · Esc סוגר
      </div>
    </div>
  );
}
