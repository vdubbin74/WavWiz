// Settings > Appearance. 0.2.1 F8 folded the View menu, Themes page and Visualizer page in here. 0.2.2 T2: one page was too crowded, so
// Appearance now has a left sub-nav - Theme, Visualizer, EQ, Now Playing, Display size - each its own page with a live preview of what it
// changes. Theme and Visualizer are the 0.2.0 dedicated-page layouts again. Everything is saved on this device only.
import { h, api, toast, debounce } from './util.js';
import { SCALES, loadScale, applyScale, scaleFactor } from './uiscale.js';
import { LAYOUTS, loadLayout, saveLayout } from './panels.js';
import { SLIDER_STYLES, loadSlider, applySlider } from './sliderstyle.js';
import { NP_SEEKS, NP_BUTTONS, NP_ARTS, NP_EFFECTS, NP_COLORS, loadNpPrefs, saveNpPrefs } from './npstyle.js';
import { npSeekMini, npBtnMini, npArtMini } from './npmini.js';
import { Viz, vizPrefs, saveVizPrefs, ENGINES, spectrumTap, isPhone } from './viz.js';
import { VIZ_BLURB, vizName } from './vizcore.js';
import { visualizerView } from './vizpage.js';
import { themeCard } from './themes.js';
import { EQ_STYLES, EQ_EXAMPLE, loadEqPrefs, saveEqPrefs, glowWords, eqTarget, ownEqName, eqSummary } from './eqstyle.js';
import { eqArea, eqLockBox } from './eqview.js';
import { flatEq } from './eq.js';
import { thisDevice, canControl } from './ui.js';
import { gridEl, pgCard, markGrid, whileVisible } from './pgrid.js';
import { OPACITY_MIN, loadOpacity, saveOpacity, clampOpacity } from './minifit.js';

const prevHead = (title, extra) => h('div', { class: 'npprev-h' }, h('span', { class: 'npprev-live' }, h('i', { 'aria-hidden': 'true' }), 'LIVE PREVIEW'), extra != null ? h('span', { class: 'small dim' }, extra) : null, h('span', { class: 'grow' }), h('span', { class: 'npprev-ex' }, title || 'EXAMPLE DATA'));

/** Visualizer sub-section (0.2.2 T2): a live mini visualizer of the active look + the Show switch, then the 0.2.0 Visualizer page
 *  (preview cards, Graphics, Reactivity, the active look's settings). Previews only run while this sub-section is on screen. */
function vizCard() {
  const box = h('div', { class: 'appsub-viz', id: 'sec-viz' });
  let gallery = null, live = null, running = false;
  const stage = h('div', { class: 'vlive-stage' }), name = h('b', null, ''), blurb = h('p', { class: 'small dim' }, ''), badge = h('span', { class: 'badge-active' }, 'ACTIVE');
  const show = h('input', { type: 'checkbox', 'data-vizshow': '1', onchange: ev => { const x = vizPrefs(); x.on = ev.target.checked; saveVizPrefs(x); window.dispatchEvent(new CustomEvent('wavwiz:viz')); } });
  const card = h('div', { class: 'npprev vlive pinprev', 'aria-label': 'Live preview of the visualizer' }, prevHead('EXAMPLE DATA', ''),
    h('div', { class: 'vlive-row' }, stage, h('div', { class: 'vlive-meta' }, h('div', { class: 'row' }, name, badge), blurb, h('label', { class: 'row' }, show, 'Show the visualizer on Now Playing'))));
  function paintLive() {
    const p = vizPrefs();
    name.textContent = vizName(p.engine); blurb.textContent = VIZ_BLURB[p.engine] || ''; show.checked = !!p.on; badge.hidden = !p.on;
    card.querySelector('.npprev-h .small').textContent = `${vizName(p.engine)} - reacts to the music`;
    if (!running) return;
    if (live && live.engine === p.engine) return;
    live?.destroy(); stage.replaceChildren(); live = new Viz(stage, { engine: p.engine, preview: true }); requestAnimationFrame(() => live?.start());
  }
  const onViz = () => { if (!box.isConnected) return; paintLive(); gallery?.mark?.(); };
  window.addEventListener('wavwiz:viz', onViz);
  // 0.3.1 B15: the grid comes first (the selected card is the live preview); the options follow below it
  function start() { running = false; gallery ??= visualizerView({ nested: true }); box.replaceChildren(gallery.el); gallery.reload(); }
  function hide() { running = false; gallery?.hide?.(); live?.destroy(); live = null; }
  box.replaceChildren(card); paintLive();
  return { el: box, hide, reload: start };
}

