import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim();
const br = await chromium.launch();
for (const [sc, w, h] of [['small', 1152, 648], ['small', 1024, 600], ['normal', 1152, 648], ['normal', 960, 540], ['normal', 1920, 1080], ['normal', 1280, 720]]) {
  const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 }); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(sc => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.uiscale', sc); localStorage.setItem('wavwiz.pins.v1', JSON.stringify(['eq', 'queue', 'library', 'devices', 'scenes'])); localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); }, sc);
  const p = await ctx.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2200);
  console.log(sc, w, JSON.stringify(await p.evaluate(() => { const s = document.querySelector('.np-ctlpanel.collapsed .np-strip'); const r = q => { const e = document.querySelector('.np-ctlpanel.collapsed ' + q); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; }; return { over: s && s.scrollWidth - s.clientWidth, strip: r('.np-strip'), chip: r('.zs-panel'), song: r('.ns-song'), vol: r('.ns-vol'), xx: r('.ns-xx'), scrow: r('.scrow') }; })));
  await ctx.close();
}
await br.close();
