// WavWiz 0.4.1: the link-drop highlight (theme accent, dashed + tint + label) vs the reorder insertion line, in all 10 themes. Screenshots: /workspace/screens/wavwiz-041-linkdrop-<theme>.png
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww041L/sess', 'utf8').trim();
const ok = (n, c, i = '') => console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? ' :: ' + String(i).slice(0, 300) : ''));
const api = async (path, method = 'GET', body) => { const r = await fetch(B + '/api/v1' + path, { method, headers: { 'content-type': 'application/json', origin: B, cookie: 'unison_session=' + sess }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
async function setup() {
  await api('/stream/stop', 'POST', {}); await api('/jukebox/zone', 'PUT', { deviceIds: [] }); for (const g of (await api('/groups')).j || []) await api('/groups/' + g.id, 'DELETE');
  const ids = {}; for (const [n, d] of [['Alpha', [1]], ['Bravo', [2]], ['Charlie', [3]], ['Delta', [4]]]) { ids[n] = (await api('/groups', 'POST', { name: n, deviceIds: d })).j.id; await api(`/groups/${ids[n]}/split`, 'POST', {}); }
}
const br = await chromium.launch();
const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const THEMES = ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'steel', 'lime'];
for (const theme of THEMES) {
  await setup();
  const ctx = await br.newContext({ viewport: { width: 1600, height: 1500 } }); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: 'dev', list: 'open', ctl: 'collapsed' })); if (!sessionStorage.getItem('i')) { sessionStorage.setItem('i', '1'); localStorage.removeItem('wavwiz.devorder.v1'); } });
  const p = await ctx.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2000); await p.locator('.phone-unlock').click({ timeout: 800 }).catch(() => {});
  await p.evaluate(async id => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS[id], preset: id }); }, theme); await p.waitForTimeout(400);
  await p.waitForSelector('.zcard[data-zone="Delta"] > .dgrip', { timeout: 20000 }); await p.waitForTimeout(500);
  const box = async s => { for (let i = 0; i < 30; i++) { const b = await p.locator(s).first().boundingBox({ timeout: 1000 }).catch(() => null); if (b) return b; await p.waitForTimeout(300); } throw new Error('no box ' + s); };
  const g = await box('.zcard[data-zone="Delta"] > .dgrip'); await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await p.mouse.down(); await p.mouse.move(g.x + g.width / 2 + 3, g.y + g.height / 2 - 14, { steps: 3 });
  // 1) reorder: near the top edge of Charlie
  let c = await box('.zcard[data-zone="Charlie"]'); await p.mouse.move(c.x + c.width / 2, c.y + c.height * 0.1, { steps: 6 }); await p.waitForTimeout(150);
  const line = await p.evaluate(() => { const e = document.querySelector('.dropbefore,.dropafter'); const r = e.getBoundingClientRect(); return { sh: getComputedStyle(e).boxShadow, outline: getComputedStyle(e).outlineStyle, bg: getComputedStyle(e).backgroundColor, x: r.x, y: r.y, w: r.width, h: r.height }; });
  await p.screenshot({ path: `/workspace/screens/wavwiz-041-reorderline-${theme}.png`, clip: { x: Math.max(0, line.x - 20), y: Math.max(0, line.y - 130), width: line.w + 40, height: 300 } });
  // 2) link: middle of Bravo
  c = await box('.zcard[data-zone="Bravo"]'); await p.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 6 }); await p.waitForTimeout(150);
  const L = await p.evaluate(() => { const e = document.querySelector('.droplink'); if (!e) return null; const cs = getComputedStyle(e), af = getComputedStyle(e, '::after'), panel = getComputedStyle(document.body).getPropertyValue('--panel'); const r = e.getBoundingClientRect();
    const probe = document.createElement('i'); probe.style.background = 'var(--panel)'; document.body.append(probe); const pb = getComputedStyle(probe).backgroundColor; probe.remove();
    const probe2 = document.createElement('i'); probe2.style.color = 'var(--accent)'; document.body.append(probe2); const ac = getComputedStyle(probe2).color; probe2.remove();
    return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, bg: cs.backgroundColor, panel: pb, accent: ac, label: e.dataset.linklabel, labelDisplay: af.display, labelBg: af.backgroundColor, labelColor: af.color, x: r.x, y: r.y, w: r.width, h: r.height }; });
  ok(`LD present [${theme}]`, !!L && /Drop to link with Bravo/.test(L.label));
  if (L) {
    ok(`LD dashed 3px outline in the theme accent [${theme}]`, L.style === 'dashed' && L.width === '3px' && L.color === L.accent, JSON.stringify({ s: L.style, w: L.width, c: L.color, a: L.accent }));
    const cr = ratio(rgb(L.color), rgb(L.bg)), crp = ratio(rgb(L.color), rgb(L.panel)), cl = ratio(rgb(L.labelColor), rgb(L.labelBg));
    ok(`LD outline contrast vs the tinted card >= 3:1 [${theme}]`, cr >= 3, cr.toFixed(2)); ok(`LD label text contrast >= 4.5:1 [${theme}]`, cl >= 4.5, cl.toFixed(2));
    ok(`LD tint differs from the plain card [${theme}]`, ratio(rgb(L.bg), rgb(L.panel)) > 1.04 || L.bg !== L.panel, `${L.bg} vs ${L.panel}`);
    ok(`LD label is displayed [${theme}]`, L.labelDisplay === 'block', L.labelDisplay);
    ok(`LD never shows the insertion line at the same time [${theme}]`, (await p.locator('.dropbefore,.dropafter').count()) === 0);
    ok(`LD differs from the insertion line (dashed outline + label vs solid shadow line, no outline) [${theme}]`, line.outline === 'none' && /rgb/.test(line.sh) && L.style === 'dashed');
    await p.screenshot({ path: `/workspace/screens/wavwiz-041-linkdrop-${theme}.png`, clip: { x: Math.max(0, L.x - 20), y: Math.max(0, L.y - 30), width: L.w + 40, height: 330 } });
    // the label is actually visible: the strip around the card's top edge is not covered by the dragged card
    const vis = await p.evaluate(({ x, y, w }) => { const e = document.elementFromPoint(x + 70, y + 2); return e?.closest('.zcard')?.dataset.zone; }, { x: L.x, y: L.y, w: L.w });
    ok(`LD top edge (label spot) is not covered by the dragged card [${theme}]`, vis === 'Bravo', vis);
  }
  await p.mouse.up(); await ctx.close();
}
await br.close();
