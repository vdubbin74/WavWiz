// WavWiz 0.3.6 K5 / K6: the Speaker Settings column of the expanded Devices view - the widest column (~1050 px at 1920), roomy sliders for volume,
// volume cap, delay, balance, bass and treble, the EQ and the output, and the speaker PROFILE row (dropdown, Save, Save as with an inline name, modified dot).
// Profiles are stored on the server (/profiles); loading one snaps the sliders and shows "Loaded <name>". Nothing here opens a window.
import { wsel } from './wwselect.js';
import { h, api, toast } from './util.js';
import { icon } from './icons.js';
import { isAdmin, canTune, canControl, ADMIN_HINT } from './ui.js';
import { flatEq } from './eq.js';
import { loadEqPrefs, ownEqName, loadEqLock, saveEqLock } from './eqstyle.js';
import { eqArea } from './eqview.js';
import { groupPresets } from './eqsettings.js';
import { spectrumTap } from './viz.js';

/** "Center" / "Left 20" / "Right 35". Pure. */
export const balanceLabel = v => { const n = Math.round(v); return n === 0 ? 'Center' : n < 0 ? `Left ${-n}` : `Right ${n}`; };
export const dbLabel = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 10) / 10)} dB`;
/** The accent dot next to the profile name shows when this speaker's settings changed after the profile was loaded. Pure. */
export const profileDot = st => !!(st && st.profileId != null && st.modified);

/** DIG-amend3 R3(a): per-speaker control epoch + accepted/intent volume across sheet reentry. */
const zoneControlEpoch = new Map();
const zoneSessionVol = new Map();
const bumpZoneControlEpoch = zid => {
  const n = (zoneControlEpoch.get(zid) || 0) + 1;
  zoneControlEpoch.set(zid, n);
  return n;
};
const readZoneControlEpoch = zid => zoneControlEpoch.get(zid) || 0;
const setZoneSessionVol = (zid, v) => { zoneSessionVol.set(zid, v); };
const readZoneSessionVol = zid => zoneSessionVol.get(zid);

export function speakerSettings(S, ctl, z0, parts = {}) {
  let z = { ...z0 }; bumpZoneControlEpoch(z.id); setZoneSessionVol(z.id, z.volume); const admin = isAdmin(S), can = canControl(S), tune = canTune(S, z);
  const mayTune = () => canTune(S, z);   // DIG-amend2 R4: revalidate ownership at DSP dispatch / after awaits
  const cur = () => (z.outputs || []).find(o => o.active) || (z.outputs || []).find(o => o.deviceId === z.chosenDeviceId) || (z.outputs || [])[0] || null;
  const ro = (el, ok, hint = ADMIN_HINT) => { if (!ok) { el.disabled = true; el.title = hint; el.classList.add('ro'); el.setAttribute('aria-disabled', 'true'); } return el; };
  const root = h('section', { class: 'spkset', 'aria-label': `Speaker settings, ${z.name}`, 'data-zone-id': z.id });
  let real = null, area = null, st = { profileId: null, modified: false }, profiles = [], naming = false, gone = false;
  // DIG Cancel: preview-only EQ until Done; snapshot zone+DSP on open for discard
  // DIG-R4: soundDirty (EQ/DSP) separate from ctlDirty (volume/mute/cap/delay)
  let soundDirty = false, ctlDirty = false, previewing = false, snap = null, gen = 0;
  let paintDirty = () => {};
  const anyDirty = () => soundDirty || ctlDirty || previewing;
  const deep = v => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
  const takeSnap = () => {
    const o = cur();
    snap = {
      zone: { volume: z.volume, muted: !!z.muted, volCap: z.volCap ?? 100 },
      latencyMs: Math.round(o?.latencyMs ?? 0), deviceId: o?.deviceId || null,
      assign: real ? { presetId: real.presets.find(x => x.source !== 'builtin' && x.name === ownEqName(z.name))?.id ?? null, bypass: !!real.cur.bypass } : null,
      cur: real ? deep(real.cur) : null
    };
    soundDirty = false; ctlDirty = false; previewing = false;
    setZoneSessionVol(z.id, z.volume);   // DIG-amend3 R3(a)
  };

  // ---- live helpers
  const slider = ({ label, min, max, step = 1, value, fmt, onInput, onChange, ok = true, hint, cls = '' }) => {
    const out = h('span', { class: 'spk-v mono' }, fmt(value));
    const r = h('input', { type: 'range', min, max, step, value, class: 'spk-range', 'aria-label': label, 'data-coarse': step === 1 ? 5 : undefined });
    r.addEventListener('input', () => { out.textContent = fmt(+r.value); onInput?.(+r.value); });
    r.addEventListener('change', () => onChange?.(+r.value));
    r.addEventListener('pointerdown', () => { r._drag = true; }); const up = () => { r._drag = false; }; r.addEventListener('pointerup', up); r.addEventListener('pointercancel', up); r.addEventListener('blur', up);
    if (!ok) ro(r, false, hint);
    const row = h('div', { class: 'spk-row ' + cls }, h('div', { class: 'spk-l' }, h('span', null, label), out), r);
    row._set = v => { if (document.activeElement !== r && !r._drag) { r.value = String(v); out.textContent = fmt(+v); } };
    row._input = r; return row;
  };
  // DIG-R3: cancelable volume debounce; DIG-amend2 R3a flush on Done; R3d track in-flight so Cancel can compensate late PATCH
  let volT = 0, volFlight = [], controlEpoch = readZoneControlEpoch(z.id);
  const putVolRaw = v => { clearTimeout(volT); volT = setTimeout(() => {
    volT = 0; if (gone) return;
    const p = Promise.resolve(ctl.act(`/zones/${z.id}`, { volume: v }, 'PATCH')).catch(() => {});
    volFlight.push(p); p.finally(() => { volFlight = volFlight.filter(x => x !== p); });
  }, 90); };
  putVolRaw.cancel = () => { clearTimeout(volT); volT = 0; };
  putVolRaw.flush = async () => {
    if (!volT) return;
    clearTimeout(volT); volT = 0; if (gone) return;
    const p = Promise.resolve(ctl.act(`/zones/${z.id}`, { volume: z.volume }, 'PATCH')).catch(() => {});
    volFlight.push(p); p.finally(() => { volFlight = volFlight.filter(x => x !== p); });
    await p;
  };
  const putVol = v => { z.volume = v; ctlDirty = true; paintDirty(); setZoneSessionVol(z.id, v); putVolRaw(v); };
  const vol = slider({ label: 'Volume', min: 0, max: 100, value: Math.round(z.volume), fmt: v => v + '%', onInput: putVol, ok: can, hint: 'Your access is view-only.', cls: 'spk-vol' });
  // 0.4.4 F25: mute / unmute this speaker, right of the Volume bar (same round button as the PC card)
  const muteB = h('button', { type: 'button', class: 'mutebtn spk-mute', onclick: () => { z.muted = !z.muted; ctlDirty = true; paintDirty(); ctl.act(`/zones/${z.id}`, { muted: z.muted }, 'PATCH'); paintMute(); } });
  const paintMute = () => { muteB.classList.toggle('on', !!z.muted); muteB.setAttribute('aria-pressed', String(!!z.muted)); muteB.setAttribute('aria-label', (z.muted ? 'Unmute ' : 'Mute ') + z.name); muteB.title = z.muted ? 'Unmute' : 'Mute'; muteB.replaceChildren(icon(z.muted ? 'mute' : 'volume')); muteB.dataset.icon = z.muted ? 'mute' : 'volume'; };
  paintMute(); if (!can) ro(muteB, false, 'Your access is view-only.');
  { const line = h('div', { class: 'spk-volline' }); vol._input.replaceWith(line); line.append(vol._input, muteB); }
  const capVal = () => z.volCap ?? 100;
  const capRow = slider({ label: 'Max volume', min: 0, max: 100, value: capVal(), fmt: v => v + '%', ok: admin, hint: 'Only an admin can change the max volume.',
    onChange: v => { const lock = v < 100; z.volCap = v; ctlDirty = true; paintDirty(); ctl.act(`/zones/${z.id}/volcap`, { cap: v, locked: lock }, 'PUT'); toast(lock ? `${z.name}: max volume locked at ${v}%` : `${z.name}: no max volume`); } });
  const capTitle = () => capRow.querySelector('.spk-l span').textContent = 'Max volume';
  const delayRow = () => { const o = cur(); return slider({ label: 'Delay / sync offset', min: 0, max: 600, step: 1, value: Math.round(o?.latencyMs ?? 0), fmt: v => `${v >= 0 ? '+' : ''}${v} ms`, ok: !!o && tune, hint: 'Only this device’s own owner or an admin can change the delay.',
    onChange: v => { const c = cur(); if (c) { c.latencyMs = v; ctlDirty = true; paintDirty(); api(`/outputs/${encodeURIComponent(c.deviceId)}/latency`, { method: 'PUT', body: { latencyMs: v, playerId: z.playerId, live: true, method: 'manual' } }).then(() => ctl.refreshAll?.()).catch(e => toast(e.message, true)); } } }); };
  // 0.4.6 F45: fine -/+ (1 ms per tap, press-and-hold repeats, accelerating) either side of the Delay value only. The wheel fine-tune stays.
  const fineDelay = row => { const r = row._input, out = row.querySelector('.spk-v'); if (!r || !out || r.disabled) return row;
    let commitT = 0, holdT = 0, n = 0;
    let pending = false; const commit = () => { clearTimeout(commitT); pending = true; commitT = setTimeout(() => { r.dispatchEvent(new Event('change', { bubbles: true })); setTimeout(() => { pending = false; }, 1500); }, 450); };
    let holding = false;
    row._cancelFine = () => { clearTimeout(commitT); clearTimeout(holdT); commitT = holdT = 0; holding = false; pending = false; };
    const nudge = d => { const v = Math.max(+r.min, Math.min(+r.max, Math.round(+r.value) + d)); if (v === +r.value) return; r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); if (!holding) commit(); };
    const stop = () => { clearTimeout(holdT); holdT = 0; if (holding) { holding = false; commit(); } };
    const mk = (d, txt, lab) => { const b = h('button', { type: 'button', class: 'spk-fine', 'data-fine': d > 0 ? 'up' : 'down', 'aria-label': lab, title: lab }, txt);
      b.addEventListener('pointerdown', ev => { if (ev.button > 0) return; ev.preventDefault(); n = 0; stop(); holding = true; clearTimeout(commitT); nudge(d); const rep = () => { n++; nudge(d); holdT = setTimeout(rep, Math.max(35, 140 - n * 8)); }; holdT = setTimeout(rep, 400); });
      for (const e of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) b.addEventListener(e, stop);
      b.addEventListener('click', ev => { if (ev.detail === 0) nudge(d); });   // keyboard Enter / Space
      return b; };
    // typed entry: numeric keypad (the range is 0..600, so no minus is needed; inputmode switches to 'text' if a range ever goes below 0)
    const num = h('input', { type: 'text', class: 'spk-num mono', inputmode: +r.min < 0 ? 'text' : 'numeric', pattern: +r.min < 0 ? '-?[0-9]*' : '[0-9]*', enterkeyhint: 'done', autocomplete: 'off', 'aria-label': 'Delay in milliseconds', value: String(Math.round(+r.value)) });
    const unit = h('span', { class: 'spk-unit small dim' }, 'ms');
    let typing = false;
    const apply = () => { const t = num.value.trim().replace(',', '.'); const v = Math.round(parseFloat(t)); if (!Number.isFinite(v)) { num.value = String(Math.round(+r.value)); return; }
      const c = Math.max(+r.min, Math.min(+r.max, v)); num.value = String(c); if (c !== +r.value) { r.value = String(c); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); } };
    num.addEventListener('focus', () => { typing = true; num.select?.(); });
    num.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); apply(); num.blur(); } else if (ev.key === 'Escape') { ev.stopPropagation(); num.value = String(Math.round(+r.value)); num.blur(); } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); nudge(ev.key === 'ArrowUp' ? 1 : -1); } });
    num.addEventListener('blur', () => { if (typing) { typing = false; apply(); } });
    r.addEventListener('input', () => { if (document.activeElement !== num) num.value = String(Math.round(+r.value)); });
    const set0 = row._set; row._set = v => { if (holding || typing || pending) return; set0(v); if (document.activeElement !== num) num.value = String(Math.round(+r.value)); };
    out.classList.add('spk-vhide');
    out.after(mk(-1, '−', 'Delay 1 ms less'), num, unit, mk(1, '+', 'Delay 1 ms more')); row.classList.add('spk-hasfine'); row._num = num; return row; };
  let delay = fineDelay(delayRow());

  // ---- device preset (balance, bass, treble, EQ): same own-preset flow as the center EQ
  const saveEq = async () => {
    // DIG-amend2 R4: recheck mayTune at dispatch and after each await; R3e: return false on failure (keep dirty/retryable)
    // DIG-amend3 R3(b): ownership loss mid-save — revert preview (no forbidden DSP persistence); cleaned abort may close
    const r = real; if (!r || gone) return true;
    const revertPreview = async () => {
      try { if (r.out?.deviceId) await api('/dsp/revert', { method: 'POST', body: { deviceId: r.out.deviceId } }); } catch { /* */ }
      previewing = false;
    };
    if (!mayTune()) { await revertPreview(); soundDirty = false; return true; }
    const name = ownEqName(z.name), body = { name, preset: { ...r.cur, name } }, g = ++gen;
    try {
      const mine = r.presets.find(x => x.source !== 'builtin' && x.name === name); let id;
      if (mine) { await api(`/dsp/presets/${mine.id}`, { method: 'PUT', body }); id = mine.id; } else id = (await api('/dsp/presets', { method: 'POST', body })).id;
      // DIG-amend4 R3: invalidated old save (gone/gen) must not revert — newer same-output session may own preview
      if (gone || g !== gen) return false;
      if (!mayTune()) { await revertPreview(); soundDirty = false; return true; }   // R3(b): cleaned abort — outer Done closes without live preview
      await api(`/dsp/assignments/${encodeURIComponent(r.out.deviceId)}`, { method: 'PUT', body: { presetId: id, enabled: true, bypass: r.cur.bypass } });
      if (gone || g !== gen) return false;
      if (!mayTune()) { await revertPreview(); soundDirty = false; return true; }
      r.presets = await api('/dsp/presets'); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('wavwiz:eqchanged', { detail: { deviceId: r.out.deviceId } })); refreshProfile();
      soundDirty = false; previewing = false;
      return true;
    } catch (e) { toast(e.message, true); return false; }
  };
  let previewT = 0;
  // DIG-R3c: fence preview vs discard — late preview after Cancel must revert
  const previewEq = () => { clearTimeout(previewT); previewT = setTimeout(() => {
    if (!real || gone || !mayTune()) return;
    const g = gen, did = real.out.deviceId, preset = deep(real.cur);
    previewing = true; paintDirty();
    api('/dsp/preview', { method: 'POST', body: { deviceId: did, preset, bypass: preset.bypass } })
      .then(() => { if (gone || g !== gen) return api('/dsp/revert', { method: 'POST', body: { deviceId: did } }); })
      .catch(() => {});
  }, 120); };
  previewEq.cancel = () => { clearTimeout(previewT); previewT = 0; };
  const edit = fn => { if (!real || !tune) return; fn(real.cur); soundDirty = true; paintDirty(); previewEq(); };
  const balance = slider({ label: 'Balance', min: -100, max: 100, value: 0, fmt: balanceLabel, ok: tune, hint: 'Only this device’s own owner or an admin can change the sound.', onChange: v => edit(c => { c.balance = v; }) });
  const bass = slider({ label: 'Bass', min: -12, max: 12, step: 0.5, value: 0, fmt: dbLabel, ok: tune, hint: 'Only this device’s own owner or an admin can change the sound.', onChange: v => edit(c => { c.bass = { ...c.bass, gainDb: v }; }) });
  const treble = slider({ label: 'Treble', min: -12, max: 12, step: 0.5, value: 0, fmt: dbLabel, ok: tune, hint: 'Only this device’s own owner or an admin can change the sound.', onChange: v => edit(c => { c.treble = { ...c.treble, gainDb: v }; }) });
  // 0.5.0 F109b: Trim / Auto pre-gain / Limiter moved here from the old in-place All sound settings
  const trim = slider({ label: 'Trim', min: -24, max: 6, step: 0.5, value: 0, fmt: dbLabel, ok: tune, hint: 'Only this device’s own owner or an admin can change the sound.', onChange: v => edit(c => { c.trimDb = v; }) });
  const eqHost = h('div', { class: 'spk-eq' });
  async function loadReal() {
    const o = cur(); if (!o) { real = null; if (!gone) paintEq(); return; }
    const wantId = o.deviceId;
    try {
      const [presets, a] = await Promise.all([api('/dsp/presets'), api(`/dsp/assignments/${encodeURIComponent(wantId)}`)]);
      // DIG-amend2 R3c: late GET must not resurrect meters after hide/destroy/target change
      if (gone || !root.isConnected) return;
      const now = cur(); if (!now || now.deviceId !== wantId) return;
      const p = a && a.presetId != null ? presets.find(x => x.id === a.presetId) : null;
      const c = { ...flatEq(), ...(p ? structuredClone(p.json) : {}) }; c.bypass = !!a?.bypass;
      real = { out: now, presets, cur: c };
    } catch { if (gone || !root.isConnected) return; const now = cur(); if (!now || now.deviceId !== wantId) return; /* DIG-amend3 R3(c): stale failure must not blank newer output */ real = null; }
    if (gone || !root.isConnected) return;
    paintEq(); syncSliders(); paintPresets(); const lc = loud.querySelector('input'); if (lc) { lc.checked = !!real?.cur.loudness?.enabled; lc.disabled = !mayTune(); } const pa = preamp.querySelector('input'); if (pa) { pa.checked = !!real?.cur.autoPreamp; pa.disabled = !mayTune(); } const li = limiter.querySelector('input'); if (li) { li.checked = !!real?.cur.limiter?.enabled; li.disabled = !mayTune(); }
    takeSnap(); paintDirty();
  }
  function syncSliders() { if (!real) return; balance._set(real.cur.balance || 0); bass._set(real.cur.bass?.gainDb || 0); treble._set(real.cur.treble?.gainDb || 0); trim._set(real.cur.trimDb || 0); }
  function paintEq() {
    area?.stopLive?.(); area?.destroy?.(); area = null;
    if (!real) { eqHost.replaceChildren(h('p', { class: 'small dim' }, cur() ? 'The EQ could not be read.' : 'No output yet.')); return; }
    const p = loadEqPrefs();
    area = eqArea({ style: p.style, gains: [...real.cur.graphicDb], glow: p.glow, interactive: true, locked: !tune,   // 0.4.2: the EQ in the speaker page is never locked (only a view-only user is read-only)
      onChange: (i, db) => { if (!tune) return; edit(c => { c.graphicDb[i] = db; }); } });
    eqHost.replaceChildren(area.el); area.startLive?.(spectrumTap);   // DIG EQ light: live meters mirror center EQ
  }

  // ---- K6 profile row
  const profSel = wsel({ class: 'spk-prof', 'aria-label': 'Profile', onchange: ev => { const v = ev.target.value; if (v) loadProfile(+v); } });
  const dot = h('i', { class: 'spk-moddot', title: 'Changed since this profile was loaded', hidden: true });
  const saveBtn = ro(h('button', { type: 'button', class: 'btn sm', 'data-act': 'prof-save', title: 'Save the current settings into this profile', onclick: () => saveProfile(st.profileId, profiles.find(p => p.id === st.profileId)?.name) }, icon('save'), ' Save'), admin, 'Only an admin can save profiles.');
  const asBtn = ro(h('button', { type: 'button', class: 'btn sm', 'data-act': 'prof-saveas', onclick: () => { naming = true; paintProfile(); } }, '＋ New…'), admin, 'Only an admin can save profiles.');   // F264: new-profile entry; name field + Create/Cancel only while naming
  const nameIn = h('input', { type: 'text', maxlength: 60, placeholder: 'Profile name', 'aria-label': 'New profile name', class: 'spk-pname', onkeydown: ev => { if (ev.key === 'Enter') doAs(); if (ev.key === 'Escape') { ev.stopPropagation(); naming = false; paintProfile(); } } });
  const doAs = async () => { const n = nameIn.value.trim(); if (!n) { nameIn.focus(); return; } await saveProfile(null, n); naming = false; paintProfile(); };
  const delBtn = ro(h('button', { type: 'button', class: 'btn sm iconsq', 'data-act': 'prof-del', 'aria-label': 'Delete this profile', title: 'Delete this profile', onclick: async () => { const p = profiles.find(x => x.id === st.profileId); if (!p) return; try { await api(`/profiles/${p.id}`, { method: 'DELETE' }); toast(`Deleted “${p.name}”`); await refreshProfile(true); } catch (e) { toast(e.message, true); } } }, icon('trash')), admin, 'Only an admin can delete profiles.');
  const profRow = h('div', { class: 'spk-profrow', title: 'Saves volume, cap, delay, balance, bass, treble, EQ, output · loads on any speaker' });   // F264: helper as tooltip (text hidden on phone)
  function paintProfile() {
    profSel.replaceChildren(h('option', { value: '' }, st.profileId == null ? 'No profile' : '—'), ...profiles.map(p => h('option', { value: p.id, selected: p.id === st.profileId }, p.name)));
    profSel.value = st.profileId == null ? '' : String(st.profileId);
    dot.hidden = !profileDot(st);
    saveBtn.disabled = !admin || st.profileId == null; if (admin) saveBtn.title = st.profileId == null ? 'Pick a profile first, or use New…' : 'Save the current settings into this profile';
    delBtn.hidden = st.profileId == null || naming;   // F264: one Save at a time
    profRow.replaceChildren(h('span', { class: 'dlbl' }, 'PROFILE'), h('span', { class: 'spk-pwrap' }, dot, profSel), naming ? null : saveBtn, naming ? [nameIn, h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'prof-saveas-ok', onclick: doAs }, 'Create'), h('button', { type: 'button', class: 'btn sm', onclick: () => { naming = false; paintProfile(); } }, 'Cancel')] : asBtn, delBtn,
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
  const tagRow = h('div', { class: 'dtagrow spk-tags' });
  // F264: the Zone row is re-made when the speaker's zone (or the zone list) changes, unless its select is in use
  const zoneHost = h('div', { class: 'spk-zonehost' }); let zoneRowEl = parts.zoneRow ? parts.zoneRow(z) : null; if (zoneRowEl) zoneHost.append(zoneRowEl);
  const paintZoneRow = () => { if (!parts.zoneRow) return; const fresh = parts.zoneRow(z); if (zoneRowEl && fresh._zsig != null && fresh._zsig === zoneRowEl._zsig) return; if (zoneRowEl?.contains(document.activeElement) && zoneRowEl.querySelector('[aria-expanded="true"]')) return; zoneRowEl = fresh; zoneHost.replaceChildren(fresh); };
  // 0.4.4 F23: status ticks patch in place - the tags / title are only touched when what they show changed
  let tagSig = null, titleSig = null;
  const paintTags = () => { const els = parts.tags ? parts.tags(z) : [], sg = els.map(e => e.outerHTML).join(''); if (sg === tagSig) return; tagSig = sg; tagRow.replaceChildren(...els); };
  const status = h('span', { class: 'spk-status' }), title = h('h3', { class: 'spk-title' });
  const paintTitle = () => { const sg = z.name + '|' + !!z.connected; if (sg === titleSig) return; titleSig = sg; title.replaceChildren(`SPEAKER SETTINGS · ${z.name.toUpperCase()} `, h('span', { class: 'spk-state' + (z.connected ? ' ok' : '') }, '● ' + (z.connected ? 'online' : 'offline'))); };
  paintTitle(); paintTags();
  const liveTag = h('span', { class: 'small dim spk-preview', hidden: true }, 'Previewing');
  paintDirty = () => { liveTag.hidden = !anyDirty(); cancel.disabled = !anyDirty(); cancel.classList.toggle('dim', cancel.disabled); };
  const discard = async () => {
    ++gen; const ep = bumpZoneControlEpoch(z.id); controlEpoch = ep; previewEq.cancel?.(); putVolRaw.cancel?.(); delay?._cancelFine?.();
    const o = cur(), did = real?.out?.deviceId || o?.deviceId || snap?.deviceId;
    const flights = [...volFlight];
    const had = previewing || soundDirty || ctlDirty;
    if (had) {
      try { if (did && (previewing || soundDirty)) await api('/dsp/revert', { method: 'POST', body: { deviceId: did } }); } catch { /* gone */ }
      if (snap?.cur && real) { real.cur = deep(snap.cur); }
      if (snap?.zone) {
        const want = snap.zone;
        if (z.volume !== want.volume) { z.volume = want.volume; try { await api(`/zones/${z.id}`, { method: 'PATCH', body: { volume: want.volume } }); } catch { /* */ } }
        if (!!z.muted !== !!want.muted) { z.muted = !!want.muted; try { await api(`/zones/${z.id}`, { method: 'PATCH', body: { muted: !!want.muted } }); } catch { /* */ } }
        if ((z.volCap ?? 100) !== want.volCap) { z.volCap = want.volCap; try { await api(`/zones/${z.id}/volcap`, { method: 'PUT', body: { cap: want.volCap, locked: want.volCap < 100 } }); } catch { /* */ } }
      }
      if (snap && o?.deviceId && snap.deviceId === o.deviceId && snap.latencyMs != null && Math.round(o.latencyMs ?? 0) !== snap.latencyMs) {
        try { await api(`/outputs/${encodeURIComponent(o.deviceId)}/latency`, { method: 'PUT', body: { latencyMs: snap.latencyMs, playerId: z.playerId, live: true, method: 'manual' } }); } catch { /* */ }
      }
    }
    // DIG-amend2 R3d + DIG-amend3 R3(a): after late Volume PATCH, re-assert current per-speaker session volume
    // (discard snap if still current; newer accepted Done/edit baseline if this speaker was reopened)
    if (snap?.zone && flights.length) {
      setZoneSessionVol(z.id, snap.zone.volume);
      void Promise.allSettled(flights).then(async () => {
        const wantVol = readZoneSessionVol(z.id);
        if (wantVol == null) return;
        try { await api(`/zones/${z.id}`, { method: 'PATCH', body: { volume: wantVol } }); } catch { /* */ }
      });
    }
    soundDirty = false; ctlDirty = false; previewing = false;
    if (typeof window !== 'undefined' && did && had) window.dispatchEvent(new CustomEvent('wavwiz:eqchanged', { detail: { deviceId: did } }));
  };
  // DIG-R4 + DIG-amend2 R3a/e/R4: flush Volume, recheck mayTune, failed save keeps sheet; takeSnap so later discard/popstate keep accepted baseline
  const commitSession = async () => {
    previewEq.cancel?.();
    await putVolRaw.flush?.();
    if (soundDirty && mayTune() && real) {
      const ok = await saveEq();
      if (ok === false) return false;   // R3e: retain soundDirty + open sheet for retry
    } else if (previewing && real?.out?.deviceId) {
      try { await api('/dsp/revert', { method: 'POST', body: { deviceId: real.out.deviceId } }); } catch { /* */ }
      previewing = false;
    }
    takeSnap();   // accepted baseline (volume/mute/cap/EQ) — subsequent discard must not roll back a committed Done
    soundDirty = false; ctlDirty = false;
    // DIG-amend3 R3(a): accepted Done supersedes any prior discard's late Volume compensation for this speaker
    controlEpoch = bumpZoneControlEpoch(z.id);
    return true;
  };
  const commitAndClose = async () => {
    if (await commitSession() === false) return;
    root._teardownLive?.();   // DIG-amend2 R3b: inner Done shares outer teardown
    parts.onDone?.();
  };
  const cancelAndClose = async () => {
    await discard();
    root._teardownLive?.();   // DIG-amend2 R3b: inner Cancel/Escape release meters
    parts.onDone?.();
  };
  const cancel = h('button', { type: 'button', class: 'btn sm spk-cancel', 'data-act': 'spk-cancel', disabled: true, onclick: () => cancelAndClose() }, 'Cancel');
  const done = h('button', { type: 'button', class: 'btn sm primary spk-done', 'data-act': 'spk-done', onclick: () => commitAndClose() }, 'Done');
  const btns = h('div', { class: 'row spk-btns' },
    parts.calibrate ? parts.calibrate(z) : null, parts.calhelp ? parts.calhelp(z) : null,   // 0.4.5 F29: '? How calibration works'
    ro(h('button', { type: 'button', class: 'btn', onclick: async () => { try { await api(`/zones/${z.id}/test-sound`, { method: 'POST' }); toast('Playing a chime in ' + z.name); } catch (e) { toast(e.message, true); } } }, 'Test sound'), can && z.connected, can ? 'This device is offline.' : 'Your access is view-only.'),
    parts.more ? parts.more(z) : null);
  // 0.4.3 #8: "Calibration: Done · Quick · Oct 18 · +42 ms" / "Calibration: Not calibrated" for the active output
  const calLine = h('div', { class: 'small spk-cal', 'data-cal': '1' }, 'Calibration: …');
  const paintCal = async () => { const o = cur(); if (!o?.deviceId) { calLine.textContent = 'Calibration: Not calibrated'; return; }
    try { const hs = await api(`/outputs/${encodeURIComponent(o.deviceId)}/calibrations`); calLine.textContent = calText(hs); } catch { calLine.textContent = 'Calibration: unknown'; } };
  const left = h('div', { class: 'spk-left' }, vol, capRow, delay, balance, bass, treble, trim);
  // ---- 0.4.2: EQ on/off, Reset, PRESETS row (8 built-ins, then "My presets"), Save as preset, loudness
  const eqOn = h('button', { type: 'button', class: 'onpill spk-eqon', role: 'switch', 'data-act': 'eq-on', 'aria-label': 'EQ on or off', onclick: () => { if (!real || !tune) return; edit(c => { c.bypass = !c.bypass; }); paintEqCtl(); } }, h('span', { class: 'op-off' }, 'OFF'), h('span', { class: 'op-on' }, 'ON'));
  ro(eqOn, tune, 'Only this device’s own owner or an admin can change the sound.');
  const resetBtn = ro(h('button', { type: 'button', class: 'btn sm', 'data-act': 'eq-reset', title: 'Back to flat', onclick: () => { if (!real) return; edit(c => { c.graphicDb = new Array(10).fill(0); c.bass = { ...c.bass, gainDb: 0 }; c.treble = { ...c.treble, gainDb: 0 }; c.balance = 0; c.trimDb = 0; }); paintEq(); syncSliders(); paintPresets(); } }, 'Reset'), tune, 'Only this device’s own owner or an admin can change the sound.');
  const saveAsBtn = ro(h('button', { type: 'button', class: 'btn sm', 'data-act': 'preset-saveas', onclick: () => { if (!real) return; parts.promptName?.('Save as preset', '', async v => { const body = { name: v, preset: { ...real.cur, name: v } }; await api('/dsp/presets', { method: 'POST', body }); real.presets = await api('/dsp/presets'); toast(`Saved preset “${v}”`); paintPresets(); }); } }, 'Save as preset'), admin || tune, 'Only this device’s own owner or an admin can save presets.');
  const eqCtl = h('span', { class: 'spk-eqctl' }, eqOn);
  const paintEqCtl = () => { const on = real ? !real.cur.bypass : false; eqOn.classList.toggle('on', on); eqOn.setAttribute('aria-checked', String(on)); };
  // 0.4.4 F20: one themed dropdown "Preset: <name> ▾" (8 built-ins, then My presets; Custom when the bands match none), Reset + Save as preset beside it
  const presetSel = ro(wsel({ class: 'eqall-preset spk-presel', 'aria-label': 'Preset', 'data-act': 'preset', onchange: ev => { if (!tune || !real) return; const p = real.presets.find(x => String(x.id) === ev.target.value); if (!p) return; edit(c => { const j = structuredClone(p.json); Object.assign(c, j, { bypass: c.bypass, name: c.name }); }); paintEq(); syncSliders(); paintPresets(); } }), tune, 'Only this device’s own owner or an admin can change the sound.');
  const presetRow = h('div', { class: 'spk-presets', 'aria-label': 'Presets' }, h('label', { class: 'dlbl spk-prelbl' }, 'Preset:'), presetSel, resetBtn, saveAsBtn);
  function paintPresets() {
    paintEqCtl(); if (!real) { presetSel.replaceChildren(h('option', { value: '' }, '—')); presetSel.disabled = true; return; }
    presetSel.disabled = !tune;
    const groups = groupPresets(real.presets), act = activePreset(groups.flatMap(g => g.items), real.cur);   // 0.4.3 #4: exactly one is current (or Custom)
    const opt = p => h('option', { value: String(p.id), selected: p.name === act }, p.name);
    presetSel.replaceChildren(h('option', { value: '', selected: act == null, disabled: true }, 'Custom'), ...groups.flatMap(g => g.label ? [h('optgroup', { label: g.label }, ...g.items.map(opt))] : g.items.map(opt)));
  }
  const loud = h('label', { class: 'spk-loud' }, h('input', { type: 'checkbox', 'data-act': 'loudness', onchange: ev => edit(c => { c.loudness = { ...c.loudness, enabled: ev.target.checked }; }) }), ' Loudness ', h('span', { class: 'small dim' }, 'More bass and treble at low volume'));
  const preamp = h('label', { class: 'spk-loud spk-preamp' }, h('input', { type: 'checkbox', 'data-act': 'autopreamp', onchange: ev => edit(c => { c.autoPreamp = ev.target.checked; }) }), ' Auto pre-gain ', h('span', { class: 'small dim' }, 'Prevents clipping when boosting.'));
  const limiter = h('label', { class: 'spk-loud spk-limiter' }, h('input', { type: 'checkbox', 'data-act': 'limiter', onchange: ev => edit(c => { c.limiter = { ...c.limiter, enabled: ev.target.checked }; }) }), ' Limiter ', h('span', { class: 'small dim' }, 'Protects the speaker.'));
  const extraSw = h('div', { class: 'spk-sw' }, loud, preamp, limiter);
  const right = h('div', { class: 'spk-right' }, h('div', { class: 'dlbl spk-eqh' }, h('span', null, 'EQUALIZER'), eqCtl), presetRow, eqHost, extraSw, h('div', { class: 'dlbl' }, 'OUTPUT DEVICE'), outHost?.el || h('p', { class: 'small dim' }, 'No output yet.'), calLine, btns, parts.extra ? parts.extra(z) : null);
  root.append(h('div', { class: 'spk-head' }, title, parts.onRename ? ro(h('button', { type: 'button', class: 'btn sm spk-rename', 'data-act': 'spk-rename', onclick: () => parts.onRename(z) }, 'Rename'), admin, 'Only an administrator can rename a device.') : null, status, liveTag, h('span', { class: 'grow' }), cancel, done), zoneHost, tagRow, profRow, h('div', { class: 'spk-body' }, left, right));
  capTitle();
  root.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !ev.target.closest('input[type=text],select')) { ev.stopPropagation(); if (anyDirty()) cancelAndClose(); else { root._teardownLive?.(); parts.onDone?.(); } } });
  // live values are patched in place - an open slider is never rebuilt
  root._patch = nz => {
    z = { ...z, ...nz }; paintTitle(); paintTags(); paintZoneRow(); vol._set(Math.round(z.volume)); paintMute(); capRow._set(capVal()); capTitle();
    const o = cur(); if (o && delay._input && document.activeElement !== delay._input) delay._set(Math.round(o.latencyMs ?? 0));
    outHost?.patch?.(nz);
    if (real && o && real.out.deviceId !== o.deviceId) { loadReal(); paintCal(); }
  };
  // DIG-R3: session helpers for phone outer Back/Done + destroy restores claimed snapshot fields
  root._commitSession = commitSession;
  root._discardSession = discard;
  root._teardownLive = () => { area?.stopLive?.(); area?.destroy?.(); area = null; };
  root._resumeLive = () => { if (!gone && real && !area) paintEq(); };   // DIG-amend2 R3b: paintDetail may run before sheet re-portals
  root._destroy = () => {
    const was = anyDirty();
    gone = true; putVolRaw.cancel?.(); previewEq.cancel?.(); delay?._cancelFine?.();
    root._teardownLive();
    if (was) void discard();
  };
  if (typeof window !== 'undefined') window.addEventListener('wavwiz:eqchanged', e => { if (!gone && e.detail?.deviceId === real?.out?.deviceId && !root.contains(document.activeElement)) loadReal(); });
  paintProfile(); refreshProfile(true); loadReal(); paintCal(); void o0;
  return root;
}

/** 0.4.3 #4: the ONE preset chip to light for the current EQ: the preset it was loaded from (cur.name) if the curve still matches it, else the first preset with the
 * same curve; null when the settings match no preset (custom, unsaved). Pure, unit-tested. */
export function activePreset(list, cur) {
  const k = a => JSON.stringify((a || []).map(Number)), mine = k(cur?.graphicDb);
  const same = (list || []).filter(p => k(p.json?.graphicDb) === mine);
  return (same.find(p => p.name === cur?.name) || same[0])?.name ?? null;
}

/** 0.4.3 #8: the calibration status line from the output's calibration history (newest first). Pure, unit-tested. */
export function calText(hist, fmtDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })) {
  const c = (hist || []).find(x => x.current); if (!c) return 'Calibration: Not calibrated';
  const d = new Date(c.measuredAt), off = Math.round(c.latencyMs || 0), how = c.method === 'manual' ? 'Set by hand' : c.method === 'ear' ? 'Done by ear' : 'Done';
  const mode = c.notes === 'quick' ? 'Quick' : c.notes === 'thorough' ? 'Thorough' : null;
  return ['Calibration: ' + how, mode, isNaN(d) ? null : fmtDate(d), `${off >= 0 ? '+' : ''}${off} ms`].filter(Boolean).join(' · ');
}
