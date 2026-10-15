// WavWiz 0.3.6 K5 / K6: the Speaker Settings column of the expanded Devices view - the widest column (~1050 px at 1920), roomy sliders for volume,
// volume cap, delay, balance, bass and treble, the EQ and the output, and the speaker PROFILE row (dropdown, Save, Save as with an inline name, modified dot).
// Profiles are stored on the server (/profiles); loading one snaps the sliders and shows "Loaded <name>". Nothing here opens a window.
import { h, api, toast, debounce } from './util.js';
import { icon } from './icons.js';
import { isAdmin, canTune, canControl, ADMIN_HINT } from './ui.js';
import { flatEq } from './eq.js';
import { loadEqPrefs, ownEqName, loadEqLock } from './eqstyle.js';
import { eqArea } from './eqview.js';
import { spectrumTap } from './viz.js';

/** "Center" / "Left 20" / "Right 35". Pure. */
export const balanceLabel = v => { const n = Math.round(v); return n === 0 ? 'Center' : n < 0 ? `Left ${-n}` : `Right ${n}`; };
export const dbLabel = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 10) / 10)} dB`;
/** The accent dot next to the profile name shows when this speaker's settings changed after the profile was loaded. Pure. */
export const profileDot = st => !!(st && st.profileId != null && st.modified);

export function speakerSettings(S, ctl, z0, parts = {}) {
  let z = { ...z0 }; const admin = isAdmin(S), can = canControl(S), tune = canTune(S, z);
  const cur = () => (z.outputs || []).find(o => o.active) || (z.outputs || []).find(o => o.deviceId === z.chosenDeviceId) || (z.outputs || [])[0] || null;
  const ro = (el, ok, hint = ADMIN_HINT) => { if (!ok) { el.disabled = true; el.title = hint; el.classList.add('ro'); el.setAttribute('aria-disabled', 'true'); } return el; };
  const root = h('section', { class: 'spkset', 'aria-label': `Speaker settings, ${z.name}`, 'data-zone-id': z.id });
  let real = null, area = null, st = { profileId: null, modified: false }, profiles = [], naming = false, gone = false;

  // ---- live helpers
  const slider = ({ label, min, max, step = 1, value, fmt, onInput, onChange, ok = true, hint, cls = '' }) => {
    const out = h('span', { class: 'spk-v mono' }, fmt(value));
    const r = h('input', { type: 'range', min, max, step, value, class: 'spk-range', 'aria-label': label, 'data-coarse': step === 1 ? 5 : undefined });
    r.addEventListener('input', () => { out.textContent = fmt(+r.value); onInput?.(+r.value); });
    r.addEventListener('change', () => onChange?.(+r.value));
    if (!ok) ro(r, false, hint);
    const row = h('div', { class: 'spk-row ' + cls }, h('div', { class: 'spk-l' }, h('span', null, label), out), r);
    row._set = v => { if (document.activeElement !== r) { r.value = String(v); out.textContent = fmt(+v); } };
    row._input = r; return row;
  };
  const putVol = debounce(v => ctl.act(`/zones/${z.id}`, { volume: v }, 'PATCH'), 90);
  const vol = slider({ label: 'Volume', min: 0, max: 100, value: Math.round(z.volume), fmt: v => v + '%', onInput: putVol, ok: can, hint: 'Your access is view-only.' });
  const capVal = () => z.volCap ?? 100;
  const capRow = slider({ label: 'Volume cap', min: 0, max: 100, value: capVal(), fmt: v => v + '%', ok: admin, hint: 'Only an admin can change the max volume.',
    onChange: v => { const lock = v < 100; ctl.act(`/zones/${z.id}/volcap`, { cap: v, locked: lock }, 'PUT'); toast(lock ? `${z.name}: max volume locked at ${v}%` : `${z.name}: no max volume`); } });
  const capTitle = () => capRow.querySelector('.spk-l span').textContent = z.volLocked ? 'Volume cap (locked)' : 'Volume cap';
  const delayRow = () => { const o = cur(); return slider({ label: 'Delay / sync offset', min: 0, max: 600, step: 1, value: Math.round(o?.latencyMs ?? 0), fmt: v => `${v >= 0 ? '+' : ''}${v} ms`, ok: !!o && tune, hint: 'Only this device’s own owner or an admin can change the delay.',
    onChange: v => { const c = cur(); if (c) api(`/outputs/${encodeURIComponent(c.deviceId)}/latency`, { method: 'PUT', body: { latencyMs: v, playerId: z.playerId, live: true, method: 'manual' } }).then(() => ctl.refreshAll?.()).catch(e => toast(e.message, true)); } }); };
  let delay = delayRow();

  // ---- device preset (balance, bass, treble, EQ): same own-preset flow as the center EQ
  const saveEq = debounce(async () => {
    const r = real; if (!r || gone) return; const name = ownEqName(z.name), body = { name, preset: { ...r.cur, name } };
    try {
      const mine = r.presets.find(x => x.source !== 'builtin' && x.name === name); let id;
      if (mine) { await api(`/dsp/presets/${mine.id}`, { method: 'PUT', body }); id = mine.id; } else id = (await api('/dsp/presets', { method: 'POST', body })).id;
      await api(`/dsp/assignments/${encodeURIComponent(r.out.deviceId)}`, { method: 'PUT', body: { presetId: id, enabled: true, bypass: r.cur.bypass } });
      r.presets = await api('/dsp/presets'); window.dispatchEvent(new CustomEvent('wavwiz:eqchanged', { detail: { deviceId: r.out.deviceId } })); refreshProfile();
    } catch (e) { toast(e.message, true); }
  }, 600);
  const previewEq = debounce(() => { if (real) api('/dsp/preview', { method: 'POST', body: { deviceId: real.out.deviceId, preset: real.cur, bypass: real.cur.bypass } }).catch(() => {}); }, 120);
  const edit = fn => { if (!real) return; fn(real.cur); previewEq(); saveEq(); };
  const balance = slider({ label: 'Balance', min: -100, max: 100, value: 0, fmt: balanceLabel, ok: tune, hint: 'Only this device’s own owner or an admin can change the sound.', onChange: v => edit(c => { c.balance = v; }) });
  const bass = slider({ label: 'Bass', min: -12, max: 12, step: 0.5, value: 0, fmt: dbLabel, ok: tune, hint: 'Only this device’s own owner or an admin can change the sound.', onChange: v => edit(c => { c.bass = { ...c.bass, gainDb: v }; }) });
  const treble = slider({ label: 'Treble', min: -12, max: 12, step: 0.5, value: 0, fmt: dbLabel, ok: tune, hint: 'Only this device’s own owner or an admin can change the sound.', onChange: v => edit(c => { c.treble = { ...c.treble, gainDb: v }; }) });
  const eqHost = h('div', { class: 'spk-eq' });
  async function loadReal() {
    const o = cur(); if (!o) { real = null; paintEq(); return; }
    try {
      const [presets, a] = await Promise.all([api('/dsp/presets'), api(`/dsp/assignments/${encodeURIComponent(o.deviceId)}`)]);
      const p = a && a.presetId != null ? presets.find(x => x.id === a.presetId) : null;
      const c = { ...flatEq(), ...(p ? structuredClone(p.json) : {}) }; c.bypass = !!a?.bypass;
      real = { out: o, presets, cur: c };
    } catch { real = null; }
    paintEq(); syncSliders();
  }
  function syncSliders() { if (!real) return; balance._set(real.cur.balance || 0); bass._set(real.cur.bass?.gainDb || 0); treble._set(real.cur.treble?.gainDb || 0); }
  function paintEq() {
    area?.stopLive?.(); area?.destroy?.(); area = null;
    if (!real) { eqHost.replaceChildren(h('p', { class: 'small dim' }, cur() ? 'The EQ could not be read.' : 'No output yet.')); return; }
    const p = loadEqPrefs();
    area = eqArea({ style: p.style, gains: [...real.cur.graphicDb], glow: p.glow, interactive: true, locked: loadEqLock() || !tune,
      onChange: (i, db) => { if (loadEqLock() || !tune) return; edit(c => { c.graphicDb[i] = db; }); } });
    eqHost.replaceChildren(area.el); if (p.glow > 0) area.startLive?.(spectrumTap);
  }

  // ---- K6 profile row
  const profSel = h('select', { class: 'spk-prof', 'aria-label': 'Profile', onchange: ev => { const v = ev.target.value; if (v) loadProfile(+v); } });
  const dot = h('i', { class: 'spk-moddot', title: 'Changed since this profile was loaded', hidden: true });
  const saveBtn = ro(h('button', { type: 'button', class: 'btn sm', 'data-act': 'prof-save', title: 'Save the current settings into this profile', onclick: () => saveProfile(st.profileId, profiles.find(p => p.id === st.profileId)?.name) }, icon('save'), ' Save'), admin, 'Only an admin can save profiles.');
  const asBtn = ro(h('button', { type: 'button', class: 'btn sm', 'data-act': 'prof-saveas', onclick: () => { naming = true; paintProfile(); } }, 'Save as…'), admin, 'Only an admin can save profiles.');
  const nameIn = h('input', { type: 'text', maxlength: 60, placeholder: 'Profile name', 'aria-label': 'New profile name', class: 'spk-pname', onkeydown: ev => { if (ev.key === 'Enter') doAs(); if (ev.key === 'Escape') { ev.stopPropagation(); naming = false; paintProfile(); } } });
  const doAs = async () => { const n = nameIn.value.trim(); if (!n) { nameIn.focus(); return; } await saveProfile(null, n); naming = false; paintProfile(); };
  const delBtn = ro(h('button', { type: 'button', class: 'btn sm iconsq', 'data-act': 'prof-del', 'aria-label': 'Delete this profile', title: 'Delete this profile', onclick: async () => { const p = profiles.find(x => x.id === st.profileId); if (!p) return; try { await api(`/profiles/${p.id}`, { method: 'DELETE' }); toast(`Deleted “${p.name}”`); await refreshProfile(true); } catch (e) { toast(e.message, true); } } }, icon('trash')), admin, 'Only an admin can delete profiles.');
  const profRow = h('div', { class: 'spk-profrow' });
  function paintProfile() {
    profSel.replaceChildren(h('option', { value: '' }, st.profileId == null ? 'No profile' : '—'), ...profiles.map(p => h('option', { value: p.id, selected: p.id === st.profileId }, p.name)));
    profSel.value = st.profileId == null ? '' : String(st.profileId);
    dot.hidden = !profileDot(st);
    saveBtn.disabled = !admin || st.profileId == null; if (admin) saveBtn.title = st.profileId == null ? 'Pick a profile first, or use Save as…' : 'Save the current settings into this profile';
    delBtn.hidden = st.profileId == null;
    profRow.replaceChildren(h('span', { class: 'dlbl' }, 'PROFILE'), h('span', { class: 'spk-pwrap' }, dot, profSel), saveBtn, naming ? [nameIn, h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'prof-saveas-ok', onclick: doAs }, 'Save'), h('button', { type: 'button', class: 'btn sm', onclick: () => { naming = false; paintProfile(); } }, 'Cancel')] : asBtn, delBtn,
      h('span', { class: 'grow' }), h('span', { class: 'small dim spk-hint' }, 'Saves volume, cap, delay, balance, bass, treble, EQ, output · loads on any speaker'));
    if (naming) queueMicrotask(() => nameIn.focus());
  }
  async function refreshProfile(reload) {
    if (gone) return;
    try { if (reload || !profiles.length) profiles = await api('/profiles'); st = await api(`/profiles/for/${z.id}`); } catch { /* keep */ }
    paintProfile();
  }
  async function saveProfile(id, name) {
    try { const r = await api('/profiles', { method: 'POST', body: { id: id || undefined, name, zoneId: z.id } }); toast(`Saved “${name}”`); st = { profileId: r.id, modified: false }; profiles = await api('/profiles'); paintProfile(); }
    catch (e) { toast(e.message, true); }
  }
  async function loadProfile(id) {
    const p = profiles.find(x => x.id === id); if (!p) return;
    try { const r = await api(`/profiles/${id}/apply`, { method: 'POST', body: { zoneId: z.id } }); await ctl.refreshAll?.(); await loadReal();
      toast(`Loaded ${p.name}${r.skipped?.length ? ` (skipped: ${r.skipped.join(', ')})` : ''}`); root.classList.add('spk-loaded'); setTimeout(() => root.classList.remove('spk-loaded'), 700); await refreshProfile(); }
    catch (e) { toast(e.message, true); await refreshProfile(); }
  }

  // ---- layout
  const o0 = () => cur();
  const outHost = parts.outputPicker ? parts.outputPicker(z) : null;
  const status = h('span', { class: 'spk-status' }), title = h('h3', { class: 'spk-title' });
  const paintTitle = () => { title.replaceChildren(`SPEAKER SETTINGS · ${z.name.toUpperCase()} `, h('span', { class: 'spk-state' + (z.connected ? ' ok' : '') }, '● ' + (z.connected ? 'online' : 'offline'))); };
  paintTitle();
  const done = h('button', { type: 'button', class: 'btn sm spk-done', 'data-act': 'spk-done', onclick: () => parts.onDone?.() }, 'Done');
  const btns = h('div', { class: 'row spk-btns' },
    parts.calibrate ? parts.calibrate(z) : null,
    ro(h('button', { type: 'button', class: 'btn', onclick: async () => { try { await api(`/zones/${z.id}/test-sound`, { method: 'POST' }); toast('Playing a chime in ' + z.name); } catch (e) { toast(e.message, true); } } }, 'Test sound'), can && z.connected, can ? 'This device is offline.' : 'Your access is view-only.'),
    parts.more ? parts.more(z) : null);
  const left = h('div', { class: 'spk-left' }, vol, capRow, delay, balance, bass, treble);
  const right = h('div', { class: 'spk-right' }, h('div', { class: 'dlbl' }, 'EQUALIZER'), eqHost, h('div', { class: 'dlbl' }, 'OUTPUT'), outHost?.el || h('p', { class: 'small dim' }, 'No output yet.'), btns, parts.extra ? parts.extra(z) : null);
  root.append(h('div', { class: 'spk-head' }, title, status, h('span', { class: 'grow' }), done), profRow, h('div', { class: 'spk-body' }, left, right));
  capTitle();
  root.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !ev.target.closest('input[type=text],select')) { ev.stopPropagation(); parts.onDone?.(); } });
  // live values are patched in place - an open slider is never rebuilt
  root._patch = nz => {
    z = { ...z, ...nz }; paintTitle(); vol._set(Math.round(z.volume)); capRow._set(capVal()); capTitle();
    const o = cur(); if (o && delay._input && document.activeElement !== delay._input) delay._set(Math.round(o.latencyMs ?? 0));
    outHost?.patch?.(nz);
    if (real && o && real.out.deviceId !== o.deviceId) loadReal();
  };
  root._destroy = () => { gone = true; area?.stopLive?.(); area?.destroy?.(); };
  window.addEventListener('wavwiz:eqchanged', e => { if (!gone && e.detail?.deviceId === real?.out?.deviceId && !root.contains(document.activeElement)) loadReal(); });
  paintProfile(); refreshProfile(true); loadReal(); void o0;
  return root;
}
