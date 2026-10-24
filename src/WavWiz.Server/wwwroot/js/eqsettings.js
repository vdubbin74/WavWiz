// WavWiz 0.3.7 L7: "All sound settings" - everything beyond the 10 bands, shown IN PLACE under the EQ (no popup): preset list, Bass, Treble, Trim, Balance,
// Loudness, Limiter, Bypass and Auto pre-gain. The ONE padlock on the EQ title bar locks all of it. The same panel is embedded in Speaker settings.
import { h } from './util.js';
import { fmtDb } from './eqstyle.js';

/** Preset names by purpose (situation / speaker type / music); anything else (the user's own) goes under "My sounds". */
export const PRESET_GROUPS = [];   // 0.4.2: a flat list of 8 built-ins (no group headings); the user's own go under "My presets"
export const LOCK_HINT = 'Locked - click the padlock to unlock the sound settings';
/** Pure: how a preset list is grouped for the select. */
export function groupPresets(presets) {
  const byName = new Map(presets.map(p => [p.name, p])), used = new Set();
  const out = [];
  const flat = byName.get('Flat'); if (flat) { out.push({ label: '', items: [flat] }); used.add('Flat'); }
  for (const [label, names] of PRESET_GROUPS) { const items = names.map(n => byName.get(n)).filter(Boolean); items.forEach(p => used.add(p.name)); if (items.length) out.push({ label, items }); }

  const ordered = ['Bass Boost', 'Treble Boost', 'Vocal', 'Late Night', 'Movie Night', 'Bluetooth Speaker', 'Rock / Metal'].map(n => byName.get(n)).filter(p => p && !used.has(p.name)); ordered.forEach(p => used.add(p.name)); if (ordered.length) out.push({ label: '', items: ordered });
  const mine2 = presets.filter(p => !used.has(p.name) && p.source !== 'builtin');
  if (mine2.length) out.push({ label: 'My presets', items: mine2 });
  return out;
}

/** api: { cur() -> preset, changed(), presets() -> [], presetId(), pick(p), saveAs(name) , flat(), revert() }. Returns { el, repaint(), setLocked(v) }. */
export function soundSettings(api) {
  let locked = false;
  const root = h('div', { class: 'eqall', role: 'group', 'aria-label': 'All sound settings' });
  const note = h('p', { class: 'small eqall-lock', hidden: true }, LOCK_HINT);
  const knob = (lbl, range, get, set, min, max, step = 0.5, unit = ' dB', fmt = v => fmtDb(v) + unit) => {
    const out = h('b', { class: 'mono eqknobv' }, fmt(get()));
    const r = h('input', { type: 'range', min, max, step, value: get(), 'aria-label': lbl, oninput: ev => { set(+ev.target.value); out.textContent = fmt(+ev.target.value); api.changed(); } });
    return { el: h('label', { class: 'eqknob' }, h('div', { class: 'row' }, h('span', { class: 'grow' }, lbl), out), r, h('div', { class: 'small dim' }, range)), r };
  };
  const sw = (lbl, hint, get, set) => {
    const i = h('input', { type: 'checkbox', role: 'switch', checked: get(), 'aria-label': lbl, onchange: ev => { set(ev.target.checked); api.changed(); } });
    return { el: h('label', { class: 'eqsw' }, h('span', { class: 'switch' }, i, h('span', { 'aria-hidden': 'true' })), h('span', null, h('b', null, lbl), h('span', { class: 'small dim' }, hint))), i };
  };
  let ctls = [];
  function paintPresets(sel) {
    const cur = api.presetId();
    sel.replaceChildren(h('option', { value: '', selected: cur == null }, 'Custom'), ...groupPresets(api.presets()).map(g => {
      const opts = g.items.map(p => h('option', { value: String(p.id), selected: p.id === cur }, p.name));
      return g.label ? h('optgroup', { label: g.label }, ...opts) : opts;
    }).flat());
  }
  function repaint() {
    const c = api.cur(); ctls = [];
    const sel = h('select', { 'aria-label': 'Preset', class: 'eqall-preset', onchange: ev => { const p = api.presets().find(x => String(x.id) === ev.target.value); if (p) api.pick(p); } });
    paintPresets(sel);
    const nameIn = h('input', { type: 'text', maxlength: 40, placeholder: 'Name this sound', 'aria-label': 'Name for a new preset', class: 'eqall-name' });
    const saveBtn = h('button', { type: 'button', class: 'btn sm', 'data-act': 'saveas', onclick: () => { const n = nameIn.value.trim(); if (!n) { nameIn.focus(); return; } api.saveAs(n); nameIn.value = ''; } }, 'Save as…');
    const bass = knob('Bass', '−12 to +12 dB', () => c.bass.gainDb, v => { c.bass = { ...c.bass, gainDb: v }; }, -12, 12);
    const treble = knob('Treble', '−12 to +12 dB', () => c.treble.gainDb, v => { c.treble = { ...c.treble, gainDb: v }; }, -12, 12);
    const trim = knob('Trim', '−24 to +6 dB', () => c.trimDb, v => { c.trimDb = v; }, -24, 6);
    const bal = knob('Balance', 'Left ← → Right', () => c.balance ?? 0, v => { c.balance = v; }, -100, 100, 1, '', v => (v === 0 ? 'Center' : v < 0 ? `L ${-v}` : `R ${v}`));
    const pre = sw('Auto pre-gain', 'Prevents clipping when boosting', () => c.autoPreamp, v => { c.autoPreamp = v; });
    const loud = sw('Loudness', 'More bass and treble at low volume', () => c.loudness.enabled, v => { c.loudness = { ...c.loudness, enabled: v }; });
    const lim = sw('Limiter', 'Protects the speaker', () => c.limiter.enabled, v => { c.limiter = { ...c.limiter, enabled: v }; });
    const byp = sw('Bypass', 'Hear the speaker without EQ', () => c.bypass, v => { c.bypass = v; });
    ctls = [sel, nameIn, saveBtn, bass.r, treble.r, trim.r, bal.r, pre.i, loud.i, lim.i, byp.i];
    root.replaceChildren(note, h('div', { class: 'eqall-top row' }, h('span', { class: 'eqlbl' }, 'PRESET'), sel, h('span', { class: 'grow' }), nameIn, saveBtn),
      h('div', { class: 'eqknobs' }, bass.el, treble.el, trim.el, bal.el), h('div', { class: 'eqsws' }, pre.el, loud.el, lim.el, byp.el),
      h('div', { class: 'eqfoot row' }, h('button', { type: 'button', class: 'btn sm', onclick: () => api.flat() }, 'Flat'), h('button', { type: 'button', class: 'btn sm', onclick: () => api.revert() }, 'Revert')));
    setLocked(locked);
  }
  function setLocked(v) { locked = !!v; ctls.forEach(x => { x.disabled = locked; }); root.classList.toggle('locked', locked); note.hidden = !locked; root.querySelectorAll('.eqfoot button').forEach(b => { b.disabled = locked; }); }
  repaint();
  return { el: root, repaint, setLocked };
}
