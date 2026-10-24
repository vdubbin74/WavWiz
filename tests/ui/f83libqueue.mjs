// 0.4.9 F83 / F84 / F85: the queue moves next to the expanded Library (header fits, no overlap), the condensed player's cover loads and
// retries, and its second row is the visualizer (no Transparency chip). Env SHOTS=dir saves screenshots.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = process.env.SHOTS;
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const overlaps = rs => rs.some((a, i) => rs.some((b, j) => j > i && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5));
const THEMES = { ember: { accent: '#FF5A1F', accent2: '#FFB347', hl: '#4FC3F7', bg: '#160E0A', ink: '#E8EDF0' }, arctic: { accent: '#3BA7FF', accent2: '#A8E6FF', hl: '#6EF7B2', bg: '#0B1218', ink: '#E8EDF0' } };
const br = await chromium.launch();
for (const [theme, np, sc, w, h, dpr] of [['ember', 'classic', '100', 1920, 1080, 1], ['ember', 'center', '200', 960, 540, 2], ['arctic', 'stack', '100', 1920, 1080, 1], ['arctic', 'horizon', '200', 960, 540, 2], ['arctic', 'center', '100', 1920, 1080, 1]]) {
  const T = `${theme}/${np}/${sc}`;
  const c = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([s, t, t2, np]) => { if (sessionStorage.f83) return; sessionStorage.f83 = 1; localStorage.clear(); for (const [k, v] of [['wavwiz.whatsnew', '9.9.9'], ['wavwiz.gettingStarted.shown', '1'], ['wavwiz.webRoom.autojoin', '0'], ['wavwiz.layout', 'full'], ['wavwiz.uiscale', s], ['wavwiz.npstyle.v1', JSON.stringify({ style: np })], ['wavwiz.theme.v1', JSON.stringify({ preset: t, ...t2 })],
    ['wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'collapsed', ctl: 'collapsed', ctlSet: true })]]) localStorage.setItem(k, v); }, [sc, theme, THEMES[theme], np]);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(1500);
  await p.evaluate(async () => { const J = { 'content-type': 'application/json' }; const gs = await (await fetch('/api/v1/groups')).json();
    for (const zq of ['', ...new Set(gs.map(g => '?zoneId=' + encodeURIComponent(g.playbackId || 'default')))]) { const q = await (await fetch('/api/v1/queue' + zq)).json(); if (!(q.items || q).length) await fetch('/api/v1/queue/add' + zq, { method: 'POST', headers: J, body: JSON.stringify({ kind: 'tracks', ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }) }); await fetch('/api/v1/stream/jump' + zq, { method: 'POST', headers: J, body: JSON.stringify({ index: 0 }) }); } });
  await p.reload(); await p.waitForTimeout(2500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(e => e.close()));
  const desk = () => p.evaluate(() => document.querySelector('.desk').className);
  ok(/listcollapsed/.test(await desk()), T + ' queue starts collapsed');
  await p.click('.libpanel .libexp'); await p.waitForTimeout(1200);
  const st = await p.evaluate(() => { const lp = document.querySelector('.listpanel'), hd = lp.querySelector('.pane-h'), vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const box = e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }, hr = box(hd);
    const items = [...hd.querySelectorAll('.qzpick,.tpin,.qsend,.plmeta,.plbtns button,.listcolwrap button')].filter(vis);
    const tog = [...hd.querySelectorAll('.listcolwrap button')].filter(vis);
    return { desk: document.querySelector('.desk').className, rows: lp.querySelectorAll('tbody tr').length, rects: items.map(box), inside: items.every(e => { const b = box(e); return b.l >= hr.l - 0.5 && b.r <= hr.r + 0.5; }),
      names: items.map(e => e.className.split(' ').pop()), upnext: !!hd.querySelector('.plnext') && vis(hd.querySelector('.plnext')), tog: tog.map(b => b.getAttribute('aria-label')) }; });
  ok(!/listcollapsed/.test(st.desk) && /libexpanded/.test(st.desk), T + ' queue opens beside the expanded Library');
  ok(st.rows >= 10, T + ' queue rows show (' + st.rows + ')');
  ok(!st.upnext, T + ' no Up next chip in the narrow header');
  ok(['qzpick', 'tpin', 'qsend', 'plmeta'].every(n => st.names.includes(n)), T + ' zone picker, pin, Copy and count visible ' + st.names.join(','));
  ok(!overlaps(st.rects) && st.inside, T + ' header controls do not overlap and fit');
  ok(st.tog.length === 1, T + ' one show / hide control: ' + st.tog.join('|'));
  // F84 / F85: condensed player
  const mp = await p.evaluate(() => { const m = document.querySelector('.minicol .mp'), v = m.querySelector('.mp-npl'), a = m.querySelector('.mp-art'), box = e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
    return { op: [...m.querySelectorAll('.mp-opbtn,.mp-oprow')].filter(e => e.getClientRects().length).length, viz: !!m.querySelector('.mp-viz,canvas'), cls: v?.className || '', vh: v ? v.getBoundingClientRect().height : 0,
      kids: v ? [...v.children].filter(e => e.getClientRects().length).map(box) : [], rv: v && box(v), rc: box(m.querySelector('.mp-ctl')), rt: box(m.querySelector('.mp-txt')), rs: box(m.querySelector('.mp-sc')), mix: !!m.querySelector('.mp-tr .mp-mix'), art: a.currentSrc, noart: a.classList.contains('noart'), nw: a.naturalWidth }; });
  ok(mp.op === 0, T + ' no Transparency chip in the condensed player');
  ok(mp.mix, T + ' mixer button sits in the transport row');
  ok(!mp.viz, T + ' no visualizer in the condensed player');
  ok(mp.cls.includes('npl-' + np) && mp.vh >= 20, T + ' selected Now Playing layout shows (' + mp.cls + ', ' + Math.round(mp.vh) + ' px)');
  ok(mp.rv && ![mp.rc, mp.rt, mp.rs].some(r => overlaps([mp.rv, r])) && !overlaps(mp.kids) && mp.kids.every(k => k.l >= mp.rv.l - 0.5 && k.r <= mp.rv.r + 0.5), T + ' layout row fits without crowding the controls or the icon row');
  ok(/\/art\//.test(mp.art) && !mp.noart && mp.nw > 0, T + ' cover loaded in the condensed player');
  if (SH) { await p.screenshot({ path: `${SH}/f85-${theme}-${np}-${sc}-full.png` }); await p.locator('.minicol').screenshot({ path: `${SH}/f85-${theme}-${np}-${sc}-bar.png` }); }
  if (theme === 'ember' && np === 'classic') {
    // F84: a 204 (cover still being looked up) is retried when the server says art arrived, and the cover follows a track change
    let n = 0; await p.route(/\/art\/track\/2\?/, r => (n++ ? r.continue() : r.fulfill({ status: 204, body: '' })));
    await p.click('.minicol .mp-b.next');
    await p.waitForFunction(() => /track\/2\?/.test(document.querySelector('.minicol .mp-art').getAttribute('src') || '') || document.querySelector('.minicol .mp-art').classList.contains('noart'), null, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(800);
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('wavwiz:art', { detail: { kind: 'album' } })));
    const got = await p.waitForFunction(() => { const a = document.querySelector('.minicol .mp-art'); return /track\/2\?/.test(a.currentSrc) && !a.classList.contains('noart') && a.naturalWidth > 0; }, null, { timeout: 8000 }).then(() => true, () => false);
    ok(got && n >= 2, 'cover changes with the track and a late cover is picked up (requests ' + n + ')');
    await p.click('.minicol .mp-b.prev'); await p.waitForTimeout(600);
  }
  await p.click('.libpanel .libexp'); await p.waitForTimeout(1000);
  ok(/listcollapsed/.test(await desk()), T + ' collapsing the Library restores the collapsed queue');
  await c.close();
}
await br.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
