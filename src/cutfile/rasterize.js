// Rasterizes a PDF page to a PNG buffer so the rest of the cut-file pipeline
// (mask → trace → offset) can treat it exactly like an uploaded photo.
//
// Clients send artwork as PDF constantly, and telling a designer to "open it
// in Illustrator and export a PNG first" defeats the point of automating the
// Illustrator workflow in the first place.
//
// mupdf is used rather than pdfjs-dist/pdf2pic because it renders via WASM:
// no native module to rebuild per platform (sharp is already the one native
// dependency this project carries) and no system-wide Ghostscript/ImageMagick
// install on the production Windows box.
//
// Note this rasterizes vector art rather than extracting its paths directly.
// That's deliberate and matches what the designer does by hand — Illustrator's
// Image Trace also works off a raster — and it keeps one single code path for
// every input type. Rendering happens at RENDER_MAX_PX so the trace has plenty
// of edge detail to work with regardless of the PDF's nominal page size.

const RENDER_MAX_PX = 1600; // longest side; matches mask.js PROCESS_MAX_DIM

// mupdf ships as ESM with a top-level await, so a CommonJS `require` throws.
// Loaded once, lazily, and cached — the WASM init is the expensive part and
// nothing else in the app needs it.
let mupdfPromise = null;
function loadMupdf() {
  if (!mupdfPromise) {
    mupdfPromise = import('mupdf').then((mod) => mod.default || mod);
  }
  return mupdfPromise;
}

function isPdf(buffer) {
  return buffer && buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

// Renders the FIRST page only — a cut file describes one physical part, and a
// multi-page PDF in this workflow is a proof/mockup whose first page is the
// artwork. pageCount is returned so the caller can tell the user what happened.
async function pdfToPng(buffer) {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  const pageCount = doc.countPages();
  if (!pageCount) throw new Error('ה-PDF ריק — לא נמצאו עמודים');

  const page = doc.loadPage(0);
  const [x0, y0, x1, y1] = page.getBounds();
  const widthPt = x1 - x0;
  const heightPt = y1 - y0;
  if (!(widthPt > 0 && heightPt > 0)) throw new Error('לא ניתן לקרוא את מידות העמוד ב-PDF');

  const scale = RENDER_MAX_PX / Math.max(widthPt, heightPt);
  // alpha=true keeps an unpainted background transparent, which lets mask.js
  // take its clean alpha path instead of guessing the background by brightness.
  const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, true, true);
  const png = Buffer.from(pixmap.asPNG());

  return { png, pageCount, widthPt, heightPt };
}

module.exports = { isPdf, pdfToPng, RENDER_MAX_PX };
