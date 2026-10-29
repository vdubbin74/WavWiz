// Per-speaker "Sound (EQ)" dialog. 0.2.1 F12: redesigned in three looks (Settings > Appearance > EQ style): LED bars (default), Studio faders,
// Spectrum curve. All three drive the same real DSP (10 bands 31 Hz - 16 kHz, ±12 dB, 0.5 dB steps, per speaker); only the main EQ area
// differs. Header (speaker + preset), Bass / Treble / Trim, the switches, Spectrum glow and the footer are shared. Changes preview live on the
// picked speaker; Save asks for a name when it makes a new preset (no name box in the footer).
import { groupPresets } from './eqsettings.js';   // 0.4.4 F6
import { h, api, toast, dialog, debounce } from './util.js';
import { eqArea, eqLockBox } from './eqview.js';
import { loadEqPrefs, saveEqPrefs, glowWords, fmtDb, loadEqLock, saveEqLock, eqTarget } from './eqstyle.js';
import { thisDevice } from './ui.js';
import { spectrumTap } from './viz.js';

/** A flat (neutral) EQ; exported for the Appearance > EQ preview (0.2.3 U10). */
export const flatEq = () => ({ name: 'Custom', graphicDb: new Array(10).fill(0), trimDb: 0, preampDb: 0, autoPreamp: true, bypass: false, bass: { gainDb: 0, hz: 100 }, treble: { gainDb: 0, hz: 10000 }, loudness: { enabled: false, refVolume: 80 }, limiter: { enabled: true, ceilingDb: -0.3, releaseMs: 120, lookaheadMs: 0 } });

/** 0.3.0 §3.4: "Sound · Kitchen" */
export const soundTitle = speaker => (speaker ? `Sound · ${speaker}` : 'Sound (EQ)');
/** 0.3.5 J9 #5: with `host` the Sound / EQ editor is drawn inline (the open speaker card's Sound / EQ section) instead of a window.
 *  Returns { close } either way. */
