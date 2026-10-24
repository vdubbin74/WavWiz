import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim();
mkdirSync('/workspace/screens', { recursive: true });
const br = await chromium.launch();
async function run(scale) {
  const ctx = await br.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(() => {
    localStorage.setItem('wavwiz.whatsnew', '9.9.9');
    localStorage.setItem('wavwiz.gettingStarted.shown', '1');
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'rail', exp: 'lib', list: 'open', ctl: 'collapsed' }));
  });
  const p = await ctx.newPage();
  await p.goto(B + '/'); await p.waitForTimeout(2800);
  await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
  // Force expand if needed
  await p.evaluate(async () => {
    const { S } = await import('/js/main.js');
    const desk = document.querySelector('.desk');
    if (!desk.classList.contains('libexpanded')) {
      document.querySelector('.libpanel .pexp')?.click() || document.querySelector('[aria-label*=Expand]')?.click();
    }
  });
  await p.waitForTimeout(1000);
  // Open albums/songs so we have draggable tracks
  await p.evaluate(async () => {
    const tabs = [...document.querySelectorAll('.libpanel button, .libpanel .tab, .libtabs button')];
    const songs = tabs.find(t => /song|track|album/i.test(t.textContent || ''));
    songs?.click();
  });
  await p.waitForTimeout(800);
  const layout = await p.evaluate(() => {
    const desk = document.querySelector('.desk');
    const list = document.querySelector('.listpanel');
    const cs = list && getComputedStyle(list);
    const lr = list?.getBoundingClientRect();
    return {
      libexpanded: desk?.classList.contains('libexpanded'),
      libdev: desk?.classList.contains('libdev'),
      list: lr && { w: Math.round(lr.width), h: Math.round(lr.height), x: Math.round(lr.x), display: cs.display, vis: cs.visibility, pe: cs.pointerEvents },
      dragItems: document.querySelectorAll('.libpanel [draggable=true]').length,
      qrows: document.querySelectorAll('.listpanel tr[data-i]').length,
      qmeta: document.querySelector('.listpanel .pane-h')?.innerText?.slice(0, 80),
    };
  });
  console.log('scale', scale, JSON.stringify(layout));
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F8-before-${scale === 1 ? '100' : '200'}.png` });

  const q0 = await p.evaluate(async () => { const j = await (await fetch('/api/v1/queue')).json(); return (j.items || j.queue || j).length; });
  const src = p.locator('.libpanel [draggable=true]').first();
  const dst = p.locator('.listpanel .qwrap');
  await src.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  const sb = await src.boundingBox(); const db = await dst.boundingBox();
  console.log('boxes', sb, db);
  let during = null;
  if (sb && db && db.width > 80) {
    await p.mouse.move(sb.x + 20, sb.y + 10);
    await p.mouse.down();
    await p.mouse.move(db.x + db.width / 2, db.y + 60, { steps: 25 });
    await p.waitForTimeout(300);
    during = await p.evaluate(() => ({
      insHidden: document.querySelector('.qins')?.hidden,
      label: document.querySelector('.qins')?.dataset?.label,
      typesOk: true,
    }));
    console.log('during', during);
    await p.mouse.up();
    await p.waitForTimeout(1500);
  } else {
    // Fallback: HTML5 drag via dispatch
    during = await p.evaluate(() => {
      const el = document.querySelector('.libpanel [draggable=true]');
      const wrap = document.querySelector('.listpanel .qwrap');
      if (!el || !wrap) return { err: 'missing', el: !!el, wrap: !!wrap };
      const dt = new DataTransfer();
      const mime = 'application/x-wavwiz-ref';
      // read ref from a synthetic dragstart
      el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const raw = dt.getData(mime);
      wrap.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: wrap.getBoundingClientRect().left + 40, clientY: wrap.getBoundingClientRect().top + 40 }));
      wrap.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: wrap.getBoundingClientRect().left + 40, clientY: wrap.getBoundingClientRect().top + 40 }));
      el.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return { raw: raw?.slice(0, 80), ins: document.querySelector('.qins')?.dataset?.label, types: [...dt.types] };
    });
    console.log('synthetic', during);
    await p.waitForTimeout(1500);
  }
  const q1 = await p.evaluate(async () => {
    const j = await (await fetch('/api/v1/queue')).json();
    return { n: (j.items || j.queue || j).length, toast: document.querySelector('.toast')?.textContent || '' };
  });
  console.log('queue', q0, '->', q1);
  await ctx.close();
  return { layout, during, q0, q1 };
}
const r1 = await run(1);
const r2 = await run(2);
await br.close();
console.log('VERDICT', r1.q1.n > r1.q0 ? 'DRAG WORKED' : 'DRAG FAILED', r1.q0, r1.q1);
