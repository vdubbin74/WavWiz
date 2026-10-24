import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim();
const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
await ctx.addInitScript(() => {
  localStorage.setItem('wavwiz.whatsnew', '9.9.9');
  localStorage.setItem('wavwiz.gettingStarted.shown', '1');
  localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'rail', exp: 'lib', list: 'open', ctl: 'collapsed' }));
});
const p = await ctx.newPage();
await p.goto(B + '/'); await p.waitForTimeout(2500);
await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
// clear queue via API
const q = await p.evaluate(async () => {
  await fetch('/api/v1/queue/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return (await (await fetch('/api/v1/queue')).json());
});
console.log('cleared', q);
await p.waitForTimeout(1000);
const r = await p.evaluate(async () => {
  const wrap = document.querySelector('.listpanel .qwrap');
  const el = document.querySelector('.libpanel [draggable=true]');
  if (!el || !wrap) return { err: 'missing', listVis: getComputedStyle(document.querySelector('.listpanel')).display };
  const before = (await (await fetch('/api/v1/queue')).json()).items?.length ?? 0;
  const dt = new DataTransfer();
  el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const mime = 'application/x-wavwiz-ref';
  wrap.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 900, clientY: 400 }));
  wrap.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 900, clientY: 400 }));
  await new Promise(r => setTimeout(r, 800));
  const after = (await (await fetch('/api/v1/queue')).json()).items?.length ?? 0;
  return { before, after, toast: document.querySelector('.toast')?.textContent, listVis: getComputedStyle(document.querySelector('.listpanel')).display, listW: document.querySelector('.listpanel').getBoundingClientRect().width };
});
console.log(r);
await p.screenshot({ path: '/workspace/screens/wavwiz-044-F8-before-libexp-empty-100.png' });
await br.close();
