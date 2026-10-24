import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim();
const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
await ctx.addInitScript(() => {
  localStorage.setItem('wavwiz.whatsnew', '9.9.9');
  localStorage.setItem('wavwiz.gettingStarted.shown', '1');
  localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' }));
  localStorage.setItem('wavwiz.uiscale', 'compact');
});
const p = await ctx.newPage();
await p.goto(B + '/'); await p.waitForTimeout(2800);
await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));

// instrument dragover accepts
await p.evaluate(() => {
  window.__dnd = { overs: 0, types: [], accepted: 0, drops: 0 };
  const wrap = document.querySelector('.listpanel .qwrap');
  wrap?.addEventListener('dragover', ev => {
    window.__dnd.overs++;
    window.__dnd.types = [...(ev.dataTransfer?.types || [])];
  }, true);
  wrap?.addEventListener('drop', () => { window.__dnd.drops++; }, true);
});

const before = await p.evaluate(() => document.querySelectorAll('.listpanel tr[data-i]').length);
const src = p.locator('.libpanel [draggable=true]').first();
const dst = p.locator('.listpanel .qwrap');
const sb = await src.boundingBox();
const db = await dst.boundingBox();
console.log('boxes', sb, db, 'before', before);

// Playwright dragTo
await src.dragTo(dst, { force: true });
await p.waitForTimeout(1500);
const after = await p.evaluate(() => ({
  rows: document.querySelectorAll('.listpanel tr[data-i]').length,
  dnd: window.__dnd,
  toast: document.querySelector('.toast')?.textContent
}));
console.log('dragTo', after);

// manual mouse HTML5-ish via dispatch with real DataTransfer is what synthetic does
// try Playwright's locator.dragTo with steps
await p.screenshot({ path: '/workspace/screens/wavwiz-044-F8-native-100.png' });
await br.close();
