import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim();
const b = await chromium.launch({headless:true});
const ctx = await b.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
await ctx.addCookies([{name:'unison_session', value:sess, url:B}]);
await ctx.addInitScript(() => {
  localStorage.setItem('wavwiz.whatsnew', '9.9.9');
  localStorage.setItem('wavwiz.gettingStarted.shown', '1');
  localStorage.setItem('wavwiz.panels', JSON.stringify({lib:'rail',dev:'expanded',exp:'dev',list:'normal',ctl:'normal'}));
  localStorage.setItem('wavwiz.uiscale', 'compact');
});
const p = await ctx.newPage();
await p.goto(B + '/'); await p.waitForTimeout(2600);
await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
await p.waitForTimeout(400);
const info = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll('.dvol-master, .dvol-master input[type=range], .dc3l3 .vbar, .dc3l3 .vbar input, .spk-range, .zsh-vol input, .np-volrow input, .mp-vol input, .qb42-vol .vbar').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const cs = getComputedStyle(el);
    out.push({
      tag: el.tagName, cls: String(el.className).slice(0,60), aria: el.getAttribute('aria-label'),
      w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x),
      flex: cs.flex, minW: cs.minWidth, width: cs.width,
      parent: String(el.parentElement?.className||'').slice(0,50),
      parentW: Math.round(el.parentElement?.getBoundingClientRect().width||0)
    });
  });
  const chip = document.querySelector('.dvol-master .zs-master');
  if (chip) {
    const r = chip.getBoundingClientRect();
    out.push({tag:'CHIP', cls: chip.className, w: Math.round(r.width), h: Math.round(r.height),
      flex: getComputedStyle(chip).flex, maxW: getComputedStyle(chip).maxWidth, text: chip.textContent?.trim()});
  }
  return {title: document.title, hasDesk: !!document.querySelector('.desk'), master: !!document.querySelector('.dmaster'), sliders: out};
});
console.log(JSON.stringify(info, null, 2));
await b.close();
