// Vista System 2026 catalog → family map + model codes.
// Page ranges come from the catalog's own Table of Content (page 2). They are
// hand-transcribed rather than parsed: the TOC's text layer interleaves three
// columns, so a parser would mis-assign sections. 25 fixed numbers are safer.
const fs=require('fs');
const FAMILIES=[
  ['Vista Classic','ויסטה קלאסי',4,51],
  ['Vista Sharp','ויסטה שארפ',52,99],
  ['Vista Square','ויסטה סקוור',100,169],
  ['Vista Nova','ויסטה נובה',170,201],
  ['Vista Light','ויסטה לייט (מואר)',202,225],
  ['Vista Fabric','ויסטה פבריק (בד)',226,231],
  ['Vista Expand','ויסטה אקספנד',232,253],
  ['Vista ADA','ויסטה ADA (נגישות)',254,259],
  ['Vista Insert','ויסטה אינסרט',260,262],
  ['Vista Art','ויסטה ארט',263,275],
  ['Tools','כלי עבודה והתקנה',276,281],
  ['Vista Slider','ויסטה סלايدר',282,285],
  ['Snap Frames','מסגרות סנאפ',286,293],
  ['Wall Mounted Display','תצוגה לקיר',294,298],
  ['Plexiglas Display Stands','סטנדים פרספקס',299,299],
  ['A-Sign','שלט A',300,302],
  ['Counter Slide-in Frame','מסגרת דלפק',303,303],
  ['Brochure Holders','מתקני ברושורים',304,313],
  ['Information and Menu Stands','סטנדי מידע ותפריט',314,316],
  ['Bulletin Board','לוח מודעות',317,318],
  ['Poster Stands','סטנדי פוסטר',319,321],
  ['Sidewalk Sign','שלט מדרכה',322,322],
  ['Rigid Poster Stand','סטנד פוסטר קשיח',323,323],
  ['Queue Belt Barriers','מחסומי תור',324,328],
  ['Sample & Display Kits','ערכות דוגמה',329,331],
];
const txt=fs.readFileSync(process.cwd()+'/vendor-catalogs/vista-2026.txt','utf8');
const pages={};
let cur=null;
for(const line of txt.split('\n')){
  const m=line.match(/^-- (\d+) of 334 --$/);
  if(m){cur=+m[1];pages[cur]=[];continue;}
  if(cur) pages[cur].push(line);
}
const famOf=p=>FAMILIES.find(f=>p>=f[2]&&p<=f[3]);
// Model codes: 1-3 uppercase letters + 2-4 digits (F120, VN70, XP1000, VL500),
// plus the paper-size variants the tables use (VN-A4, F-Letter, F11).
const CODE=/\b([A-Z]{1,3}\d{2,4}|[A-Z]{1,3}-(?:A\d|Letter|\d{3,4}))\b/g;
const out={};
for(const [p,lines] of Object.entries(pages)){
  const f=famOf(+p); if(!f) continue;
  const body=lines.join('\n');
  for(const m of body.matchAll(CODE)){
    const code=m[1];
    if(/^(PDF|RGB|CMYK|ISO|USA|LED)/.test(code)) continue;
    out[f[0]]=out[f[0]]||new Map();
    const e=out[f[0]].get(code)||{code,pages:new Set()};
    e.pages.add(+p); out[f[0]].set(code,e);
  }
}
const result=FAMILIES.map(([en,he,from,to])=>({
  family:en, family_he:he, page_from:from, page_to:to,
  models:[...(out[en]||new Map()).values()]
    .map(e=>({code:e.code,pages:[...e.pages].sort((a,b)=>a-b)}))
    .sort((a,b)=>a.code.localeCompare(b.code,'en',{numeric:true})),
}));
fs.writeFileSync(process.cwd()+'/vista-families.json',JSON.stringify(result,null,1));
for(const r of result) console.log(String(r.models.length).padStart(4),r.family,`(p${r.page_from}-${r.page_to})`,r.models.slice(0,8).map(m=>m.code).join(' '));
