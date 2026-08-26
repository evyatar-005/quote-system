// Scores every rendered Vista catalog page as photo-like vs drawing-like.
//
// A product section opens with a real installation photo and then continues into
// pages of technical line drawings. The photo is what an agent recognises the
// product by, so it should be the card image — but the drawings are what carries
// the model codes, so they must stay reachable in the enlarge view.
//
// The separator is colour saturation. Line drawings are black-on-white with a
// thin brand stripe (mean saturation ~5), photographs of installed signage are
// full-colour (~30-40). Measured on the 120px downscale, which is plenty for a
// whole-page statistic and keeps the pass fast.
const fs = require('fs');
const path = require('path');

(async () => {
  const sharp = require('sharp');
  const dir = path.join(process.cwd(), 'sign-smart-quote/public/vista-pages');
  const files = fs.readdirSync(dir).filter(f => /^p\d{3}\.jpg$/.test(f)).sort();
  const scores = {};
  for (const f of files) {
    const { data, info } = await sharp(path.join(dir, f))
      .resize({ width: 120 }).raw().toBuffer({ resolveWithObject: true });
    let sat = 0, n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      sat += Math.max(r, g, b) - Math.min(r, g, b);
      n++;
    }
    scores[parseInt(f.slice(1, 4), 10)] = Math.round((sat / n) * 10) / 10;
  }
  fs.writeFileSync(path.join(process.cwd(), 'tools/vista-page-scores.json'), JSON.stringify(scores));
  const vals = Object.values(scores);
  console.log('scored', vals.length, 'pages | min', Math.min(...vals), '| max', Math.max(...vals));
})();
