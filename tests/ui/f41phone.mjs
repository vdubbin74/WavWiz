// 0.4.6 F41: iPhone (WebKit 390x844, Safari and home-screen PWA = display-mode standalone): reorder a speaker, open a speaker, Close (Done / Back) ->
// the Devices tree is back, scrolled where it was, and no Devices view is wider than the screen. SHOTS=1 TAG=before|after -> /workspace/screens/wavwiz-046-F41-*.
import { webkit } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS, TAG = process.env.TAG || 'after'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const br = await webkit.launch();
for (const mode of ['safari', 'standalone']) for (const how of ['done', 'back', 'zone']) {
  const c = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([mode]) => { if (mode === 'standalone') { Object.defineProperty(navigator, 'standalone', { get: () => true }); const mm = window.matchMedia.bind(window);
      window.matchMedia = q => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : mm(q); }
    if (sessionStorage.getItem('f41')) return; sessionStorage.setItem('f41', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); }, [mode]);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(3000);
  await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
  await p.evaluate(() => [...document.querySelectorAll('button')].filter(e => e.offsetParent && /Devices$/.test(e.textContent.trim())).pop()?.click()); await p.waitForTimeout(1200);
  const tg = `[${mode} ${how}]`;
  // reorder a speaker inside its zone (grip drag)
  const g = p.locator('#p-zones .sp42 .dgrip42').first();
  if (await g.count()) { const b = await g.boundingBox(); if (b) { await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width / 2, b.y + 20, { steps: 4 }); await p.mouse.move(b.x + b.width / 2, b.y + 50, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(900); } }
  // scroll the tree a little, remember where
  const before = await p.evaluate(() => { const sc = (() => { for (let e = document.querySelector('#p-zones').parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowY; if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e; } return document.scrollingElement; })(); sc.scrollTop = 220; return sc.scrollTop; });
  const name = how === 'zone' ? p.locator('#p-zones .tree42 .zcard42 .zname:visible').first() : p.locator('#p-zones .tree42 .sp42:not(.un) .sp42-n:visible').nth(1);
  await name.tap(); await p.waitForTimeout(900);
  const open = await p.evaluate(() => (document.querySelector('#p-zones .pd42-wrap')?.getBoundingClientRect().height > 0) && !!document.querySelector('#p-zones .pd42 > *'));
  ok(`${tg} tapping a ${how === 'zone' ? 'zone' : 'speaker'} opens its settings sheet`, open);
  if (how === 'zone') { const z = await p.evaluate(() => { const d = document.querySelector('#p-zones .pd42'); const t = d?.textContent || ''; const r = document.querySelector('#p-zones .pd42-wrap')?.getBoundingClientRect(); return { rename: /Rename/.test(t), link: /Link to/.test(t), w: r && Math.round(r.width), done: !!document.querySelector('[data-act=pd-done]')?.offsetParent, over: [...d.querySelectorAll('*')].filter(e => e.offsetParent && e.getBoundingClientRect().right > innerWidth + 1).map(e => e.className).slice(0, 4) }; });
    ok(`${tg} zone sheet: full width, Rename + Link to reachable, Done shown, nothing past the right edge`, z.w >= 388 && z.rename && z.done && z.over.length === 0, JSON.stringify(z)); }
  const ow = await p.evaluate(() => { const r = document.querySelector('#p-zones'); return { sw: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth, rw: r.scrollWidth, rc: r.clientWidth }; });
  ok(`${tg} speaker settings never wider than the screen`, ow.sw <= ow.cw && ow.rw <= ow.rc + 1, JSON.stringify(ow));
  if (SH && how !== 'back') await p.screenshot({ path: `/workspace/screens/wavwiz-046-F41-${TAG}-${mode}-1-${how === 'zone' ? 'zonesheet' : 'speakersheet'}.png` });
  const closer = p.locator(how === 'done' ? '#p-zones [data-act=spk-done]:visible' : how === 'zone' ? '#p-zones [data-act=pd-done]:visible, #p-zones [data-act=pd-close]:visible' : '#p-zones [data-act=pd-close]:visible').first();
  if (await closer.count()) await closer.tap(); else ok(`${tg} a Back / Done control is reachable`, false);
  await p.waitForTimeout(1000);
  const r = await p.evaluate(() => { const t = document.querySelector('#p-zones .tree42'), d = document.querySelector('#p-zones .pd42-wrap'), se = document.scrollingElement;
    const sc = (() => { for (let e = document.querySelector('#p-zones').parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowY; if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e; } return se; })();
    const vis = e => !!e && e.isConnected && e.getBoundingClientRect().height > 0;
    return { tree: vis(t), detail: vis(d), top: sc.scrollTop, sw: se.scrollWidth, cw: se.clientWidth, rw: document.querySelector('#p-zones').scrollWidth, rc: document.querySelector('#p-zones').clientWidth }; });
  ok(`${tg} Close returns to the Devices tree (no zone detail left)`, r.tree && !r.detail, JSON.stringify(r));
  ok(`${tg} the tree's scroll position is restored`, Math.abs(r.top - before) <= 4, `before ${before} ${JSON.stringify(r)}`);
  ok(`${tg} scrollWidth <= clientWidth on the Devices tree`, r.sw <= r.cw && r.rw <= r.rc + 1, JSON.stringify(r));
  if (SH && how !== 'back') await p.screenshot({ path: `/workspace/screens/wavwiz-046-F41-${TAG}-${mode}-2-tree-after-${how === 'zone' ? 'zone' : 'speaker'}.png` });
  await c.close(); }
await br.close(); console.log(`f41phone: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
