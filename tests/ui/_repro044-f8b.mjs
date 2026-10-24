import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim();
mkdirSync('/workspace/screens', { recursive: true });
const br = await chromium.launch();
async function tryLayout(label, panels, { tv = false } = {}) {
  const ctx = await br.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(([pn, tv]) => {
    localStorage.setItem('wavwiz.whatsnew', '9.9.9');
    localStorage.setItem('wavwiz.gettingStarted.shown', '1');
    localStorage.setItem('wavwiz.panels', JSON.stringify(pn));
    if (tv) document.documentElement.classList.add('tv');
  }, [panels, tv]);
  const p = await ctx.newPage();
  if (tv) await p.addInitScript(() => { document.documentElement.classList.add('tv'); });
  await p.goto(B + '/'); await p.waitForTimeout(2500);
  await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
  if (tv) await p.evaluate(() => document.documentElement.classList.add('tv'));
  await p.waitForTimeout(500);
  const info = await p.evaluate(() => {
    const list = document.querySelector('.listpanel');
    const cs = list && getComputedStyle(list);
    return {
      tv: document.documentElement.classList.contains('tv'),
      libexpanded: document.querySelector('.desk')?.classList.contains('libexpanded'),
      listDisplay: cs?.display, listPe: cs?.pointerEvents, listW: list && Math.round(list.getBoundingClientRect().width),
      dragItems: document.querySelectorAll('.libpanel [draggable=true]').length,
      qrows: document.querySelectorAll('.listpanel tr[data-i]').length,
    };
  });
  const q0 = await p.evaluate(async () => { const j = await (await fetch('/api/v1/queue')).json(); return (j.items || j.queue || j).length; });
  const src = p.locator('.libpanel [draggable=true]').first();
  const dst = p.locator('.listpanel .qwrap');
  const sb = await src.boundingBox().catch(() => null);
  const db = await dst.boundingBox().catch(() => null);
  let result = 'no-boxes';
  if (sb && db && db.width > 40 && db.height > 40) {
    await p.mouse.move(sb.x + 15, sb.y + 12);
    await p.mouse.down();
    await p.mouse.move(db.x + db.width / 2, db.y + Math.min(80, db.height / 2), { steps: 20 });
    const mid = await p.evaluate(() => document.querySelector('.qins')?.dataset?.label || (document.querySelector('.qins')?.hidden === false ? 'ins' : 'no-ins'));
    await p.mouse.up();
    await p.waitForTimeout(1200);
    const q1 = await p.evaluate(async () => {
      const j = await (await fetch('/api/v1/queue')).json();
      return { n: (j.items || j.queue || j).length, toast: document.querySelector('.toast')?.textContent || '', qrows: document.querySelectorAll('.listpanel tr[data-i]').length };
    });
    result = { mid, q0, q1 };
  } else result = { err: 'no-boxes', sb, db };
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F8-before-${label}.png` });
  console.log(label, JSON.stringify({ info, result }));
  await ctx.close();
}
await tryLayout('normal-100', { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' });
await tryLayout('libexp-100', { lib: 'normal', dev: 'rail', exp: 'lib', list: 'open', ctl: 'collapsed' });
await tryLayout('tv-100', { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' }, { tv: true });
await br.close();
