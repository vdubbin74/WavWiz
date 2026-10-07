import { h, api, toast, dialog, debounce } from './util.js';

const BANDS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const flat = () => ({ name: 'Custom', graphicDb: new Array(10).fill(0), trimDb: 0, preampDb: 0, autoPreamp: true, bypass: false, bass: { gainDb: 0, hz: 100 }, treble: { gainDb: 0, hz: 10000 }, loudness: { enabled: false, refVolume: 80 }, limiter: { enabled: true, ceilingDb: -0.3, releaseMs: 120, lookaheadMs: 0 } });

// Per-speaker "Sound" dialog: pick a speaker, edit a 10-band EQ + bass/treble/trim/loudness/limiter. Changes preview live on that speaker; Save stores the preset and assigns it.
export async function openEq(S, refresh, deviceId) {
  const outputs = S.zones.flatMap(z => z.outputs.map(o => ({ ...o, zone: z.name }))).filter(o => o.connected || o.active);
  if (!outputs.length) return toast('No speaker is connected yet.', true);
  let presets = []; try { presets = await api('/dsp/presets'); } catch (e) { return toast(e.message, true); }
  let dev = deviceId && outputs.find(o => o.deviceId === deviceId) ? deviceId : (outputs.find(o => o.active)?.deviceId ?? outputs[0].deviceId);
  let cur = flat(); let previewing = false;
  const body = h('div'); const canv = h('canvas', { class: 'curve', width: 700, height: 150, 'aria-label': 'Frequency response' });
  const d = dialog('Sound (EQ)', body, [], { onClose: async () => { if (previewing) { try { await api('/dsp/revert', { method: 'POST', body: { deviceId: dev } }); } catch { } } refresh && refresh(); } });

  const sliders = [], valLbl = [];
  const sync = debounce(async () => {
    try { drawCurve(await api('/dsp/response', { method: 'POST', body: { preset: cur } })); } catch { }
    try { await api('/dsp/preview', { method: 'POST', body: { deviceId: dev, preset: cur, bypass: cur.bypass } }); previewing = true; } catch (e) { toast(e.message, true); }
  }, 150);
  const edit = fn => { fn(cur); sync(); };

  function drawCurve(r) {
    const c = canv.getContext('2d'), W = canv.width, Hh = canv.height; c.clearRect(0, 0, W, Hh); c.fillStyle = '#080a0c'; c.fillRect(0, 0, W, Hh);
    c.strokeStyle = '#1d252b'; c.lineWidth = 1; c.fillStyle = '#6a7882'; c.font = '11px sans-serif';
    for (const db of [-12, -6, 0, 6, 12]) { const y = Hh / 2 - db / 15 * (Hh / 2); c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); c.fillText(db + ' dB', 4, y - 2); }
    for (const f of [100, 1000, 10000]) { const x = Math.log10(f / 20) / 3 * W; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, Hh); c.stroke(); c.fillText(f >= 1000 ? f / 1000 + 'k' : f, x + 3, Hh - 4); }
    c.strokeStyle = '#25d6c6'; c.lineWidth = 2; c.beginPath();
    r.db.forEach((v, i) => { const x = Math.log10(r.hz[i] / 20) / 3 * W, y = Hh / 2 - Math.max(-15, Math.min(15, v)) / 15 * (Hh / 2); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
    if (r.preGainDb) { c.fillStyle = '#ffb300'; c.fillText(`auto pre-gain ${r.preGainDb} dB`, W - 130, 14); }
  }

  function draw() {
    sliders.length = 0; valLbl.length = 0;
    const outSel = h('select', { 'aria-label': 'Speaker', onchange: async ev => { if (previewing) { try { await api('/dsp/revert', { method: 'POST', body: { deviceId: dev } }); } catch { } previewing = false; } dev = ev.target.value; await load(); } }, outputs.map(o => h('option', { value: o.deviceId, selected: o.deviceId === dev }, `${o.zone} — ${o.name}`)));
    const preSel = h('select', { 'aria-label': 'Preset', onchange: ev => { const p = presets.find(x => String(x.id) === ev.target.value); if (p) { cur = { ...flat(), ...structuredClone(p.json) }; draw(); sync(); } } },
      h('option', { value: '' }, '— choose a preset —'), presets.map(p => h('option', { value: p.id }, p.name + (p.source === 'builtin' ? ' (built-in)' : ''))));
    const bands = h('div', { class: 'eq' }, BANDS.map((b, i) => {
      const v = h('div', { class: 'small amber mono' }, fmt(cur.graphicDb[i]));
      const s = h('input', { type: 'range', min: -12, max: 12, step: 0.5, value: cur.graphicDb[i], 'aria-label': `${b} Hz`, oninput: ev => { cur.graphicDb[i] = +ev.target.value; v.textContent = fmt(+ev.target.value); sync(); } });
      return h('div', null, v, s, h('div', { class: 'small dim' }, b));
    }));
    const num = (lbl, get, set, min, max, step = 0.5) => { const i = h('input', { type: 'range', min, max, step, value: get(), oninput: ev => { set(+ev.target.value); o.textContent = fmt(+ev.target.value); sync(); } }); const o = h('span', { class: 'amber mono small', style: 'width:60px;text-align:right' }, fmt(get())); return h('label', { class: 'row' }, h('span', { style: 'width:110px' }, lbl), h('span', { class: 'grow' }, i), o); };
    const chk = (lbl, get, set) => h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: get(), onchange: ev => { set(ev.target.checked); sync(); } }), lbl);
    const nm = h('input', { type: 'text', value: cur.name, maxlength: 40, 'aria-label': 'Preset name', oninput: ev => cur.name = ev.target.value });
    body.replaceChildren(
      h('div', { class: 'row wrap' }, outSel, preSel), canv, bands,
      h('div', { class: 'card', style: 'margin-top:8px' },
        num('Bass', () => cur.bass.gainDb, v => cur.bass = { ...cur.bass, gainDb: v }, -12, 12), num('Treble', () => cur.treble.gainDb, v => cur.treble = { ...cur.treble, gainDb: v }, -12, 12),
        num('Trim', () => cur.trimDb, v => cur.trimDb = v, -24, 6), chk('Automatic pre-gain (prevents clipping when boosting)', () => cur.autoPreamp, v => cur.autoPreamp = v),
        chk('Loudness (adds bass/treble at low volume)', () => cur.loudness.enabled, v => cur.loudness = { ...cur.loudness, enabled: v }), chk('Limiter (protects the speaker from clipping)', () => cur.limiter.enabled, v => cur.limiter = { ...cur.limiter, enabled: v }),
        chk('Bypass (hear the speaker without EQ)', () => cur.bypass, v => cur.bypass = v)),
      h('div', { class: 'row wrap' }, nm,
        h('button', { class: 'btn primary', onclick: save }, 'Save & use on this speaker'),
        h('button', { class: 'btn', onclick: async () => { cur = flat(); draw(); sync(); } }, 'Flat'),
        h('button', { class: 'btn', onclick: async () => { try { await api('/dsp/revert', { method: 'POST', body: { deviceId: dev } }); previewing = false; await load(); toast('Back to the saved sound'); } catch (e) { toast(e.message, true); } } }, 'Revert')));
    sync();
  }
  const fmt = v => (v > 0 ? '+' : '') + (+v).toFixed(1);
  async function save() {
    try {
      const name = (cur.name || 'Custom').trim(); const ex = presets.find(p => p.name === name && p.source !== 'builtin');
      let id; if (ex) { await api(`/dsp/presets/${ex.id}`, { method: 'PUT', body: { name, preset: { ...cur, name } } }); id = ex.id; } else { id = (await api('/dsp/presets', { method: 'POST', body: { name, preset: { ...cur, name } } })).id; }
      await api(`/dsp/assignments/${encodeURIComponent(dev)}`, { method: 'PUT', body: { presetId: id, enabled: true, bypass: cur.bypass } });
      previewing = false; toast('Saved'); presets = await api('/dsp/presets'); draw();
    } catch (e) { toast(e.message, true); }
  }
  async function load() {
    try { const a = await api(`/dsp/assignments/${encodeURIComponent(dev)}`); const p = a && presets.find(x => x.id === a.presetId); cur = p ? { ...flat(), ...structuredClone(p.json) } : flat(); } catch { cur = flat(); }
    draw();
  }
  load();
}
