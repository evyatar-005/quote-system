// Vista catalog (014) → one row per catalog product page.
//
// Row granularity is the PAGE, not the model code. The catalog's product pages
// are drawings: only some carry a readable title in the text layer, and model
// codes appear as scattered diagram labels, so a per-model row list would be
// part real and part garbage. A page is the unit the catalog itself is built
// around — it shows one product with its photo and its size chart — so the
// agent picks the page they can see, and the model/size goes in the line text.
const fs=require('fs'), path=require('path');
const FAM=require(process.cwd()+'/vista-families.json');
const txt=fs.readFileSync(process.cwd()+'/vendor-catalogs/vista-2026.txt','utf8');

const pages={};
let cur=null;
for(const line of txt.split('\n')){
  const m=line.match(/^-- (\d+) of 334 --$/);
  if(m){cur=+m[1];pages[cur]=[];continue;}
  if(cur!=null) pages[cur].push(line);
}

// A usable title is a mostly-alphabetic English phrase. The garbled diagram
// text (":)3", "FRPHVZLWK", "w58") fails on either the letter ratio or the
// share of real dictionary-ish words, so both get rejected by the same test.
function titleOf(lines){
  for(const raw of lines){
    const s=raw.replace(/\s+/g,' ').trim();
    if(s.length<4||s.length>60) continue;
    if(/^\d+$/.test(s)) continue;
    const letters=(s.match(/[A-Za-z]/g)||[]).length;
    if(letters/s.length<0.6) continue;
    const words=s.split(' ').filter(Boolean);
    // Reject ciphered runs like "FRPHVZLWKDGLERQGIURQWSDQHO": one long
    // all-caps token with no vowel pattern a real product name would have.
    if(words.some(t=>t.length>12&&!/[aeiou]/.test(t))) continue;
    if(!/[a-z]/.test(s)) continue;
    return s;
  }
  return null;
}

const famOf=p=>FAM.find(f=>p>=f.page_from&&p<=f.page_to);
const imgDir=path.join(process.cwd(),'sign-smart-quote/public/vista-pages');
const rows=[];
for(let p=4;p<=331;p++){
  const f=famOf(p); if(!f) continue;
  const file='p'+String(p).padStart(3,'0')+'.jpg';
  if(!fs.existsSync(path.join(imgDir,file))) continue;
  const lines=pages[p]||[];
  const codes=(f.models||[]).filter(m=>m.pages.includes(p)).map(m=>m.code);
  rows.push({
    family:f.family, family_he:f.family_he, page:p,
    name:titleOf(lines)||f.family,
    model_codes:codes.join(', '),
    image_file:file, sort:p,
  });
}
fs.writeFileSync(process.cwd()+'/src/db/vista-items.json',JSON.stringify(rows,null,1));
const byFam={};
for(const r of rows) byFam[r.family_he]=(byFam[r.family_he]||0)+1;
console.log('rows',rows.length);
console.log('titled',rows.filter(r=>r.name!==r.family).length);
console.log(byFam);
