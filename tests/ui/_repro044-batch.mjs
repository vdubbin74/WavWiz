// Batch before-screenshots + targeted F8/F11/F16 probes at 100% and 200%.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim();
mkdirSync('/workspace/screens', { recursive: true });
const br = await chromium.launch();

async function pageFor(panels, scale = 1) {
  const ctx = await br.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(pn => {
    localStorage.setItem('wavwiz.whatsnew', '9.9.9');
    localStorage.setItem('wavwiz.gettingStarted.shown', '1');
    localStorage.setItem('wavwiz.panels', JSON.stringify(pn));
    localStorage.setItem('wavwiz.uiscale', 'compact');
  }, panels);
  const p = await ctx.newPage();
  await p.goto(B + '/'); await p.waitForTimeout(2600);
  await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
  await p.waitForTimeout(400);
  return { ctx, p };
}
const tag = s => (s === 1 ? '100' : '200');

// F8: synthetic drop in normal + libexpanded; verify zone queue grows
for (const [name, pn] of [
  ['normal', { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' }],
  ['libexp', { lib: 'normal', dev: 'rail', exp: 'lib', list: 'open', ctl: 'collapsed' }],
]) {
  for (const scale of [1, 2]) {
    const { ctx, p } = await pageFor(pn, scale);
    const r = await p.evaluate(async () => {
      const wrap = document.querySelector('.listpanel .qwrap');
      const el = document.querySelector('.libpanel [draggable=true]');
      if (!el || !wrap) return { err: 'missing' };
      const before = document.querySelectorAll('.listpanel tr[data-i]').length;
      const dt = new DataTransfer();
      el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const mime = 'application/x-wavwiz-ref';
      const raw = dt.getData(mime);
      const box = wrap.getBoundingClientRect();
      const evInit = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.left + box.width / 2, clientY: box.top + 40 };
      const over = new DragEvent('dragover', evInit);
      const accepted = wrap.dispatchEvent(over);
      const ins = document.querySelector('.qins');
      wrap.dispatchEvent(new DragEvent('drop', evInit));
      await new Promise(r => setTimeout(r, 800));
      return {
        raw: raw?.slice(0, 100), types: [...dt.types],
        overDefaultPrevented: over.defaultPrevented, accepted,
        insHidden: ins?.hidden, insLabel: ins?.dataset?.label,
        before, after: document.querySelectorAll('.listpanel tr[data-i]').length,
        toast: document.querySelector('.toast')?.textContent || '',
        pe: getComputedStyle(wrap).pointerEvents,
        listPe: getComputedStyle(document.querySelector('.listpanel')).pointerEvents,
      };
    });
    await p.screenshot({ path: `/workspace/screens/wavwiz-044-F8-before-${name}-${tag(scale)}.png` });
    console.log('F8', name, tag(scale), JSON.stringify(r));
    await ctx.close();
  }
}

// F11: open Send dialog, check default mode and wording
{
  const { ctx, p } = await pageFor({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' }, 1);
  await p.click('.listpanel .qsend').catch(() => {});
  await p.waitForTimeout(400);
  const send = await p.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    const mode = d?.querySelector('select[aria-label="Copy or move"]');
    return {
      open: !!d,
      title: d?.querySelector('header, h2, [class*=title]')?.textContent || d?.getAttribute('aria-label'),
      text: d?.innerText?.slice(0, 400),
      modeValue: mode?.value,
      modeOptions: mode ? [...mode.options].map(o => o.value + ':' + o.textContent) : [],
      btn: [...(d?.querySelectorAll('button') || [])].map(b => b.textContent),
    };
  });
  await p.screenshot({ path: '/workspace/screens/wavwiz-044-F11-before-100.png' });
  console.log('F11', JSON.stringify(send));
  await ctx.close();
}

// F16: expand devices, look at master volume + open a zone detail
{
  for (const scale of [1, 2]) {
    const { ctx, p } = await pageFor({ lib: 'rail', dev: 'normal', exp: 'dev', list: 'collapsed', ctl: 'collapsed' }, scale);
    await p.waitForTimeout(800);
    const sliders = await p.evaluate(() => {
      const info = sel => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { w: Math.round(r.width), h: Math.round(r.height), display: cs.display, flex: cs.flex, parentW: Math.round(el.parentElement?.getBoundingClientRect().width || 0) };
      };
      return {
        master: info('.devpanel .dmaster input[type=range], .devpanel .dvol-master input[type=range]'),
        masterPct: document.querySelector('.devpanel .dmaster .pct')?.textContent,
        zoneRanges: [...document.querySelectorAll('.devpanel input[type=range]')].slice(0, 6).map(el => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), cls: el.className, aria: el.getAttribute('aria-label') };
        }),
        stubSuspect: [...document.querySelectorAll('.devpanel input[type=range]')].filter(el => el.getBoundingClientRect().width < 40).map(el => ({ w: Math.round(el.getBoundingClientRect().width), aria: el.getAttribute('aria-label'), parent: el.parentElement?.className })),
      };
    });
    await p.screenshot({ path: `/workspace/screens/wavwiz-044-F16-before-expanded-${tag(scale)}.png` });
    // Open first zone card settings if possible
    await p.click('.devpanel .zcard42, .devpanel .zcard, .devpanel .zname').catch(() => {});
    await p.waitForTimeout(600);
    const zonePage = await p.evaluate(() => {
      const ranges = [...document.querySelectorAll('.spkset input[type=range], .zedit input[type=range], .spkpage input[type=range], .devpanel .expanded input[type=range], .zdetail input[type=range]')];
      const pcts = [...document.querySelectorAll('.spkset .pct, .zedit .pct, .spk-vol .pct')].map(e => ({ t: e.textContent, w: Math.round(e.getBoundingClientRect().width) }));
      return {
        ranges: ranges.map(el => ({ w: Math.round(el.getBoundingClientRect().width), aria: el.getAttribute('aria-label'), cls: el.className })),
        stubs: ranges.filter(el => el.getBoundingClientRect().width < 40).length,
        pcts,
        htmlSnippet: document.querySelector('.spkset, .zedit, .spkpage')?.innerHTML?.slice(0, 200),
      };
    });
    await p.screenshot({ path: `/workspace/screens/wavwiz-044-F16-before-zonepage-${tag(scale)}.png` });
    console.log('F16', tag(scale), JSON.stringify({ sliders, zonePage }));
    await ctx.close();
  }
}

// F1/F2/F10 before shots: scenes in devices panel
{
  for (const scale of [1, 2]) {
    const { ctx, p } = await pageFor({ lib: 'rail', dev: 'normal', exp: null, list: 'collapsed', ctl: 'collapsed' }, scale);
    await p.screenshot({ path: `/workspace/screens/wavwiz-044-F1F2-before-devices-${tag(scale)}.png` });
    const { ctx: c2, p: p2 } = await pageFor({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open' }, scale);
    const f10 = await p2.evaluate(() => ({
      pick: document.querySelector('.listpanel .qzpick')?.selectedOptions?.[0]?.textContent,
      editing: document.querySelector('.listpanel .qediting')?.textContent,
      qzone: document.querySelector('.listpanel .qzone')?.textContent,
      header: document.querySelector('.listpanel .pane-h')?.innerText?.slice(0, 200),
    }));
    await p2.screenshot({ path: `/workspace/screens/wavwiz-044-F10-before-${tag(scale)}.png` });
    console.log('F10', tag(scale), JSON.stringify(f10));
    await ctx.close(); await c2.close();
  }
}

await br.close();
console.log('batch done');
