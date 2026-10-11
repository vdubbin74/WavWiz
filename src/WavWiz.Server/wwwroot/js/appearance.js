// Settings > Appearance. 0.2.1 F8 folded the View menu, Themes page and Visualizer page in here. 0.2.2 T2: one page was too crowded, so
// Appearance now has a left sub-nav - Theme, Visualizer, EQ, Now Playing, Display size - each its own page with a live preview of what it
// changes. Theme and Visualizer are the 0.2.0 dedicated-page layouts again. Everything is saved on this device only.
import { h } from './util.js';
import { SCALES, loadScale, applyScale, scaleFactor } from './uiscale.js';
import { NP_STYLES, NP_EFFECTS, loadNpPrefs, saveNpPrefs } from './npstyle.js';
import { Viz, vizPrefs, saveVizPrefs, ENGINES } from './viz.js';
import { VIZ_BLURB, vizName } from './vizcore.js';
import { visualizerView } from './vizpage.js';
import { themeCard } from './themes.js';
import { EQ_STYLES, EQ_EXAMPLE, loadEqPrefs, saveEqPrefs, glowWords } from './eqstyle.js';
import { eqArea } from './eqview.js';

const prevHead = (title, extra) => h('div', { class: 'npprev-h' }, h('span', { class: 'npprev-live' }, h('i', { 'aria-hidden': 'true' }), 'LIVE PREVIEW'), extra != null ? h('span', { class: 'small dim' }, extra) : null, h('span', { class: 'grow' }), h('span', { class: 'npprev-ex' }, title || 'EXAMPLE DATA'));

/** Visualizer sub-section (0.2.2 T2): a live mini visualizer of the active look + the Show switch, then the 0.2.0 Visualizer page
 *  (preview cards, Graphics, Reactivity, the active look's settings). Previews only run while this sub-section is on screen. */
