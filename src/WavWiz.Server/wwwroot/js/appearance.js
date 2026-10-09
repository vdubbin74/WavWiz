// 0.2.1 F8: Settings > Appearance is one page - Theme, Visualizer, Now Playing style (with the F9 live preview) and Display size.
// The old View menu, Themes page and Visualizer page are folded in here. Everything is saved on this device only.
import { h } from './util.js';
import { SCALES, loadScale, applyScale } from './uiscale.js';
import { NP_STYLES, NP_EFFECTS, loadNpPrefs, saveNpPrefs } from './npstyle.js';
import { vizPrefs, saveVizPrefs, ENGINES } from './viz.js';
import { visualizerView } from './vizpage.js';
import { themeCard } from './themes.js';
import { EQ_STYLES, EQ_EXAMPLE, loadEqPrefs, saveEqPrefs } from './eqstyle.js';
import { eqArea } from './eqview.js';

/** Visualizer card: the active look as a dropdown + "Looks…" which unfolds the full gallery (live previews, colors, energy) in place. */
function vizCard(openLooks) {
  const box = h('div', { class: 'card', id: 'sec-viz' });
  let gallery = null, open = !!openLooks;
  const hide = () => { gallery?.hide?.(); };
  function draw() {
    const p = vizPrefs();
    const sel = h('select', { 'aria-label': 'Visualizer look', 'data-vizlook': '1', onchange: ev => { const x = vizPrefs(); x.engine = ev.target.value; x.on = true; saveVizPrefs(x); window.dispatchEvent(new CustomEvent('wavwiz:viz')); if (gallery) gallery.reload(); } },
      ENGINES.map(([k, t]) => h('option', { value: k, selected: p.engine === k }, t)));
    const host = h('div', { class: 'vizlooks', hidden: !open || undefined });
    box.replaceChildren(h('h3', null, 'Visualizer'),
      h('p', { class: 'dim small' }, 'The look in the Visualizer panel on this device.'),
      h('div', { class: 'setrow' }, h('div', { class: 'grow' }, h('div', null, 'Look'), h('div', { class: 'small dim' }, `${ENGINES.length} looks. Colors follow the theme.`)),
        sel, h('button', { class: 'btn', 'aria-expanded': String(open), 'data-looks': '1', onclick: () => { open = !open; draw(); } }, open ? 'Hide looks' : 'Looks…')),
      host);
    if (open) { gallery ??= visualizerView(); host.append(gallery.el); gallery.reload(); } else hide();
  }
  draw();
  return { el: box, hide, reload: draw };
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
    box.replaceChildren(h('h3', null, 'Now Playing style'),
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

/** 0.2.1 F12: EQ style (this device) - LED bars (default), Studio faders, Spectrum curve - with a small still preview of the Sound (EQ) area. */
function eqStyleCard() {
  const box = h('div', { class: 'card', id: 'sec-eqstyle' });
  let prev = null;
  function draw() {
    const p = loadEqPrefs();
    prev?.destroy(); prev = eqArea({ style: p.style, gains: [...EQ_EXAMPLE], glow: p.glow, interactive: false });
    box.replaceChildren(h('h3', null, 'EQ style'),
      h('p', { class: 'dim small' }, 'How the Sound (EQ) window looks on this device. All three set the same 10-band EQ.'),
      h('div', { class: 'row wrap', role: 'group', 'aria-label': 'EQ style' }, EQ_STYLES.map(([id, name, tip]) =>
        h('button', { class: 'chipbtn' + (p.style === id ? ' on' : ''), 'aria-pressed': String(p.style === id), title: tip, 'data-eqstyle': id, onclick: () => { saveEqPrefs({ ...loadEqPrefs(), style: id }); draw(); } }, name))),
      h('div', { class: 'eqprevbox', 'aria-label': 'Preview of the EQ style' }, h('div', { class: 'npprev-h' }, h('span', { class: 'npprev-live' }, h('i', { 'aria-hidden': 'true' }), 'PREVIEW'), h('span', { class: 'grow' }), h('span', { class: 'npprev-ex' }, 'EXAMPLE DATA')), prev.el));
  }
  draw();
  return { el: box, reload: draw };
}

function displaySizeCard() {
  const box = h('div', { class: 'card', id: 'sec-display' });
  function draw() {
    const cur = loadScale();
    box.replaceChildren(h('h3', null, 'Display size'),
      h('p', { class: 'dim small' }, 'Makes the web UI larger or smaller on this phone or PC only.'),
      h('div', { class: 'row wrap' }, SCALES.map(([id, name]) => h('button', { class: 'chipbtn' + (cur === id ? ' on' : ''), 'aria-pressed': String(cur === id), onclick: () => { applyScale(id); draw(); } }, name))));
  }
  draw();
  return { el: box, reload: draw };
}

/** The whole Appearance pane. `opts.looks` unfolds the visualizer gallery (the panel's Looks button); `opts.preview` builds the F9 strip. */
export function appearancePane(opts = {}) {
  const theme = themeCard(), viz = vizCard(opts.looks), np = npStyleCard(opts.preview?.() || null), eqs = eqStyleCard(), disp = displaySizeCard();
  const el = h('div', { class: 'appearance' }, theme.el, viz.el, np.el, eqs.el, disp.el,
    h('p', { class: 'small dim setfoot' }, 'Changes save automatically and apply to this device only.'));
  return { el, hide: viz.hide, theme, viz, np, eqs, disp };
}
