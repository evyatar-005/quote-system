// Wraps `potrace` — the automated equivalent of Illustrator's Image Trace +
// Expand + Smooth Line steps. potrace returns a single <path> whose `d`
// combines every separate shape on the page AND any interior holes as
// subpaths, with fill-rule="evenodd" — exactly the multi-contour form this
// pipeline (and clipper's offset) needs, so there's no separate
// hole-detection or shape-splitting step. Note that means one upload can
// legitimately yield many contours: a sheet of stickers traces as one path
// with one subpath per sticker.

const potrace = require('potrace');
const { flattenPathData } = require('./flatten');

// turdSize: suppress speckles smaller than N px² — cleans JPEG/flood-fill noise.
// alphaMax: corner threshold controlling how aggressively corners are rounded
//           vs kept sharp — this is the "smoothing" knob exposed to the UI.
function traceMask(maskPngBuffer, { threshold = 128, turdSize = 2, alphaMax = 1, optCurve = true, optTolerance = 0.2 } = {}) {
  return new Promise((resolve, reject) => {
    potrace.trace(
      maskPngBuffer,
      { threshold, turdSize, alphaMax, optCurve, optTolerance, color: 'black', background: 'white' },
      (err, svgStr) => {
        if (err) return reject(err);
        const match = svgStr.match(/ d="([^"]+)"/);
        const d = match ? match[1] : '';
        const contours = flattenPathData(d).filter((c) => c.length >= 3);
        resolve({ contours, rawSvgD: d });
      }
    );
  });
}

module.exports = { traceMask };
