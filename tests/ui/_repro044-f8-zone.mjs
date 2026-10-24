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
const posts = [];
p.on('request', req => { if (req.method() === 'POST' && /queue\/add/.test(req.url())) posts.push(req.url()); });
await p.goto(B + '/'); await p.waitForTimeout(2800);
await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));

const info = await p.evaluate(async () => {
  const u = await import('/js/util.js');
  const Z = await import('/js/zones40.js');
  const cur = Z.current();
  // clear controlling zone queue
  await u.api('/queue/clear', { method: 'POST', body: {} });
  const q0 = await u.api('/queue');
  const wrap = document.querySelector('.listpanel .qwrap');
  const el = document.querySelector('.libpanel [draggable=true]');
  const dt = new DataTransfer();
  el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  wrap.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 1600, clientY: 400 }));
  wrap.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 1600, clientY: 400 }));
  await new Promise(r => setTimeout(r, 1000));
  const q1 = await u.api('/queue');
  const defQ = await fetch('/api/v1/queue').then(r => r.json()); // no zone via raw
  return {
    apiZone: u.getApiZone(),
    cur,
    zoneIdFor: Z.zoneIdFor(cur),
    q0: q0.items?.length,
    q1: q1.items?.length,
    defQn: defQ.items?.length,
    toast: document.querySelector('.toast')?.textContent,
    sQueue: window.__S?.queue?.length // maybe not exposed
  };
});
console.log(JSON.stringify({ info, posts }, null, 2));
await br.close();
