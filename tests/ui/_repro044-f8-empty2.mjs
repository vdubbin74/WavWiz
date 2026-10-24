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
await p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));

const r = await p.evaluate(async () => {
  const clear = await fetch('/api/v1/queue/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const q0 = await (await fetch('/api/v1/queue')).json();
  const wrap = document.querySelector('.listpanel .qwrap');
  const el = document.querySelector('.libpanel [draggable=true]');
  const dt = new DataTransfer();
  el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const mime = 'application/x-wavwiz-ref';
  const raw = dt.getData(mime);
  const types = [...dt.types];
  wrap.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 1600, clientY: 400 }));
  let dropErr = null;
  try {
    wrap.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 1600, clientY: 400 }));
  } catch (e) { dropErr = String(e); }
  await new Promise(r => setTimeout(r, 1200));
  const q1 = await (await fetch('/api/v1/queue')).json();
  const stream = await (await fetch('/api/v1/stream')).json();
  return {
    clear: clear.status, q0n: q0.items?.length, raw, types,
    q1n: q1.items?.length, streamQn: stream.queue?.items?.length, zoneId: stream.zoneId,
    toast: document.querySelector('.toast')?.textContent, dropErr,
    desk: document.querySelector('.desk')?.className
  };
});
console.log(JSON.stringify(r, null, 2));
await br.close();
