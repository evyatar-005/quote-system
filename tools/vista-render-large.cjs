// High-resolution versions of the Vista catalog pages, for the click-to-enlarge
// overlay in the picker and the admin price table.
//
// Rendered at 1600px: the technical drawings are the whole point of enlarging,
// and their model codes (WFFP265, WFSUE107) are unreadable below about that.
// Line art compresses well, so this costs far less than a photo would — the
// 360px grid thumbnails stay as they are, since they load hundreds at a time.
const fs = require('fs');
const path = require('path');
const OUT = process.cwd() + '/vrender-large.log';
const w = m => fs.appendFileSync(OUT, m + '\n');
fs.writeFileSync(OUT, 'start\n');
process.on('unhandledRejection', e => { w('UNHANDLED ' + (e && e.message)); process.exit(1); });

(async () => {
  const { PDFParse } = require('pdf-parse');
  const sharp = require('sharp');
  const catalog = require(process.cwd() + '/src/db/vista-catalog.json');

  // Every page of every product's spread, not just the cover: the size chart an
  // agent wants to read is often on the second or third page of the section.
  const wanted = new Set();
  for (const p of catalog) for (let n = p.page; n <= p.page_to; n++) wanted.add(n);
  const pages = [...wanted].sort((a, b) => a - b);
  w('pages to render: ' + pages.length);

  const dir = path.join(process.cwd(), 'sign-smart-quote/public/vista-pages/large');
  fs.mkdirSync(dir, { recursive: true });
  const buf = fs.readFileSync(process.cwd() + '/vendor-catalogs/vista-2026.pdf');

  let done = 0, bytes = 0;
  const BATCH = 15;
  for (let i = 0; i < pages.length; i += BATCH) {
    const slice = pages.slice(i, i + BATCH);
    const parser = new PDFParse({ data: buf });
    const r = await parser.getScreenshot({ first: slice[0], last: slice[slice.length - 1], scale: 3.0 });
    for (const pg of (r.pages || [])) {
      if (!wanted.has(pg.pageNumber)) continue;
      const b64 = (pg.dataUrl || '').split(',')[1];
      if (!b64) continue;
      const jpg = await sharp(Buffer.from(b64, 'base64'))
        .flatten({ background: '#ffffff' })
        .resize({ width: 1600 })
        .jpeg({ quality: 60, mozjpeg: true })
        .toBuffer();
      fs.writeFileSync(path.join(dir, 'p' + String(pg.pageNumber).padStart(3, '0') + '.jpg'), jpg);
      done++; bytes += jpg.length;
    }
    await parser.destroy();
    w('… ' + done + '/' + pages.length + ' (' + Math.round(bytes / 1024) + 'KB)');
  }
  w('DONE pages=' + done + ' totalKB=' + Math.round(bytes / 1024));
  console.log('rendered', done, 'large pages,', Math.round(bytes / 1024 / 1024 * 10) / 10, 'MB');
})();
