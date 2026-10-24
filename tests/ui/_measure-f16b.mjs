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
const info = await p.evaluate(() => {
  const box = document.querySelector('.dvol-master');
  if (!box) return {err:'no master'};
  const kids = [...box.children].map(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {tag:el.tagName, cls:String(el.className).slice(0,40), w:Math.round(r.width), h:Math.round(r.height),
      x:Math.round(r.x), y:Math.round(r.y), flex:cs.flex, wrap:cs.flexWrap, basis:cs.flexBasis,
      minW:cs.minWidth, maxW:cs.maxWidth, display:cs.display, text: (el.textContent||'').trim().slice(0,40)};
  });
  const bcs = getComputedStyle(box);
  // also check zone page volume when open
  const zvol = document.querySelector('.zsh-vol input, .spkset .spk-range, .zpage input[type=range]');
  let zv = null;
  if (zvol) {
    const r = zvol.getBoundingClientRect();
    zv = {cls:zvol.className, w:Math.round(r.width), parent:zvol.parentElement?.className, parentW:Math.round(zvol.parentElement.getBoundingClientRect().width)};
  }
  // open a zone page by clicking basement in tree
  return {box:{w:Math.round(box.getBoundingClientRect().width), h:Math.round(box.getBoundingClientRect().height),
    flex:bcs.flex, wrap:bcs.flexWrap, display:bcs.display}, kids, zv};
});
console.log(JSON.stringify(info, null, 2));

// click Basement zone title to open detail, measure zone page volume
await p.evaluate(() => {
  const t = [...document.querySelectorAll('.zsh-now, .zbox-title, .qb42-title, .ztitle, [data-act]')].find(e => /Basement/i.test(e.textContent||''));
  // try opening first zone card
  const card = document.querySelector('.dc3[data-id], .zcard, .tree42 .zrow');
});
// Find zone settings volume by navigating
const open = await p.evaluate(() => {
  // click first zone name in expanded tree that opens settings
  const el = document.querySelector('.devpanel.expanded .qb42-title, .devpanel.expanded .zsh-ttl, .devpanel.expanded .ztitle');
  if (el) { el.click(); return el.className + '|' + el.textContent?.slice(0,40); }
  const b = [...document.querySelectorAll('button,a,.clickable')].find(e => /Basement/i.test(e.textContent||'') && e.closest('.devpanel'));
  if (b) { b.click(); return 'btn|' + b.textContent?.slice(0,40); }
  return 'none';
});
await p.waitForTimeout(800);
const zinfo = await p.evaluate(() => {
  const ranges = [...document.querySelectorAll('.dexp-main input[type=range], .spkset input[type=range], .zset input[type=range], .zsh-vol input')].map(el => {
    const r = el.getBoundingClientRect();
    return {aria:el.getAttribute('aria-label'), cls:el.className, w:Math.round(r.width), h:Math.round(r.height),
      parent:String(el.parentElement?.className||'').slice(0,40), parentW:Math.round(el.parentElement?.getBoundingClientRect().width||0),
      pct: el.parentElement?.querySelector('.pct')?.textContent};
  });
  return {open: document.querySelector('.spkset, .zset, .zsh-vol')?.className, ranges};
});
console.log('open', open);
console.log(JSON.stringify(zinfo, null, 2));
await b.close();
