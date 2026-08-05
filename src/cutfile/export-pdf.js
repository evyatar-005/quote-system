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

const MM_TO_PT = 2.834645669;

async function exportPdf({ contours, widthMm, heightMm, strokeMm = 0.25 }) {
  const wPt = widthMm * MM_TO_PT;
  const hPt = heightMm * MM_TO_PT;

  const doc = await PDFDocument.create();
  const page = doc.addPage([wPt, hPt]);
  const context = doc.context;

  // Type 2 (exponential) tint-transform function: tint 1 → a visible CMYK
  // proxy color (magenta+yellow) for viewers/printers that render the spot
  // literally instead of treating it as a cut instruction. The /Separation
  // *name* "CutContour" is what a RIP actually keys off — this color is only
  // ever a fallback preview.
  const tintTransform = context.register(
    context.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 1, 1, 0], N: 1 })
  );
  const separation = context.register(
    context.obj([PDFName.of('Separation'), PDFName.of('CutContour'), PDFName.of('DeviceCMYK'), tintTransform])
  );

  const resources = page.node.Resources();
  let colorSpaceDict = resources.lookupMaybe(PDFName.of('ColorSpace'), PDFDict);
  if (!colorSpaceDict) {
    colorSpaceDict = context.obj({});
    resources.set(PDFName.of('ColorSpace'), colorSpaceDict);
  }
  colorSpaceDict.set(PDFName.of('CS0'), separation);

  const flipped = flipY(contours, heightMm);
  const ops = [
    PDFOperator.of(PDFOperatorNames.PushGraphicsState),
    PDFOperator.of(PDFOperatorNames.StrokingColorspace, [PDFName.of('CS0')]),
    PDFOperator.of(PDFOperatorNames.StrokingColorN, [PDFNumber.of(1)]), // full tint on the CutContour channel
    PDFOperator.of('w', [PDFNumber.of(strokeMm * MM_TO_PT)]),
  ];
  for (const pts of flipped) {
    if (!pts.length) continue;
    const [x0, y0] = pts[0];
    ops.push(PDFOperator.of(PDFOperatorNames.MoveTo, [PDFNumber.of(x0 * MM_TO_PT), PDFNumber.of(y0 * MM_TO_PT)]));
    for (const [x, y] of pts.slice(1)) {
      ops.push(PDFOperator.of(PDFOperatorNames.LineTo, [PDFNumber.of(x * MM_TO_PT), PDFNumber.of(y * MM_TO_PT)]));
    }
    ops.push(PDFOperator.of(PDFOperatorNames.ClosePath));
  }
  ops.push(PDFOperator.of(PDFOperatorNames.StrokePath));
  ops.push(PDFOperator.of(PDFOperatorNames.PopGraphicsState));

  page.pushOperators(...ops);

  // useObjectStreams:false — these are small vector files, so the size win
  // from PDF 1.5 compressed object streams doesn't matter; plotter/RIP
  // software (the actual target of this export) has a much better track
  // record parsing classic, uncompressed indirect objects.
  return doc.save({ useObjectStreams: false });
}

module.exports = { exportPdf };
