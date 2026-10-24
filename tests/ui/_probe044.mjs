// 0.4.4 reproduce probes for F1 F2 F3 F7 F17 F18 at 100/200%. TAG=before|after
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), TAG = process.env.TAG || 'before';
const br = await chromium.launch();
async function page(dpr, panels, w = 1920, h = 1080) {
  const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(pn => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.setItem('wavwiz.panels', JSON.stringify(pn)); }, panels);
  const p = await ctx.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2800);
  await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
  return { ctx, p };
}
const out = {};
for (const [tag, dpr] of [['100', 1], ['200', 2]]) {
  // expanded devices view: scenes & schedules column + zone pane + tags
  let { ctx, p } = await page(dpr, { lib: 'rail', dev: 'expanded', exp: 'dev', list: 'normal', ctl: 'collapsed' });
  await p.evaluate(() => { const t = [...document.querySelectorAll('.devpanel *')].find(e => e.children.length === 0 && /^Basement$/.test(e.textContent.trim())); t?.click(); });
  await p.waitForTimeout(800);
  const m = await p.evaluate(() => {
    const r = e => e?.getBoundingClientRect(); const ov = (a, b) => a && b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const row = document.querySelector('.ssc-sched'); const tag = row?.querySelector('.dtag'), days = row?.querySelector('.ss-days'), next = row?.querySelector('.ss-when .small');
    const hscroll = el => el ? el.scrollWidth - el.clientWidth : null;
    const ssCol = row?.closest('.ssc, .sscol, [class*=ssc-col], .dexp-col, section, aside') || null;
    const anc = []; let e = row; while (e && e !== document.body) { if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'hidden') anc.push(e.className + ':' + (e.scrollWidth - e.clientWidth)); e = e.parentElement; }
    const sub = document.querySelector('.ssc-scene .ss-mid .small');
    const tags = [...document.querySelectorAll('.devpanel .dtag')].filter(t => t.offsetParent).map(t => ({ t: t.textContent.trim().slice(0, 14), h: Math.round(r(t).height), fs: getComputedStyle(t).fontSize }));
    const zp = document.querySelector('.zp42, .zonepane, [class*=zp42]'); const zpAnc = []; let z = zp; while (z && z !== document.body) { if (z.scrollWidth > z.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(z).overflowX)) zpAnc.push(z.className + ':' + (z.scrollWidth - z.clientWidth)); z = z.parentElement; }
    return { F1: { row: !!row, tagDays: ov(r(tag), r(days)), daysNext: ov(r(days), r(next)), nextLines: next ? Math.round(r(next).height / parseFloat(getComputedStyle(next).lineHeight || 16)) : null, nextH: r(next)?.height, nextText: next?.textContent },
      F2: { hscrollAncestors: anc }, F3: { text: sub?.textContent, truncated: sub ? sub.scrollWidth > sub.clientWidth : null, title: sub?.title },
      F17: { zp: !!zp, hscroll: zpAnc }, F18: tags };
  });
  out[tag] = m; await p.screenshot({ path: `/workspace/screens/wavwiz-044-F1F2F3F17F18-${TAG}-${tag}.png` }); await ctx.close();
  // collapsed library rail count
  ({ ctx, p } = await page(dpr, { lib: 'rail', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' }));
  const lc = await p.evaluate(() => { const c = document.querySelector('.libcount'); if (!c || !c.offsetParent) return { visible: false, any: !!c, text: c?.textContent }; const cs = getComputedStyle(c); const rr = c.getBoundingClientRect(); const rail = c.closest('.libpanel, aside, section')?.getBoundingClientRect(); return { visible: true, text: c.textContent, writing: cs.writingMode, transform: cs.transform, bg: cs.backgroundColor, border: cs.borderColor + ' ' + cs.borderStyle, title: c.title, pos: { l: Math.round(rr.left - (rail?.left || 0)), b: Math.round((rail?.bottom || 0) - rr.bottom) } }; });
  out[tag].F7 = lc; await p.screenshot({ path: `/workspace/screens/wavwiz-044-F7-${TAG}-${tag}.png` }); await ctx.close();
}
console.log(JSON.stringify(out, null, 1)); await br.close();