/** Now Playing (control panel) style + effects. Every effect 0-100 %, 50 % default. */
function npStyleCard(preview, S = null, thumbFn = null) {
  const box = h('div', { class: 'card', id: 'sec-npstyle' });
  let thumbs = [], stopNp = null;
  function draw() {
    const p = loadNpPrefs();
    const slider = (k, label) => {
      const out = h('span', { class: 'small dim mono', style: 'min-width:3em;text-align:right' }, p[k] + '%');
      const r = h('input', { type: 'range', min: 0, max: 100, step: 1, value: p[k], class: 'grow', 'aria-label': label, 'data-npfx': k,
        oninput: ev => { out.textContent = ev.target.value + '%'; saveNpPrefs({ ...loadNpPrefs(), [k]: +ev.target.value }); thumbs.forEach(t => t.update()); } });
      return h('label', { class: 'row', style: 'gap:10px;margin-top:6px' }, h('span', { style: 'min-width:8.5em' }, label), r, out);
    };
    // 0.5.0 F94: Color intensity, a 3-stop track bar (snaps to Subtle / Spicy / Max), live on the real stage and the previews
    const colorBar = () => {
      const idx = Math.max(0, NP_COLORS.findIndex(([id]) => id === p.color));
      const wrap = h('div', { class: 'npcolor', 'data-npcolor-bar': '', style: '--stop:' + idx });
      const set = i => { i = Math.max(0, Math.min(NP_COLORS.length - 1, i)); wrap.style.setProperty('--stop', i); r.value = i;
        r.setAttribute('aria-valuetext', NP_COLORS[i][1]); labs.forEach((l, j) => l.classList.toggle('on', j === i));
        saveNpPrefs({ ...loadNpPrefs(), color: NP_COLORS[i][0] }); thumbs.forEach(t => t.update()); };
      const r = h('input', { type: 'range', min: 0, max: NP_COLORS.length - 1, step: 1, value: idx, class: 'npcolor-range', 'aria-label': 'Color intensity',
        'aria-valuetext': NP_COLORS[idx][1], 'data-npcolor-range': '', oninput: ev => set(+ev.target.value) });
      const labs = NP_COLORS.map(([id, l], j) => h('button', { type: 'button', class: 'npcolor-lab' + (j === idx ? ' on' : ''), 'data-npcolor': id, onclick: () => set(j) }, l));
      wrap.append(h('div', { class: 'npcolor-rail' }, h('div', { class: 'npcolor-fill' }), ...NP_COLORS.map((_, j) => h('span', { class: 'npcolor-tick', style: '--i:' + j })), r),
        h('div', { class: 'npcolor-labs' }, ...labs));
      return wrap;
    };
    // 0.5.0 F95: no locked layout packages - one live preview of the saved mix, then Track bar / Buttons / Color intensity mixed independently
    stopNp?.(); const live = thumbFn ? thumbFn(null, () => !!S?.now?.item) : { el: h('div'), update() {} }; thumbs = [live];
    const liveCard = h('div', { class: 'npmix-live', 'data-npmix-live': '' }, live.el);
    stopNp = whileVisible([liveCard], c => { live.update(); c._iv = setInterval(() => live.update(), 1000); }, c => { clearInterval(c._iv); });
    const pick = (list, key, mini, kind, label) => gridEl(kind, label, list.map(([id, name, tip]) => pgCard({ id, name: name + (id === list[0][0] ? ' (default)' : ''), sub: tip, on: p[key] === id,
      preview: mini(id), attrs: { ['data-np' + key]: id }, onSelect: v => { saveNpPrefs({ ...loadNpPrefs(), [key]: v }); draw(); } })));
    box.replaceChildren(h('h3', null, 'Now Playing'),
      h('p', { class: 'dim small' }, 'Mix the track bar, buttons, album art and color intensity. Applies on this PC and on phones / tablets using this browser.'),
      liveCard,
      h('div', { class: 'sec', style: 'margin-top:12px' }, 'Track bar'), pick(NP_SEEKS, 'seek', npSeekMini, 'npseek', 'Track bar'),
      h('div', { class: 'sec', style: 'margin-top:12px' }, 'Buttons'), pick(NP_BUTTONS, 'buttons', npBtnMini, 'npbtn', 'Buttons'),
      h('div', { class: 'sec', style: 'margin-top:12px' }, 'Album art'), pick(NP_ARTS, 'art', npArtMini, 'npart', 'Album art'),   // 0.5.0 F96
      h('div', { class: 'sec', style: 'margin-top:12px' }, 'Color intensity'),
      h('p', { class: 'dim small', style: 'margin:2px 0 4px' }, 'How hard Now Playing leans into the active theme'), colorBar(),
      h('div', { class: 'sec', style: 'margin-top:12px' }, 'Effects'), slider('fx', 'Panel effects'), ...NP_EFFECTS.map(([k, l]) => slider(k, l)),
      h('div', { class: 'row', style: 'margin-top:6px' }, h('p', { class: 'small dim grow', style: 'margin:0' }, 'Panel effects scales all of them at once. Each starts at 50% and goes up to 100%.'),
        h('button', { class: 'btn', onclick: () => { { const q = loadNpPrefs(); saveNpPrefs({ seek: q.seek, buttons: q.buttons, art: q.art, color: q.color }); } draw(); } }, 'Reset effects')));
    thumbs.forEach(t => t.update());
  }
  draw();
  return { el: box, reload: draw, hide: () => { stopNp?.(); stopNp = null; } };
}

