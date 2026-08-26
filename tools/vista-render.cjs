// Renders every Vista catalog page to a thumbnail for the 014 picker.
// The catalog's product pages are graphical — their text layer is a scatter of
// diagram labels — so the page image itself is the product visual. Thumbnails
// only: a 360px-wide JPEG is enough to recognise a product in a grid, and the
// full 87MB PDF stays out of the app entirely.
const fs=require('fs'), path=require('path');
const OUT=process.cwd()+'/vrender.log';
const w=m=>fs.appendFileSync(OUT,m+'\n'); fs.writeFileSync(OUT,'start\n');
process.on('unhandledRejection',e=>{w('UNHANDLED '+(e&&e.message));process.exit(1)});
const FIRST=4, LAST=331, BATCH=20;
(async()=>{
  const {PDFParse}=require('pdf-parse');
  const sharp=require('sharp');
  const dir=path.join(process.cwd(),'sign-smart-quote/public/vista-pages');
  fs.mkdirSync(dir,{recursive:true});
  const buf=fs.readFileSync(process.cwd()+'/vendor-catalogs/vista-2026.pdf');
  let total=0, bytes=0;
  for(let start=FIRST; start<=LAST; start+=BATCH){
    const end=Math.min(start+BATCH-1,LAST);
    const p=new PDFParse({data:buf});
    const r=await p.getScreenshot({first:start,last:end,scale:1.5});
    for(const pg of (r.pages||[])){
      const b64=(pg.dataUrl||'').split(',')[1]; if(!b64) continue;
      const jpg=await sharp(Buffer.from(b64,'base64')).flatten({background:'#ffffff'})
        .resize({width:360}).jpeg({quality:72,mozjpeg:true}).toBuffer();
      const name='p'+String(pg.pageNumber).padStart(3,'0')+'.jpg';
      fs.writeFileSync(path.join(dir,name),jpg);
      total++; bytes+=jpg.length;
    }
    await p.destroy();
    w('pages '+start+'-'+end+' ok (total '+total+', '+Math.round(bytes/1024)+'KB)');
  }
  w('DONE pages='+total+' totalKB='+Math.round(bytes/1024));
})();
