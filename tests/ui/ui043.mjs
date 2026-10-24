// WavWiz 0.4.3 e2e: the 9-item fix list (panel Controlling chip, idle box, EQ labels never overlap, one preset chip, Home EQ default,
// Scenes header, no inner outline, speaker page output + calibration line, panel layout = render final042l). Screenshots /workspace/screens/wavwiz-043-*.png
// Usage: WW_SESS=/tmp/ww032/sess node ui043.mjs   (server on 172.30.0.2:47800; /workspace/seed042.sh seeds the scenario)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
let pass = 0, fail = 0;
const ok = (n, c, i = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (i !== '' && !c ? ' :: ' + String(i).slice(0, 400) : '')); };
mkdirSync('/workspace/screens', { recursive: true });
const seed = () => execSync('WWDIR=/tmp/ww032 bash /workspace/seed042.sh', { stdio: 'ignore' });
const br = await chromium.launch();
const EXP = { lib: 'normal', dev: 'normal', exp: 'dev', list: 'open', ctl: 'collapsed' };
async function page(o, { panels = null, spk = null, zone = null } = {}) {
  const ctx = await br.newContext({ viewport: { width: o.w, height: o.h }, deviceScaleFactor: o.dpr || 1 }); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(([pn, sp, z]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.uiscale', 'compact'); if (pn) localStorage.setItem('wavwiz.panels', JSON.stringify(pn)); if (sp) sessionStorage.setItem('wavwiz.spk', String(sp)); if (z) localStorage.setItem('wavwiz.zone', z); }, [panels, spk, zone]);
  const p = await ctx.newPage(); p.on('pageerror', e => ok('no page error: ' + e.message.slice(0, 80), false));
  await p.goto(B + '/'); await p.waitForTimeout(2200); await p.evaluate(() => document.querySelector('.phone-unlock')?.click());
  await p.evaluate(async () => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS.pepecoin, preset: 'pepecoin' }); });
  await p.waitForTimeout(600); if (await p.evaluate(() => document.querySelector('.desk')?.classList.contains('tight') && !document.querySelector('.desk').classList.contains('devexpanded'))) { await p.locator('.devtab').click(); await p.waitForTimeout(500); }   // 0.4.5 T1: Devices is behind the right-edge tab at < 1600 CSS px
  return { ctx, p };
}
const api = (p, path, method = 'GET', body) => p.evaluate(async ([path, method, body]) => { const r = await fetch('/api/v1' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { /* none */ } return { s: r.status, j }; }, [path, method, body]);
// "200%" = device pixel ratio 2 (Windows 200% scaling) and also a browser zoom of 200% (half the CSS viewport)
const CONF = [{ n: '100', w: 1920, h: 1080 }, { n: '200', w: 1920, h: 1080, dpr: 2 }, { n: '200zoom', w: 960, h: 540, dpr: 2 }];
const overlaps = sel => `(() => { const r = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none').map(e => e.getBoundingClientRect()).filter(b => b.width > 0);
  const bad = []; for (let i = 1; i < r.length; i++) if (Math.abs(r[i].top - r[i - 1].top) < r[i].height && r[i].left < r[i - 1].right - 0.5) bad.push(i); return { n: r.length, bad }; })()`;

for (const o of CONF) { const tag = o.n; seed();
  // ---- the normal Devices panel (#1, #2, #7, #9)
  { const { ctx, p } = await page(o); await p.waitForTimeout(500);
    const m = await p.evaluate(() => { const q = s => document.querySelector(s), R = s => q(s)?.getBoundingClientRect(); const chip = q('.devpanel .dmaster .zs-master'), lbl = chip?.querySelector('.zs-lbl'), nm = chip?.querySelector('.zs-name');
      const vis = e => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; const L = R('.devpanel .dmaster>.dlbl'), S = R('.devpanel .dmaster input[type=range]'), P = R('.devpanel .dmaster .pct'), M = R('.devpanel .dmaster .mastermute');
      const mid = b => b && (b.top + b.bottom) / 2; const bt = [...document.querySelectorAll('.devpanel .mallrow .mall')].map(b => Math.round(b.getBoundingClientRect().width));
      return { chipVis: vis(chip), lbl: vis(lbl) && lbl.textContent, name: vis(nm) && nm.textContent, oneRow: [S, P, M].every(b => b && Math.abs(mid(b) - mid(L)) < 6), order: L && S && P && M && L.right <= S.left && S.right <= P.left && P.right <= M.left + 1, bt, master: document.querySelectorAll('.devpanel .dmaster').length }; });
    ok(`GO(a) no CONTROLLING chip in the normal panel (final042l) [${tag}]`, !m.lbl && !m.name && !m.chipVis, JSON.stringify(m));
    ok(`#9 one MASTER row: label, slider, %, mute on one line [${tag}]`, m.master === 1 && m.oneRow && m.order, JSON.stringify(m));
    ok(`#9 All off / All on / Link all are three equal buttons [${tag}]`, m.bt.length === 3 && Math.max(...m.bt) - Math.min(...m.bt) <= 1, m.bt.join());
    const t = await p.evaluate(() => { const qs = s => [...document.querySelectorAll(s)];
      const titles = qs('.devpanel .qb42-t').map(e => ({ t: e.textContent, tt: getComputedStyle(e).textTransform, st: e.querySelector('.qb42-st')?.textContent }));
      const cards = qs('.devpanel .zcard42').map(c => { const n = c.querySelector('.zname').getBoundingClientRect(), b = c.querySelector('.zcount42')?.getBoundingClientRect(), pill = c.querySelector('.onpill').getBoundingClientRect(), lb = c.querySelector('.zlinkbtn')?.getBoundingClientRect(), g = c.querySelector('.zgut42')?.getBoundingClientRect(), ct = c.querySelector('.zctl')?.getBoundingClientRect(), cr = c.getBoundingClientRect();
        return { badgeInline: !!b && Math.abs(b.top + b.height / 2 - (n.top + n.height / 2)) < 4 && b.left >= n.right - 1, gutTall: !!g && g.height >= cr.height - 3 && g.left - cr.left < 3, lbUnder: !lb || (lb.top >= pill.bottom - 1 && Math.abs(lb.right - pill.right) < 3), ctlUnder: !ct || ct.top >= n.bottom - 1, devLine: !!c.querySelector('.dtag.count') }; });
      const rows = qs('.devpanel .zsp42 .sp42').map(r => { const n = r.querySelector('.sp42-n').getBoundingClientRect(), tg = [...r.querySelectorAll('.dtag')].map(e => e.getBoundingClientRect()), v = r.querySelector('.sp42-v').getBoundingClientRect(), rr = r.getBoundingClientRect();
        return { inline: tg.every(b => Math.abs(b.top + b.height / 2 - (n.top + n.height / 2)) < 4) || (tg.length > 0 && tg[0].top >= n.bottom - 2 && rr.width < 260),   /* inline when space allows, else under the name */ right: (m => m ? m.getBoundingClientRect().left >= v.right - 1 && rr.right - m.getBoundingClientRect().right < 12 : rr.right - v.right < 12)(r.querySelector(".sp42-mute")), /* 0.4.4 F25: the % then the mute toggle at the right edge */ grip: r.querySelector('.dgrip42')?.textContent }; });
      const idle = qs('.devpanel .qb42.idle').map(b => ({ empty: !!b.querySelector('.zl-now.empty'), txt: b.querySelector('.zl-now')?.textContent, op: +getComputedStyle(b.querySelector('.qb42-vol')).opacity }));
      const lines = qs('.devpanel .zsp42').filter(z => z.querySelector('.sp42')).map(z => getComputedStyle(z, '::before').borderLeftWidth);
      return { titles, cards, rows, idle, lines, menus: qs('.devpanel .sp42-menu').length, six: document.querySelector('.devpanel').textContent.includes('⠿'), picked: qs('.zwrap42.picked .zcard42').map(e => getComputedStyle(e).outlineStyle),
        ctl: (() => { const b = document.querySelector('.devpanel .qb42.ctl'); if (!b) return null; const cs = getComputedStyle(b); return { l: cs.borderLeftWidth, t: cs.borderTopWidth, c: cs.borderTopColor === cs.borderLeftColor }; })(),
        follower: document.querySelector('.devpanel .zwrap42[data-zone="Kitchen"] .zc42-q')?.textContent }; });
    ok(`#9 box titles are sentence case "Queue: X · STATUS" [${tag}]`, t.titles.length >= 3 && t.titles.every(x => /^Queue: [A-Z][a-z]/.test(x.t) && x.tt === 'none' && /^ · (IN SYNC|PLAYING|PAUSED|IDLE)$/.test(x.st)), JSON.stringify(t.titles));
    ok(`#9 speaker-count badge inline right after the zone name; no "N DEVICES" line [${tag}]`, t.cards.length >= 4 && t.cards.every(c => c.badgeInline && !c.devLine), JSON.stringify(t.cards));
    ok(`#9 every zone card has a full-height grip column [${tag}]`, t.cards.every(c => c.gutTall), JSON.stringify(t.cards));
    ok(`#9 Link / Split off under the OFF/ON switch; CONTROLLING under the name [${tag}]`, t.cards.every(c => c.lbUnder && c.ctlUnder), JSON.stringify(t.cards));
    ok(`#9 speaker rows: 3-dot grip, tags inline, % right-aligned, no ⋯, no ⠿ [${tag}]`, t.rows.length >= 5 && t.rows.every(r => r.inline && r.right && r.grip === '⋮') && t.menus === 0 && !t.six, JSON.stringify(t.rows));
    ok(`#9 tree connector line from the zone card to its speakers [${tag}]`, t.lines.length >= 3 && t.lines.every(w => parseFloat(w) >= 1), t.lines.join());
    ok(`#9 Controlling box: thick accent left edge + accent outline [${tag}]`, t.ctl && parseFloat(t.ctl.l) >= 3 && parseFloat(t.ctl.t) >= 1 && t.ctl.c, JSON.stringify(t.ctl));
    ok(`#9 linked follower says "Queue from Patio" [${tag}]`, t.follower === 'Queue from Patio', t.follower);
    ok(`#2 idle boxes: Nothing playing + dimmed slider [${tag}]`, t.idle.length >= 1 && t.idle.every(b => b.empty && /Nothing playing/.test(b.txt) && b.op < 0.6), JSON.stringify(t.idle));
    ok(`#7 no dashed/dotted outline on a zone card [${tag}]`, t.picked.every(s => s === 'none'), t.picked.join());
    await p.locator('.devpanel').screenshot({ path: `/workspace/screens/wavwiz-043-panel-${tag}.png` });
    await ctx.close(); }
  // ---- expanded: speaker page (#3, #4, #8) + Scenes header (#6)
  { const { ctx, p } = await page(o, { panels: EXP, spk: 5 }); await p.waitForTimeout(900);
    const hz = await p.evaluate(overlaps('.d42-pane .spkset .eqb-hz')), val = await p.evaluate(overlaps('.d42-pane .spkset .eqb-val'));
    const tight = await p.evaluate(() => [...document.querySelectorAll('.d42-pane .spkset .eqb-hz, .d42-pane .spkset .eqb-val')].filter(x => getComputedStyle(x).visibility !== 'hidden').every(x => x.scrollWidth <= x.clientWidth + 1 || x.getBoundingClientRect().width <= x.parentElement.getBoundingClientRect().width + 1));
    ok(`#3 EQ frequency labels never overlap [${tag}]`, hz.n >= 5 && hz.bad.length === 0, JSON.stringify(hz));
    ok(`#3 EQ value labels never overlap [${tag}]`, val.n >= 5 && val.bad.length === 0, JSON.stringify(val));
    ok(`#3 EQ labels fit their band column [${tag}]`, tight);
    const s = await p.evaluate(() => { const q = s => document.querySelector(s); return { on: (q('.spk-presel')?.selectedOptions.length ?? 0), out: !!q('.spkset select[aria-label$="output device"]'), outLbl: /OUTPUT DEVICE/i.test(q('.spkset')?.innerText || ''), cal: q('.spk-cal')?.textContent || '' }; });
    ok(`#4 at most one preset chip lit [${tag}]`, s.on <= 1, s.on); ok(`#8 Output device picker on the speaker page [${tag}]`, s.out && s.outLbl, JSON.stringify(s));
    ok(`#8 Calibration line [${tag}]`, /^Calibration: (Not calibrated|(Done|Set by hand|Done by ear)( · (Quick|Thorough))? · .+ · [+-]\d+ ms)$/.test(s.cal), s.cal);
    await p.locator('.spk-presel').selectOption({ index: 1 }); await p.waitForTimeout(1300); { const v = await p.evaluate(() => [...document.querySelector('.spk-presel').selectedOptions].map(o => o.textContent)); ok(`#4 after picking a preset exactly one is current (0.4.4 F20 dropdown) [${tag}]`, v.length === 1 && v[0] !== 'Custom', v); }
    const h = await p.evaluate(() => { const one = e => { if (!e) return null; const r = document.createRange(); r.selectNodeContents(e); return r.getClientRects().length <= 1 || new Set([...r.getClientRects()].map(x => Math.round(x.top))).size === 1; };
      return { title: one(document.querySelector('.ssc-title')), clock: one(document.querySelector('.ssc-clock')), clockTxt: document.querySelector('.ssc-clock')?.textContent, inHead: !!document.querySelector('.ssc-h .ss-clock') }; });
    ok(`#6 "Scenes & Schedules" header on one line; clock note on its own single line under it [${tag}]`, h.title && h.clock && !h.inHead && /^Server PC clock: /.test(h.clockTxt || ''), JSON.stringify(h));
    await p.screenshot({ path: `/workspace/screens/wavwiz-043-expanded-speaker-${tag}.png` });
    { const eq = p.locator('.d42-pane .spkset .eqarea').first(); if (await eq.count()) { await eq.scrollIntoViewIfNeeded(); await p.waitForTimeout(300); await eq.screenshot({ path: `/workspace/screens/wavwiz-043-expanded-eq-${tag}.png` }); } }
    await p.locator('.zwrap42[data-zone="Patio"] .zname').first().click(); await p.waitForTimeout(800);
    await p.screenshot({ path: `/workspace/screens/wavwiz-043-expanded-zone-${tag}.png` });
    ok(`E no horizontal overflow in the expanded view [${tag}]`, !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)));
    await ctx.close(); }
  // ---- Home EQ (#5)
  { const { ctx, p } = await page(o, { panels: { lib: 'normal', dev: 'normal', list: 'open', ctl: 'collapsed' } }); await p.waitForTimeout(500);
    const sw = p.locator('[data-ov=swap]').first(); if (!(await p.locator('.np-eqhead').count()) && await sw.count()) { await sw.click(); await p.waitForTimeout(1500); }
    const r = await p.evaluate(async () => { const Z = await import('/js/zones40.js'); const st = await import('/js/eqstyle.js'); const S = { zones: await (await fetch('/api/v1/zones')).json(), groups: await (await fetch('/api/v1/groups')).json() };
      const want = st.controllingTarget(S.zones, S.groups, Z.current()); const pk = document.querySelector('.np-eqhead .np-eqpick:not(.eqpreset)');
      return { want: want && want.zone, adj: document.querySelector('.np-eqname')?.textContent, pick: pk ? { fits: [...pk.options].every(op => op.textContent.length <= 24), sel: pk.selectedOptions[0]?.textContent, cut: pk.scrollWidth > pk.clientWidth + 2 } : null }; });
    ok(`#5 Adjusting: defaults to the Controlling zone's first live speaker (when one is online) [${tag}]`, r.want == null || r.adj === `Adjusting: ${r.want}`, JSON.stringify(r));
    ok(`#5 speaker picker text is short [${tag}]`, !r.pick || r.pick.fits, JSON.stringify(r.pick));
    console.log('INFO #5', JSON.stringify(r));
    await p.screenshot({ path: `/workspace/screens/wavwiz-043-home-eq-${tag}.png` });
    await ctx.close(); }
}
// ---- #5 with live speakers: a second browser (a speaker in Basement, the Controlling zone) and this browser (in Garage)
{ seed(); const o = CONF[0]; const ids = async p => (await api(p, '/zones')).j.filter(z => z.connected).map(z => z.id);
  const a = await page(o); const before = await ids(a.p);
  const b = await page(o, { panels: { lib: 'normal', dev: 'normal', list: 'open', ctl: 'collapsed' } }); await b.p.waitForTimeout(2500);
  const all = await ids(b.p); const g = (await api(b.p, '/groups')).j, bas = g.find(x => x.name === 'Basement'), gar = g.find(x => x.name === 'Garage');
  const fresh = all.filter(x => !before.includes(x)), other = before.filter(x => x > 8).slice(-1)[0], mine = fresh[0];
  if (other != null && mine != null) {
    await api(b.p, `/zones/${other}`, 'PATCH', { name: 'Den-PC' });
    await api(b.p, `/groups/${bas.id}`, 'PATCH', { name: 'Basement', deviceIds: [...bas.deviceIds, other] }); await api(b.p, `/groups/${gar.id}`, 'PATCH', { name: 'Garage', deviceIds: [mine] });
    await b.p.evaluate(() => localStorage.setItem('wavwiz.zone', '')); await b.p.reload(); await b.p.waitForTimeout(3000); await b.p.evaluate(() => document.querySelector('.phone-unlock')?.click());
    const sw = b.p.locator('[data-ov=swap]').first(); if (!(await b.p.locator('.np-eqhead').count()) && await sw.count()) { await sw.click(); await b.p.waitForTimeout(1500); }
    const zs = (await api(b.p, '/zones')).j, oName = zs.find(z => z.id === other)?.name, mName = zs.find(z => z.id === mine)?.name;
    const r = await b.p.evaluate(async () => { const Z = await import('/js/zones40.js'); return { cur: Z.current()?.name || Z.current()?.key, adj: document.querySelector('.np-eqname')?.textContent, pick: [...document.querySelectorAll('.np-eqhead .np-eqpick:not(.eqpreset) option')].map(x => x.textContent), pw: (() => { const e = document.querySelector('.np-eqhead .np-eqpick:not(.eqpreset)'); return e ? [e.scrollWidth, e.clientWidth] : null; })() }; });
    ok('#5 live: Adjusting = the Controlling zone (Basement)\'s first live speaker, not this browser', r.adj === `Adjusting: ${oName}` && oName !== mName, JSON.stringify({ r, oName, mName }));
    ok('#5 live: picker options are short (speaker name only)', r.pick.length === 0 || r.pick.every(t => t.length <= 24 && !/ — /.test(t)), r.pick.join('|'));
    await b.p.screenshot({ path: '/workspace/screens/wavwiz-043-home-eq-live-100.png' });
  } else ok('#5 live: two live browser speakers', false, JSON.stringify({ before, all }));
  await a.ctx.close(); await b.ctx.close(); seed(); }
console.log(`\n${pass} passed, ${fail} failed`); await br.close(); process.exit(fail ? 1 : 0);
