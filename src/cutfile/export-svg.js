// SVG is the "just works everywhere" export — opens directly in Illustrator
// for a final look, and is what the browser preview also renders. Coordinate
// space matches the source image (Y-down), so contours need no flip here
// (unlike DXF/PDF, which are Y-up).

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

// stroke-only, fill:none — this is a cut line, not a filled shape. id/color
// name it "CutContour" the same way the PDF spot channel does, so a human
// opening the SVG in Illustrator can find/select it the same way.
function exportSvg({ contours, widthMm, heightMm, strokeMm = 0.25 }) {
  const d = contoursToPathD(contours);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}">
  <path id="CutContour" d="${d}" fill="none" stroke="#FF00FF" stroke-width="${strokeMm}" />
</svg>
`;
}

module.exports = { exportSvg, contoursToPathD };
