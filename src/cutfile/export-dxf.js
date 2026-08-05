// Minimal ASCII DXF (R12 entity set — POLYLINE/VERTEX/SEQEND, not the newer
// LWPOLYLINE which needs R13+) for the widest possible compatibility with CNC
// router / laser-cutter import software.
//
// DXF is Y-up (origin bottom-left); the source contours are in image space
// (Y-down, origin top-left) — every point is flipped here. SVG/PDF need their
// own handling of this (SVG doesn't, PDF does) — don't reuse this blindly.

function flipY(contours, heightMm) {
  return contours.map((pts) => pts.map(([x, y]) => [x, heightMm - y]));
}

function polylineEntity(pts) {
  const lines = [
    '0', 'POLYLINE',
    '8', 'CutContour',
    '66', '1', // vertices-follow flag
    '70', '1', // closed polyline
  ];
  for (const [x, y] of pts) {
    lines.push('0', 'VERTEX', '8', 'CutContour', '10', x.toFixed(3), '20', y.toFixed(3));
  }
  lines.push('0', 'SEQEND');
  return lines;
}

function exportDxf({ contours, widthMm, heightMm }) {
  const flipped = flipY(contours, heightMm);
  const lines = [
    '0', 'SECTION', '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1009',
    '9', '$INSUNITS', '70', '4', // 4 = millimeters
    '9', '$MEASUREMENT', '70', '1', // metric
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
  ];
  for (const pts of flipped) lines.push(...polylineEntity(pts));
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n') + '\n';
}

module.exports = { exportDxf, flipY };