/** EQ sub-section (0.2.2 T2 page). 0.2.3 U10: the preview mirrors this device's REAL EQ (bands, preset, pre-gain, loudness), live, in the
 *  chosen style - no demo values. Lock EQ (U9) is checked every time the page opens so styles can be browsed safely; unchecking allows
 *  edits, which play at once on the speaker and are kept in its own preset ("<speaker> EQ"). Small previews of the other looks, glow 0-100 %. */
function eqStyleCard(S) {
  const box = h('div', { class: 'card', id: 'sec-eqstyle' });
  let prev = null, others = [], locked = true, real = null, shown = false, loading = null, stopLive = null;
  const can = () => !!S && canControl(S);
  /** Fetch the speaker's current EQ from the server (assignment -> preset -> bands; the server's response curve gives the pre-gain). */
  async function fetchReal() {
    const out = S ? eqTarget(S.zones, thisDevice(S)) : null;
    if (!out) return null;
    try {
      const [presets, a] = await Promise.all([api('/dsp/presets'), api(`/dsp/assignments/${encodeURIComponent(out.deviceId)}`)]);
      const p = a && a.presetId != null ? presets.find(x => x.id === a.presetId) : null;
      const cur = { ...flatEq(), ...(p ? structuredClone(p.json) : {}) }; cur.bypass = !!a?.bypass;
      let resp = null; try { resp = await api('/dsp/response', { method: 'POST', body: { preset: cur } }); } catch { /* approx curve */ }
      return { out, presets, preset: p, cur, resp, enabled: a ? a.enabled !== false : true };
    } catch { return null; }
  }
  async function reload() {
    shown = true; locked = true;                       // U10: locked by default every time the page opens
    const job = loading = fetchReal(); const r = await job; if (job !== loading) return;
    real = r; draw();
  }
  // edits (only when unlocked): play at once (preview), then keep them in the speaker's own preset
  const previewNow = debounce(() => { if (real) api('/dsp/preview', { method: 'POST', body: { deviceId: real.out.deviceId, preset: real.cur, bypass: real.cur.bypass } }).catch(() => {}); }, 120);
  const saveSoon = debounce(async () => {
    const r = real; if (!r) return;
    const name = ownEqName(r.out.zone), body = { name, preset: { ...r.cur, name } };
    try {
      let own = r.presets.find(x => x.source !== 'builtin' && x.name === name), id;
      if (own) { await api(`/dsp/presets/${own.id}`, { method: 'PUT', body }); id = own.id; } else id = (await api('/dsp/presets', { method: 'POST', body })).id;
      await api(`/dsp/assignments/${encodeURIComponent(r.out.deviceId)}`, { method: 'PUT', body: { presetId: id, enabled: true, bypass: r.cur.bypass } });
      r.presets = await api('/dsp/presets'); r.preset = r.presets.find(x => x.id === id) || { id, name }; r.enabled = true;
      try { r.resp = await api('/dsp/response', { method: 'POST', body: { preset: r.cur } }); prev?.setResponse(r.resp); } catch { /* keep */ }
      paintSummary();
    } catch (e) { toast(e.message, true); }
  }, 700);
  const summary = h('div', { class: 'small eqreal-sum', role: 'status' });
  function paintSummary() {
    summary.textContent = real ? `${real.out.zone} · ` + eqSummary({ presetName: real.preset?.name, preGainDb: real.resp?.preGainDb || 0, loudness: !!real.cur.loudness?.enabled, bypass: !!real.cur.bypass, enabled: real.enabled })
      : (S ? 'No speaker is connected yet, so this shows example values.' : 'Example values.');
  }
  function draw() {
    const p = loadEqPrefs(), [gl, gh] = glowWords(p.style);
    prev?.destroy(); others.forEach(o => o.destroy());
    const gains = () => real ? [...real.cur.graphicDb] : [...EQ_EXAMPLE];
    prev = eqArea({ style: p.style, gains: gains(), glow: p.glow, interactive: true, locked: locked || !real || !can(),
      onChange: (i, db) => { if (!real || locked) return; real.cur.graphicDb[i] = db; others.forEach(o => o.setGains(real.cur.graphicDb)); previewNow(); saveSoon(); } });
    if (real?.resp) prev.setResponse(real.resp);
    prev.exampleSpectrum?.(); if (shown && p.glow > 0) prev.startLive?.(spectrumTap);
    // 0.3.1 B13: all three styles as live, display-only previews of this speaker's real EQ (no demo values once a speaker is known)
    stopLive?.(); stopLive = null;
    others = EQ_STYLES.map(([id]) => Object.assign(eqArea({ style: id, gains: gains(), glow: p.glow, interactive: false }), { id }));
    if (real?.resp) others.forEach(o => o.setResponse(real.resp));
    const name = (EQ_STYLES.find(([id]) => id === p.style) || EQ_STYLES[0])[1];
    const lock = eqLockBox(locked || !real || !can(), v => { locked = v; prev.setLocked(v); paintHint(); });
    if (!real || !can()) { lock.input.disabled = true; lock.el.title = real ? 'Only Control or Admin access can change the EQ.' : 'No speaker connected - nothing to change.'; }
    const hint = h('p', { class: 'small dim npprev-cap' });
    function paintHint() { hint.textContent = !real ? 'Connect a speaker to see its EQ here.' : locked ? 'Locked: browse the styles freely. Uncheck Lock EQ to change the EQ of this speaker.' : 'Unlocked: changes play right away and are kept in “' + ownEqName(real.out.zone) + '”.'; }
    paintHint(); paintSummary();
    const glowOut = h('span', { class: 'small dim mono', style: 'min-width:3em;text-align:right' }, p.glow + '%');
    const cards = others.map(o => { const [, nm, tip] = EQ_STYLES.find(([id]) => id === o.id);
      const c = pgCard({ id: o.id, name: nm + (o.id === 'led' ? ' (default)' : ''), sub: tip, on: p.style === o.id, preview: o.el, attrs: { 'data-eqstyle': o.id },
        onSelect: id => { saveEqPrefs({ ...loadEqPrefs(), style: id }); try { window.dispatchEvent(new CustomEvent('wavwiz:eqstyle')); } catch { /* ok */ } draw(); } });
      c._area = o; return c; });
    const grid = gridEl('eq', 'EQ style', cards);
    // previews react to the playing music only while on screen (B15: CPU drops when they scroll away)
    stopLive = whileVisible(cards, c => { if (shown) c._area.startLive?.(spectrumTap); }, c => c._area.stopLive?.());
    box.replaceChildren(h('h3', null, 'EQ style'),
      h('p', { class: 'dim small' }, 'Pick how the EQ looks on this device. All three set the same 10-band EQ; the previews show this speaker’s EQ with the music playing.'),
      grid,
      h('label', { class: 'row', style: 'gap:10px;margin-top:12px' }, h('span', { style: 'min-width:8.5em' }, h('div', null, gl), h('div', { class: 'small dim' }, gh + '. 50% default, 100% max.')),
        h('input', { type: 'range', min: 0, max: 100, step: 1, value: p.glow, class: 'grow', 'aria-label': gl, 'data-eqglow': '1',
          oninput: ev => { const v = +ev.target.value; glowOut.textContent = v + '%'; prev.setGlow?.(v); others.forEach(o => o.setGlow?.(v)); if (!(ev.target._lg > 0) && v > 0) prev.startLive?.(spectrumTap); ev.target._lg = v; },   // 0.3.3 G14: no save / re-render mid-drag
          onchange: ev => { const v = +ev.target.value; saveEqPrefs({ ...loadEqPrefs(), glow: v }); try { window.dispatchEvent(new CustomEvent('wavwiz:eqglow', { detail: v })); } catch { /* ok */ } } }), glowOut),
      h('div', { class: 'sec', style: 'margin-top:12px' }, 'Edit this speaker’s EQ'),
      h('div', { class: 'eqprevbox eqprev-big', 'aria-label': 'This speaker\'s EQ in the chosen style' },
        h('div', { class: 'npprev-h' }, h('span', { class: 'small dim ell' }, name), h('span', { class: 'grow' }), lock.el, h('span', { class: 'npprev-ex' }, real ? 'YOUR EQ' : 'EXAMPLE DATA')),
        summary, prev.el, hint));
  }
  // live: the dialog (or another page) saved / reverted this speaker's EQ -> mirror it (not while this page is being edited)
  window.addEventListener('wavwiz:eqchanged', () => { if (shown && box.isConnected && locked) reload(); });
  draw();
  return { el: box, reload, hide: () => { shown = false; stopLive?.(); stopLive = null; prev?.destroy(); others.forEach(o => o.destroy()); prev = null; others = []; } };
}

