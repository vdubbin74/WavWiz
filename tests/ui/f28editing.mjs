// 0.4.5 F28: the Queue panel's "Editing:" picker switches the shown queue at once (title, rows, Copy source) without touching Controlling.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const br = await chromium.launch();
for (const d of [1, 2]) {
  const c = await br.newContext({ viewport: { width: 1920 / d, height: 1080 / d }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); localStorage.removeItem('wavwiz.zone.v1'); });
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(3000); const t = `[dpr ${d}]`;
  const zs = await p.evaluate(async () => { const m = await import('/js/zones40.js'); return m.choicesNow().map(x => ({ k: x.key, n: x.name, z: m.zoneIdFor(x) || 'default' })); });
  const ctl0 = await p.evaluate(async () => (await import('/js/zones40.js')).current()?.key);
  const titles = async zid => (await p.evaluate(async z => (await (await fetch('/api/v1/stream?zoneId=' + encodeURIComponent(z))).json()).queue.items.map(i => i.title), zid));
  const shown = () => p.evaluate(() => [...document.querySelectorAll('.listpanel tbody tr')].map(r => r.querySelector('td.title, .title')?.textContent || r.innerText));
  for (const z of zs.filter(x => x.k !== ctl0)) {
    await p.selectOption('.qzpick', z.k); await p.waitForTimeout(1500);
    const want = await titles(z.z), got = await shown(), title = await p.locator('.listpanel .qzone').innerText();
    ok(`${t} ${z.n}: title names the Editing zone`, title.toUpperCase().includes(z.n.toUpperCase()) || /FROM /.test(title.toUpperCase()), title);   // a linked zone is titled by the zone it plays from (0.4.1)
    ok(`${t} ${z.n}: rows are that zone's queue`, want.length ? want.every(w => got.some(g => g.includes(w))) : got.every(g => /queue is empty/i.test(g)), JSON.stringify([want, got]));
    ok(`${t} ${z.n}: Controlling unchanged`, await p.evaluate(async () => (await import('/js/zones40.js')).current()?.key) === ctl0);
    ok(`${t} ${z.n}: panel keyed on editing zone`, await p.locator('.listpanel').getAttribute('data-editing') === z.k);
  }
  // race: two quick changes - the last one wins
  const o = zs.filter(x => x.k !== ctl0); if (o.length >= 2) { await p.selectOption('.qzpick', o[0].k); await p.selectOption('.qzpick', o[o.length - 1].k); await p.waitForTimeout(1800);
    const want = await titles(o[o.length - 1].z), got = await shown(); ok(`${t} quick switch shows the last zone`, want.length ? want.every(w => got.some(g => g.includes(w))) : got.every(g => /empty/i.test(g)), JSON.stringify([want, got])); }
  // copy source = editing zone
  await p.selectOption('.qzpick', o[0].k); await p.waitForTimeout(800); await p.locator('.qsend').click(); await p.waitForTimeout(400);
  const opts = await p.evaluate(() => [...document.querySelectorAll('dialog[open] select option')].map(x => x.value)); ok(`${t} Copy queue offers every zone but the Editing one`, !opts.includes(o[0].k) && opts.includes(ctl0), JSON.stringify(opts));
  await p.keyboard.press('Escape'); await c.close();
}
await br.close(); console.log(`f28editing: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
