// 0.4.9 F66: Master volume mixer - every zone and speaker slider (assigned and unassigned, Whole-Home excluded) in one column of cards has the same
// track: left edge, width and center within 1 px, so 50 % is at the same spot on every row. 100 %, 200 % + Display size tiny (TV), phone. SH=1 TAG=before|after.
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SH, TAG = process.env.TAG || 'after', OUT = '/workspace/screens/049-mixer'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
if (SH) mkdirSync(OUT, { recursive: true });
const br = await chromium.launch();
for (const [z, vw, vh, dpr, u] of [['100', 1920, 1080, 1, 'compact'], ['200-tiny', 960, 540, 2, 'tiny'], ['phone', 390, 844, 3, 'compact']]) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, isMobile: z === 'phone' }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(u => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.setItem('wavwiz.uiscale', u); localStorage.setItem('wavwiz.layout', 'full'); }, u);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(e => e.close()));
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('wavwiz:mixer'))); await p.waitForTimeout(1200);
  const cols = await p.evaluate(() => { const d = document.querySelector('dialog.mixer-dlg'); if (!d) return null; const m = {};
    for (const s of d.querySelectorAll('.mv-card input.mv-s')) { if (!s.offsetParent) continue; const r = s.getBoundingClientRect(), k = Math.round(s.closest('.mv-card').getBoundingClientRect().left);
      (m[k] ||= []).push({ kind: s.closest('.mv-zrow') ? 'zone' : s.closest('.mv-sub.flat') ? 'unassigned' : 'speaker', l: r.left, w: r.width, c: r.left + r.width / 2 }); }
    return { n: Object.keys(m).length, m }; });
  ok(`[${z}] the mixer opened with slider columns (${cols?.n})`, cols && cols.n >= 1, JSON.stringify(cols));
  if (cols) for (const [k, list] of Object.entries(cols.m)) {
    const sp = f => Math.max(...list.map(f)) - Math.min(...list.map(f)), kinds = [...new Set(list.map(x => x.kind))].join('+');
    ok(`[${z}] column @${k}: ${list.length} sliders (${kinds}) share the track left edge (spread ${sp(x => x.l).toFixed(1)} px)`, sp(x => x.l) <= 1, JSON.stringify(list.map(x => [x.kind, Math.round(x.l)])));
    ok(`[${z}] column @${k}: same track width (spread ${sp(x => x.w).toFixed(1)} px)`, sp(x => x.w) <= 1, JSON.stringify(list.map(x => Math.round(x.w))));
    ok(`[${z}] column @${k}: same center, 50 % lines up (spread ${sp(x => x.c).toFixed(1)} px)`, sp(x => x.c) <= 1);
  }
  if (SH) await p.screenshot({ path: `${OUT}/mixer-${TAG}-${z}.png` });
  await c.close();
}
await br.close(); console.log(`f66mixeralign: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