function vizCard() {
  const box = h('div', { class: 'appsub-viz', id: 'sec-viz' });
  let gallery = null, live = null, running = false;
  const stage = h('div', { class: 'vlive-stage' }), name = h('b', null, ''), blurb = h('p', { class: 'small dim' }, ''), badge = h('span', { class: 'badge-active' }, 'ACTIVE');
  const show = h('input', { type: 'checkbox', 'data-vizshow': '1', onchange: ev => { const x = vizPrefs(); x.on = ev.target.checked; saveVizPrefs(x); window.dispatchEvent(new CustomEvent('wavwiz:viz')); } });
  const card = h('div', { class: 'npprev vlive', 'aria-label': 'Live preview of the visualizer' }, prevHead('EXAMPLE DATA', ''),
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
  function start() { running = true; gallery ??= visualizerView({ nested: true }); box.replaceChildren(card, gallery.el); gallery.reload(); paintLive(); }
  function hide() { running = false; gallery?.hide?.(); live?.destroy(); live = null; }
  box.replaceChildren(card); paintLive();
  return { el: box, hide, reload: start };
}

/** Now Playing (control panel) style + effects. Every effect 0-100 %, 50 % default. */
function npStyleCard(preview) {
  const box = h('div', { class: 'card', id: 'sec-npstyle' });
  function draw() {
    const p = loadNpPrefs();
    const slider = (k, label) => {
      const out = h('span', { class: 'small dim mono', style: 'min-width:3em;text-align:right' }, p[k] + '%');
      const r = h('input', { type: 'range', min: 0, max: 100, step: 1, value: p[k], class: 'grow', 'aria-label': label, 'data-npfx': k,
        oninput: ev => { out.textContent = ev.target.value + '%'; saveNpPrefs({ ...loadNpPrefs(), [k]: +ev.target.value }); preview?.update(); } });
      return h('label', { class: 'row', style: 'gap:10px;margin-top:6px' }, h('span', { style: 'min-width:8.5em' }, label), r, out);
    };
    box.replaceChildren(h('h3', null, 'Now Playing'),
      h('p', { class: 'dim small' }, 'How the playback controls under the visualizer look. Classic is the default.'),
      h('div', { class: 'row wrap', role: 'group', 'aria-label': 'Now Playing style' }, NP_STYLES.map(([id, name, tip]) =>
        h('button', { class: 'chipbtn' + (p.style === id ? ' on' : ''), 'aria-pressed': String(p.style === id), title: tip, 'data-npstyle': id, onclick: () => { saveNpPrefs({ ...loadNpPrefs(), style: id }); draw(); } }, name))),
      preview ? preview.el : null,
      h('div', { class: 'sec', style: 'margin-top:12px' }, 'Effects'), slider('fx', 'Panel effects'), ...NP_EFFECTS.map(([k, l]) => slider(k, l)),
      h('div', { class: 'row', style: 'margin-top:6px' }, h('p', { class: 'small dim grow', style: 'margin:0' }, 'Panel effects scales all of them at once. Each starts at 50% and goes up to 100%.'),
        h('button', { class: 'btn', onclick: () => { saveNpPrefs({ style: loadNpPrefs().style }); draw(); } }, 'Reset effects')));
    preview?.update();
  }
  draw();
  return { el: box, reload: draw };
}

/** EQ sub-section (0.2.2 T2, fuller page): the three EQ looks (LED bars default), a big live preview of the chosen look you can try out
 *  (example gains, never sent to a speaker), small previews of the other looks, and the glow level (0-100 %, 50 % default). */
function eqStyleCard() {
  const box = h('div', { class: 'card', id: 'sec-eqstyle' });
  let prev = null, others = [];
  function draw() {
    const p = loadEqPrefs(), [gl, gh] = glowWords(p.style);
    prev?.destroy(); others.forEach(o => o.destroy());
    prev = eqArea({ style: p.style, gains: [...EQ_EXAMPLE], glow: p.glow, interactive: true });   // try-out only: no onChange, nothing is sent
    prev.exampleSpectrum?.();
    others = EQ_STYLES.filter(([id]) => id !== p.style).map(([id]) => Object.assign(eqArea({ style: id, gains: [...EQ_EXAMPLE], glow: p.glow, interactive: false }), { id }));
    const name = (EQ_STYLES.find(([id]) => id === p.style) || EQ_STYLES[0])[1];
    const glowOut = h('span', { class: 'small dim mono', style: 'min-width:3em;text-align:right' }, p.glow + '%');
    box.replaceChildren(h('h3', null, 'EQ style'),
      h('p', { class: 'dim small' }, 'How the Sound (EQ) window looks on this device. All three set the same 10-band EQ.'),
      h('div', { class: 'row wrap', role: 'group', 'aria-label': 'EQ style' }, EQ_STYLES.map(([id, nm, tip]) =>
        h('button', { class: 'chipbtn' + (p.style === id ? ' on' : ''), 'aria-pressed': String(p.style === id), title: tip, 'data-eqstyle': id, onclick: () => { saveEqPrefs({ ...loadEqPrefs(), style: id }); draw(); } }, nm + (id === 'led' ? ' (default)' : '')))),
      h('div', { class: 'eqprevbox eqprev-big', 'aria-label': 'Preview of the EQ style' }, prevHead('EXAMPLE DATA', `${name} - try it: drag a ${p.style === 'curve' ? 'node' : p.style === 'faders' ? 'fader' : 'cap'}`), prev.el,
        h('p', { class: 'small dim npprev-cap' }, 'Updates as you pick. Trying it here does not change any speaker.')),
      h('div', { class: 'sec', style: 'margin-top:12px' }, 'Other styles'),
      h('div', { class: 'eqothers' }, others.map(o => h('button', { type: 'button', class: 'eqother', 'data-eqstyle': o.id, 'aria-label': `Use ${EQ_STYLES.find(([id]) => id === o.id)[1]}`, onclick: () => { saveEqPrefs({ ...loadEqPrefs(), style: o.id }); draw(); } },
        h('div', { class: 'eqother-prev', inert: '' }, o.el), h('span', null, EQ_STYLES.find(([id]) => id === o.id)[1])))),
      h('label', { class: 'row', style: 'gap:10px;margin-top:12px' }, h('span', { style: 'min-width:8.5em' }, h('div', null, gl), h('div', { class: 'small dim' }, gh + '. 50% default, 100% max.')),
        h('input', { type: 'range', min: 0, max: 100, step: 1, value: p.glow, class: 'grow', 'aria-label': gl, 'data-eqglow': '1',
          oninput: ev => { const v = +ev.target.value; glowOut.textContent = v + '%'; saveEqPrefs({ ...loadEqPrefs(), glow: v }); prev.setGlow?.(v); others.forEach(o => o.setGlow?.(v)); } }), glowOut));
  }
  draw();
  return { el: box, reload: draw, hide: () => { prev?.destroy(); others.forEach(o => o.destroy()); prev = null; others = []; } };
}

/** Display size sub-section: the five sizes + a preview slice of the UI (a Playlist strip) drawn at the chosen size. */
function displaySizeCard() {
  const box = h('div', { class: 'card', id: 'sec-display' });
  function draw() {
    const cur = loadScale(), z = scaleFactor(cur), name = (SCALES.find(([id]) => id === cur) || SCALES[1])[1];
    const row = (n, t, a, d, on) => h('div', { class: 'ds-row' + (on ? ' on' : '') }, h('span', { class: 'ds-n' }, on ? '▶' : String(n)), h('b', { class: 'ell' }, t), h('span', { class: 'ell ds-a' }, a), h('span', { class: 'ds-d' }, d));
    box.replaceChildren(h('h3', null, 'Display size'),
      h('p', { class: 'dim small' }, 'Makes the web UI larger or smaller on this phone or PC only.'),
      h('div', { class: 'row wrap', role: 'group', 'aria-label': 'Display size' }, SCALES.map(([id, nm]) => h('button', { class: 'chipbtn' + (cur === id ? ' on' : ''), 'aria-pressed': String(cur === id), 'data-scale': id, onclick: () => { applyScale(id); draw(); } }, nm))),
      h('div', { class: 'npprev dsprev', 'aria-label': 'Preview of the display size' }, prevHead('EXAMPLE DATA', `${name.replace(' (default)', '')} - ${Math.round(z * 100)}%`),
        h('div', { class: 'ds-stage', inert: '' }, h('div', { class: 'ds-ui', style: `font-size:${(13 * z).toFixed(1)}px` },
          h('div', { class: 'ds-h' }, h('span', { class: 'ds-title' }, 'PLAYLIST'), h('span', { class: 'grow' }), h('span', { class: 'ds-btn' }, 'Save as playlist'), h('span', { class: 'ds-btn' }, 'Clear')),
          row(1, 'Night Swim', 'Faded Atlas', '03:20', true), row(2, 'Paper Satellites', 'Amber Kites', '04:05', false)))));
  }
  draw();
  return { el: box, reload: draw };
}

export const APP_SUBS = [['theme', 'Theme'], ['viz', 'Visualizer'], ['eq', 'EQ'], ['np', 'Now Playing'], ['display', 'Display size']];
const SUB_KEY = 'wavwiz.appsub';
/** The Appearance pane (0.2.2 T2): left sub-nav + one sub-section at a time. `opts.section` opens a sub-section (the visualizer
 *  panel's Looks button opens Visualizer); otherwise the last one used in this session, else Theme. `opts.preview` builds the F9 strip. */
export function appearancePane(opts = {}) {
  const theme = themeCard(), viz = vizCard(), np = npStyleCard(opts.preview?.() || null), eqs = eqStyleCard(), disp = displaySizeCard();
  const pages = { theme, viz, eq: eqs, np, display: disp };
  let saved = null; try { saved = sessionStorage.getItem(SUB_KEY); } catch { /* ignore */ }
  let cur = opts.looks ? 'viz' : (pages[opts.section] ? opts.section : (pages[saved] ? saved : 'theme'));
  const nav = h('nav', { class: 'appnav', 'aria-label': 'Appearance sections' }, h('div', { class: 'appnav-h' }, 'APPEARANCE'),
    APP_SUBS.map(([id, label]) => h('button', { type: 'button', 'data-sub': id, 'aria-current': String(id === cur), onclick: () => select(id) }, label)));
  const host = h('div', { class: 'appsub' });
  function select(id) {
    if (pages[cur] !== pages[id]) pages[cur].hide?.();
    cur = id; try { sessionStorage.setItem(SUB_KEY, id); } catch { /* ignore */ }
    nav.querySelectorAll('button').forEach(b => { const on = b.dataset.sub === id; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
    host.replaceChildren(pages[id].el, h('p', { class: 'small dim setfoot' }, 'Changes save automatically and apply to this device only.'));
    if (id === 'viz') requestAnimationFrame(() => { if (cur === 'viz' && host.isConnected) viz.reload(); });   // live previews need the page on screen
    else pages[id].reload?.();
    host.scrollTop = 0;
  }
  select(cur);
  const el = h('div', { class: 'appearance appsplit' }, nav, host);
  /** Stop every live preview (Settings closed or another tab); `resume` restarts the visible one. */
  const hide = () => { viz.hide(); eqs.hide(); };
  const resume = () => { if (cur === 'viz') viz.reload(); else if (cur === 'eq') eqs.reload(); };
  return { el, hide, resume, select, current: () => cur, theme, viz: { ...viz, reload: resume }, np, eqs, disp };
}
