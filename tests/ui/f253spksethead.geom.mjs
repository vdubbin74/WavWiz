// F253 geometry: phone .pd42-sheet .spk-head title row + unclipped actions at 320/390/430; desktop bare head unchanged at 1280.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = process.env.WW_WWW
  ? path.resolve(process.env.WW_WWW)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/WavWiz.Server/wwwroot');
const css = fs.readFileSync(path.join(ROOT, 'app.css'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c || !x ? '' : '  ' + x)); };

const mime = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<link rel=stylesheet href=/app.css>
<style>
  /* fixture chrome: variables the sheet expects; keep layout under test from product CSS */
  :root{--safe-t:0px;--safe-b:0px;--z:1;--line:#444;--panel:#1a1a22;--panel2:#22222c;--bg:#111;--ink:#eee;--dim:#999;--accent:#9b59ff;--accent-ink:#fff;--accent-text:#c9a6ff;--accent2:#7ad;--accent2-text:#9cf;--fld-bg:#222;--fld-ink:#eee;--fld-line:#555}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.3 system-ui,sans-serif}
  .btn{background:var(--panel2);border:1px solid var(--line);border-radius:3px;padding:8px 13px;cursor:pointer;min-height:38px;color:inherit}
  .btn.sm{padding:3px 10px;min-height:26px;font-size:12px}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:700}
  .small{font-size:12px}.dim{color:var(--dim)}.grow{flex:1 1 auto}
</style>
<body>
<div id=phone></div>
<div id=desk style="padding:20px;max-width:900px"></div>
<script>
function head(preview){
  const h=document.createElement('div'); h.className='spk-head';
  const title=document.createElement('h3'); title.className='spk-title';
  title.innerHTML='SPEAKER SETTINGS · IPHONE <span class="spk-state ok">● online</span>';
  const rename=document.createElement('button'); rename.type='button'; rename.className='btn sm spk-rename'; rename.textContent='Rename';
  const status=document.createElement('span'); status.className='spk-status';
  const live=document.createElement('span'); live.className='small dim spk-preview'; live.textContent='Previewing'; if(!preview) live.hidden=true;
  const grow=document.createElement('span'); grow.className='grow';
  const cancel=document.createElement('button'); cancel.type='button'; cancel.className='btn sm spk-cancel'; cancel.textContent='Cancel';
  const done=document.createElement('button'); done.type='button'; done.className='btn sm primary spk-done'; done.textContent='Done';
  h.append(title,rename,status,live,grow,cancel,done);
  return h;
}
function phoneMount(){
  const sheet=document.createElement('div'); sheet.className='pd42-sheet';
  const pd=document.createElement('div'); pd.className='pd42';
  const set=document.createElement('section'); set.className='spkset';
  set.append(head(true));
  pd.append(set); sheet.append(pd);
  document.getElementById('phone').replaceChildren(sheet);
}
function deskMount(){
  const set=document.createElement('section'); set.className='spkset';
  set.append(head(true));
  document.getElementById('desk').replaceChildren(set);
}
phoneMount(); deskMount();
window.__measure = (which) => {
  const root = which === 'phone' ? document.querySelector('#phone .spk-head') : document.querySelector('#desk .spk-head');
  const title = root.querySelector('.spk-title');
  const acts = [...root.querySelectorAll('.spk-rename,.spk-preview:not([hidden]),.spk-cancel,.spk-done')];
  const tr = title.getBoundingClientRect(), hr = root.getBoundingClientRect();
  const boxes = acts.map(el => {
    const r = el.getBoundingClientRect();
    return { cls: el.className, text: el.textContent, x:r.x, y:r.y, w:r.width, h:r.height, right:r.right, bottom:r.bottom,
      scrollW: el.scrollWidth, clientW: el.clientWidth, clipped: el.scrollWidth > el.clientWidth + 1 };
  });
  // pairwise overlap (area > 1px)
  const overlaps = [];
  for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++){
    const a=boxes[i], b=boxes[j];
    const ox = Math.max(0, Math.min(a.right,b.right) - Math.max(a.x,b.x));
    const oy = Math.max(0, Math.min(a.bottom,b.bottom) - Math.max(a.y,b.y));
    if (ox*oy > 1) overlaps.push([a.cls,b.cls,ox,oy]);
  }
  const styles = getComputedStyle(root);
  const titleOwnRow = boxes.length ? (tr.bottom <= Math.min(...boxes.map(b => b.y)) + 1) : true;
  // Title occupies full head width (forced row); actions start at/after title bottom.
  const titleFullWidth = Math.abs(tr.width - hr.width) <= 2;
  return {
    vw: innerWidth,
    wrap: styles.flexWrap,
    titleOwnRow,
    titleFullWidth,
    titleY: tr.y, titleBottom: tr.bottom,
    titleH: tr.height, titleW: tr.width, headW: hr.width,
    boxes, overlaps,
    anyClipped: boxes.some(b => b.clipped),
  };
};
</script>`);
    return;
  }
  if (u.pathname === '/app.css') {
    res.writeHead(200, { 'content-type': 'text/css' });
    res.end(css);
    return;
  }
  const fp = path.join(ROOT, u.pathname.replace(/^\//, ''));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': mime[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PW_CHROME || '/workspace/pw-browsers/chromium-1248/chrome-linux64/chrome',
});
async function check(width, height, which, expect) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  const m = await page.evaluate(w => window.__measure(w), which);
  console.log('GEOM', JSON.stringify({ width, which, wrap: m.wrap, titleOwnRow: m.titleOwnRow, anyClipped: m.anyClipped, overlaps: m.overlaps.length, boxes: m.boxes.map(b => b.text + ':' + Math.round(b.w)) }));
  if (expect.wrap != null) ok(`${width} ${which} flex-wrap=${expect.wrap}`, m.wrap === expect.wrap, `got ${m.wrap}`);
  if (expect.titleOwnRow != null) ok(`${width} ${which} title own row`, m.titleOwnRow === expect.titleOwnRow, JSON.stringify({titleOwnRow:m.titleOwnRow,titleFullWidth:m.titleFullWidth,titleY:m.titleY,titleBottom:m.titleBottom,actY:m.boxes[0]?.y}));
  if (expect.titleFullWidth != null) ok(`${width} ${which} title full width`, m.titleFullWidth === expect.titleFullWidth, JSON.stringify({titleW:m.titleW,headW:m.headW}));
  if (expect.noClip) ok(`${width} ${which} no clipped labels`, !m.anyClipped, JSON.stringify(m.boxes));
  if (expect.noOverlap) ok(`${width} ${which} no action overlap`, m.overlaps.length === 0, JSON.stringify(m.overlaps));
  await ctx.close();
  return m;
}
try {
  for (const w of [320, 390, 430]) {
    await check(w, 720, 'phone', { wrap: 'wrap', titleOwnRow: true, titleFullWidth: true, noClip: true, noOverlap: true });
  }
  // Desktop Speakers column: bare .spk-head (not under .pd42-sheet) must stay nowrap / single-row CSS.
  await check(1280, 800, 'desk', { wrap: 'nowrap' });
} finally {
  await browser.close();
  server.close();
}
console.log(`\n# F253 geometry ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