/** Display size sub-section. 0.2.3 U4: no preview pane - picking a size already resizes the whole app live. */
function displaySizeCard() {
  const box = h('div', { class: 'card', id: 'sec-display' });
  // 0.3.1 B16: card picker, a mini app mockup per size (Small 75 %, Default 100 %, Large 125 %); the whole UI scales as you pick
  const mock = f => h('div', { class: 'dsmock', style: `--mz:${f}` }, h('div', { class: 'dsm-top' }, h('i'), h('i'), h('i')),
    h('div', { class: 'dsm-body' }, h('div', { class: 'dsm-lib' }, h('i'), h('i'), h('i'), h('i')), h('div', { class: 'dsm-now' }, h('div', { class: 'dsm-art' }), h('i'), h('i')), h('div', { class: 'dsm-dev' }, h('i'), h('i'), h('i'))));
  function draw() {
    const cur = loadScale(), z = scaleFactor(cur);
    const cards = SCALES.map(([id, nm, f]) => pgCard({ id, name: `${nm} ${Math.round(f * 100)}%` + (id === 'compact' ? ' (default)' : ''), on: cur === id, preview: mock(f), attrs: { 'data-scale': id }, onSelect: v => { applyScale(v); draw(); } }));
    box.replaceChildren(h('h3', null, 'Display size'),
      h('p', { class: 'dim small' }, 'Makes the web UI larger or smaller on this phone or PC only. The whole app changes as you pick.'),
      gridEl('display', 'Display size', cards),
      h('p', { class: 'small dim', style: 'margin-top:8px' }, SCALES.some(([id]) => id === cur) ? `Now ${Math.round(z * 100)}%.` : `Now ${Math.round(z * 100)}% (your earlier choice). Pick a size above to change it.`),
      // 0.4.5 T1b: Layout - Auto / Roomy / Full (this phone or PC only)
      h('h3', { style: 'margin-top:14px' }, 'Layout'),
      h('p', { class: 'dim small' }, 'Roomy puts Devices behind a tab on the right edge and the Library on its rail, so Sound, the Queue and Now Playing get the width. Full is the classic layout. Auto picks Roomy on big high-DPI screens (like a 4K TV at 200%) and narrow windows.'),
      h('div', { class: 'seg laylayout', role: 'radiogroup', 'aria-label': 'Layout' }, LAYOUTS.map(([id, nm, tip]) => { const on = loadLayout() === id; return h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: 'segbtn' + (on ? ' on' : ''), 'data-layout': id, title: tip, onclick: () => { saveLayout(id); draw(); } }, nm + (id === 'full' ? ' (default)' : '')); })),
      h('p', { class: 'small dim', style: 'margin:6px 0 14px' }, 'Right now: ' + (document.querySelector('.desk')?.classList.contains('tight') || document.querySelector('.desk')?.classList.contains('roomy') ? 'Roomy' : 'Full') + '.'),
      // 0.3.3 G11: volume slider style (this phone or PC only)
      h('div', { class: 'setrow sliderstyle', id: 'sec-sliderstyle' }, h('div', { class: 'grow' }, h('div', null, 'Volume slider style'), h('div', { class: 'small dim' }, 'Gradient blends your theme’s main and second colors. Flat uses the main color. Default: Gradient.')),
        h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Volume slider style' }, SLIDER_STYLES.map(([id, nm]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(loadSlider() === id), class: loadSlider() === id ? 'on' : '', 'data-slider': id, onclick: () => { applySlider(id); draw(); } },
          h('span', { class: 'slsw ' + id, 'aria-hidden': 'true' }), nm)))));
  }
  draw();
  return { el: box, reload: draw };
}

