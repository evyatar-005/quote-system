// SVG is the "just works everywhere" export — opens directly in Illustrator
// for a final look. Coordinate space matches the source image (Y-down), so
// contours need no flip here (unlike DXF/PDF, which are Y-up).
//
// Two lines are emitted, matching what the on-screen preview shows and what
// production actually needs:
//   CutContour (magenta) — where the blade travels, i.e. the outside of the
//     cut including the bleed offset.
//   NetLine (green)      — the artwork's own edge: the net shape that is left
//     after cutting. Kept as a separate, clearly-named layer so the operator
//     can see the finished size, and can delete it before sending to the
//     cutter if their RIP would otherwise try to cut it too.

const { contoursToBezierPathD } = require('./fit');

// Kept for callers that need raw polyline output (the browser preview, which
// re-renders on every slider drag and doesn't benefit from curve fitting).
function contoursToPathD(contours) {
  return contours
    .map((pts) => {
      if (!pts.length) return '';
      const [x0, y0] = pts[0];
      const rest = pts
        .slice(1)
        .map(([x, y]) => `L ${x.toFixed(3)} ${y.toFixed(3)}`)
        .join(' ');
      return `M ${x0.toFixed(3)} ${y0.toFixed(3)} ${rest} Z`;
    })
    .join(' ');
}

// stroke-only, fill:none — these are cut lines, not filled shapes.
function exportSvg({ contours, netContours, widthMm, heightMm, strokeMm = 0.25 }) {
  const cutD = contoursToBezierPathD(contours);
  const netD = netContours && netContours.length ? contoursToBezierPathD(netContours) : '';

  const netLayer = netD
    ? `\n  <g id="NetLine" inkscape:label="NetLine" data-role="net">
    <path d="${netD}" fill="none" stroke="#00A651" stroke-width="${strokeMm}" />
  </g>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}">${netLayer}
  <g id="CutContour" inkscape:label="CutContour" data-role="cut">
    <path d="${cutD}" fill="none" stroke="#FF00FF" stroke-width="${strokeMm}" />
  </g>
</svg>
`;
}

module.exports = { exportSvg, contoursToPathD };
