// 0.4.8 F60: the header is now "Queue: [zone ▾]" (the zone named only in the picker); the pin counts as a control Up next must clear.
// 0.4.8 F50: collapsed Queue header - "Up next" and the zone label ("Editing: <zone>", QUEUE · <zone>) never overlap at 67 / 100 / 200 %,
// with a short and a 40+ character zone name; a long name ellipsizes with a title tooltip. SHOTS=1 TAG=before|after -> /workspace/screens/050/.
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS, D = '/workspace/screens/050/' + (process.env.TAG || 'after'); let pass = 0, fail = 0; if (SH) mkdirSync(D, { recursive: true });
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const br = await chromium.launch();
for (const [vw, vh, d, sc, zt] of [[1920, 1080, 1, 'tiny', '67'], [1920, 1080, 1, 'compact', '100'], [960, 540, 2, 'compact', '200']]) for (const [nm, name] of [['short', 'Whole-Home'], ['long', 'Whole-Home Upstairs and Downstairs Living Areas']]) for (const st of ['collapsed', 'open', 'expanded']) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([sc, st]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.setItem('wavwiz.uiscale', sc); localStorage.setItem('wavwiz.layout', 'full');
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: st, ctl: 'collapsed' })); }, [sc, st]);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2800); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  await p.evaluate(n => { const put = () => { const s = document.querySelector('.listpanel .qtitle select'); if (s?.selectedOptions[0] && !s.selectedOptions[0].textContent.startsWith(n)) { s.selectedOptions[0].textContent = n; s.title = n + ' - Show and edit any zone\'s queue'; }
    };
    put(); new MutationObserver(put).observe(document.querySelector('.listpanel .pane-h'), { subtree: true, childList: true, characterData: true }); window.dispatchEvent(new Event('resize')); }, name);
  await p.waitForTimeout(700);
  const r = await p.evaluate(() => { const vis = e => !!e && !e.hidden && e.offsetParent !== null && e.getBoundingClientRect().width > 0, R = e => { const b = e.getBoundingClientRect(); return [b.left, b.right, b.top, b.bottom].map(Math.round); };
    const nb = document.querySelector('.listpanel .plnext'), zw = document.querySelector('.listpanel .qzwrap'), sel = document.querySelector('.listpanel .qtitle select'), ttl = document.querySelector('.listpanel .pane-h > .grow.ell');
    const others = [...document.querySelectorAll('.listpanel .pane-h > .qzwrap, .listpanel .pane-h > .tpin, .listpanel .pane-h > .plmeta, .listpanel .pane-h > .plicons, .listpanel .pane-h > .listcolwrap')].filter(vis).map(e => [e.className, R(e)]);
    const tr = (() => { if (!ttl) return null; const g = document.createRange(); g.selectNodeContents(ttl); const a = g.getBoundingClientRect(), b = ttl.getBoundingClientRect(); return [b.left, Math.min(a.right, b.right), b.top, b.bottom].map(Math.round); })();
    const hd = document.querySelector('.listpanel .pane-h'), pills = [...document.querySelectorAll('.listpanel tr .qnextpill')].filter(x => x.getClientRects().length), wr = document.querySelector('.listpanel .qwrap')?.getBoundingClientRect(), pr = pills[0]?.getBoundingClientRect(); const lbl = ttl?.querySelector('.qlbl'), qz = ttl?.querySelector('.qzone'); return { hScroll: hd.scrollWidth - hd.clientWidth, nbText: nb?.textContent.replace(/\s+/g, ' ').trim(), cur: window.__ww?.S?.now?.index ?? (document.querySelector('.listpanel tr.cur') ? +document.querySelector('.listpanel tr.cur').dataset.i : (pills[0] ? +pills[0].closest('tr').dataset.i - 1 : -1)), pills: pills.map(x => x.closest('tr').dataset.i), pillVis: !!(pr && wr && pr.top >= wr.top - 1 && pr.bottom <= wr.bottom + 1), nb: vis(nb) ? R(nb) : null, others, tr, text: ttl?.querySelector('.qlbl')?.textContent, qzVis: vis(ttl?.querySelector('.qzone')), selOpt: sel?.selectedOptions[0]?.textContent || '', lblClip: lbl ? lbl.scrollWidth > lbl.clientWidth + 1 || lbl.getBoundingClientRect().left < ttl.getBoundingClientRect().left - 1 : true, qzClip: qz ? qz.scrollWidth > qz.clientWidth + 1 : false, ttlTitle: ttl?.title, selClip: sel ? sel.scrollWidth > sel.clientWidth + 1 : false, selTitle: sel?.title || '', selW: sel ? Math.round(sel.getBoundingClientRect().width) : 0 }; });
  const t = `[${zt} ${st} ${nm}]`, ov = (a, b) => a && b && a[0] < b[1] - 1 && b[0] < a[1] - 1;
  ok(`${t} F60 header reads "Queue: [<zone> ▾]", the zone named only in the picker`, r.text === 'Queue:' && !r.qzVis && r.selOpt.startsWith(name) && r.selW > 40, JSON.stringify([r.text, r.qzVis, r.selOpt, r.selW]));
  ok(`${t} no side scrolling in the header`, r.hScroll <= 1, String(r.hScroll));
  if (st === 'collapsed' && r.nb) ok(`${t} the line reads "UP NEXT <song> · <artist>"`, /^UP NEXT/.test(r.nbText), r.nbText);
  if (st === 'open') ok(`${t} standard: no header banner, the next row carries the UP NEXT pill`, !r.nb && r.pills.length === 1 && r.pillVis, JSON.stringify({ nb: r.nb, p: r.pills, v: r.pillVis }));
  if (st === 'expanded') ok(`${t} wide: "Up next: song · artist" in the header XOR the row pill`, r.nb ? r.pills.length === 0 && /^UP NEXT/.test(r.nbText) : r.pills.length === 1, JSON.stringify({ nb: r.nb, p: r.pills, txt: r.nbText }));
  if (st === 'expanded' && zt === '100' && nm === 'short') ok(`${t} wide at 100 %: the header line is shown`, !!r.nb, JSON.stringify(r.nb));
  ok(`${t} the UP NEXT label is fully visible (no clip at its left)`, !r.lblClip, JSON.stringify(r));
  ok(`${t} the zone name clips only when long (ellipsis + tooltip)`, nm === 'long' ? (!r.selClip || /Whole-Home Upstairs/i.test(r.selTitle)) : true, JSON.stringify(r));
  if (st === 'collapsed') ok(`${t} the Up next banner is shown (200 %: hidden when the gap before the pin is too small - F60/F50)`, zt === '200' || !!r.nb, JSON.stringify(r));
  for (const [cl, b] of r.others) ok(`${t} Up next does not overlap ${cl}`, !ov(r.nb, b), JSON.stringify({ nb: r.nb, b }));
  ok(`${t} Up next does not overlap the Queue: label + picker`, !ov(r.nb, r.tr), JSON.stringify({ nb: r.nb, tr: r.tr }));
  if (nm === 'long' && r.selClip) ok(`${t} the clipped zone picker has a title tooltip`, /Whole-Home Upstairs/.test(r.selTitle), JSON.stringify(r));
  if (SH) await p.locator('.listpanel .pane-h').screenshot({ path: `${D}/F50-${zt}-${st}-${nm}.png` });
  await c.close(); }
await br.close(); console.log(`f50upnext: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
