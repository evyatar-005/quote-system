/**
 * Rasterize the given DOM nodes (one per PDF page) into a downloadable PDF.
 * Heavy libs are dynamically imported so they never land in the main bundle.
 * jsPDF's built-in fonts have no Hebrew glyphs, so all text - including the
 * Hebrew stats/legend card - must go through this raster path, never
 * `doc.text(...)`.
 * @param {{nodes: HTMLElement[], title: string, fileName: string}} args
 */
export async function exportSheetsToPdf({ nodes, title, fileName }) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

  if (document.fonts?.ready) await document.fonts.ready;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const PW = 297;
  const PH = 210;
  const MG = 8;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;
    const canvas = await html2canvas(node, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      windowWidth: node.scrollWidth,
    });
    const ratio = Math.min((PW - 2 * MG) / canvas.width, (PH - 2 * MG) / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    if (i > 0) doc.addPage();
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', (PW - w) / 2, (PH - h) / 2, w, h, undefined, 'FAST');
    // Yield a frame between pages so the tab stays responsive on long exports.
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  doc.setProperties({ title });
  doc.save(fileName);
}
