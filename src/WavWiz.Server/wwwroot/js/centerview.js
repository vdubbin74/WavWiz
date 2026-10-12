// WavWiz 0.3.0 §3: the center panel shows the live EQ by default; one toggle (next to Looks) switches EQ ⇄ Visualizer, remembered per device.
import { h, api, toast, debounce } from './util.js';
import { loadEqPrefs, eqTarget, ownEqName, loadEqLock, saveEqLock } from './eqstyle.js';
import { eqArea, eqLockBox } from './eqview.js';
import { flatEq } from './eq.js';
import { thisDevice, canTune, isAdmin } from './ui.js';
import { spectrumTap } from './viz.js';
import { flag } from './flags.js';

export const CENTER_KEY = 'wavwiz.center.v1';
export const CENTER_MIGRATED = 'wavwiz.center.migrated030';
/** 'eq' | 'viz'. On the first 0.3.0 launch a saved visualizer choice moves to EQ once; after that the device's own choice is kept. */
export function loadCenter(store = globalThis.localStorage) {
  try {
    if (store.getItem(CENTER_MIGRATED) !== '1') { store.setItem(CENTER_KEY, 'eq'); store.setItem(CENTER_MIGRATED, '1'); return 'eq'; }
    return store.getItem(CENTER_KEY) === 'viz' ? 'viz' : 'eq';
  } catch { return 'eq'; }
}
export function saveCenter(v, store = globalThis.localStorage) { try { store.setItem(CENTER_KEY, v === 'viz' ? 'viz' : 'eq'); store.setItem(CENTER_MIGRATED, '1'); } catch { /* private mode */ } return v === 'viz' ? 'viz' : 'eq'; }
export const toggleLabel = mode => (mode === 'eq' ? 'Visualizer' : 'EQ');
/** The outputs the admin picker lists (connected ones), own output first. */
export function pickerOutputs(zones = [], mine = null) {
  const outs = (zones || []).flatMap(z => (z.outputs || []).map(o => ({ ...o, zone: z.name, zoneId: z.id }))).filter(o => o.connected || o.active);
  const own = eqTarget(zones, mine); return own ? [own, ...outs.filter(o => o.deviceId !== own.deviceId)] : outs;
}

/** Mounts the editable EQ (chosen EQ style, glow behind it) into host. Returns { destroy, refresh }. */
export function centerEq(S, host) {
  let area = null, real = null, gone = false, target = null;   // target: picker choice (not saved: resets to this Player's own output on reload)
  const root = h('div', { class: 'np-eqview' }); host.replaceChildren(root);
  const own = () => eqTarget(S.zones, thisDevice(S));
  const out = () => (target && pickerOutputs(S.zones, thisDevice(S)).find(o => o.deviceId === target)) || own();
  const zoneOf = o => (S.zones || []).find(z => z.id === o?.zoneId);
  const can = o => !!o && canTune(S, zoneOf(o));
  async function fetchReal() {
    const o = out(); if (!o) return null;
    const [presets, a] = await Promise.all([api('/dsp/presets'), api(`/dsp/assignments/${encodeURIComponent(o.deviceId)}`)]);
    const p = a && a.presetId != null ? presets.find(x => x.id === a.presetId) : null;
    const cur = { ...flatEq(), ...(p ? structuredClone(p.json) : {}) }; cur.bypass = !!a?.bypass;
    let resp = null; try { resp = await api('/dsp/response', { method: 'POST', body: { preset: cur } }); } catch { /* approx */ }
    return { out: o, presets, cur, resp };
  }
  const previewNow = debounce(() => { if (real) api('/dsp/preview', { method: 'POST', body: { deviceId: real.out.deviceId, preset: real.cur, bypass: real.cur.bypass } }).catch(() => {}); }, 120);
  const saveSoon = debounce(async () => {
    const r = real; if (!r) return; const name = ownEqName(r.out.zone), body = { name, preset: { ...r.cur, name } };
    try {
      const mine = r.presets.find(x => x.source !== 'builtin' && x.name === name); let id;
      if (mine) { await api(`/dsp/presets/${mine.id}`, { method: 'PUT', body }); id = mine.id; } else id = (await api('/dsp/presets', { method: 'POST', body })).id;
      await api(`/dsp/assignments/${encodeURIComponent(r.out.deviceId)}`, { method: 'PUT', body: { presetId: id, enabled: true, bypass: r.cur.bypass } });
      r.presets = await api('/dsp/presets'); window.dispatchEvent(new CustomEvent('wavwiz:eqchanged', { detail: { deviceId: r.out.deviceId } }));
    } catch (e) { toast(e.message, true); }
  }, 700);
  function draw() {
    if (gone) return;
    const p = loadEqPrefs(), o = real?.out, ok = can(o), locked = loadEqLock();
    area?.destroy();
    area = eqArea({ style: p.style, gains: real ? [...real.cur.graphicDb] : new Array(10).fill(0), glow: p.glow, interactive: true, locked: locked || !ok || !real,
      onChange: (i, db) => { if (!real || loadEqLock() || !ok) return; real.cur.graphicDb[i] = db; previewNow(); saveSoon(); } });
    if (real?.resp) area.setResponse(real.resp);
    if (p.glow > 0) area.startLive?.(spectrumTap);
    const lock = eqLockBox(locked, v => { saveEqLock(v); area?.setLocked(v || !ok); });
    if (!ok) { lock.input.disabled = true; lock.el.title = o ? 'Only Control or Admin access can change this speaker’s EQ.' : 'No speaker connected.'; }
    const outs = pickerOutputs(S.zones, thisDevice(S));
    const picker = flag('ui.eqOutputPicker') && isAdmin(S) && outs.length > 1
      ? h('select', { class: 'np-eqpick', 'aria-label': 'Which output this EQ adjusts', onchange: ev => { target = ev.target.value; reload(); } }, outs.map(x => h('option', { value: x.deviceId, selected: x.deviceId === o?.deviceId }, `${x.zone} — ${x.name}`)))
      : null;
    root.replaceChildren(h('div', { class: 'np-eqhead' }, h('b', { class: 'np-eqname' }, o ? `Sound · ${o.zone}` : 'Sound'), picker, h('span', { class: 'grow' }), lock.el),
      real ? area.el : h('p', { class: 'small dim np-eqnone' }, 'Connect a speaker to adjust its EQ here.'));
  }
  async function reload() { try { real = await fetchReal(); } catch { real = null; } draw(); }
  const onLock = () => area?.setLocked(loadEqLock() || !can(real?.out));
  const onStyle = () => draw();
  window.addEventListener('wavwiz:eqstyle', onStyle); window.addEventListener('wavwiz:eqlock', onLock);
  const onEq = e => { if (e.detail?.deviceId && e.detail.deviceId === real?.out?.deviceId && !document.activeElement?.closest?.('.np-eqview')) reload(); };
  window.addEventListener('wavwiz:eqchanged', onEq);
  reload();
  return {
    destroy() { gone = true; area?.destroy(); area = null; window.removeEventListener('wavwiz:eqstyle', onStyle); window.removeEventListener('wavwiz:eqlock', onLock); window.removeEventListener('wavwiz:eqchanged', onEq); root.remove(); },
    refresh() { const o = out(); if (o?.deviceId !== real?.out?.deviceId) reload(); },
  };
}
