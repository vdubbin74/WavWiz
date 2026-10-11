// Per-speaker "Sound (EQ)" dialog. 0.2.1 F12: redesigned in three looks (Settings > Appearance > EQ style): LED bars (default), Studio faders,
// Spectrum curve. All three drive the same real DSP (10 bands 31 Hz - 16 kHz, ±12 dB, 0.5 dB steps, per speaker); only the main EQ area
// differs. Header (speaker + preset), Bass / Treble / Trim, the switches, Spectrum glow and the footer are shared. Changes preview live on the
// picked speaker; Save asks for a name when it makes a new preset (no name box in the footer).
import { h, api, toast, dialog, debounce } from './util.js';
import { eqArea } from './eqview.js';
import { loadEqPrefs, saveEqPrefs, glowWords, fmtDb } from './eqstyle.js';
import { spectrumTap } from './viz.js';

const flat = () => ({ name: 'Custom', graphicDb: new Array(10).fill(0), trimDb: 0, preampDb: 0, autoPreamp: true, bypass: false, bass: { gainDb: 0, hz: 100 }, treble: { gainDb: 0, hz: 10000 }, loudness: { enabled: false, refVolume: 80 }, limiter: { enabled: true, ceilingDb: -0.3, releaseMs: 120, lookaheadMs: 0 } });

