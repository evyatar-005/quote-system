// PDF export with the cut line on its own `CutContour` spot-color channel —
// the format the plotter/RIP (Roland/Summa-style workflow) actually expects,
// so the operator can select "cut" vs "print" per separation instead of
// guessing from a plain black stroke.
//
// pdf-lib has no high-level "add a spot color" API — this is built from the
// low-level PDF object model: a Separation colorspace (naming the channel
// "CutContour", with a tint-transform Function so viewers that don't
// understand spot colors still render *something*), registered into the
// page's /Resources /ColorSpace dict, then a hand-written content stream
// that selects it and strokes the path. This is the riskiest export of the
// three (SVG/DXF are comparatively mechanical) — if this throws, the caller
// should let SVG/DXF still succeed rather than fail the whole request.
//
// PDF page space is Y-up (origin bottom-left), same as DXF — reuse its flip.

const { PDFDocument, PDFName, PDFNumber, PDFDict, PDFOperator, PDFOperatorNames } = require('pdf-lib');
const { flipY } = require('./export-dxf');
const { rdpSimplify } = require('./fit');

const MM_TO_PT = 2.834645669;

// Emits one contour set as cubic Béziers on an already-selected colorspace.
// Curves rather than a lineto per traced sample: a dense polyline made files
// ~180× heavier than a professionally prepared equivalent and could fail to
// open in Illustrator/RIP software altogether.
function strokeContourOps(contours, heightMm, colorSpaceName, strokeMm) {
  const ops = [
    PDFOperator.of(PDFOperatorNames.PushGraphicsState),
    PDFOperator.of(PDFOperatorNames.StrokingColorspace, [PDFName.of(colorSpaceName)]),
    PDFOperator.of(PDFOperatorNames.StrokingColorN, [PDFNumber.of(1)]), // full tint on this spot channel
    PDFOperator.of('w', [PDFNumber.of(strokeMm * MM_TO_PT)]),
  ];
  const pt = (v) => PDFNumber.of(v * MM_TO_PT);

  for (const raw of flipY(contours, heightMm)) {
    const pts = rdpSimplify(raw, 0.05);
    const n = pts.length;
    if (n < 2) continue;
    const at = (i) => pts[((i % n) + n) % n];
    ops.push(PDFOperator.of(PDFOperatorNames.MoveTo, [pt(pts[0][0]), pt(pts[0][1])]));
    // Catmull-Rom → Bézier, same construction as the SVG exporter uses.
    for (let i = 0; i < n; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      ops.push(PDFOperator.of('c', [pt(c1x), pt(c1y), pt(c2x), pt(c2y), pt(p2[0]), pt(p2[1])]));
    }
    ops.push(PDFOperator.of(PDFOperatorNames.ClosePath));
  }
  ops.push(PDFOperator.of(PDFOperatorNames.StrokePath));
  ops.push(PDFOperator.of(PDFOperatorNames.PopGraphicsState));
  return ops;
}

async function exportPdf({ contours, netContours, widthMm, heightMm, strokeMm = 0.25 }) {
  const wPt = widthMm * MM_TO_PT;
  const hPt = heightMm * MM_TO_PT;

  const doc = await PDFDocument.create();
  const page = doc.addPage([wPt, hPt]);
  const context = doc.context;

  // Type 2 (exponential) tint-transform functions: tint 1 → a visible CMYK
  // proxy color for viewers/printers that render the spot literally instead
  // of treating it as an instruction. The /Separation *name* is what a RIP
  // actually keys off — these colors are only ever a fallback preview.
  const makeSeparation = (name, c1) => {
    const tintTransform = context.register(
      context.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: c1, N: 1 })
    );
    return context.register(
      context.obj([PDFName.of('Separation'), PDFName.of(name), PDFName.of('DeviceCMYK'), tintTransform])
    );
  };

  const resources = page.node.Resources();
  let colorSpaceDict = resources.lookupMaybe(PDFName.of('ColorSpace'), PDFDict);
  if (!colorSpaceDict) {
    colorSpaceDict = context.obj({});
    resources.set(PDFName.of('ColorSpace'), colorSpaceDict);
  }
  // CS0 = the blade path. CS1 = the net/finished edge, kept as its own named
  // separation so the operator (and the RIP) can tell the two apart, and can
  // drop the net line without touching the cut path.
  colorSpaceDict.set(PDFName.of('CS0'), makeSeparation('CutContour', [0, 1, 1, 0]));
  const hasNet = netContours && netContours.length;
  if (hasNet) colorSpaceDict.set(PDFName.of('CS1'), makeSeparation('NetLine', [1, 0, 1, 0]));

  const ops = [];
  if (hasNet) ops.push(...strokeContourOps(netContours, heightMm, 'CS1', strokeMm));
  ops.push(...strokeContourOps(contours, heightMm, 'CS0', strokeMm));

  page.pushOperators(...ops);

  // useObjectStreams:false — these are small vector files, so the size win
  // from PDF 1.5 compressed object streams doesn't matter; plotter/RIP
  // software (the actual target of this export) has a much better track
  // record parsing classic, uncompressed indirect objects.
  return doc.save({ useObjectStreams: false });
}

module.exports = { exportPdf };
