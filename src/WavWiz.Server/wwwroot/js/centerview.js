// WavWiz 0.3.0 §3: the center panel shows the live EQ by default; one toggle (next to Looks) switches EQ ⇄ Visualizer, remembered per device.
import { h, api, toast, debounce } from './util.js';
import { loadEqPrefs, eqTarget, ownEqName, loadEqLock, saveEqLock, controllingTarget, pickerLabel } from './eqstyle.js';
import * as Z from './zones40.js';
import { eqArea, eqLockBox } from './eqview.js';
import { flatEq } from './eq.js';
import { thisDevice, canTune, isAdmin } from './ui.js';
import { spectrumTap } from './viz.js';
import { flag } from './flags.js';
import { soundSettings, LOCK_HINT } from './eqsettings.js';
import { icon, setIcon } from './icons.js';

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
export function pickerOutputs(zones = [], mine = null, ctlFirst = null) {
  const outs = (zones || []).flatMap(z => (z.outputs || []).map(o => ({ ...o, zone: z.name, zoneId: z.id }))).filter(o => o.connected || o.active);
  const own = ctlFirst || eqTarget(zones, mine); return own ? [own, ...outs.filter(o => o.deviceId !== own.deviceId)] : outs;
}

/** Mounts the editable EQ (chosen EQ style, glow behind it) into host. Returns { destroy, refresh }. */
export function centerEq(S, host, opts = {}) {
  let area = null, real = null, gone = false, target = opts.deviceId || null, allOpen = false, all = null;   // target: picker choice (not saved: resets to this Player's own output on reload)
  const root = h('div', { class: 'np-eqview' }); host.replaceChildren(root);
  // 0.4.3 #5: by default the first speaker of the Controlling zone (then this device's own output, then the first live one)
  const ctlT = () => { try { return controllingTarget(S.zones, S.groups, Z.current()); } catch { return null; } };
  const own = () => ctlT() || eqTarget(S.zones, thisDevice(S));
  const outsNow = () => pickerOutputs(S.zones, thisDevice(S), ctlT());
  const out = () => (target && outsNow().find(o => o.deviceId === target)) || own();
  const zoneOf = o => (S.zones || []).find(z => z.id === o?.zoneId);
  const can = o => !!o && canTune(S, zoneOf(o));
  async function fetchReal() {
    const o = out(); if (!o) return null;
    const [presets, a] = await Promise.all([api('/dsp/presets'), api(`/dsp/assignments/${encodeURIComponent(o.deviceId)}`)]);
    const p = a && a.presetId != null ? presets.find(x => x.id === a.presetId) : null;
    const cur = { ...flatEq(), ...(p ? structuredClone(p.json) : {}) }; cur.bypass = !!a?.bypass;
    let resp = null; try { resp = await api('/dsp/response', { method: 'POST', body: { preset: cur } }); } catch { /* approx */ }
    return { out: o, presets, cur, resp, presetId: p ? p.id : null };
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
    // 0.3.1 B17: Lock EQ moved into the center panel's overlay button group (now.js); this header keeps a read-only note for non-tuners
    const note = !ok ? h('span', { class: 'small dim np-eqro', title: o ? 'Only Control or Admin access can change this speaker’s EQ.' : 'No speaker connected.' }, o ? 'Read-only' : '') : null;
    const outs = outsNow();
    const picker = flag('ui.eqOutputPicker') && isAdmin(S) && outs.length > 1
      ? h('select', { class: 'np-eqpick', 'aria-label': 'Which output this EQ adjusts', onchange: ev => { target = ev.target.value; reload(); } }, outs.map(x => h('option', { value: x.deviceId, selected: x.deviceId === o?.deviceId, title: `${x.zone} — ${x.name}` }, pickerLabel(x, outs))))
      : null;
    // 0.3.7 L7: ONE title bar: name, [All sound settings] expands the rest in place, ONE padlock locks everything (bands + all settings)
    const allBtn = h('button', { type: 'button', class: 'btn sm eqallbtn' + (allOpen ? ' on' : ''), 'data-act': 'allsound', 'aria-expanded': String(allOpen), disabled: !real || undefined, onclick: () => { allOpen = !allOpen; draw(); } }, 'All sound settings');
    // 0.3.8 L39: the active preset as a plain themed select (same look as the output picker); every EQ chooser uses this select style
    const presetSel = real ? h('select', { class: 'np-eqpick eqpreset', 'data-act': 'eqpreset', 'aria-label': 'EQ preset', title: 'The active EQ preset', disabled: (!ok || loadEqLock()) || undefined,
      onchange: ev => { const p = real.presets.find(x => String(x.id) === ev.target.value); if (!p || !ok || loadEqLock()) return; real.cur = { ...flatEq(), ...structuredClone(p.json), bypass: real.cur.bypass }; real.presetId = p.id; previewNow(); saveSoon(); draw(); } },
      real.presetId == null ? h('option', { value: '', selected: true }, 'Custom (not saved)') : null,
      (real.presets || []).map(p => h('option', { value: String(p.id), selected: p.id === real.presetId }, p.name))) : null;
    all = null;
    if (real && allOpen) {
      all = soundSettings({
        cur: () => real.cur, changed: () => { if (!ok || loadEqLock()) return; previewNow(); saveSoon(); area?.setGains?.(real.cur.graphicDb); },
        presets: () => real.presets, presetId: () => real.presetId ?? null,
        pick: p => { if (!ok || loadEqLock()) return; real.cur = { ...flatEq(), ...structuredClone(p.json), bypass: real.cur.bypass }; real.presetId = p.id; previewNow(); saveSoon(); draw(); },
        saveAs: async name => { if (!ok || loadEqLock()) return; try { const id = (await api('/dsp/presets', { method: 'POST', body: { name, preset: { ...real.cur, name } } })).id; await api(`/dsp/assignments/${encodeURIComponent(real.out.deviceId)}`, { method: 'PUT', body: { presetId: id, enabled: true, bypass: real.cur.bypass } }); real.presets = await api('/dsp/presets'); real.presetId = id; toast(`Saved “${name}”`); draw(); } catch (e) { toast(e.message, true); } },
        flat: () => { if (!ok || loadEqLock()) return; real.cur = { ...flatEq(), bypass: real.cur.bypass }; previewNow(); saveSoon(); draw(); },
        revert: () => reload(),
      });
      all.setLocked(locked || !ok);
    }
    root.replaceChildren(h('div', { class: 'np-eqhead' }, h('b', { class: 'np-eqname' }, o ? `Adjusting: ${o.zone}` : 'Sound'), picker, presetSel, h('span', { class: 'grow' }), note, allBtn),
      real ? area.el : h('p', { class: 'small dim np-eqnone' }, 'Connect a speaker to adjust its EQ here.'), all ? sheetOf(all.el) : (sheetEl?.remove(), sheetEl = null, null));
    root.classList.toggle('allopen', !!all);
  }
  // 0.4.8 F56: "All sound settings" sits in a sheet: in place on PC, a full-screen sheet with a title + X on the phone (Esc / Back close it, body scroll locked)
  const phone = () => matchMedia('(max-width:760px)').matches;
  let sheetBack = false, sheetEl = null;
  function closeAll() { if (!allOpen) return; allOpen = false; document.documentElement.classList.remove('eqsheet-lock'); if (sheetBack) { sheetBack = false; history.back(); } draw(); }
  function sheetOf(el) {
    const x = h('button', { type: 'button', class: 'iconbtn eqsheet-x', 'aria-label': 'Close', title: 'Close', onclick: closeAll }, '\u2715');
    const sh = h('div', { class: 'eqsheet open', role: 'dialog', 'aria-label': 'All sound settings' }, h('div', { class: 'eqsheet-h' }, h('b', {}, 'All sound settings'), x), h('div', { class: 'eqsheet-b' }, el));
    sheetEl?.remove(); sheetEl = null;
    if (phone()) { document.documentElement.classList.add('eqsheet-lock'); if (!sheetBack) { sheetBack = true; history.pushState({ eqsheet: 1 }, ''); } document.body.append(sh); sheetEl = sh; return null; }   // on <body>: above the EQ header icons and the mini player
    return sh;
  }
  window.addEventListener('popstate', () => { if (sheetBack) { sheetBack = false; closeAll(); } });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && allOpen && root.isConnected) { ev.preventDefault(); ev.stopPropagation(); closeAll(); } }, true);
  async function reload() { try { real = await fetchReal(); } catch { real = null; } draw(); }
  const onLock = () => { area?.setLocked(loadEqLock() || !can(real?.out)); all?.setLocked(loadEqLock() || !can(real?.out)); const l = loadEqLock(), b = root.querySelector('.eqpadlock'); if (b) { b.classList.toggle('on', l); b.setAttribute('aria-pressed', String(l)); setIcon(b.querySelector('.ic'), l ? 'lock' : 'unlock'); b.title = l ? 'Sound locked (click to unlock)' : 'Lock the sound (EQ and all settings)'; b.setAttribute('aria-label', b.title); } };
  const onStyle = () => draw();
  const onGlow = e => { const v = +e.detail; area?.setGlow(v); if (v > 0) area?.startLive?.(spectrumTap); };
  window.addEventListener('wavwiz:eqglow', onGlow);
  window.addEventListener('wavwiz:eqstyle', onStyle); window.addEventListener('wavwiz:eqlock', onLock);
  const onEq = e => { if (e.detail?.deviceId && e.detail.deviceId === real?.out?.deviceId && !document.activeElement?.closest?.('.np-eqview')) reload(); };
  window.addEventListener('wavwiz:eqchanged', onEq);
  const onZone = () => { if (!target && !gone) { const o = out(); if (o?.deviceId !== real?.out?.deviceId) reload(); } };   // 0.4.3 #5: follows the Controlling zone until a speaker is picked by hand
  window.addEventListener('wavwiz:zone', onZone);
  reload();
  return {
    destroy() { gone = true; sheetEl?.remove(); sheetEl = null; document.documentElement.classList.remove("eqsheet-lock"); area?.destroy(); area = null; window.removeEventListener('wavwiz:eqstyle', onStyle); window.removeEventListener('wavwiz:eqlock', onLock); window.removeEventListener('wavwiz:eqchanged', onEq); window.removeEventListener('wavwiz:zone', onZone); window.removeEventListener('wavwiz:eqglow', onGlow); root.remove(); },
    refresh() { const o = out(); if (o?.deviceId !== real?.out?.deviceId) reload(); },
  };
}
