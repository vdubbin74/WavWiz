// Visualizer page (View > Visualizer, phone hamburger > View > Visualizer). 0.0.7: live preview cards, colors, energy. 0.0.8: tapping a card makes it
// the active look WITHOUT rebuilding the previews (0.0.7 tore down and re-created every WebGL preview on each tap - part of the crash), the "Adjust"
// button is gone (the settings of the selected look are always shown below), each look has its own effect controls, and a device-wide Sensitivity /
// auto-gain card drives how strongly every look reacts. 0.1.3: every level is a 0-100 % slider (default 50 %), Mood became the Energy level, the
// Detail choice became Quality (Auto / Low / High / Ultra), and a Graphics card holds the post-processing knobs (bloom, streaks, fringing, depth blur).
import { h, toast } from './util.js';
import { Viz, vizPrefs, saveVizPrefs } from './viz.js';
import { VIZ_LIST, VIZ_BLURB, vizName, loadSettings, saveSettings, resetSettings, SHARED, FX, loadReact, saveReact, loadPost, savePost, POST, QUALITY_LIST, DEFAULT_REACT } from './vizcore.js';

export function visualizerView() {
  const root = h('div', { class: 'viz-page' }); let previews = [], editing = null, cards = {}, ctlHost = null;
  const changed = () => window.dispatchEvent(new CustomEvent('wavwiz:vizsettings'));
  function setActive(k) {
    const p = vizPrefs(), was = p.engine; p.engine = k; p.on = true; saveVizPrefs(p); window.dispatchEvent(new CustomEvent('wavwiz:viz'));
    editing = k; markCards(); drawControls(); if (was !== k) toast(vizName(k) + ' is now the visualizer');
  }
  function stopPreviews() { previews.forEach(v => v.destroy()); previews = []; }
  function markCards() {
    const p = vizPrefs();
    for (const [k, c] of Object.entries(cards)) {
      const active = p.on && p.engine === k; c.classList.toggle('on', active); c.classList.toggle('edit', editing === k);
      c.setAttribute('aria-label', `${vizName(k)}${active ? ' (active)' : ''}`); c.setAttribute('aria-pressed', String(active));
      c.querySelector('.badge-active')?.classList.toggle('hidden', !active);
    }
  }
  const pctFmt = v => Math.round(v) + '%';
  /** A 0-100 % level slider (default 50 %); 0 % reads "Off" where the effect switches off. */
  function slider({ label, value, hint, offAtZero = false, onInput, key }) {
    const fmt = v => (offAtZero && Math.round(v) === 0 ? 'Off' : pctFmt(v));
    const out = h('span', { class: 'small dim mono' }, fmt(value));
    const input = h('input', { type: 'range', min: 0, max: 100, step: 1, value, 'aria-label': label, oninput: ev => { out.textContent = fmt(+ev.target.value); onInput(+ev.target.value); } });
    if (key) input.dataset.fx = key;
    return h('label', { class: 'vslider' }, h('span', { class: 'vsl-l' }, label), input, out, hint ? h('span', { class: 'small dim vsl-h' }, hint) : null);
  }
  function controls(k) {
    const s = loadSettings(k), box = h('div', { class: 'card vizctl', 'data-viz': k });
    const save = patch => { Object.assign(s, patch); saveSettings(k, s); changed(); };
    const saveFx = patch => { s.fx = { ...(s.fx || {}), ...patch }; saveSettings(k, s); changed(); };
    const custom = h('div', { class: 'row wrap vcolors', style: s.colorMode === 'custom' ? '' : 'display:none' },
      ...[['primary', 'Primary'], ['secondary', 'Secondary'], ['accent', 'Accent']].map(([key, label]) => h('label', { class: 'row tp-pick' }, h('input', { type: 'color', value: s[key], 'aria-label': `${label} color`, oninput: ev => save({ [key]: ev.target.value.toUpperCase() }) }), label)));
    const mode = v => h('label', { class: 'row' }, h('input', { type: 'radio', name: 'vcm-' + k, checked: s.colorMode === v, onchange: () => { save({ colorMode: v }); custom.style.display = v === 'custom' ? '' : 'none'; } }), v === 'theme' ? 'Follow the theme' : 'Custom colors');
    const fxEls = (FX[k] || []).map(([key, label, map, choices, def]) => {
      if (map === null) return h('label', { class: 'row wrap vchoice' }, h('span', { class: 'vsl-l' }, label), h('select', { 'aria-label': label, 'data-fx': key, onchange: ev => saveFx({ [key]: ev.target.value }) }, choices.map(([v, t]) => h('option', { value: v, selected: v === (s.fx?.[key] ?? def) }, t))));
      return slider({ label, value: s.fx?.[key] ?? 50, hint: choices, key, offAtZero: map[0] === 0, onInput: v => saveFx({ [key]: v }) });
    });
    box.append(h('h3', null, `${vizName(k)} settings`),
      fxEls.length ? h('div', { class: 'sec' }, 'Effects') : null, ...fxEls,
      h('div', { class: 'sec' }, 'Colors'), h('div', { class: 'row wrap' }, mode('theme'), mode('custom')), custom,
      h('div', { class: 'sec' }, 'Energy'), ...SHARED.map(([key, label, map, hint]) => slider({ label, value: s[key], hint, key, offAtZero: map[0] === 0, onInput: v => save({ [key]: v }) })),
      h('div', { class: 'row wrap', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: () => { resetSettings(k); changed(); drawControls(); } }, 'Reset this look')));
    return box;
  }
  function reactCard() {
    const r = loadReact(), set = patch => { saveReact({ ...loadReact(), ...patch }); changed(); };
    return h('div', { class: 'card vizreact' }, h('h3', null, 'Reactivity (all looks)'),
      slider({ label: 'Energy', value: r.energy, hint: '0 % = calm and soothing, 50 % = lively but refined, 100 % = big, fast motion', key: 'energy', onInput: v => set({ energy: v }) }),
      slider({ label: 'Sensitivity', value: r.sensitivity, hint: 'higher = bigger motion and more beats detected', key: 'sensitivity', onInput: v => set({ sensitivity: v }) }),
      slider({ label: 'Auto-gain', value: r.autoGain, offAtZero: true, hint: 'quiet and loud songs move the same (0 % = off)', key: 'autoGain', onInput: v => set({ autoGain: v }) }),
      h('div', { class: 'row wrap', style: 'margin-top:6px' }, h('button', { class: 'btn', onclick: () => { saveReact({ ...DEFAULT_REACT }); changed(); draw(); } }, 'Reset reactivity')));
  }
  function graphicsCard(p) {
    const post = loadPost(), set = patch => { savePost({ ...loadPost(), ...patch }); changed(); };
    const quality = h('select', { 'aria-label': 'Visualizer quality', 'data-quality': '1', onchange: ev => { const x = vizPrefs(); x.quality = ev.target.value; saveVizPrefs(x); window.dispatchEvent(new CustomEvent('wavwiz:viz')); changed(); } },
      QUALITY_LIST.map(([v, t]) => h('option', { value: v, selected: p.quality === v }, t)));
    return h('div', { class: 'card vizgfx' }, h('h3', null, 'Graphics (this device)'),
      h('label', { class: 'row wrap vchoice' }, h('span', { class: 'vsl-l' }, 'Quality'), quality),
      h('p', { class: 'small dim' }, 'Auto keeps phones light and smooth (it steps down by itself if frames start to slip) and gives desktop graphics cards full resolution, far more particles and longer trails. Ultra is for strong PCs.'),
      ...POST.map(([key, label, , hint]) => slider({ label, value: post[key], hint, key, offAtZero: true, onInput: v => set({ [key]: v }) })),
      h('div', { class: 'row wrap', style: 'margin-top:6px' }, h('button', { class: 'btn', onclick: () => { savePost({}); changed(); draw(); } }, 'Reset graphics')));
  }
  function drawControls() { if (ctlHost) ctlHost.replaceChildren(controls(editing)); }
  function draw() {
    stopPreviews(); cards = {};
    const p = vizPrefs(); editing = editing || p.engine;
    const grid = h('div', { class: 'vizgrid' });
    for (const [k] of VIZ_LIST) {
      const host = h('div', { class: 'vp-host' });
      const card = h('div', { class: 'vizcard', 'data-viz': k, role: 'button', tabindex: 0,
        onclick: () => setActive(k), onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setActive(k); } } },
        host, h('div', { class: 'vp-meta' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, vizName(k)), h('span', { class: 'badge-active hidden' }, 'ACTIVE')),
          h('div', { class: 'small dim' }, VIZ_BLURB[k])));
      cards[k] = card; grid.append(card);
      const v = new Viz(host, { engine: k, preview: true }); previews.push(v); requestAnimationFrame(() => v.start());
    }
    ctlHost = h('div', { class: 'vizctl-host' });
    root.replaceChildren(
      h('p', { class: 'dim small' }, 'Tap a look to use it on Now Playing; its settings appear below. Each look follows the theme colors unless you switch it to Custom. Every level runs 0–100 % (50 % is the default). Settings are saved for each look on this device.'),
      grid,
      h('div', { class: 'card' }, h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: p.on, onchange: ev => { const x = vizPrefs(); x.on = ev.target.checked; saveVizPrefs(x); window.dispatchEvent(new CustomEvent('wavwiz:viz')); markCards(); } }), 'Show the visualizer on Now Playing')),
      graphicsCard(p), reactCard(), ctlHost);
    markCards(); drawControls();
  }
  return { el: root, reload: draw, hide: stopPreviews };
}
