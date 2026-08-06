// The automated equivalent of Illustrator step 5 ("בדיקת התמונה מול הקו
// חיתוך מוכן ותיקונים") — the source photo with the traced outline and the
// final (offset) cut line drawn over it, so the graphic designer can confirm
// the shape before downloading instead of guessing blind.
//
// Paths (tracePathD/cutPathD) are in millimetre space, same origin/orientation
// (top-left, Y-down) as the source image — the overlay SVG's viewBox is set to
// the same width/height in mm with preserveAspectRatio="none" so it lines up
// with the <img> regardless of the image's on-screen pixel size.
//
// Zoom/pan matters here specifically: at fit-to-page size a whole sticker
// sheet renders a few hundred pixels tall, which is far too small to judge
// whether a cut line actually follows the artwork — the check this screen
// exists for. Image and overlay live inside one transformed wrapper so they
// stay registered to each other at any zoom, and stroke widths are divided by
// the zoom factor so the lines stay hairline-thin instead of growing into
// bars that hide the very detail being inspected.

import { useState, useRef, useCallback, useEffect } from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
const ZOOM_STEP = 1.4;

export default function TracePreview({ sourceUrl, widthMm, heightMm, tracePathD, cutPathD, loading }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const viewportRef = useRef(null);

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // A new image (or a re-trace that changes the page size) invalidates the
  // current pan/zoom — otherwise the view stays scrolled to wherever the
  // previous artwork was.
  useEffect(() => { reset(); }, [sourceUrl, reset]);

  const clampPan = useCallback((next, z) => {
    const el = viewportRef.current;
    if (!el) return next;
    // Allow panning only as far as the scaled content actually extends, so
    // the artwork can't be dragged completely out of view.
    const maxX = (el.clientWidth * (z - 1)) / 2;
    const maxY = (el.clientHeight * (z - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }, []);

  const applyZoom = useCallback((factor) => {
    setZoom((z) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor));
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
      else setPan((p) => clampPan(p, next));
      return next;
    });
  }, [clampPan]);

  const handleWheel = (e) => {
    if (!sourceUrl) return;
    e.preventDefault();
    applyZoom(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  };

  const handlePointerDown = (e) => {
    if (zoom <= 1) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: pan };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    setPan(clampPan({ x: d.origin.x + (e.clientX - d.startX), y: d.origin.y + (e.clientY - d.startY) }, zoom));
  };

  const handlePointerUp = (e) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Keep the drawn lines a constant on-screen thickness regardless of zoom.
  const netStroke = Math.max(widthMm * 0.0015, 0.3) / zoom;
  const cutStroke = Math.max(widthMm * 0.0025, 0.5) / zoom;

  return (
    <div className="space-y-2">
      <div
        ref={viewportRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative overflow-hidden rounded-xl border-2 border-slate-900 bg-[repeating-conic-gradient(#e2e8f0_0%_25%,white_0%_50%)] bg-[length:16px_16px] ${
          zoom > 1 ? (dragRef.current ? 'cursor-grabbing' : 'cursor-grab') : ''
        }`}
      >
        <div
          className="origin-center transition-transform duration-75"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          {sourceUrl && (
            <img
              src={sourceUrl}
              alt="תמונת מקור"
              draggable={false}
              className="block max-w-full max-h-[60vh] w-auto h-auto mx-auto select-none"
            />
          )}
          {sourceUrl && widthMm > 0 && heightMm > 0 && (
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox={`0 0 ${widthMm} ${heightMm}`}
              preserveAspectRatio="none"
            >
              {tracePathD && (
                <path d={tracePathD} fill="none" stroke="#22c55e" strokeWidth={netStroke} opacity={0.85} />
              )}
              {cutPathD && (
                <path d={cutPathD} fill="none" stroke="#ef4444" strokeWidth={cutStroke} />
              )}
            </svg>
          )}
        </div>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/40">
            <div className="w-8 h-8 border-4 border-slate-300 border-t-amber-600 rounded-full animate-spin" />
          </div>
        )}

        {sourceUrl && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-lg bg-white/90 backdrop-blur px-1.5 py-1 border border-slate-300 shadow-sm">
            <button
              type="button"
              onClick={() => applyZoom(1 / ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM}
              title="הקטנה"
              className="p-1 rounded text-slate-600 hover:text-amber-600 disabled:opacity-30 disabled:hover:text-slate-600"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs tabular-nums text-slate-600 w-11 text-center">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => applyZoom(ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM}
              title="הגדלה"
              className="p-1 rounded text-slate-600 hover:text-amber-600 disabled:opacity-30 disabled:hover:text-slate-600"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
              title="התאמה למסך"
              className="p-1 rounded text-slate-600 hover:text-amber-600 disabled:opacity-30 disabled:hover:text-slate-600"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {sourceUrl && (
        <p className="text-xs text-slate-400">
          גלגלת העכבר להגדלה · גרירה להזזה · עד ×{MAX_ZOOM} לבדיקת הקווים לפני ההורדה
        </p>
      )}
    </div>
  );
}