export async function openEq(S, refresh, deviceId) {
  const outputs = S.zones.flatMap(z => z.outputs.map(o => ({ ...o, zone: z.name }))).filter(o => o.connected || o.active);
  if (!outputs.length) return toast('No speaker is connected yet.', true);
  let presets = []; try { presets = await api('/dsp/presets'); } catch (e) { return toast(e.message, true); }
  let dev = deviceId && outputs.find(o => o.deviceId === deviceId) ? deviceId : (outputs.find(o => o.active)?.deviceId ?? outputs[0].deviceId);
  let cur = flat(), presetId = null, dirty = false, previewing = false, area = null, lastResp = null;
  const body = h('div', { class: 'eqdlg' });
  const d = dialog('Sound (EQ)', body, [], { cls: 'eqdialog', onClose: async () => { area?.destroy(); if (previewing) { try { await api('/dsp/revert', { method: 'POST', body: { deviceId: dev } }); } catch { /* gone */ } } refresh && refresh(); } });
  d.el.querySelector('header .grow')?.append(h('span', { class: 'small dim eqsub' }, 'Changes play live on the speaker you pick.'));

  const liveTag = h('span', { class: 'eqprev small', hidden: true }, h('i', { 'aria-hidden': 'true' }), 'Previewing live');
  const preGain = h('span', { class: 'eqpregain', hidden: true, title: 'Level drop applied by Auto pre-gain so boosts never clip' });
  const sync = debounce(async () => {
    try { lastResp = await api('/dsp/response', { method: 'POST', body: { preset: cur } }); area?.setResponse(lastResp); preGain.hidden = !lastResp.preGainDb; preGain.textContent = `${fmtDb(lastResp.preGainDb || 0)} dB`; } catch { area?.setResponse(null); }
    try { await api('/dsp/preview', { method: 'POST', body: { deviceId: dev, preset: cur, bypass: cur.bypass } }); previewing = true; liveTag.hidden = false; } catch (e) { toast(e.message, true); }
  }, 150);
  const changed = () => { if (!dirty) { dirty = true; paintPreset(); } sync(); };

  const outSel = h('select', { 'aria-label': 'Speaker', onchange: async ev => { if (previewing) { try { await api('/dsp/revert', { method: 'POST', body: { deviceId: dev } }); } catch { /* gone */ } previewing = false; liveTag.hidden = true; } dev = ev.target.value; await load(); } },
    outputs.map(o => h('option', { value: o.deviceId, selected: o.deviceId === dev }, `${o.zone} — ${o.name}`)));
  const preSel = h('select', { 'aria-label': 'Preset', onchange: ev => { const p = presets.find(x => String(x.id) === ev.target.value); if (p) { cur = { ...flat(), ...structuredClone(p.json) }; presetId = p.id; dirty = false; paintAll(); sync(); } } });
  function paintPreset() {
    preSel.replaceChildren(h('option', { value: '', selected: dirty || presetId == null }, 'Custom'),
      ...presets.map(p => h('option', { value: p.id, selected: !dirty && p.id === presetId }, p.name + (p.source === 'builtin' ? ' (built-in)' : ''))));
  }
  const mainHost = h('div', { class: 'eqmain' });
  function buildArea() {
    area?.destroy();
    area = eqArea({ style: loadEqPrefs().style, gains: cur.graphicDb, glow: loadEqPrefs().glow, onChange: (i, db) => { cur.graphicDb[i] = db; changed(); } });
    mainHost.replaceChildren(area.el); area.setResponse(lastResp); area.exampleSpectrum?.(); if (loadEqPrefs().glow > 0) area.startLive(spectrumTap);
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
    const glowR = h('input', { type: 'range', min: 0, max: 100, step: 1, value: st.glow, 'aria-label': gl, 'data-eqglow': '1', oninput: ev => { const v = +ev.target.value; gOut.textContent = v + '%'; saveEqPrefs({ ...loadEqPrefs(), glow: v }); area?.setGlow(v); if (v > 0) area?.startLive(spectrumTap); } });
    ctl = [bass, treble, trim, ...sws];
    lower.replaceChildren(h('div', { class: 'eqknobs' }, bass.el, treble.el, trim.el), h('div', { class: 'eqsws' }, sws.map(s => s.el)),
      h('div', { class: 'eqglowrow' }, h('b', null, gl), h('span', { class: 'small dim' }, gh), h('span', { class: 'grow' }), glowR, gOut));
  }
  function paintAll() { buildArea(); buildLower(); paintPreset(); }
  const footer = h('div', { class: 'eqfoot' },
    h('button', { class: 'btn', onclick: () => { cur = flat(); presetId = null; dirty = true; paintAll(); sync(); } }, 'Flat'),
    h('button', { class: 'btn', onclick: async () => { try { await api('/dsp/revert', { method: 'POST', body: { deviceId: dev } }); previewing = false; liveTag.hidden = true; await load(); toast('Back to the saved sound'); } catch (e) { toast(e.message, true); } } }, 'Revert'),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn primary', onclick: save }, 'Save & use on this speaker'));
  body.replaceChildren(
    h('div', { class: 'eqtop' }, h('span', { class: 'eqlbl' }, 'SPEAKER'), outSel, liveTag, h('span', { class: 'grow' }), h('span', { class: 'eqlbl' }, 'PRESET'), preSel),
    mainHost, lower, footer);
  const onStyle = () => { if (d.el.isConnected) { buildArea(); buildLower(); } else window.removeEventListener('wavwiz:eqstyle', onStyle); };
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
    } catch (e) { toast(e.message, true); }
  }
  function askName() {
    return new Promise(res => {
      const inp = h('input', { type: 'text', maxlength: 40, value: cur.name && cur.name !== 'Custom' ? cur.name : 'My sound', 'aria-label': 'Preset name' });
      let done = false; const fin = v => { if (!done) { done = true; res(v); } };
      dialog('Save as a new preset', h('div', { class: 'field' }, h('label', null, 'Preset name'), inp),
        [{ text: 'Save', cls: 'primary', onclick: () => { const v = inp.value.trim(); if (!v) { toast('Give the preset a name.', true); return false; } fin(v); } }, { text: 'Cancel', onclick: () => fin(null) }],
        { onClose: () => fin(null) });
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
    });
  }
  async function load() {
    try { const a = await api(`/dsp/assignments/${encodeURIComponent(dev)}`); const p = a && presets.find(x => x.id === a.presetId); cur = p ? { ...flat(), ...structuredClone(p.json) } : flat(); presetId = p ? p.id : null; } catch { cur = flat(); presetId = null; }
    dirty = false; lastResp = null; paintAll();
    try { lastResp = await api('/dsp/response', { method: 'POST', body: { preset: cur } }); area?.setResponse(lastResp); preGain.hidden = !lastResp.preGainDb; preGain.textContent = `${fmtDb(lastResp.preGainDb || 0)} dB`; } catch { /* approx curve stays */ }
  }
  load();
}
