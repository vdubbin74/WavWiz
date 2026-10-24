// WavWiz 0.3.6 K5 / K6: the Speaker Settings column of the expanded Devices view - the widest column (~1050 px at 1920), roomy sliders for volume,
// volume cap, delay, balance, bass and treble, the EQ and the output, and the speaker PROFILE row (dropdown, Save, Save as with an inline name, modified dot).
// Profiles are stored on the server (/profiles); loading one snaps the sliders and shows "Loaded <name>". Nothing here opens a window.
import { h, api, toast, debounce } from './util.js';
import { icon } from './icons.js';
import { isAdmin, canTune, canControl, ADMIN_HINT } from './ui.js';
import { flatEq } from './eq.js';
import { loadEqPrefs, ownEqName, loadEqLock, saveEqLock } from './eqstyle.js';
import { eqArea } from './eqview.js';
import { groupPresets } from './eqsettings.js';

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
    r.addEventListener('pointerdown', () => { r._drag = true; }); const up = () => { r._drag = false; }; r.addEventListener('pointerup', up); r.addEventListener('pointercancel', up); r.addEventListener('blur', up);
    if (!ok) ro(r, false, hint);
    const row = h('div', { class: 'spk-row ' + cls }, h('div', { class: 'spk-l' }, h('span', null, label), out), r);
    row._set = v => { if (document.activeElement !== r && !r._drag) { r.value = String(v); out.textContent = fmt(+v); } };
    row._input = r; return row;
  };
  const putVol = debounce(v => ctl.act(`/zones/${z.id}`, { volume: v }, 'PATCH'), 90);
  const vol = slider({ label: 'Volume', min: 0, max: 100, value: Math.round(z.volume), fmt: v => v + '%', onInput: putVol, ok: can, hint: 'Your access is view-only.', cls: 'spk-vol' });
  // 0.4.4 F25: mute / unmute this speaker, right of the Volume bar (same round button as the PC card)
  const muteB = h('button', { type: 'button', class: 'mutebtn spk-mute', onclick: () => { z.muted = !z.muted; ctl.act(`/zones/${z.id}`, { muted: z.muted }, 'PATCH'); paintMute(); } });
  const paintMute = () => { muteB.classList.toggle('on', !!z.muted); muteB.setAttribute('aria-pressed', String(!!z.muted)); muteB.setAttribute('aria-label', (z.muted ? 'Unmute ' : 'Mute ') + z.name); muteB.title = z.muted ? 'Unmute' : 'Mute'; muteB.replaceChildren(icon(z.muted ? 'mute' : 'volume')); muteB.dataset.icon = z.muted ? 'mute' : 'volume'; };
  paintMute(); if (!can) ro(muteB, false, 'Your access is view-only.');
  { const line = h('div', { class: 'spk-volline' }); vol._input.replaceWith(line); line.append(vol._input, muteB); }
  const capVal = () => z.volCap ?? 100;
  const capRow = slider({ label: 'Max volume', min: 0, max: 100, value: capVal(), fmt: v => v + '%', ok: admin, hint: 'Only an admin can change the max volume.',
    onChange: v => { const lock = v < 100; ctl.act(`/zones/${z.id}/volcap`, { cap: v, locked: lock }, 'PUT'); toast(lock ? `${z.name}: max volume locked at ${v}%` : `${z.name}: no max volume`); } });
  const capTitle = () => capRow.querySelector('.spk-l span').textContent = 'Max volume';
  const delayRow = () => { const o = cur(); return slider({ label: 'Delay / sync offset', min: 0, max: 600, step: 1, value: Math.round(o?.latencyMs ?? 0), fmt: v => `${v >= 0 ? '+' : ''}${v} ms`, ok: !!o && tune, hint: 'Only this device’s own owner or an admin can change the delay.',
    onChange: v => { const c = cur(); if (c) api(`/outputs/${encodeURIComponent(c.deviceId)}/latency`, { method: 'PUT', body: { latencyMs: v, playerId: z.playerId, live: true, method: 'manual' } }).then(() => ctl.refreshAll?.()).catch(e => toast(e.message, true)); } }); };
  // 0.4.6 F45: fine -/+ (1 ms per tap, press-and-hold repeats, accelerating) either side of the Delay value only. The wheel fine-tune stays.
  const fineDelay = row => { const r = row._input, out = row.querySelector('.spk-v'); if (!r || !out || r.disabled) return row;
    let commitT = 0, holdT = 0, n = 0;
    let pending = false; const commit = () => { clearTimeout(commitT); pending = true; commitT = setTimeout(() => { r.dispatchEvent(new Event('change', { bubbles: true })); setTimeout(() => { pending = false; }, 1500); }, 450); };
    const nudge = d => { const v = Math.max(+r.min, Math.min(+r.max, Math.round(+r.value) + d)); if (v === +r.value) return; r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); if (!holding) commit(); };
    let holding = false; const stop = () => { clearTimeout(holdT); holdT = 0; if (holding) { holding = false; commit(); } };
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
  const saveEq = debounce(async () => {
    const r = real; if (!r || gone) return; const name = ownEqName(z.name), body = { name, preset: { ...r.cur, name } };
    try {
      const mine = r.presets.find(x => x.source !== 'builtin' && x.name === name); let id;
      if (mine) { await api(`/dsp/presets/${mine.id}`, { method: 'PUT', body }); id = mine.id; } else id = (await api('/dsp/presets', { method: 'POST', body })).id;
      await api(`/dsp/assignments/${encodeURIComponent(r.out.deviceId)}`, { method: 'PUT', body: { presetId: id, enabled: true, bypass: r.cur.bypass } });
      r.presets = await api('/dsp/presets'); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('wavwiz:eqchanged', { detail: { deviceId: r.out.deviceId } })); refreshProfile();
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
    paintEq(); syncSliders(); paintPresets(); const lc = loud.querySelector('input'); if (lc) { lc.checked = !!real?.cur.loudness?.enabled; lc.disabled = !tune; }
  }
  function syncSliders() { if (!real) return; balance._set(real.cur.balance || 0); bass._set(real.cur.bass?.gainDb || 0); treble._set(real.cur.treble?.gainDb || 0); }
  function paintEq() {
    area?.stopLive?.(); area?.destroy?.(); area = null;
    if (!real) { eqHost.replaceChildren(h('p', { class: 'small dim' }, cur() ? 'The EQ could not be read.' : 'No output yet.')); return; }
    const p = loadEqPrefs();
    area = eqArea({ style: p.style, gains: [...real.cur.graphicDb], glow: p.glow, interactive: true, locked: !tune,   // 0.4.2: the EQ in the speaker page is never locked (only a view-only user is read-only)
      onChange: (i, db) => { if (!tune) return; edit(c => { c.graphicDb[i] = db; }); } });
    eqHost.replaceChildren(area.el);   // no live meters here: the Now Playing EQ shows the music, this one is for settings
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
  const tagRow = h('div', { class: 'dtagrow spk-tags' });
  // 0.4.4 F23: status ticks patch in place - the tags / title are only touched when what they show changed
  let tagSig = null, titleSig = null;
  const paintTags = () => { const els = parts.tags ? parts.tags(z) : [], sg = els.map(e => e.outerHTML).join(''); if (sg === tagSig) return; tagSig = sg; tagRow.replaceChildren(...els); };
  const status = h('span', { class: 'spk-status' }), title = h('h3', { class: 'spk-title' });
  const paintTitle = () => { const sg = z.name + '|' + !!z.connected; if (sg === titleSig) return; titleSig = sg; title.replaceChildren(`SPEAKER SETTINGS · ${z.name.toUpperCase()} `, h('span', { class: 'spk-state' + (z.connected ? ' ok' : '') }, '● ' + (z.connected ? 'online' : 'offline'))); };
  paintTitle(); paintTags();
  const done = h('button', { type: 'button', class: 'btn sm spk-done', 'data-act': 'spk-done', onclick: () => parts.onDone?.() }, 'Done');
  const btns = h('div', { class: 'row spk-btns' },
    parts.calibrate ? parts.calibrate(z) : null, parts.calhelp ? parts.calhelp(z) : null,   // 0.4.5 F29: '? How calibration works'
    ro(h('button', { type: 'button', class: 'btn', onclick: async () => { try { await api(`/zones/${z.id}/test-sound`, { method: 'POST' }); toast('Playing a chime in ' + z.name); } catch (e) { toast(e.message, true); } } }, 'Test sound'), can && z.connected, can ? 'This device is offline.' : 'Your access is view-only.'),
    parts.more ? parts.more(z) : null);
  // 0.4.3 #8: "Calibration: Done · Quick · Oct 18 · +42 ms" / "Calibration: Not calibrated" for the active output
  const calLine = h('div', { class: 'small spk-cal', 'data-cal': '1' }, 'Calibration: …');
  const paintCal = async () => { const o = cur(); if (!o?.deviceId) { calLine.textContent = 'Calibration: Not calibrated'; return; }
    try { const hs = await api(`/outputs/${encodeURIComponent(o.deviceId)}/calibrations`); calLine.textContent = calText(hs); } catch { calLine.textContent = 'Calibration: unknown'; } };
  const left = h('div', { class: 'spk-left' }, vol, capRow, delay, balance, bass, treble);
  // ---- 0.4.2: EQ on/off, Reset, PRESETS row (8 built-ins, then "My presets"), Save as preset, loudness
  const eqOn = h('button', { type: 'button', class: 'onpill spk-eqon', role: 'switch', 'data-act': 'eq-on', 'aria-label': 'EQ on or off', onclick: () => { if (!real || !tune) return; edit(c => { c.bypass = !c.bypass; }); paintEqCtl(); } }, h('span', { class: 'op-off' }, 'OFF'), h('span', { class: 'op-on' }, 'ON'));
  ro(eqOn, tune, 'Only this device’s own owner or an admin can change the sound.');
  const resetBtn = ro(h('button', { type: 'button', class: 'btn sm', 'data-act': 'eq-reset', title: 'Back to flat', onclick: () => { if (!real) return; edit(c => { c.graphicDb = new Array(10).fill(0); c.bass = { ...c.bass, gainDb: 0 }; c.treble = { ...c.treble, gainDb: 0 }; c.balance = 0; }); paintEq(); syncSliders(); paintPresets(); } }, 'Reset'), tune, 'Only this device’s own owner or an admin can change the sound.');
  const saveAsBtn = ro(h('button', { type: 'button', class: 'btn sm', 'data-act': 'preset-saveas', onclick: () => { if (!real) return; parts.promptName?.('Save as preset', '', async v => { const body = { name: v, preset: { ...real.cur, name: v } }; await api('/dsp/presets', { method: 'POST', body }); real.presets = await api('/dsp/presets'); toast(`Saved preset “${v}”`); paintPresets(); }); } }, 'Save as preset'), admin || tune, 'Only this device’s own owner or an admin can save presets.');
  const eqCtl = h('span', { class: 'spk-eqctl' }, eqOn);
  const paintEqCtl = () => { const on = real ? !real.cur.bypass : false; eqOn.classList.toggle('on', on); eqOn.setAttribute('aria-checked', String(on)); };
  // 0.4.4 F20: one themed dropdown "Preset: <name> ▾" (8 built-ins, then My presets; Custom when the bands match none), Reset + Save as preset beside it
  const presetSel = ro(h('select', { class: 'eqall-preset spk-presel', 'aria-label': 'Preset', 'data-act': 'preset', onchange: ev => { if (!tune || !real) return; const p = real.presets.find(x => String(x.id) === ev.target.value); if (!p) return; edit(c => { const j = structuredClone(p.json); Object.assign(c, j, { bypass: c.bypass, name: c.name }); }); paintEq(); syncSliders(); paintPresets(); } }), tune, 'Only this device’s own owner or an admin can change the sound.');
  const presetRow = h('div', { class: 'spk-presets', 'aria-label': 'Presets' }, h('label', { class: 'dlbl spk-prelbl' }, 'Preset:'), presetSel, resetBtn, saveAsBtn);
  function paintPresets() {
    paintEqCtl(); if (!real) { presetSel.replaceChildren(h('option', { value: '' }, '—')); presetSel.disabled = true; return; }
    presetSel.disabled = !tune;
    const groups = groupPresets(real.presets), act = activePreset(groups.flatMap(g => g.items), real.cur);   // 0.4.3 #4: exactly one is current (or Custom)
    const opt = p => h('option', { value: String(p.id), selected: p.name === act }, p.name);
    presetSel.replaceChildren(h('option', { value: '', selected: act == null, disabled: true }, 'Custom'), ...groups.flatMap(g => g.label ? [h('optgroup', { label: g.label }, ...g.items.map(opt))] : g.items.map(opt)));
  }
  const loud = h('label', { class: 'spk-loud' }, h('input', { type: 'checkbox', 'data-act': 'loudness', onchange: ev => edit(c => { c.loudness = { ...c.loudness, enabled: ev.target.checked }; }) }), ' Loudness ', h('span', { class: 'small dim' }, 'More bass and treble at low volume'));
  const extraSw = h('div', { class: 'spk-sw' }, loud);
  const right = h('div', { class: 'spk-right' }, h('div', { class: 'dlbl spk-eqh' }, h('span', null, 'EQUALIZER'), eqCtl), presetRow, eqHost, extraSw, h('div', { class: 'dlbl' }, 'OUTPUT DEVICE'), outHost?.el || h('p', { class: 'small dim' }, 'No output yet.'), calLine, btns, parts.extra ? parts.extra(z) : null);
  root.append(h('div', { class: 'spk-head' }, title, parts.onRename ? ro(h('button', { type: 'button', class: 'btn sm spk-rename', 'data-act': 'spk-rename', onclick: () => parts.onRename(z) }, 'Rename'), admin, 'Only an administrator can rename a device.') : null, status, h('span', { class: 'grow' }), done), parts.zoneRow ? parts.zoneRow(z) : null, tagRow, profRow, h('div', { class: 'spk-body' }, left, right));
  capTitle();
  root.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !ev.target.closest('input[type=text],select')) { ev.stopPropagation(); parts.onDone?.(); } });
  // live values are patched in place - an open slider is never rebuilt
  root._patch = nz => {
    z = { ...z, ...nz }; paintTitle(); paintTags(); vol._set(Math.round(z.volume)); paintMute(); capRow._set(capVal()); capTitle();
    const o = cur(); if (o && delay._input && document.activeElement !== delay._input) delay._set(Math.round(o.latencyMs ?? 0));
    outHost?.patch?.(nz);
    if (real && o && real.out.deviceId !== o.deviceId) { loadReal(); paintCal(); }
  };
  root._destroy = () => { gone = true; area?.stopLive?.(); area?.destroy?.(); };
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