export async function openEq(S, refresh, deviceId, host = null) {
  const outputs = S.zones.flatMap(z => z.outputs.map(o => ({ ...o, zone: z.name }))).filter(o => o.connected || o.active);
  if (!outputs.length) return toast('No speaker is connected yet.', true);
  let presets = []; try { presets = await api('/dsp/presets'); } catch (e) { return toast(e.message, true); }
  // 0.3.0 §3.4: no picker in the Sound window - it adjusts this device's own speaker (or the one asked for), named in the title
  const own = eqTarget(S.zones, thisDevice(S));
  let dev = deviceId && outputs.find(o => o.deviceId === deviceId) ? deviceId : (own?.deviceId ?? outputs.find(o => o.active)?.deviceId ?? outputs[0].deviceId);
  const devOut = outputs.find(o => o.deviceId === dev);
  let cur = flatEq(), presetId = null, dirty = false, previewing = false, area = null, lastResp = null;
  const body = h('div', { class: 'eqdlg' });
  const onClose = async () => { area?.destroy(); if (previewing) { try { await api('/dsp/revert', { method: 'POST', body: { deviceId: dev } }); } catch { /* gone */ } } window.dispatchEvent(new CustomEvent('wavwiz:eqchanged', { detail: { deviceId: dev } })); refresh && refresh(); };
  let d;
  if (host) {   // inline: same header (title, Lock EQ) and body, closed by the card
    const el = h('div', { class: 'eqinline' }, h('header', { class: 'eqi-h' }, h('span', { class: 'grow' }, soundTitle(devOut?.zone)), h('button', { class: 'btn sm', type: 'button', onclick: () => d.close() }, 'Done')), h('div', { class: 'body' }, body));
    host.replaceChildren(el); d = { el, close: () => { el.remove(); onClose(); } };
  } else d = dialog(soundTitle(devOut?.zone), body, [], { cls: 'eqdialog', onClose });
  d.el.querySelector('header .grow')?.append(h('span', { class: 'small dim eqsub' }, 'Changes play live on this speaker.'));
  // 0.2.3 U9: Lock EQ in the header (remembered on this device): the sliders then ignore the wheel, drag and click
  const lock = eqLockBox(loadEqLock(), v => { saveEqLock(v); area?.setLocked(v); });
  d.el.querySelector('header .grow')?.after(lock.el);

  const liveTag = h('span', { class: 'eqprev small', hidden: true }, h('i', { 'aria-hidden': 'true' }), 'Previewing live');
  const preGain = h('span', { class: 'eqpregain', hidden: true, title: 'Level drop applied by Auto pre-gain so boosts never clip' });
  const sync = debounce(async () => {
    try { lastResp = await api('/dsp/response', { method: 'POST', body: { preset: cur } }); area?.setResponse(lastResp); preGain.hidden = !lastResp.preGainDb; preGain.textContent = `${fmtDb(lastResp.preGainDb || 0)} dB`; } catch { area?.setResponse(null); }
    try { await api('/dsp/preview', { method: 'POST', body: { deviceId: dev, preset: cur, bypass: cur.bypass } }); previewing = true; liveTag.hidden = false; } catch (e) { toast(e.message, true); }
  }, 150);
  const changed = () => { if (!dirty) { dirty = true; paintPreset(); } sync(); };

  const preSel = h('select', { 'aria-label': 'Preset', onchange: ev => { const p = presets.find(x => String(x.id) === ev.target.value); if (p) { cur = { ...flatEq(), ...structuredClone(p.json) }; presetId = p.id; dirty = false; paintAll(); sync(); } } });
  function paintPreset() {
    preSel.replaceChildren(h('option', { value: '', selected: dirty || presetId == null }, 'Custom'),
      ...groupPresets(presets).map(g => { const opts = g.items.map(p => h('option', { value: p.id, selected: !dirty && p.id === presetId }, p.name)); return g.label ? h('optgroup', { label: g.label }, ...opts) : opts; }).flat());   // 0.4.4 F6: the 8 built-ins, then "My presets" (no legacy built-ins)
  }
  const mainHost = h('div', { class: 'eqmain' });
  function buildArea() {
    area?.destroy();
    area = eqArea({ style: loadEqPrefs().style, gains: cur.graphicDb, glow: loadEqPrefs().glow, locked: loadEqLock(), onChange: (i, db) => { cur.graphicDb[i] = db; changed(); } });
    mainHost.replaceChildren(area.el); area.setResponse(lastResp); area.exampleSpectrum?.(); area.startLive(spectrumTap);   // 0.5.1: LEDs always live; Glow 0 only drops the halo (was: frozen example frame)
  }
  // shared lower card: Bass / Treble / Trim, switches, Spectrum glow
  const knob = (lbl, range, get, set, min, max) => {
    const out = h('b', { class: 'mono eqknobv' }, fmtDb(get()) + ' dB');
    const r = h('input', { type: 'range', min, max, step: 0.5, value: get(), 'aria-label': lbl, oninput: ev => { set(+ev.target.value); out.textContent = fmtDb(+ev.target.value) + ' dB'; changed(); } });
    return { el: h('label', { class: 'eqknob' }, h('div', { class: 'row' }, h('span', { class: 'grow' }, lbl), out), r, h('div', { class: 'small dim' }, range)), r, out, get };
  };
  const sw = (lbl, hint, get, set, extra) => {
    const i = h('input', { type: 'checkbox', role: 'switch', checked: get(), 'aria-label': lbl, onchange: ev => { set(ev.target.checked); changed(); } });
    return { el: h('label', { class: 'eqsw' }, h('span', { class: 'switch' }, i, h('span', { 'aria-hidden': 'true' })), h('span', null, h('b', null, lbl), h('span', { class: 'small dim' }, hint), extra ? h('span', { class: 'eqsw-extra' }, extra) : null)), i, get };   // 0.2.2 T1: a badge sits on its own line, never over the next switch
  };
  let ctl = [];
  const lower = h('div', { class: 'card eqlower' });
  function buildLower() {
    const bass = knob('Bass', '−12 to +12 dB', () => cur.bass.gainDb, v => { cur.bass = { ...cur.bass, gainDb: v }; }, -12, 12);
    const treble = knob('Treble', '−12 to +12 dB', () => cur.treble.gainDb, v => { cur.treble = { ...cur.treble, gainDb: v }; }, -12, 12);
    const trim = knob('Trim', '−24 to +6 dB', () => cur.trimDb, v => { cur.trimDb = v; }, -24, 6);
    const sws = [sw('Auto pre-gain', 'Prevents clipping when boosting', () => cur.autoPreamp, v => { cur.autoPreamp = v; }, preGain),
      sw('Loudness', 'More bass and treble at low volume', () => cur.loudness.enabled, v => { cur.loudness = { ...cur.loudness, enabled: v }; }),
      sw('Limiter', 'Protects the speaker', () => cur.limiter.enabled, v => { cur.limiter = { ...cur.limiter, enabled: v }; }),
      sw('Bypass', 'Hear the speaker without EQ', () => cur.bypass, v => { cur.bypass = v; })];
    const st = loadEqPrefs(), [gl, gh] = glowWords(st.style);
    const gOut = h('b', { class: 'mono' }, st.glow + '%');
    const glowR = h('input', { type: 'range', min: 0, max: 100, step: 1, value: st.glow, 'aria-label': gl, 'data-eqglow': '1', oninput: ev => { const v = +ev.target.value; gOut.textContent = v + '%'; area?.setGlow(v); if (glowWasOff(lastGlow, v)) area?.startLive(spectrumTap); lastGlow = v; },
      // 0.3.3 G14: saving fired 'wavwiz:eqstyle' on every input, which rebuilt this dialog (buildArea + buildLower) and replaced the slider under the
      // pointer - the drag stuck. Now dragging only moves the label and the glow; the value is saved once on change; Live starts only on 0 -> >0.
      onchange: ev => { const v = +ev.target.value; saveEqPrefs({ ...loadEqPrefs(), glow: v }); try { window.dispatchEvent(new CustomEvent('wavwiz:eqglow', { detail: v })); } catch { /* ok */ } } });
    let lastGlow = st.glow;
    ctl = [bass, treble, trim, ...sws];
    lower.replaceChildren(h('div', { class: 'eqknobs' }, bass.el, treble.el, trim.el), h('div', { class: 'eqsws' }, sws.map(s => s.el)),
      h('div', { class: 'eqglowrow' }, h('b', null, gl), h('span', { class: 'small dim' }, gh), h('span', { class: 'grow' }), glowR, gOut));
  }
  function paintAll() { buildArea(); buildLower(); paintPreset(); }
  const footer = h('div', { class: 'eqfoot' },
    h('button', { class: 'btn', onclick: () => { cur = flatEq(); presetId = null; dirty = true; paintAll(); sync(); } }, 'Flat'),
    h('button', { class: 'btn', onclick: async () => { try { await api('/dsp/revert', { method: 'POST', body: { deviceId: dev } }); previewing = false; liveTag.hidden = true; await load(); toast('Back to the saved sound'); } catch (e) { toast(e.message, true); } } }, 'Revert'),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn primary', onclick: save }, 'Save & use on this speaker'));
  body.replaceChildren(
    h('div', { class: 'eqtop' }, h('span', { class: 'eqlbl' }, 'SPEAKER'), h('b', { class: 'eqspk' }, devOut ? `${devOut.zone} — ${devOut.name}` : ''), liveTag, h('span', { class: 'grow' }), h('span', { class: 'eqlbl' }, 'PRESET'), preSel),
    mainHost, lower, footer);
  let builtStyle = loadEqPrefs().style;   // 0.3.3 G14: rebuild only when the EQ style itself changed (never for a glow save, never mid-drag)
  const onStyle = () => { if (!d.el.isConnected) return window.removeEventListener('wavwiz:eqstyle', onStyle); const s2 = loadEqPrefs().style; if (s2 === builtStyle || userDragging(d.el)) return; builtStyle = s2; buildArea(); buildLower(); };
  window.addEventListener('wavwiz:eqstyle', onStyle);

  /** Saving a changed built-in or new sound asks for a name; an own preset that is selected is saved over. */
  async function save() {
    const mine = presets.find(p => p.id === presetId && p.source !== 'builtin');
    let name = mine ? mine.name : null;
    if (!mine) { name = await askName(); if (!name) return; }
    try {
      const ex = presets.find(p => p.name === name && p.source !== 'builtin');
      let id; if (ex) { await api(`/dsp/presets/${ex.id}`, { method: 'PUT', body: { name, preset: { ...cur, name } } }); id = ex.id; } else { id = (await api('/dsp/presets', { method: 'POST', body: { name, preset: { ...cur, name } } })).id; }
      await api(`/dsp/assignments/${encodeURIComponent(dev)}`, { method: 'PUT', body: { presetId: id, enabled: true, bypass: cur.bypass } });
      previewing = false; liveTag.hidden = true; presetId = id; dirty = false; cur.name = name; presets = await api('/dsp/presets'); paintPreset(); toast(`Saved “${name}” and using it on this speaker`);
      window.dispatchEvent(new CustomEvent('wavwiz:eqchanged', { detail: { deviceId: dev } }));
    } catch (e) { toast(e.message, true); }
  }
  // 0.3.5 J9 #10: "Save as a new preset" asks for the name in a field next to the preset list (no popup)
  function askName() {
    return new Promise(res => {
      body.querySelector('.eqname')?.remove();
      const inp = h('input', { type: 'text', maxlength: 40, value: cur.name && cur.name !== 'Custom' ? cur.name : 'My sound', 'aria-label': 'Preset name' });
      let done = false; const fin = v => { if (!done) { done = true; box.remove(); res(v); } };
      const ok = () => { const v = inp.value.trim(); if (!v) { toast('Give the preset a name.', true); inp.focus(); return; } fin(v); };
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') ok(); if (ev.key === 'Escape') fin(null); });
      const box = h('span', { class: 'eqname row' }, inp, h('button', { class: 'btn sm primary', type: 'button', onclick: ok }, 'Save'), h('button', { class: 'btn sm', type: 'button', onclick: () => fin(null) }, 'Cancel'));
      (preSel.parentElement || body).append(box);
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
    });
  }
  async function load() {
    try { const a = await api(`/dsp/assignments/${encodeURIComponent(dev)}`); const p = a && presets.find(x => x.id === a.presetId); cur = p ? { ...flatEq(), ...structuredClone(p.json) } : flatEq(); presetId = p ? p.id : null; } catch { cur = flatEq(); presetId = null; }
    dirty = false; lastResp = null; paintAll();
    try { lastResp = await api('/dsp/response', { method: 'POST', body: { preset: cur } }); area?.setResponse(lastResp); preGain.hidden = !lastResp.preGainDb; preGain.textContent = `${fmtDb(lastResp.preGainDb || 0)} dB`; } catch { /* approx curve stays */ }
  }
  load();
  return d;
}

/** 0.3.3 G14: the live spectrum starts only when the glow goes from 0 to above 0. Pure. */
export const glowWasOff = (prev, v) => !(prev > 0) && v > 0;
/** 0.3.3 G14: a slider in el is being dragged / focused (no re-render under it). */
const userDragging = el => { const a = typeof document !== 'undefined' ? document.activeElement : null; return !!(a && el.contains(a) && a.matches?.('input[type=range]')); };