// 0.3.5 J2: Display size is part of the theme - it sits on the Theme page (no Display size sub-tab any more)
export const APP_SUBS = [['theme', 'Theme'], ['viz', 'Visualizer'], ['eq', 'EQ'], ['np', 'Now Playing']];
const SUB_KEY = 'wavwiz.appsub';
/** 0.5.0 F125: phone Settings has no Appearance > Visualizer (phone Now Playing shows no visualizer); desktop keeps it. */
export const appSubsFor = (phone = isPhone()) => phone ? APP_SUBS.filter(([id]) => id !== 'viz') : APP_SUBS;
/** F125: on phone a 'viz' request (looks / section / saved sub) opens Theme instead. */
export const appSubFor = (id, phone = isPhone()) => (phone && id === 'viz') ? 'theme' : id;
/** The Appearance pane (0.2.2 T2; 0.2.5 C: sub-tabs on top): one sub-section at a time. `opts.section` opens a sub-section (the visualizer
 *  panel's Looks button opens Visualizer); otherwise the last one used in this session, else Theme. `opts.preview` builds the F9 strip. */
export function appearancePane(opts = {}) {
  const theme = themeCard(), viz = vizCard(), np = npStyleCard(null, opts.S || null, opts.npThumb || null), eqs = eqStyleCard(opts.S || null), disp = displaySizeCard();
  const mini = miniCard();
  const themePage = { el: h('div', { class: 'apptheme' }, theme.el, disp.el, mini.el), reload: () => { theme.reload?.(); disp.reload(); mini.reload(); }, hide: () => theme.hide?.() };
  const pages = { theme: themePage, viz, eq: eqs, np, display: themePage };
  let saved = null; try { saved = sessionStorage.getItem(SUB_KEY); } catch { /* ignore */ }
  let cur = opts.looks ? 'viz' : (pages[opts.section] ? opts.section : (pages[saved] ? saved : 'theme'));
  const phone = isPhone(); cur = appSubFor(cur, phone);
  if (phone && saved === 'viz') { try { sessionStorage.setItem(SUB_KEY, 'theme'); } catch { /* ignore */ } }
  const wantDisplay = cur === 'display'; if (cur === 'display') cur = 'theme';
  // 0.2.5 C: a row of sub-tabs right under the main Settings tabs (was a left column), so the content uses the full Settings width
  const nav = h('nav', { class: 'appnav subtabs', 'aria-label': 'Appearance sections' },
    appSubsFor(phone).map(([id, label]) => h('button', { type: 'button', 'data-sub': id, 'aria-current': String(id === cur), onclick: () => select(id) }, label)));
  const host = h('div', { class: 'appsub' });
  function select(id) {
    id = appSubFor(id, phone); if (!pages[id]) return;   // F125: no Visualizer sub on phone
    if (pages[cur] !== pages[id]) pages[cur].hide?.();
    cur = id; try { sessionStorage.setItem(SUB_KEY, id); } catch { /* ignore */ }
    nav.querySelectorAll('button').forEach(b => { const on = b.dataset.sub === id; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
    host.replaceChildren(pages[id].el, h('p', { class: 'small dim setfoot' }, 'Changes save automatically and apply to this device only.'));
    if (id === 'viz') requestAnimationFrame(() => { if (cur === 'viz' && host.isConnected) viz.reload(); });   // live previews need the page on screen
    else pages[id].reload?.();
    host.scrollTop = 0;
  }
  select(cur);
  if (wantDisplay) setTimeout(() => disp.el.scrollIntoView?.({ block: 'start' }), 60);
  const el = h('div', { class: 'appearance appstack' }, nav, host);
  /** Stop every live preview (Settings closed or another tab); `resume` restarts the visible one. */
  const hide = () => { viz.hide(); eqs.hide(); np.hide?.(); };
  const resume = () => { if (cur === 'viz' && !phone) viz.reload(); else if (cur === 'eq') eqs.reload(); };
  return { el, hide, resume, select, current: () => cur, theme, viz: { ...viz, reload: resume }, np, eqs, disp };
}

/** 0.3.5 J17: Settings > Appearance > Theme: the mini player's window transparency (the mini player follows at once; in WavWiz Player it is real
 *  window transparency). Same value as the mini player's own Transparency control and right-click menu. */
export function miniCard() {
  const val = h('span', { class: 'mono small' }), sl = h('input', { type: 'range', min: OPACITY_MIN, max: 100, step: 5, 'aria-label': 'Mini player transparency (opacity)', class: 'grow',
    oninput: () => { const v = clampOpacity(+sl.value); val.textContent = v + '%'; saveOpacity(v); } });
  const reload = () => { const v = loadOpacity(); sl.value = String(v); val.textContent = v + '%'; };
  reload();
  const el = h('div', { class: 'card appsec minicard', 'data-sec': 'mini' }, h('h3', null, 'Mini player'),
    h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Transparency'), sl, val),
    h('p', { class: 'small dim' }, '100% is solid. Lower values let you see what is behind the mini player; it changes live while you move the slider. Also in the mini player: right-click › Transparency.'));
  return { el, reload };
}
