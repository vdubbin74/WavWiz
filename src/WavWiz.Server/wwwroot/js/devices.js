import { h, api, toast, dialog } from './util.js';
import { roomPill, roomPillClass } from './diag.js';
import { openEq } from './eq.js';
import { latencyControl, clampMs } from './latency.js';
import { openCalibration } from './calibrate.js';
import { canControl, isAdmin, canTune, ADMIN_HINT, thisDevice } from './ui.js';
import { icon, setIcon, iconSvg } from './icons.js';
import { whenIdle } from './slider.js';

// Devices are the speakers (one per PC player or browser). ZONES are optional named groups of devices.
// 0.2.0:
//  - item 27: the Devices panel has three sizes like the Library - Collapsed (46 px strip) / Standard (narrow list) / Expanded (card grid with
//    every control inline, replacing the device pop-up); tapping a device in Standard opens Expanded with that card highlighted. Saved per
//    browser. (0.2.1 F1: arrow = collapse / open, Expand button = wide view; the size toggle and the cycling are gone.)
//  - item 10: Master volume at the top (Standard + Expanded) and a Mute button on every speaker. Master rules live on the server (ZoneManager.Master).
//  - item 26: a gray output line under a device that has more than one output, amber "Output unavailable" when the chosen output is gone
//    (WavWiz never switches by itself); in Expanded an Output dropdown lists every output with its own saved delay, and the Delay slider (0-1000 ms)
//    is saved per output - switching output brings back that output's delay.
//  - item 28: everyone with Control can change volume / mute / on-off on any speaker; delay and output only on THEIR OWN device; rename, forget,
//    zones and "Set as reference" are admin-only. Admin-only controls are shown read-only, never hidden.
//  - item 30: one house reference speaker (••• > Set as reference, admin) with a "Reference" badge.
// 0.2.1 F1: no Collapsed / Standard / Expanded toggle and no arrow cycling any more. The panel mirrors the Library: the boxed arrow collapses /
// opens it, and a separate Expand button switches the wide card view on and off (Esc returns). The three states stay the model underneath.
export const SIZES = ['collapsed', 'standard', 'expanded'];
/** Arrow: collapsed <-> open (open = Standard). Pure. */
// 0.2.2 T5: one rule for Library and Devices: the arrow while Expanded first returns to the normal layout; the next press collapses.
// 0.3.0 §6: from Expanded the chevron goes straight to the rail (one press, as the icon shows)
export const arrowSize = s => (s === 'collapsed' ? 'standard' : 'collapsed');
/** 0.2.2 T5: the same arrow labels for both side panels (which = 'Library' | 'Devices'). Pure. */
export function arrowLabel(which, state) {
  return state === 'collapsed' ? `Open the ${which} panel` : `Fold the ${which} panel to a rail`;
}
/** 0.2.3 U6: Expand button arrows point the way the panel travels: Devices (right side) grows to the LEFT and goes back to the right;
 *  the Library (left side) is the mirror image. Pure: side = 'left' | 'right'. */
// 0.3.1 B6: standard icons on both panels - outward arrows to expand, inward arrows while expanded; labels "Expand" / "Collapse (Esc)"
export const expandIcon = (side, expanded) => (expanded ? 'collapseIn' : 'expandOut');
export const expandLabel = (which, on) => (on ? 'Collapse (Esc)' : 'Expand');
/** 0.3.1 B4: paint the Expand button for every exit path (Esc, button, chevron, [ ] keys, other rail). Always rewrites the icon:
 *  0.3.0's setIcon() skipped the redraw when the button's remembered icon name had not changed although "⤡ Esc" text had replaced it. */
export function paintExpandBtn(btn, which, expanded) {
  const name = expandIcon(null, expanded); btn.dataset.icon = name; btn.innerHTML = iconSvg(name);
  btn.setAttribute('aria-pressed', String(!!expanded)); btn.setAttribute('aria-label', expandLabel(which, expanded)); btn.title = expandLabel(which, expanded);
}
/** Expand button: Expanded <-> Standard (also opens a collapsed panel straight into Expanded). Pure. */
export const expandSize = s => (s === 'expanded' ? 'standard' : 'expanded');
const SIZE_KEY = 'wavwiz.devsize';
/** The saved size for this browser; a 0.1.x "collapsed" flag carries over. */
export function loadDevSize(store = globalThis.localStorage) {
  try { const v = store.getItem(SIZE_KEY); if (SIZES.includes(v)) return v; return store.getItem('wavwiz.devcollapsed') === '1' ? 'collapsed' : 'standard'; } catch { return 'standard'; }
}
export function saveDevSize(s, store = globalThis.localStorage) { try { store.setItem(SIZE_KEY, s); store.setItem('wavwiz.devcollapsed', s === 'collapsed' ? '1' : '0'); } catch { /* ignore */ } }

const KIND = { hdmi: ['HDMI', '▭'], spdif: ['Optical (TOSLINK)', '◎'], analog: ['Speakers', '🔈'], bluetooth: ['Bluetooth', 'ᛒ'], usb: ['USB', '⌁'], other: ['', '♪'], wired: ['Speakers', '🔈'] };
/** "HDMI · LG TV", "Optical (TOSLINK)", "Speakers (Realtek)" - the label of one output (pure). */
export function outputLabel(o) {
  if (!o) return '';
  const [kind] = KIND[o.kind] || KIND.other, name = (o.name || '').trim();
  if (!kind) return name || 'Output';
  if (!name) return kind;
  if (name.toLowerCase().includes(kind.toLowerCase().split(' ')[0])) return name;
  return o.kind === 'hdmi' || o.kind === 'bluetooth' || o.kind === 'usb' ? `${kind} · ${name}` : `${kind} (${name})`;
}
export const kindGlyph = o => (KIND[o?.kind] || KIND.other)[1];
/** The output the device is set to: the active one, else the one it was set to (chosenDeviceId) when that is gone. */
export const chosenOutput = z => z.outputs.find(o => o.active) || z.outputs.find(o => o.deviceId === z.chosenDeviceId) || null;
/** Show the output line only when there is a choice (more than one output) or a problem (chosen output gone). */
export const showOutputLine = z => !!z.outputUnavailable || z.outputs.filter(o => o.connected || o.active).length > 1;
const dms = o => (o && !o.notCalibrated ? `${Math.round(o.latencyMs)} ms` : 'not set');
const stateText = z => !z.enabled ? 'Off' : !z.connected ? 'Offline' : ({ ok: 'Playing', idle: 'Not playing', buffering: 'Buffering', dropped: 'Dropped', reconnecting: 'Reconnecting', offline: 'Offline' }[z.room?.state] || 'Online');
// ---- 0.2.5 device cards (approved render v2): tags, one status line, mute on the right, one Settings chevron ----
/** A phone playing as a speaker (a browser zone named after a phone). */
export const isPhoneZone = z => !!z?.isWeb && /iPhone|iPad|Android|phone|tablet/i.test(z.name || '');
/** Up to two tags right of the name: OFFLINE, REF, MUTED, NO DELAY, and a phone's SPEAKER role chip (pure). No BROWSER / THIS DEVICE badges. */
export function cardTags(z) {
  const t = [], o = chosenOutput(z);
  if (!z.connected) t.push({ k: 'offline', text: 'OFFLINE', title: 'Not connected right now' });
  if (isBluetooth(z)) t.push({ k: 'bt', text: 'BLUETOOTH', title: 'Bluetooth output: its delay can change when it reconnects. A wired speaker makes a steadier reference.' });   // 0.3.1 B1
  if (z.reference) t.push({ k: 'ref', text: 'REF', title: 'Reference speaker - other delays are measured against this one' });
  if (z.muted) t.push({ k: 'muted', text: 'MUTED', title: 'Muted - press the round button to unmute' });
  if (z.connected && !z.reference && o && o.notCalibrated) t.push({ k: 'nodelay', text: 'NO DELAY', title: 'The delay is not set yet: Settings › Delay › Calibrate' });
  if (isPhoneZone(z)) t.push({ k: 'role', text: 'SPEAKER', title: 'This phone plays music. On the phone: Devices › Phone role to use it as a calibration mic instead' });
  return t.slice(0, 2);
}
// ---- 0.3.1 B1: Bluetooth outputs - a tag on the row, and a one-time "Bluetooth reconnected - recalibrate?" hint when one reconnects or the output changes
export function isBluetooth(z) { const o = z && chosenOutput(z); return !!(o && o.kind === 'bluetooth'); }
/** Pure: compares the last seen state with now. A hit = a Bluetooth output that came back (offline -> online) or became the output. First sight never hits. */
export function btReconnects(seen, zones) {
  const next = new Map(), hits = [];
  for (const z of zones || []) {
    const o = chosenOutput(z), bt = !!(o && o.kind === 'bluetooth'), on = bt && !!z.connected && o.connected !== false;
    const cur = { bt, on, dev: o?.deviceId ?? null }; next.set(z.id, cur);
    const was = seen && seen.get(z.id);
    if (was && bt && on && (!was.on || was.dev !== cur.dev)) hits.push(z.id);
  }
  return { next, hits };
}
const btState = { seen: null, pending: new Map() };
export function btHint(S, ctl) {
  const { next, hits } = btReconnects(btState.seen, S.zones); btState.seen = next;
  for (const id of hits) btState.pending.set(id, true);
  for (const id of [...btState.pending.keys()]) if (!next.get(id)?.on) btState.pending.delete(id);
  const zs = [...btState.pending.keys()].map(id => S.zones.find(z => z.id === id)).filter(Boolean);
  if (!zs.length) return null;
  return h('div', { class: 'dbthint', role: 'status', 'data-k': zs.map(z => z.id).join(',') }, zs.map(z => h('div', { class: 'row' },
    h('span', { class: 'grow small' }, h('b', null, z.name), ': Bluetooth reconnected - recalibrate?'),
    ro(h('button', { class: 'btn sm', onclick: () => { btState.pending.delete(z.id); openCalibration(S, ctl.refreshAll, z.id); ctl.redraw?.(); } }, 'Recalibrate'), canTune(S, z), OWN_HINT),
    h('button', { class: 'btn sm ghost', 'aria-label': 'Dismiss', title: 'Dismiss', onclick: ev => { btState.pending.delete(z.id); ev.target.closest('.row').remove(); } }, '✕'))));
}
const two = n => String(n).padStart(2, '0');
/** "6:40 PM" today, "Oct 9" before (pure, local time). */
export function fmtSeen(iso, now = new Date()) {
  const d = new Date(iso); if (isNaN(d)) return '';
  if (d.toDateString() === now.toDateString()) { const hr = d.getHours() % 12 || 12; return `${hr}:${two(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`; }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
/** The one status line: playing state · output · delay. Offline: "Last seen 6:40 PM · output · delay". No "Muted", no "Delay not set" (tags say that). */
export function statusLine(z, me = false) {
  const o = chosenOutput(z);
  const st = !z.connected ? (z.lastSeen ? `Last seen ${fmtSeen(z.lastSeen)}` : 'Offline') : !z.enabled ? 'Off' : ({ ok: 'Playing', idle: 'Not playing', buffering: 'Buffering', dropped: 'Dropped', reconnecting: 'Reconnecting', offline: 'Offline' }[z.room?.state] || 'Online');
  const out = z.outputUnavailable ? 'Output unavailable' : z.isWeb ? (me ? 'this browser' : isPhoneZone(z) ? (z.link === 'wifi' ? 'Wi-Fi' : 'phone') : 'browser') : o ? outputLabel(o) : null;
  const d = o && !o.notCalibrated ? `${Math.round(o.latencyMs)} ms` : null;
  return [st, out, d].filter(Boolean).join(' · ');
}
const MIC_KIND = { usb: 'a USB mic', interface: 'an audio interface', builtin: 'the PC’s built-in mic', analog: 'a wired mic', bluetooth: 'a Bluetooth mic' };
/** "Measured with the phone mic · Oct 9", "Measured with a USB mic · Oct 9", "Set by ear · Oct 2", "Set by hand · …" (pure). */
export function measuredNote(o, now = new Date()) {
  if (!o) return '';
  if (o.notCalibrated) return 'Not measured yet. Calibrate measures it.';
  if (!o.measuredWith) return '';
  const i = o.measuredWith.indexOf(':'), m = i < 0 ? o.measuredWith : o.measuredWith.slice(0, i), src = i < 0 ? '' : o.measuredWith.slice(i + 1);
  const how = m === 'manual' ? 'Set by hand' : m === 'ear' ? 'Set by ear' : m === 'loopback' ? 'Measured by loopback'
    : m === 'mic' ? (src === 'phone' ? 'Measured with the phone mic' : src.startsWith('pc') ? `Measured with ${MIC_KIND[src.split(':')[1]] || 'the PC’s mic'}` : 'Measured with a mic') : 'Set';
  return o.measuredAt ? `${how} · ${fmtSeen(o.measuredAt, now)}` : how;
}
export const deviceIconName = z => z.isWeb ? (isPhoneZone(z) ? 'phone' : 'globe') : 'monitor';
function tagEls(z) { return cardTags(z).map(t => h('span', { class: 'dtag ' + t.k, title: t.title }, t.text)); }

const dotClass = z => !z.connected ? 'off' : ({ ok: 'ok', idle: 'ok', buffering: 'warn', dropped: 'bad', reconnecting: 'bad' }[z.room?.state] || 'ok');
export const unassigned = (zones, groups) => { const inG = new Set(groups.flatMap(g => g.deviceIds)); return zones.filter(z => !inG.has(z.id)); };
/** The master slider shows the loudest speaker that is on (the server scales every on-speaker by the same factor from it). */
export const masterLevel = zones => { const on = (zones || []).filter(z => z.enabled); return on.length ? Math.max(...on.map(z => z.volume)) : 0; };
const ro = (el, ok, hint = ADMIN_HINT) => { if (!ok) { el.disabled = true; el.title = hint; el.classList.add('ro'); el.setAttribute('aria-disabled', 'true'); } return el; };
const OWN_HINT = 'Only an administrator can change another device\'s output or delay. You can change them on the device you are using.';

/** Confirm + remove a zone (the group only; its devices stay and become Unassigned). */
export function confirmRemoveZone(S, g, done) {
  dialog(`Remove zone “${g.name}”?`, h('div', null, h('p', null, 'The zone and its settings are deleted. Its devices are not touched - they simply move to Unassigned.'),
    g.active ? h('p', { class: 'warnc' }, 'This zone is the one playing now: playback stops first.') : null),
  [{ text: 'Remove zone', cls: 'danger', onclick: async () => { try { await api(`/groups/${g.id}`, { method: 'DELETE' }); toast(`Zone “${g.name}” removed`); } catch (e) { toast(e.message, true); return false; } done?.(); } }, { text: 'Cancel' }]);
}
/** Create or edit a zone: a name and the devices in it (admin). */
export function editZone(S, g, done) {
  const name = h('input', { type: 'text', maxlength: 60, value: g?.name || '', placeholder: 'e.g. Downstairs', 'aria-label': 'Zone name' }), picked = new Set(g?.deviceIds || []);
  const boxes = S.zones.map(z => h('label', { class: 'row zrow' }, h('input', { type: 'checkbox', checked: picked.has(z.id), onchange: ev => { ev.target.checked ? picked.add(z.id) : picked.delete(z.id); } }), h('span', { class: 'dot ' + dotClass(z) }), z.name + (z.isWeb ? ' (browser)' : '')));
  dialog(g ? 'Edit zone' : 'New zone', h('div', null, h('div', { class: 'field' }, h('label', null, 'Name'), name), h('div', { class: 'sec' }, 'Devices in this zone'), boxes.length ? boxes : h('p', { class: 'dim' }, 'No devices yet. Open WavWiz in a browser, or connect WavWiz Player on a PC.')),
    [{ text: g ? 'Save' : 'Create zone', cls: 'primary', onclick: async () => { try { const body = { name: name.value, deviceIds: [...picked] }; await api(g ? `/groups/${g.id}` : '/groups', { method: g ? 'PATCH' : 'POST', body }); toast('Saved'); } catch (e) { toast(e.message, true); return false; } done?.(); } }, { text: 'Cancel' }]);
}

function muteButton(S, ctl, z) {
  const b = h('button', { class: 'mutebtn' + (z.muted ? ' on' : ''), 'aria-pressed': String(!!z.muted), 'aria-label': (z.muted ? 'Unmute ' : 'Mute ') + z.name, title: z.muted ? 'Unmute' : 'Mute',
    onclick: () => { z.muted = !z.muted; ctl.act(`/zones/${z.id}`, { muted: z.muted }, 'PATCH'); b.classList.toggle('on', z.muted); setIcon(b, z.muted ? 'mute' : 'volume'); } });
  b.append(icon(z.muted ? 'mute' : 'volume')); b.dataset.icon = z.muted ? 'mute' : 'volume';
  return ro(b, canControl(S), 'Your access is view-only.');
}
function volumeRow(S, ctl, z) {
  const pct = h('span', { class: 'pct' }, Math.round(z.volume) + '%');
  const vol = h('input', { type: 'range', min: 0, max: 100, value: z.volume, 'aria-label': `${z.name} volume`, oninput: ev => { pct.textContent = ev.target.value + '%'; clearTimeout(vol._t); vol._t = setTimeout(() => ctl.act(`/zones/${z.id}`, { volume: +ev.target.value }, 'PATCH'), 100); } });
  ro(vol, canControl(S), 'Your access is view-only.');
  if (z.volLocked) { const lk = h('span', { class: 'vlock', title: `Max volume locked at ${Math.round(z.volCap ?? 100)}%`, 'aria-label': `Max volume locked at ${Math.round(z.volCap ?? 100)}%` }, icon('lock')); queueMicrotask(() => pct.parentNode ? pct.before(lk) : vol.parentNode && vol.after(lk)); }   // 0.3.2 F18 padlock by the bar
  return { vol, pct, mute: muteButton(S, ctl, z) };
}
function onSwitch(S, ctl, z) {
  const sw = h('div', { class: 'sw sm' + (z.enabled ? ' on' : ''), role: 'switch', 'aria-checked': String(z.enabled), 'aria-label': `${z.name} on or off`, tabindex: 0, onclick: () => canControl(S) && ctl.act(`/zones/${z.id}`, { enabled: !z.enabled }, 'PATCH'), onkeydown: e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.target.click(); } } });
  if (!canControl(S)) { sw.setAttribute('aria-disabled', 'true'); sw.classList.add('ro'); sw.title = 'Your access is view-only.'; }
  return sw;
}
function outputLine(z) {
  if (!showOutputLine(z)) return null;
  if (z.outputUnavailable) return h('div', { class: 'doutline warn', role: 'status' }, '⚠ Output unavailable');
  const o = chosenOutput(z); return o ? h('div', { class: 'doutline small dim ell' }, h('span', { 'aria-hidden': 'true' }, kindGlyph(o) + ' '), outputLabel(o)) : null;
}
function masterRow(S, ctl) {
  const lvl = Math.round(masterLevel(S.zones)), pct = h('span', { class: 'pct' }, lvl + '%');
  const sl = h('input', { type: 'range', min: 0, max: 100, value: lvl, 'aria-label': 'Master volume', title: 'Raises or lowers every speaker that is on by the same factor (keeps the balance between rooms; never un-mutes)',
    oninput: ev => { pct.textContent = ev.target.value + '%'; clearTimeout(sl._t); sl._t = setTimeout(() => ctl.act('/zones/master', { set: +ev.target.value }), 120); } });
  ro(sl, canControl(S), 'Your access is view-only.');
  // 0.3.1 B7: the same track / thumb / length / % position as every device row (.dvol: slider, %, round Mute button) so the bars line up.
  // 0.3.2 F5 (supersedes B8): the slot right of the master bar is the same round mute icon button as the device rows; it mutes everything.
  return h('div', { class: 'dmaster' }, h('div', { class: 'dlbl' }, 'MASTER', h('span', { class: 'mvword' }, ' VOLUME')),
    h('div', { class: 'dvol dvol-master' }, sl, pct, masterMuteButton(S, ctl)));
}
/** 0.2.1 F17: every device muted? (drives the master mute button) */
export const allMuted = zones => (zones || []).length > 0 && zones.every(z => z.muted);
/** 0.3.2 F5: master mute = a round icon button identical to a device's Mute (amber when muted). Mutes every device; un-muting brings back only
 * the ones it muted (the server remembers), so a device muted on its own stays muted. */
function masterMuteButton(S, ctl) {
  const b = h('button', { type: 'button', class: 'mutebtn mastermute' });
  const paint = m => { b.classList.toggle('on', m); b.setAttribute('aria-pressed', String(m)); b.setAttribute('aria-label', m ? 'Unmute every device' : 'Mute every device'); b.title = m ? 'Unmute everything' : 'Mute everything'; setIcon(b, m ? 'mute' : 'volume'); };
  b.onclick = () => { const want = !allMuted(S.zones); for (const z of S.zones || []) if (want) z.muted = true; ctl.act('/zones/mute-all', { muted: want }); paint(want); };
  b.append(icon('volume')); b.dataset.icon = 'volume'; paint(allMuted(S.zones));
  return ro(b, canControl(S), 'Your access is view-only.');
}
// ---- 0.3.2 F4: zone cards - name (accent), PLAYING / amber MUTED tag, members line, then the device bar (.dvol: slider, %, round mute) ----
/** Members of a zone (device rows), in the zone's order. Pure. */
export const zoneMembers = (zones, g) => (zones || []).filter(z => (g.deviceIds || []).includes(z.id));
/** Zone level = the average of its speakers (rounded). Pure. */
export const zoneLevel = (zones, g) => { const ms = zoneMembers(zones, g); return ms.length ? Math.round(ms.reduce((a, z) => a + z.volume, 0) / ms.length) : 0; };
/** Zone muted = every member muted. Pure. */
export const zoneMuted = (zones, g) => { const ms = zoneMembers(zones, g); return ms.length > 0 && ms.every(z => z.muted); };
/** The client mirror of the server's offset-keeping move (ZoneVolume.Shift): virtual levels shift, real = clamped. Pure. */
export function zoneShift(virt, target) { const t = Math.max(0, Math.min(100, target)), d = virt.length ? t - virt.reduce((a, v) => a + v, 0) / virt.length : 0; const nv = virt.map(v => v + d); return { virt: nv, real: nv.map(v => Math.max(0, Math.min(100, v))) }; }
function zoneCard(S, ctl, g, { edit = null } = {}) {
  const can = canControl(S), ms = zoneMembers(S.zones, g), lvl = zoneLevel(S.zones, g), muted = zoneMuted(S.zones, g);
  const pct = h('span', { class: 'pct' }, lvl + '%');
  const vol = h('input', { type: 'range', min: 0, max: 100, value: lvl, 'aria-label': `${g.name} zone volume`, title: 'Moves every speaker in this zone together (keeps their balance)',
    oninput: ev => { pct.textContent = ev.target.value + '%'; clearTimeout(vol._t); vol._t = setTimeout(() => ctl.act(`/groups/${g.id}/volume`, { set: +ev.target.value }), 100); } });
  ro(vol, can, 'Your access is view-only.');
  const mute = h('button', { type: 'button', class: 'mutebtn zmute' + (muted ? ' on' : ''), 'aria-pressed': String(muted), 'aria-label': (muted ? 'Unmute zone ' : 'Mute zone ') + g.name, title: muted ? 'Unmute this zone' : 'Mute every speaker in this zone',
    onclick: () => { const m = !zoneMuted(S.zones, g); for (const z of ms) z.muted = m; ctl.act(`/groups/${g.id}/mute`, { muted: m }); } }, icon(muted ? 'mute' : 'volume'));
  mute.dataset.icon = muted ? 'mute' : 'volume'; ro(mute, can, 'Your access is view-only.');
  const zdot = h('span', { class: 'dot zdot ' + (ms.some(z => z.connected) ? 'ok' : 'off'), title: `${ms.filter(z => z.connected).length} of ${ms.length} online` });   // 0.3.2 F17: same dot as a device card, so the zone name lines up with device names
  const head = h('div', { class: 'zc-top' }, zdot,
    ro(h('button', { class: 'zname ell', title: 'Play in this zone only', onclick: () => ctl.act(`/groups/${g.id}/activate`) }, g.name), can, 'Your access is view-only.'),
    h('span', { class: 'grow' }), edit ? ro(h('button', { class: 'zbtn zedit', 'aria-label': `Edit zone ${g.name}`, title: 'Edit zone', onclick: () => edit(g.id) }, '✎'), isAdmin(S)) : null);
  const ztags = (g.active || muted) ? h('div', { class: 'dtagrow ztagrow' }, g.active ? h('span', { class: 'dtag zplaying' }, 'PLAYING') : null, muted ? h('span', { class: 'dtag zmuted' }, 'MUTED') : null) : null;   // 0.3.2 F21
  const card = h('div', { class: 'zcard' + (g.active ? ' active' : '') + (muted ? ' muted' : ''), 'data-zone': g.name, 'data-group-id': g.id },
    head, h('div', { class: 'zc-mem small dim ell' }, ms.length ? ms.map(z => z.name).join(' · ') : 'No devices yet'), h('div', { class: 'dvol' }, vol, pct, mute), ztags);
  return card;
}
function zonesHead(S, ctl) {
  return h('div', { class: 'pane-h dsec-h zones-h' }, h('span', null, 'ZONES'), h('span', { class: 'grow' }),
    ro(h('button', { class: 'btn sm zadd-new', 'aria-label': 'New zone', title: 'New zone', onclick: () => editZone(S, null, ctl.refreshAll) }, '+ New zone'), isAdmin(S)));
}
// ---- 0.3.1 B9: compact Scenes & Schedules under Zones - next event + countdown + Skip, one-tap scene Run chips, Open, + (admins only).
// No inline editing; the full window does that. The next-event countdown is shown only here (Now Playing shows no next-event status).
let ssCache = { at: 0, scenes: [], rows: [], now: null }, ssEl = null, ssIv = 0;
async function loadSS(force) {
  if (!force && Date.now() - ssCache.at < 30000) return ssCache;
  try { const [scenes, rows, ck] = await Promise.all([api('/scenes'), api('/schedules'), api('/schedules/clock').catch(() => ({}))]); ssCache = { at: Date.now(), scenes, rows, now: ck.now || null, nowAt: Date.now() }; }
  catch { ssCache.at = Date.now(); }
  return ssCache;
}
/** The next enabled schedule with a run time (soonest first). Pure. */
export function nextEvent(rows) { return (rows || []).filter(r => r.enabled && r.nextRunAt).sort((a, b) => new Date(a.nextRunAt) - new Date(b.nextRunAt))[0] || null; }
/** "in 2 h 5 m" / "in 7 m" / "now". Pure. */
export function ssCountdown(iso, nowMs) { const ms = new Date(iso) - nowMs; if (!(ms > 0)) return 'now'; const m = Math.round(ms / 60000), hh = Math.floor(m / 60); return hh ? `in ${hh} h ${m % 60} m` : `in ${m} m`; }
function ssCompact(S, ctl) {
  const admin = isAdmin(S), can = canControl(S);
  if (!ssEl) ssEl = h('section', { class: 'dss', 'aria-label': 'Scenes and schedules' });
  const el = ssEl;
  const open = () => ctl.go?.('scenes');
  const paint = d => {
    const nx = nextEvent(d.rows), skew = d.now ? new Date(d.now) - d.nowAt : 0;
    const cd = nx ? h('span', { class: 'dss-cd', 'data-at': nx.nextRunAt }, ssCountdown(nx.nextRunAt, Date.now() + skew)) : null;
    el.replaceChildren(
      h('div', { class: 'pane-h dss-h' }, h('span', null, 'SCENES & SCHEDULES'), h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'linkbtn dss-open', title: 'Open Scenes & Schedules', onclick: open }, 'Open'),
        admin ? h('button', { type: 'button', class: 'plus zbtn dss-add', 'aria-label': 'New scene or schedule', title: 'New scene or schedule (opens the full window)', onclick: open }, '+') : null),
      nx ? h('div', { class: 'dss-next' }, h('span', { 'aria-hidden': 'true' }, nx.alarm ? '⏰' : '🗓'), h('span', { class: 'ell grow' }, h('b', null, nx.name), ' ', cd),
        ro(h('button', { type: 'button', class: 'btn sm dss-skip', title: `Skip the next “${nx.name}”`, onclick: async () => { try { const x = await api(`/schedules/${nx.id}/skip`, { method: 'POST' }); toast(x.skipped ? `Skipping the next “${nx.name}”` : `“${nx.name}” runs as planned`); paint(await loadSS(true)); } catch (e) { toast(e.message, true); } } }, 'Skip'), can, 'Your access is view-only.'))
        : h('p', { class: 'small dim dss-none' }, 'Nothing scheduled.'),
      d.scenes.length ? h('div', { class: 'dss-chips' }, d.scenes.map(sc => ro(h('button', { type: 'button', class: 'chip dss-run', 'data-scene': sc.id, title: `Run the scene “${sc.name}”`,
        onclick: async () => { try { await api(`/scenes/${sc.id}/apply`, { method: 'POST' }); toast(`Scene “${sc.name}” applied`); ctl.refreshAll?.(); } catch (e) { toast(e.message, true); } } }, '▶ ' + sc.name), can, 'Your access is view-only.'))) : null);
  };
  if (ssCache.at) paint(ssCache);
  loadSS().then(d => { if (d.at) paint(d); });
  if (!ssIv) ssIv = setInterval(() => { const el = ssEl; if (!el) return; const c = el.querySelector('.dss-cd'); if (c) c.textContent = ssCountdown(c.dataset.at, Date.now() + (ssCache.now ? new Date(ssCache.now) - ssCache.nowAt : 0)); }, 30000);
  ssIv?.unref?.();   // node tests: never keep the process alive
  return el;
}
function zonesStrip(S, ctl, compact) {
  const admin = isAdmin(S), can = canControl(S);
  const add = ro(h('button', { class: 'plus zbtn accent-o zadd', 'aria-label': 'New zone', title: 'New zone', onclick: () => editZone(S, null, ctl.refreshAll) }, '+'), admin);
  const zs = (S.groups || []).map(g => h('span', { class: 'zchip' + (g.active ? ' active' : ''), 'data-zone': g.name },
    ro(h('button', { class: 'zname ell', title: 'Play in this zone only', onclick: () => ctl.act(`/groups/${g.id}/activate`) }, g.name), can, 'Your access is view-only.'),
    h('span', { class: 'small dim' }, String(g.members)), g.active ? h('span', { class: 'badge-active' }, 'ACTIVE') : null,
    compact ? null : ro(h('button', { class: 'zbtn zedit', 'aria-label': `Edit zone ${g.name}`, title: 'Edit zone', onclick: () => editZone(S, g, ctl.refreshAll) }, '✎'), admin),
    compact ? null : ro(h('button', { class: 'zbtn danger', 'aria-label': `Remove zone ${g.name}`, title: 'Remove zone', onclick: () => confirmRemoveZone(S, g, ctl.refreshAll) }, '✕'), admin)));
  return h('div', { class: 'dzones' }, h('span', { class: 'dlbl' }, 'ZONES'), zs.length ? zs : h('span', { class: 'small dim' }, 'None yet (optional groups, like “Downstairs”)'), add);
}

/** 0.2.1 F7: which devices a sidebar pick shows. 'all' (default) = every device; a zone id = only that zone's devices. Pure. */
export function zoneFilter(zones, groups, pick) {
  if (pick == null || pick === 'all') return zones || [];
  const g = (groups || []).find(x => x.id === pick); if (!g) return zones || [];
  const ids = new Set(g.deviceIds || []); return (zones || []).filter(z => ids.has(z.id));
}
/** 0.2.1 F7: a zone is "off" (dimmed) when none of its devices is switched on; its dot is live when one is on and connected. Pure. */
export function zoneState(zones, g) {
  const ms = (zones || []).filter(z => (g.deviceIds || []).includes(z.id));
  return { count: g.members ?? ms.length, off: !ms.some(z => z.enabled), live: ms.some(z => z.enabled && z.connected) };
}
const ZPICK_KEY = 'wavwiz.devzone';
const loadZonePick = () => { try { const v = sessionStorage.getItem(ZPICK_KEY); return v == null || v === 'all' ? 'all' : +v; } catch { return 'all'; } };
const saveZonePick = v => { try { sessionStorage.setItem(ZPICK_KEY, String(v)); } catch { /* ignore */ } };
let scenesCache = { at: 0, list: [] };
async function loadScenes(force) {
  if (!force && Date.now() - scenesCache.at < 30000) return scenesCache.list;
  try { scenesCache = { at: Date.now(), list: await api('/scenes') }; } catch { scenesCache.at = Date.now(); }
  return scenesCache.list;
}
/** 0.2.1 F7 (variant B): the ~180 px ZONES sidebar on the right of Expanded Devices - All devices (default) + every zone with its count and
 * a live dot (off zones dimmed); picking one filters the cards. Optional SCENES chips below. F19: a zone's settings live in the sidebar's
 * own edit view (name, devices, play here, remove) - there is no zone Details pop-up. */
function zonesSidebar(S, ctl, pick, setPick, edit, setEdit) {
  const admin = isAdmin(S), can = canControl(S), groups = S.groups || [];
  const side = h('aside', { class: 'zside', 'aria-label': 'Zones' });
  if (edit !== null) return zoneEditView(S, ctl, side, groups.find(g => g.id === edit) || null, setEdit, setPick);
  const row = (key, name, count, extra = {}) => h('button', { type: 'button', class: 'zsrow' + (pick === key ? ' on' : '') + (extra.off ? ' off' : ''), 'aria-pressed': String(pick === key), 'data-zone': name,
    title: key === 'all' ? 'Show every device' : `Show only the devices in ${name}`, onclick: () => setPick(key) },
    h('span', { class: 'zdot' + (extra.live ? ' live' : '') + (extra.off ? ' hollow' : ''), 'aria-hidden': 'true' }), h('span', { class: 'zsname ell' }, name),
    extra.off ? h('span', { class: 'small dim' }, 'Off') : null, extra.active ? h('span', { class: 'zsplay', title: 'Playing in this zone only' }, '▶') : null,
    h('span', { class: 'zscount' }, String(count)));
  const list = h('div', { class: 'zslist', role: 'group', 'aria-label': 'Show devices in' },
    row('all', 'All devices', (S.zones || []).length, { live: (S.zones || []).some(z => z.enabled && z.connected) }),
    ...groups.map(g => { const st = zoneState(S.zones, g); const r = row(g.id, g.name, st.count, { off: st.off, live: st.live, active: g.active });
      r.append(h('span', { class: 'zsedit', role: 'button', tabindex: 0, 'aria-label': `Zone settings for ${g.name}`, title: 'Zone settings', onclick: ev => { ev.stopPropagation(); setEdit(g.id); }, onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); setEdit(g.id); } } }, '⚙'));
      return r; }));
  const add = ro(h('button', { class: 'plus zbtn zadd', 'aria-label': 'New zone', title: 'New zone', onclick: () => editZone(S, null, ctl.refreshAll) }, '+'), admin);
  side.append(h('div', { class: 'zshead' }, h('span', { class: 'dlbl' }, 'ZONES'), h('span', { class: 'grow' }), add), list,
    groups.length ? null : h('p', { class: 'small dim zsempty' }, 'Zones are optional groups, like “Downstairs”.'), ssCompact(S, ctl));   // 0.3.1 B9
  return side;
}
/** F19: one zone's settings inside the sidebar (replaces the old pop-ups): name, devices, play in this zone only, remove. Admin edits; others read. */
function zoneEditView(S, ctl, side, g, setEdit, setPick) {
  const admin = isAdmin(S), can = canControl(S);
  const back = h('button', { type: 'button', class: 'zsback', onclick: () => setEdit(null) }, '‹ Zones');
  if (!g) { side.append(back, h('p', { class: 'small dim' }, 'This zone no longer exists.')); return side; }
  const name = ro(h('input', { type: 'text', maxlength: 60, value: g.name, 'aria-label': 'Zone name' }), admin), picked = new Set(g.deviceIds || []);
  const boxes = (S.zones || []).map(z => h('label', { class: 'row zsmember' }, ro(h('input', { type: 'checkbox', checked: picked.has(z.id), onchange: ev => { ev.target.checked ? picked.add(z.id) : picked.delete(z.id); } }), admin), h('span', { class: 'dot ' + dotClass(z) }), h('span', { class: 'ell' }, z.name)));
  const save = ro(h('button', { class: 'btn primary', onclick: async () => { try { await api(`/groups/${g.id}`, { method: 'PATCH', body: { name: name.value, deviceIds: [...picked] } }); toast('Zone saved'); ctl.refreshAll(); } catch (e) { toast(e.message, true); } } }, 'Save'), admin);
  const play = ro(h('button', { class: 'btn', onclick: () => ctl.act(`/groups/${g.id}/activate`) }, g.active ? '▶ Playing here' : '▶ Play here only'), can, 'Your access is view-only.');
  const del = ro(h('button', { class: 'btn danger', onclick: () => confirmRemoveZone(S, g, () => { setEdit(null); setPick('all'); ctl.refreshAll(); }) }, 'Remove zone'), admin);
  side.classList.add('editing');
  side.append(back, h('div', { class: 'dlbl' }, 'ZONE NAME'), name, h('div', { class: 'dlbl' }, 'DEVICES'), h('div', { class: 'zsmembers' }, boxes.length ? boxes : h('p', { class: 'small dim' }, 'No devices yet.')),
    h('div', { class: 'zsactions' }, save, play, del));
  return side;
}

/** 0.2.1 F18 + F19: each card has its own settings - Calibrate and Test sound live there, not on the card face; the old device Details… pop-up is
 * gone - everything it had lives here (sound check, Sound / EQ, delay history, connection, Bluetooth follow) or on the card itself (output + delay),
 * and zone settings live in the zones sidebar's edit view (F7).
 * 0.2.3 U12: the ••• button that flipped the whole card is now a themed chevron "Settings" Expand control (it matches the Library / Devices expand
 * arrows). It opens the settings downward under the card face, in place, on the Expanded cards (and the Devices page); the chevron flips, and the button
 * or Esc closes them. Open / closed is remembered per device for this browser session only (sessionStorage).
 * 0.2.3 (later): the Standard rows have no Settings button any more - settings live only on the Expanded cards; tapping a device's name in
 * Standard opens Expanded with its card highlighted. */
const OPEN_KEY = 'wavwiz.devopen.v1';
const openSet = (() => { try { return new Set(JSON.parse(sessionStorage.getItem(OPEN_KEY) || '[]')); } catch { return new Set(); } })();
export const cardInSettings = id => openSet.has(id);
export function setCardOpen(id, open) {
  if (open) openSet.add(id); else openSet.delete(id);
  try { sessionStorage.setItem(OPEN_KEY, JSON.stringify([...openSet])); } catch { /* private mode: this page only */ }
}
/** The Expand control on each device card / row. */
export function settingsToggle(name, open, onToggle) {
  return h('button', { type: 'button', class: 'dexpand' + (open ? ' on' : ''), 'aria-expanded': String(open), 'aria-label': `${open ? 'Hide' : 'Show'} settings for ${name}`,
    title: open ? 'Hide settings (Esc)' : 'Settings: delay, output, test sound, calibrate, rename…', onclick: ev => { ev.stopPropagation(); onToggle(); } },
  icon('chevD'), h('span', { class: 'dexp-l' }, 'Settings'));
}
/** Re-render one card / row in place after it opened or closed; focus stays on its Expand control. */
function toggleSettings(z, el, render) {
  setCardOpen(z.id, !openSet.has(z.id));
  const fresh = render(); el.replaceWith(fresh); fresh.querySelector('.dexpand')?.focus();
  flushSoon();          // a redraw that waited for this card applies now
  return fresh;
}
/** A redraw (the list refreshes every few seconds) must not drop keyboard focus from a card's Expand control, or Esc would stop closing it. */
function keepExpandFocus(scope) {
  const a = document.activeElement;
  if (!a?.classList?.contains('dexpand') || !scope.contains(a)) return;
  const id = a.closest('[data-zone-id]')?.dataset.zoneId;
  if (id != null) queueMicrotask(() => scope.querySelector(`[data-zone-id="${id}"] .dexpand`)?.focus());
}
/** Esc inside an open card closes its settings. */
function escCloses(el, z, close) {
  el.addEventListener('keydown', ev => { if (ev.key === 'Escape' && openSet.has(z.id) && !ev.defaultPrevented) { ev.preventDefault(); ev.stopPropagation(); close(); } });
  return el;
}
// ---- 0.2.3 fix: an open device card no longer "keeps refreshing" ----
// The Devices list is redrawn on every status / level / heartbeat push (refreshZones). Until now every redraw rebuilt every card, so an open
// card's settings were thrown away and re-created every few seconds: the slide-in animation replayed, focus, typed delay values, a slider drag
// in progress and the scroll spot were lost. Now each card / row carries a signature of what shapes it (name, outputs, rights, open state…);
// a redraw keeps the SAME element when the signature is unchanged and only patches the live values in it (dot, state, volume, mute, on/off,
// delay, connection), never touching an input that has focus or sits under the pointer. A card whose shape did change is rebuilt only when the
// user is not working in it; otherwise the rebuild waits for blur / pointerup / collapse. A removed device still goes at once.
let dragEl = null;
const redrawers = new Set();
const flushSoon = () => setTimeout(() => { for (const f of redrawers) f(); }, 30);
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('pointerdown', ev => { dragEl = ev.target; }, true);
  const up = () => { if (!dragEl) return; dragEl = null; flushSoon(); };
  document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
  document.addEventListener('focusout', flushSoon, true);
  globalThis.addEventListener?.('blur', up);
}
const EDITABLE = /^(INPUT|SELECT|TEXTAREA)$/;
/** Is the user working inside el right now (focus in a field / slider / dropdown, or a pointer held down in it)? */
export function userBusyIn(el) {
  if (!el) return false;
  const a = document.activeElement;
  if (a && EDITABLE.test(a.tagName || '') && el.contains(a)) return true;
  return !!(dragEl && el.contains(dragEl));
}
/** May a live value be written into this control (it has no focus and is not being dragged)? */
const idle = el => !!el && document.activeElement !== el && !(dragEl && el.contains(dragEl));
/** Put kids into parent in order, keeping every element that is already there in place (a moved node would lose focus / an active drag). */
export function reconcile(parent, kids) {
  kids = kids.flat(Infinity).filter(Boolean);
  const want = new Set(kids);
  for (const c of [...parent.childNodes]) if (!want.has(c)) c.remove();
  kids.forEach((k, i) => { const at = parent.childNodes[i]; if (at !== k) parent.insertBefore(k, at || null); });
}
/** What shapes a card / row (anything else is a live value that is patched in place). */
export function cardSig(S, z, hl = false) {
  return JSON.stringify([z.name, z.playerId, !!z.mine, !!z.reference, !!z.isWeb, thisDevice(S)?.id === z.id, isAdmin(S), canControl(S), canTune(S, z), openSet.has(z.id), typeof hl === 'string' ? hl : !!hl, !!z.connected,
    z.badge === 'recheck' || z.badge === 'uncalibrated' ? z.badge : '', !!z.outputUnavailable, z.chosenDeviceId ?? null,
    (z.outputs || []).map(o => [o.endpointDbId, o.deviceId, o.kind, o.name, !!o.connected, !!o.active, !!o.notCalibrated])]);
}
/** Keep the old card / row (patched) when it still fits or the user is working in it; else build a new one. busy.v = a rebuild is waiting. */
function keepCard(old, S, z, hl, build, busy) {
  if (old && old._sig === cardSig(S, z, hl)) { old._patch?.(z); return old; }
  if (old && userBusyIn(old)) { old._patch?.(z); busy.v = true; return old; }
  const el = build();
  if (old?.classList.contains('dset')) el.classList.add('dsnoanim');      // already open: do not replay the slide-in
  return el;
}
/** Keep a section (master row, zones sidebar) while the user is working in it; else take the fresh one. */
function keepSection(old, fresh, busy) {
  if (old && userBusyIn(old)) { busy.v = true; return old; }
  return fresh;
}
const childCards = (parent, cls) => new Map([...parent.children].filter(e => e.classList.contains(cls) && e.dataset.zoneId != null).map(e => [e.dataset.zoneId, e]));
function patchVolume(z, vol, pct, mute) {
  if (idle(vol)) { vol.value = String(z.volume); pct.textContent = Math.round(z.volume) + '%'; }
  mute.classList.toggle('on', !!z.muted); mute.setAttribute('aria-pressed', String(!!z.muted)); mute.setAttribute('aria-label', (z.muted ? 'Unmute ' : 'Mute ') + z.name);
  mute.title = z.muted ? 'Unmute' : 'Mute'; setIcon(mute, z.muted ? 'mute' : 'volume');
}
function patchFace(el, z, dot, state, sw) {
  el.classList.toggle('off', !z.enabled);
  dot.className = 'dot ' + dotClass(z); dot.title = stateText(z);
  if (state) { state.className = 'dstate small dim'; state.textContent = stateText(z); }
  sw.classList.toggle('on', !!z.enabled); sw.setAttribute('aria-checked', String(!!z.enabled));
}

/** 0.3.2 F18: the room's max-volume cap + lock (admin-only to change; the server enforces it for every volume source). */
function volCapControl(S, ctl, z, admin) {
  const cap = z.volCap ?? 100, out = h('span', { class: 'small mono vcap-v' }, Math.round(cap) + '%');
  const r = ro(h('input', { type: 'range', min: 0, max: 100, step: 1, value: cap, class: 'grow', 'aria-label': `${z.name} max volume`,
    oninput: ev => { out.textContent = ev.target.value + '%'; }, onchange: ev => ctl.act(`/zones/${z.id}/volcap`, { cap: +ev.target.value }, 'PUT') }), admin, 'Only an admin can change the max volume.');
  const lk = ro(h('button', { type: 'button', class: 'btn sm vcap-lock' + (z.volLocked ? ' on' : ''), 'aria-pressed': String(!!z.volLocked), title: z.volLocked ? 'Unlock: the room can go above the cap again' : 'Lock: nothing can raise this room above the cap',
    onclick: () => ctl.act(`/zones/${z.id}/volcap`, { cap: +r.value, locked: !z.volLocked }, 'PUT') }, icon('lock'), z.volLocked ? ' Locked' : ' Lock'), admin, 'Only an admin can change the max volume.');
  return h('div', { class: 'row vcap', style: 'gap:8px;align-items:center' }, r, out, lk);
}
function cardSettings(S, ctl, z) {
  const admin = isAdmin(S), tune = canTune(S, z), can = canControl(S), cur = chosenOutput(z);
  const testSound = async () => { try { await api(`/zones/${z.id}/test-sound`, { method: 'POST' }); toast('Playing a chime in ' + z.name); } catch (e) { toast(e.message, true); } };
  const sec = (title, ...kids) => h('div', { class: 'dssec' }, title ? h('div', { class: 'dlbl' }, title) : null, ...kids);
  const btn = (label, fn, ok = true, hint = OWN_HINT, cls = 'btn') => ro(h('button', { type: 'button', class: cls, onclick: fn }, label), ok, hint);
  const out = outputPicker(S, ctl, z), delay = cur ? exactDelay(S, ctl, z, cur, tune) : null, conn = connSection(z);
  const note = h('div', { class: 'small dim dmeasured' }, measuredNote(cur));
  const calib = btn('Calibrate', () => openCalibration(S, ctl.refreshAll, z.id), tune && z.connected && !z.reference, z.reference ? 'This is the reference speaker: the others are measured against it.' : tune ? 'This device is offline.' : OWN_HINT,
    'btn calbtn' + (z.badge === 'recheck' || z.badge === 'uncalibrated' ? ' primary' : ''));
  const more = moreMenu(S, ctl, z, cur);
  const el = h('div', { class: 'dsettings', role: 'group', id: `dset-${z.id}`, 'aria-label': `${z.name} settings` },
    sec('OUTPUT', out.el),
    sec('MAX VOLUME', volCapControl(S, ctl, z, admin)),
    cur ? sec('DELAY', h('div', { class: 'ddelay' }, delay, calib), note) : null,
    h('div', { class: 'dssec' }, h('div', { class: 'row dsbtns' },
      btn('Test sound', testSound, can && z.connected, can ? 'This device is offline.' : 'Your access is view-only.'),
      btn('Sound / EQ', () => openEq(S, ctl.refreshAll, cur?.deviceId), tune && !!cur, cur ? OWN_HINT : 'No output yet.'),
      h('span', { class: 'grow' }), more)),
    conn);
  // 0.2.3 fix: live values are patched in place - the open settings are never rebuilt by a status update
  el._patch = nz => {
    const o = chosenOutput(nz);
    if (delay && o) delay._patch(o);
    out.patch(nz); const n = measuredNote(o); if (note.textContent !== n) note.textContent = n;
    const key = connKey(nz); if (conn._key !== key) { const fresh = connSection(nz); conn.replaceChildren(...fresh.childNodes); conn._key = key; }
  };
  return el;
}
/** More ▾ - Rename, Set as reference, Delay history, Forget (admin-only items stay visible, read-only, for everyone else). */
function moreMenu(S, ctl, z, cur) {
  const admin = isAdmin(S);
  const wrap = h('div', { class: 'dmore' });
  const item = (label, fn, ok, hint, cls = '') => { const b = h('button', { type: 'button', role: 'menuitem', class: 'mitem' + (cls ? ' ' + cls : ''), onclick: () => { close(); fn(); } }, label); if (!ok) { b.disabled = true; b.title = hint; b.classList.add('ro'); b.setAttribute('aria-disabled', 'true'); } return b; };
  const menu = h('div', { class: 'dmenu', role: 'menu', hidden: true },
    item('Rename…', () => rename(S, ctl, z), admin, ADMIN_HINT),
    item(z.reference ? 'Reference speaker ✓' : 'Set as reference', () => setReference(ctl, z), admin && !z.reference, z.reference ? 'Already the reference speaker' : ADMIN_HINT),
    item('Delay history…', () => delayHistory(S, ctl, z, cur), !!cur, 'No output yet.'),
    cur?.kind === 'bluetooth' ? item('Follow this speaker', async () => { try { await api('/speakers/profiles/capture', { method: 'POST', body: { deviceId: z.id, name: cur.name, follow: true } }); toast('Saved profile and enabled Follow this speaker'); } catch (e) { toast(e.message, true); } }, canTune(S, z), OWN_HINT) : null,
    item('Forget device…', () => forget(ctl, z), admin, ADMIN_HINT, 'danger'));
  const btn = h('button', { type: 'button', class: 'btn dmorebtn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: ev => { ev.stopPropagation(); menu.hidden ? open() : close(); } }, 'More ▾');
  const outside = ev => { if (!wrap.contains(ev.target)) close(); };
  const esc = ev => { if (ev.key === 'Escape' && !menu.hidden) { ev.preventDefault(); ev.stopPropagation(); close(); btn.focus(); } };
  function open() { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', esc, true); menu.querySelector('button:not([disabled])')?.focus(); }
  function close() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); flushSoon(); }
  wrap.append(btn, menu); return wrap;
}
const connKey = z => JSON.stringify([z.connected, z.link, z.remoteIp, z.syncErrorMs, z.bufferMs, z.hardResyncs, z.isWeb, z.room?.state, z.room?.drops, z.room?.reconnects, z.room?.underrunEvents]);
/** The CONNECTION section of a card's settings (text only - safe to refresh in place). */
function connSection(z) {
  const r = z.room;
  const bits = [z.connected ? 'Connected' : 'Offline', z.link === 'wifi' ? 'Wi-Fi' : z.link === 'wired' || z.link === 'ethernet' ? 'network cable' : z.link, z.remoteIp,
    z.syncErrorMs != null ? `sync ±${Math.abs(z.syncErrorMs).toFixed(1)} ms` : null, r && (r.drops || r.reconnects || r.underrunEvents) ? `dropped ${r.drops}× · reconnected ${r.reconnects}×` : null].filter(Boolean);
  const el = h('div', { class: 'dsconn small dim', title: z.isWeb ? 'A browser cannot measure its own sync error - Calibrate or set the delay by ear.' : 'Sync error shows once something plays.' }, bits.join(' · '));
  el._key = connKey(z);
  return el;
}
/** Slider + ms box for typing an exact delay (0.0.8 item 7; was in the Details pop-up). Live while dragging, saved on release. */
function exactDelay(S, ctl, z, o, tune) {
  const put = (v, live) => api(`/outputs/${encodeURIComponent(o.deviceId)}/latency`, { method: 'PUT', body: { latencyMs: v, playerId: z.playerId, method: 'manual', live } });
  const status = h('span', { class: 'small dim latstatus', 'aria-live': 'polite' });
  const lat = latencyControl({ label: `${z.name} delay`, value: o.notCalibrated ? 0 : o.latencyMs, onChange: async (v, final) => { try { await put(v, !final); status.textContent = final ? `Saved ${v} ms` : `${v} ms (live)`; } catch (e) { status.textContent = ''; toast(e.message, true); } } });
  if (!tune) lat.el.querySelectorAll('input').forEach(i => ro(i, false, OWN_HINT));
  const el = h('div', null, lat.el, status);
  // 0.2.3 fix: the saved delay is shown live, but never under a focused / dragged slider or a box the user is typing in
  el._patch = no => { const v = clampMs(no.notCalibrated ? 0 : no.latencyMs); if (v !== lat.value && idle(lat.slider) && idle(lat.box)) lat.set(v); };
  return el;
}
async function delayHistory(S, ctl, z, o) {
  if (!o) return;
  let rows = []; try { rows = await api(`/outputs/${encodeURIComponent(o.deviceId)}/calibrations`); } catch (e) { return toast(e.message, true); }
  const tune = canTune(S, z);
  const dd = dialog('Delay history — ' + outputLabel(o), rows.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['When', 'Delay', 'How', ''].map(x => h('th', null, x)))), h('tbody', null, rows.map(r =>
    h('tr', null, h('td', null, new Date(r.measuredAt).toLocaleString()), h('td', null, `${Math.round(r.latencyMs)} ms`), h('td', null, r.method), h('td', null, tune ? h('button', { class: 'btn', onclick: async () => { try { await api(`/calibrations/${r.id}/restore`, { method: 'POST' }); toast('Restored'); dd.close(); ctl.refreshAll(); } catch (e) { toast(e.message, true); } } }, 'Use this') : null))))) : h('p', { class: 'dim' }, 'No saved delays yet.'), [{ text: 'Close' }]);
}
function rename(S, ctl, z) {
  const name = h('input', { type: 'text', value: z.name, maxlength: 40, 'aria-label': 'Device name' });
  dialog('Rename device', h('div', { class: 'field' }, h('label', null, 'Name'), name), [{ text: 'Rename', cls: 'primary', onclick: async () => { try { await api(`/zones/${z.id}`, { method: 'PATCH', body: { name: name.value } }); toast('Renamed'); ctl.refreshAll(); } catch (e) { toast(e.message, true); return false; } } }, { text: 'Cancel' }]);
}
async function setReference(ctl, z) { try { await api('/calibration/reference', { method: 'PUT', body: { zoneId: z.id } }); toast(`${z.name} is now the reference speaker`); ctl.refreshAll(); } catch (e) { toast(e.message, true); } }
function forget(ctl, z) {
  dialog(`Forget “${z.name}”?`, h('div', null, h('p', null, 'Its pairing is revoked and it disappears from the device list and from any zone. Saved delays for its speakers are kept.'),
    h('p', { class: 'small dim' }, z.isWeb ? 'A browser speaker comes back by itself the next time WavWiz is opened there.' : 'The PC can be paired again from WavWiz Player (Pair again… in the tray menu) with a new 6-digit code.')),
  [{ text: 'Forget device', cls: 'danger', onclick: async () => { try { await api(`/players/${encodeURIComponent(z.playerId)}`, { method: 'DELETE' }); toast(`${z.name} was forgotten`); ctl.refreshAll(); } catch (e) { toast(e.message, true); return false; } } }, { text: 'Cancel' }]);
}

/** Output dropdown + per-output delay of one device (Expanded card). Editable on your own device, or by an admin on any device. */
function outputPicker(S, ctl, z) {
  const can = canTune(S, z), hint = canControl(S) ? OWN_HINT : 'Your access is view-only.';
  const outs = z.outputs.filter(o => o.connected || o.active || o.deviceId === z.chosenDeviceId);
  const cur = chosenOutput(z);
  let el;
  if (z.outputUnavailable) {
    el = h('select', { class: 'dsel warn', 'aria-label': `${z.name} output`, onchange: ev => pick(ev.target.value) },
      h('option', { value: '', selected: true }, '⚠ Output unavailable'), ...outs.filter(o => o.connected).map(o => h('option', { value: o.endpointDbId }, `${outputLabel(o)} — ${dms(o)}`)));
  } else if (outs.length <= 1) {
    el = h('div', { class: 'small dim dsingle' }, z.isWeb ? 'This browser’s default output' : cur ? `${outputLabel(cur)} (the only output)` : 'No output reported yet');
  } else {
    el = h('select', { class: 'dsel', 'aria-label': `${z.name} output`, onchange: ev => pick(ev.target.value) }, ...outs.map(o => h('option', { value: o.endpointDbId, selected: o === cur, disabled: !o.connected }, `${outputLabel(o)}${o.connected ? '' : ' (unplugged)'}`)));
  }
  if (el.tagName === 'SELECT') ro(el, can, hint);
  async function pick(id) { if (!id) return; try { await api(`/zones/${z.id}/output`, { method: 'POST', body: { endpointId: +id } }); toast('Output switched - its own delay is back'); ctl.refreshAll(); } catch (e) { toast(e.message, true); ctl.refreshAll(); } }
  return { el, patch: () => {} };
}

function expandedCard(S, ctl, z, hl) {
  z = { ...z };           // this card's own copy: later updates patch it in place
  const open = openSet.has(z.id), me = thisDevice(S)?.id === z.id;
  const cls = 'dcard' + (z.enabled ? '' : ' off') + (z.connected ? '' : ' gone') + (z.muted ? ' muted' : '') + (hl ? ' hl' : '') + (me || z.mine ? ' mine' : '') + (open ? ' dset' : '');
  let card;
  const flip = () => { card = toggleSettings(z, card, () => expandedCard(S, ctl, (S.zones || []).find(x => x.id === z.id) || z, hl)); };
  const { vol, pct, mute } = volumeRow(S, ctl, z);
  const expBtn = settingsToggle(z.name, open, flip); expBtn.setAttribute('aria-controls', `dset-${z.id}`);
  const liveBits = () => [z.health === 'starved' ? h('span', { class: 'chip warn' }, 'Network is slow') : null,
    z.room && z.room.state !== 'ok' && z.room.state !== 'idle' && z.connected ? h('div', { class: 'small', style: 'color:var(--amber)' }, z.room.text + (z.room.detail ? ' - ' + z.room.detail : '')) : null].filter(Boolean);
  const liveKey = () => JSON.stringify([z.health === 'starved', z.connected && z.room && z.room.state !== 'ok' && z.room.state !== 'idle' ? [z.room.text, z.room.detail] : null]);
  const dot = h('span', { class: 'dot ' + dotClass(z), title: stateText(z) }), sw = onSwitch(S, ctl, z);
  const tags = h('span', { class: 'dtags' }, tagEls(z)), status = h('div', { class: 'dstatus small dim ell' }, statusLine(z, me));
  const live = h('div', { class: 'dlive' }, liveBits()), settings = open ? cardSettings(S, ctl, z) : null;
  let lk = liveKey();
  card = h('div', { class: cls, 'data-room': z.name, 'data-zone-id': z.id },
    h('div', { class: 'dtop' }, dot, h('b', { class: 'dname ell', title: (me ? 'This device. ' : '') + z.name }, z.name), h('span', { class: 'dkind', title: z.isWeb ? (isPhoneZone(z) ? 'Phone' : 'Browser') : 'PC with WavWiz Player' }, icon(deviceIconName(z))), h('span', { class: 'grow' }), sw),
    status,
    h('div', { class: 'dvol' }, vol, pct, mute),
    h('div', { class: 'dtagrow' }, tags),   // 0.3.2 F21: tags on their own row under the volume bar
    live,
    settings,
    h('div', { class: 'dexpbar' }, expBtn));
  card._sig = cardSig(S, z, hl);
  card._patch = nz => {            // 0.2.3 fix: a status / level / heartbeat update patches this card in place
    Object.assign(z, nz);
    patchFace(card, z, dot, null, sw); patchVolume(z, vol, pct, mute);
    card.classList.toggle('muted', !!z.muted); card.classList.toggle('gone', !z.connected);
    const t = JSON.stringify(cardTags(z)); if (tags._k !== t) { tags._k = t; tags.replaceChildren(...tagEls(z)); }
    const sl = statusLine(z, me); if (status.textContent !== sl) status.textContent = sl;
    const k = liveKey(); if (k !== lk) { lk = k; live.replaceChildren(...liveBits()); }
    settings?._patch(z);
  };
  tags._k = JSON.stringify(cardTags(z));
  return escCloses(card, z, flip);
}

/** Standard (narrow) row: name, status, volume, Mute and on/off only. 0.2.3: device settings live ONLY on the Expanded cards - tapping the name
 * opens Expanded with this device's card highlighted (0.2.0), one tap from its Settings button. */
function standardRow(S, ctl, z, openDevice) {
  z = { ...z };           // this row's own copy: later updates patch it in place
  const { vol, pct, mute } = volumeRow(S, ctl, z);
  const dot = h('span', { class: 'dot ' + dotClass(z), title: stateText(z) }), state = h('span', { class: 'dstate small' + (z.muted ? ' err' : ' dim') }, stateText(z)), sw = onSwitch(S, ctl, z);
  const tags = h('span', { class: 'dtags' }, tagEls(z)); tags._k = JSON.stringify(cardTags(z));
  const row = h('div', { class: 'drow' + (z.enabled ? '' : ' off') + (z.muted ? ' muted' : '') + (z.mine ? ' mine' : ''), 'data-device': z.name, 'data-zone-id': z.id },
    h('div', { class: 'dtop' }, dot,
      h('button', { class: 'dname ell', title: (z.mine ? 'This device. ' : '') + 'Show this device with all of its controls and settings', onclick: () => openDevice(z.id) }, z.name),
      h('span', { class: 'grow' }), sw),
    outputLine(z),
    h('div', { class: 'dvol' }, vol, pct, mute),
    h('div', { class: 'dtagrow' }, tags, state));   // 0.3.2 F21     // 0.2.5: mute on the right, no speaker icon on the left
  row._sig = cardSig(S, z);
  row._patch = nz => { Object.assign(z, nz); patchFace(row, z, dot, state, sw); patchVolume(z, vol, pct, mute); row.classList.toggle('muted', !!z.muted); const t = JSON.stringify(cardTags(z)); if (tags._k !== t) { tags._k = t; tags.replaceChildren(...tagEls(z)); } };   // 0.2.3 fix: patched in place
  return row;
}

// ---- 0.2.5: the "Calibration mic" line at the top of the list while a phone (or a PC mic run) is connected as a calibration mic ----
let MICS = [], micsAt = 0, micsBusy = false;
const micsRedraw = () => { try { window.dispatchEvent(new CustomEvent('wavwiz:devredraw')); } catch { /* node */ } };
async function loadMics(force) {
  if (micsBusy || (!force && Date.now() - micsAt < 5000)) return; micsBusy = true;
  try { const r = await api('/calibration/mics'); const changed = JSON.stringify(r) !== JSON.stringify(MICS); MICS = r || []; micsAt = Date.now(); if (changed) { micsSig++; micsRedraw(); } } catch { /* not signed in yet */ } finally { micsBusy = false; }
}
let micsSig = 0;
const HASWIN = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
if (HASWIN) { for (const ev of ['wavwiz:calmics', 'wavwiz:calphone', 'wavwiz:calrun']) window.addEventListener(ev, () => loadMics(true)); }
/** "Calibration mic  MIC  Dana's iPhone · connected · ready to measure  [Stop using as mic]" (pure text part tested). */
export const micLineText = m => `${m.device} · ${m.label}`;
function micLine(S) {
  loadMics(false);
  if (!MICS.length) return null;
  const can = canControl(S);
  const el = h('div', { class: 'dmicline', role: 'status' }, MICS.map(m => h('div', { class: 'dmicrow' },
    h('span', { class: 'dmicic' }, icon('mic')), h('b', null, 'Calibration mic'), h('span', { class: 'dtag mic' }, 'MIC'),
    h('span', { class: 'ell grow' }, h('span', { class: 'dmicdev' }, m.device), h('span', { class: 'small dim' }, ' · ' + m.label)),
    m.bluetooth ? h('span', { class: 'dtag nodelay', title: 'Bluetooth mics add their own delay, so results may be off. A wired or USB mic is recommended.' }, 'BLUETOOTH') : null,
    ro(h('button', { type: 'button', class: 'btn sm', onclick: async () => { try { if (m.kind === 'phone') await api(`/calibration/phone-link/${m.token}/stop`, { method: 'POST', body: {} }); else await api(`/calibration/sessions/${m.sessionId}/end`, { method: 'POST', body: {} }); toast('Stopped using it as a calibration mic'); } catch (e) { toast(e.message, true); } loadMics(true); } }, 'Stop using as mic'), can, 'Your access is view-only.'))));
  el._sig = micsSig; return el;
}
const keepMic = (old, S) => (old && old._sig === micsSig ? old : micLine(S));

const EMPTY = 'No devices yet. Every browser that opens WavWiz joins as a speaker by itself; for a PC with speakers, install WavWiz Player there (it finds this server by itself).';

/** Right-hand panel of the desktop layout in three sizes. ctl.setDevSize(size, highlightZoneId) switches size. */
export function devicesPanel(S, ctl) {
  const root = h('section', { class: 'devpanel', 'aria-label': 'Devices and zones' }), body = h('div', { class: 'devbody' });
  let size = loadDevSize(), hl = null, zpick = loadZonePick(), zedit = null;
  const setPick = v => { zpick = v; saveZonePick(v); draw(true); };
  const setEdit = v => { zedit = v; draw(true); };
  // 0.2.2 T5: a true mirror of the Library header. Library = title … Esc, arrow, Expand (outer edge); Devices = Expand, arrow (outer edge), Esc, title …
  const colBtn = h('button', { class: 'plus devcol', 'aria-label': arrowLabel('Devices', 'standard'), 'aria-expanded': 'true', title: 'Fold / open the Devices panel ( ] )', onclick: ev => { ev.stopPropagation(); ctl.toggleDev?.(); } }, '›');
  const expBtn = h('button', { class: 'plus devexp', 'aria-label': expandLabel('Devices', false), 'aria-pressed': 'false', title: 'Expand', onclick: ev => { ev.stopPropagation(); ctl.toggleDevExpanded?.(); } }, icon(expandIcon('right', false)));
  const count = h('span', { class: 'small dim devcount' });
  // 0.2.3 U7: the DEVICES title sits at the right edge, the true mirror image of LIBRARY at the left edge of the Library header
  // 0.3.0 §6: two controls kept apart - Expand on the inner edge (becomes "⤡ Esc"), chevron on the outer edge; a 30 px rail with icon + title
  root.append(h('div', { class: 'prail', 'aria-hidden': 'true' }, h('span', { class: 'prail-ic' }, '◉'), h('span', { class: 'prail-t' }, 'DEVICES')),
    h('div', { class: 'pane-h devhead' }, expBtn, h('span', { class: 'grow devtitle' }), count, h('span', { class: 'devtitle' }, 'DEVICES'), colBtn), body);
  root.addEventListener('click', ev => { if (size === 'collapsed' && !ev.target.closest('.devcol')) ctl.toggleDev?.(false); });
  const setSize = (s, highlight = null) => {
    size = s; hl = highlight;
    colBtn.textContent = s === 'collapsed' ? '‹' : '›'; colBtn.setAttribute('aria-expanded', String(s !== 'collapsed'));
    colBtn.setAttribute('aria-label', arrowLabel('Devices', s));
    paintExpandBtn(expBtn, 'Devices', s === 'expanded');
    root.classList.toggle('israil', s === 'collapsed'); root.title = s === 'collapsed' ? 'Open the Devices panel ( ] )' : '';
    root.classList.toggle('expanded', s === 'expanded'); draw(true);
    if (hl != null) setTimeout(() => body.querySelector(`.dcard[data-zone-id="${hl}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
  };
  // 0.2.3 U11: a skipped redraw used to be dropped, so a device removed (revoked/forgotten) while a slider, menu or zone editor was open stayed on the
  // list until some later change. Now a skipped redraw is retried until it can run - except that a removed device is never kept: it goes at once.
  // 0.2.3 fix: a redraw no longer rebuilds the list. Cards / rows are kept and patched in place (keepCard); a card the user is working in is never
  // replaced - its rebuild waits for blur / pointerup / collapse (later + flush). A removed device's card goes at once, the others stay untouched.
  let pending = 0;
  const later = () => { clearTimeout(pending); pending = setTimeout(() => { pending = 0; draw(); }, 700); };
  const removedShown = () => [...body.querySelectorAll('[data-zone-id]')].some(el => !S.zones.some(z => String(z.id) === el.dataset.zoneId));
  redrawers.add(() => { if (pending) { clearTimeout(pending); pending = 0; draw(); } });
  const kid = (parent, cls) => [...parent.children].find(e => e.classList.contains(cls));
  function draw(force) {
    if (!force && removedShown()) force = true;
    if (!force && body.querySelector('.dmenu:not([hidden])')) return later();
    clearTimeout(pending); pending = 0; keepExpandFocus(body);
    const busy = { v: false };
    count.textContent = `${S.zones.length} device${S.zones.length === 1 ? '' : 's'} • ${S.zones.filter(z => z.connected).length} online`;
    if (size === 'collapsed') { body.replaceChildren(); return; }
    if (size === 'expanded') {
      // 0.2.1 F7: master volume keeps the full-width strip; zones move to the ~180 px sidebar on the right (variant B) and filter the cards
      if (zpick !== 'all' && !(S.groups || []).some(g => g.id === zpick)) zpick = 'all';
      // tapping a device in Standard opens Expanded with its card highlighted: never hide that card behind a zone filter
      if (hl != null && zpick !== 'all' && !zoneFilter(S.zones, S.groups, zpick).some(z => z.id === hl)) { zpick = 'all'; saveZonePick('all'); }
      // 0.3.3 G9 (E1, replaces F17's 4 columns): Zones (All + zone cards) | Speakers (one-line rows, unassigned subgroup at the bottom) | Scenes & Schedules.
      const etop = kid(body, 'dexp-top') || h('div', { class: 'dexp-top' }), emain = kid(body, 'dexp-main') || h('div', { class: 'dexp-main e1' });
      emain.classList.add('e1');
      reconcile(etop, [keepSection(kid(etop, 'dmaster'), masterRow(S, ctl), busy), btHint(S, ctl), keepMic(kid(etop, 'dmicline'), S)].filter(Boolean));
      const groups = S.groups || [], hset = zoneHighlight(groups, zpick), pg = groups.find(g => g.id === zpick);
      const oldSide = kid(emain, 'zcol');
      const zcol = !force && zedit !== null && oldSide ? oldSide : keepSection(oldSide, (() => {
        const c = h('div', { class: 'zcol ecol' });
        if (zedit !== null) { c.append(zoneEditView(S, ctl, h('div', { class: 'zside' }), groups.find(g => g.id === zedit) || null, setEdit, setPick)); return c; }
        const all = h('button', { type: 'button', class: 'zall' + (hset ? '' : ' on'), 'aria-pressed': String(!hset), onclick: () => setPick('all') }, h('b', null, 'All'), h('span', { class: 'small dim' }, `${S.zones.length} speaker${S.zones.length === 1 ? '' : 's'}`));
        c.append(h('div', { class: 'pane-h dsec-h zones-h' }, h('span', null, 'ZONES'), h('span', { class: 'small dim' }, String(groups.length)), h('span', { class: 'grow' }),
          ro(h('button', { class: 'btn sm zadd-new', 'aria-label': 'New zone', title: 'New zone', onclick: () => editZone(S, null, ctl.refreshAll) }, '+'), isAdmin(S))), all,
          groups.length ? h('div', { class: 'zlist' }, groups.map(g => { const zc = zoneCard2(S, ctl, g, { pick: zpick, onPick: setPick }); ((g0, b) => g0 ? g0.parentNode.insertBefore(b, g0.nextSibling) : null)(zc.querySelector('.zc-top .grow'), ro(h('button', { class: 'zbtn zedit', 'aria-label': `Edit zone ${g.name}`, title: 'Edit zone', onclick: ev => { ev.stopPropagation(); setEdit(g.id); } }, '✎'), isAdmin(S))); return zc; }))
            : h('p', { class: 'dim small pad' }, 'Zones are optional groups, like “Downstairs”.'));
        return c;
      })(), busy);
      const scol = kid(emain, 'scol') || h('div', { class: 'scol ecol' });
      const { zoned, unassigned: un } = speakerGroups(S.zones, groups);
      const oldS = new Map([...scol.querySelectorAll('.srow')].map(e => [e.dataset.zoneId, e]));
      const mk = (z, addable) => keepCard(oldS.get(String(z.id)), S, z, rowKey(z.id === hl, !!hset && !hset.has(z.id), addable, groups.length), () => speakerRow(S, ctl, z, z.id === hl, { dim: !!hset && !hset.has(z.id), groups, addable }), busy);
      const head = h('div', { class: 'pane-h dsec-h devs-h' }, h('span', null, SPEAKERS_LABEL.toUpperCase()), h('span', { class: 'small dim' }, `${S.zones.length}${pg ? ' · ' + pg.name.toUpperCase() + ' HIGHLIGHTED' : ''}`), h('span', { class: 'grow' }),
        pg ? h('button', { class: 'btn sm', onclick: () => setPick('all') }, 'Show all') : h('span', { class: 'small dim' }, `${S.zones.filter(z => z.connected).length} online`));
      const cols = h('div', { class: 'scolhead', 'aria-hidden': 'true' }, h('span', { class: 'ch-dot' }), h('span', { class: 'ch-name' }, 'NAME'), h('span', { class: 'ch-out' }, 'OUTPUT'), h('span', { class: 'ch-vol' }, 'VOLUME'), h('span', { class: 'ch-tags' }, 'TAGS'));
      const list = kid(scol, 'slist') || h('div', { class: 'slist' }), ulist = kid(scol, 'ulist') || h('div', { class: 'ulist' });
      reconcile(list, zoned.map(z => mk(z, false))); reconcile(ulist, un.map(z => mk(z, true)));
      reconcile(scol, [head, S.zones.length ? cols : null, S.zones.length ? list : h('p', { class: 'dim small pad' }, EMPTY),
        un.length ? h('div', { class: 'udiv', role: 'separator' }, h('b', null, `${UNASSIGNED_LABEL.toUpperCase()} ${un.length}`), h('span', { class: 'small dim' }, ' · not in any zone')) : null, un.length ? ulist : null].filter(Boolean));
      const sscol = kid(emain, 'sscol') || h('div', { class: 'sscol ecol' });
      reconcile(sscol, [keepSection(kid(sscol, 'dss'), ssCompact(S, ctl), busy)]);
      reconcile(emain, [zcol, scol, sscol]);
      reconcile(body, [etop, emain]);
      if (busy.v) later();
      return;
    }
    // 0.3.3 G10 (slim): one-line master, Speakers / Unassigned / Zones subheads with counts, 2-line rows (~56 px), output name in the tooltip
    const groups = S.groups || [], { zoned, unassigned: un } = speakerGroups(S.zones, groups), old = childCards(body, 'drow');
    const sub = (t, n, cls = '') => h('div', { class: 'pane-h dsec-h slimsub ' + cls }, h('span', null, t), h('span', { class: 'small dim' }, String(n)));
    const row = z => keepCard(old.get(String(z.id)), S, z, false, () => slimRow(S, ctl, z, id => ctl.setDevSize?.('expanded', id)), busy);
    reconcile(body, [keepSection(kid(body, 'dmaster'), masterRow(S, ctl), busy), btHint(S, ctl), keepMic(kid(body, 'dmicline'), S),
      sub(SPEAKERS_LABEL.toUpperCase(), zoned.length, 'devs-h'),
      S.zones.length ? zoned.map(row) : h('p', { class: 'dim small pad' }, EMPTY),
      un.length ? [sub(UNASSIGNED_LABEL.toUpperCase(), un.length, 'unas-h'), un.map(row)] : null,
      h('div', { class: 'pane-h dsec-h slimsub zones-h' }, h('span', null, 'ZONES'), h('span', { class: 'small dim' }, String(groups.length)), h('span', { class: 'grow' }),
        ro(h('button', { class: 'btn sm zadd-new', 'aria-label': 'New zone', title: 'New zone', onclick: () => editZone(S, null, ctl.refreshAll) }, '+'), isAdmin(S))),
      groups.length ? keepSection(kid(body, 'zlist'), h('div', { class: 'zlist' }, groups.map(g => zoneCard2(S, ctl, g, { slim: true }))), busy)
        : h('p', { class: 'dim small pad' }, 'Zones are optional groups, like “Downstairs”. An administrator can create one to switch several speakers on together.'),
      ssCompact(S, ctl)]);
    if (busy.v) later();
  }
  setSize(size); if (HASWIN) window.addEventListener('wavwiz:devredraw', () => whenIdle(draw, draw));
  return { el: root, draw, setSize, get size() { return size; }, setCollapsed: c => setSize(c ? 'collapsed' : (size === 'collapsed' ? 'standard' : size)) };
}

/** The Devices & zones page (phone tab / narrow screens): master + zones on top, then one Expanded card per device. */
export function devicesView(S, ctl) {
  const root = h('div', { id: 'p-zones' }), top = h('div'), list = h('div', { class: 'dgrid one' }), foot = h('div', { class: 'row wrap', style: 'margin-top:6px' });
  root.append(h('h2', { class: 'pagetitle' }, 'Devices & zones'), top, list, foot);
  let pending = 0;      // 0.2.3 U11: same rule as the side panel - retry a skipped redraw, never keep a removed device on screen
  const later = () => { clearTimeout(pending); pending = setTimeout(() => { pending = 0; draw(); }, 700); };
  redrawers.add(() => { if (pending) { clearTimeout(pending); pending = 0; draw(); } });
  function draw() {
    const gone = [...list.querySelectorAll('[data-zone-id]')].some(el => !S.zones.some(z => String(z.id) === el.dataset.zoneId));
    if (!gone && root.querySelector('.dmenu:not([hidden])')) return later();
    clearTimeout(pending); pending = 0; keepExpandFocus(list);
    const busy = { v: false };      // 0.2.3 fix: cards are kept and patched in place, exactly like the side panel
    reconcile(top, [keepSection(top.children[0], masterRow(S, ctl), busy), keepMic(top.querySelector('.dmicline'), S), zonesStrip(S, ctl, false)].filter(Boolean));
    const old = childCards(list, 'dcard');
    reconcile(list, S.zones.length ? S.zones.map(z => keepCard(old.get(String(z.id)), S, z, false, () => expandedCard(S, ctl, z, false), busy)) : [h('div', { class: 'card' }, h('h3', null, 'No devices yet'), h('p', { class: 'dim' }, EMPTY))]);
    const live = S.zones.some(z => z.enabled && z.connected);
    foot.replaceChildren(h('span', { class: 'dot ' + (live ? 'ok' : 'warn') }), live ? 'Synced playback active' : 'No device is switched on and connected', h('span', { class: 'grow' }),
      canControl(S) ? h('button', { class: 'btn', onclick: () => openCalibration(S, ctl.refreshAll) }, '🎤 Calibrate') : null);
    if (busy.v) later();
  }
  if (HASWIN) window.addEventListener('wavwiz:devredraw', () => whenIdle(() => { if (root.isConnected) draw(); }, draw));
  return { el: root, draw };
}
export { roomPillClass, roomPill };

// ---- 0.3.3 G6-G11: Speakers wording, slim standard rows, E1 expanded view ----
/** G8: the inner section is "Speakers" (the panel title stays "Devices"). Pure. */
export const SPEAKERS_LABEL = 'Speakers', UNASSIGNED_LABEL = 'Unassigned';
/** G9: "TYPE · Windows FriendlyName" for a speaker row's dim output line (pure). */
export function outputTypeLine(z) {
  if (z?.outputUnavailable) return '⚠ Output unavailable';
  const o = z && chosenOutput(z); if (!o) return '';
  const T = { hdmi: 'HDMI', spdif: 'OPTICAL', analog: 'WIRED', wired: 'WIRED', bluetooth: 'BLUETOOTH', usb: 'USB', other: 'OUTPUT' }[o.kind] || 'OUTPUT';
  return (o.name || '').trim() ? `${T} · ${o.name.trim()}` : T;
}
/** G9/G10: speakers split into zoned (in at least one zone) and unassigned; with no zones at all every speaker is "zoned". Pure. */
export function speakerGroups(zones, groups) {
  const zs = zones || [], gs = groups || [];
  if (!gs.length) return { zoned: zs, unassigned: [] };
  const un = new Set(unassigned(zs, gs).map(z => z.id));
  return { zoned: zs.filter(z => !un.has(z.id)), unassigned: zs.filter(z => un.has(z.id)) };
}
/** G9: which speaker ids a selected zone highlights (null = none selected / All). Pure. */
export const zoneHighlight = (groups, pick) => { if (pick == null || pick === 'all') return null; const g = (groups || []).find(x => x.id === pick); return g ? new Set(g.deviceIds || []) : null; };
/** G7: a zone is "on" while any of its speakers is switched on. Pure. */
export const zoneOn = (zones, g) => zoneMembers(zones, g).some(z => z.enabled);
function zoneSwitch(S, ctl, g) {
  const on = zoneOn(S.zones, g), ms = zoneMembers(S.zones, g);
  const sw = h('div', { class: 'sw sm' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': `Zone ${g.name} on or off`, tabindex: 0, title: 'Switch every speaker in this zone on or off',
    onclick: ev => { ev.stopPropagation(); if (!canControl(S)) return; const want = !zoneOn(S.zones, g); for (const z of ms) { z.enabled = want; ctl.act(`/zones/${z.id}`, { enabled: want }, 'PATCH'); } },
    onkeydown: e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.target.click(); } } });
  if (!canControl(S)) { sw.setAttribute('aria-disabled', 'true'); sw.classList.add('ro'); sw.title = 'Your access is view-only.'; }
  return sw;
}
/** G7: a zone card with exactly the device-card look - dot / name / on-off top line, full-width bar + % + mute, tags row under the bar. */
function zoneCard2(S, ctl, g, { pick = null, onPick = null, slim = false } = {}) {
  const card = zoneCard(S, ctl, g);
  const ms = zoneMembers(S.zones, g), muted = zoneMuted(S.zones, g);
  const top = card.querySelector('.zc-top'); top.classList.add('dtop'); top.querySelector('.zname')?.classList.add('dname');
  top.append(zoneSwitch(S, ctl, g));
  card.querySelector('.zc-mem')?.remove();
  const tags = [h('span', { class: 'dtag zone' }, 'ZONE'), slim ? null : h('span', { class: 'dtag' }, `${ms.length} SPEAKER${ms.length === 1 ? '' : 'S'}`), g.active ? h('span', { class: 'dtag zplaying' }, 'PLAYING') : null, muted ? h('span', { class: 'dtag zmuted' }, 'MUTED') : null].filter(Boolean);
  card.querySelector('.ztagrow')?.remove();
  const tr = h('div', { class: 'dtagrow ztagrow' }, tags);
  if (slim) { const g0 = top.querySelector('.grow'); top.insertBefore(h('span', { class: 'dtags slimtags' }, tags), g0 ? g0.nextSibling : null); } else card.append(tr);
  card.classList.add('dlike'); card.title = ms.length ? ms.map(z => z.name).join(' · ') : 'No speakers yet';
  if (onPick) { card.classList.toggle('picked', pick === g.id); card.setAttribute('aria-pressed', String(pick === g.id)); card.addEventListener('click', ev => { if (ev.target.closest('button,input,[role=switch]')) return; onPick(pick === g.id ? 'all' : g.id); }); }
  return card;
}
/** G10: slim standard row (~56 px): line 1 dot, name, small tags, switch; line 2 full-width bar to the %, mute. Output name in the tooltip. */
function slimRow(S, ctl, z, openDevice) {
  const row = standardRow(S, ctl, z, openDevice);
  row.classList.add('slim');
  row.querySelector('.doutline')?.remove();
  const tags = row.querySelector('.dtags'), sw = row.querySelector('.dtop .sw');
  if (tags && sw) { tags.classList.add('slimtags'); sw.parentNode.insertBefore(tags, sw); }
  row.querySelector('.dtagrow')?.remove();
  const ol = outputTypeLine(z); row.title = ol ? `${z.name} - ${ol}` : z.name;
  return row;
}
/** G9: one-line speaker row in the E1 expanded view: dot, name, dim output line (ellipsis + tooltip), bar to %, mute, tags, on/off, settings. */
function speakerRow(S, ctl, z, hl, { dim = false, groups = [], addable = false } = {}) {
  z = { ...z };
  const open = openSet.has(z.id), me = thisDevice(S)?.id === z.id;
  let row;
  const flip = () => { row = toggleSettings(z, row, () => speakerRow(S, ctl, (S.zones || []).find(x => x.id === z.id) || z, hl, { dim, groups, addable })); };
  const { vol, pct, mute } = volumeRow(S, ctl, z);
  const dot = h('span', { class: 'dot ' + dotClass(z), title: stateText(z) }), sw = onSwitch(S, ctl, z);
  const tags = h('span', { class: 'dtags' }, tagEls(z)); tags._k = JSON.stringify(cardTags(z));
  const ol = outputTypeLine(z), oparts = ol.split(' · ');
  const out = h('span', { class: 'sout ell' + (z.outputUnavailable ? ' warn' : ''), title: ol || 'No output' }, oparts.length > 1 ? [h('b', { class: 'skind' }, oparts[0]), ' · ' + oparts.slice(1).join(' · ')] : ol);
  const expBtn = settingsToggle(z.name, open, flip), settings = open ? cardSettings(S, ctl, z) : null;
  const add = addable ? ro(h('button', { type: 'button', class: 'btn sm saddzone', title: 'Add this speaker to a zone', onclick: ev => { ev.stopPropagation(); addToZoneMenu(S, ctl, z, ev.currentTarget, groups); } }, '+ Add to zone'), isAdmin(S)) : null;
  row = h('div', { class: 'dcard srow' + (z.enabled ? '' : ' off') + (z.connected ? '' : ' gone') + (z.muted ? ' muted' : '') + (hl ? ' hl' : '') + (dim ? ' dimmed' : '') + (open ? ' dset' : ''), 'data-room': z.name, 'data-zone-id': z.id },
    h('div', { class: 'sline' }, dot, h('b', { class: 'dname ell', title: (me ? 'This device. ' : '') + z.name }, z.name), out, h('div', { class: 'dvol' }, vol, pct, mute), h('span', { class: 'stags' }, tags), add || h('span', { class: 'saddslot' }), expBtn, sw),   // 0.3.4 H8: settings ⌄ then the switch, as in the approved render
    settings);
  row._sig = cardSig(S, z, rowKey(hl, dim, addable, groups.length));
  row._patch = nz => { Object.assign(z, nz); patchFace(row, z, dot, null, sw); patchVolume(z, vol, pct, mute); row.classList.toggle('muted', !!z.muted); row.classList.toggle('gone', !z.connected); const t = JSON.stringify(cardTags(z)); if (tags._k !== t) { tags._k = t; tags.replaceChildren(...tagEls(z)); } settings?._patch?.(z); };
  return escCloses(row, z, flip);
}
function addToZoneMenu(S, ctl, z, anchor, groups) {
  document.querySelector('.zaddmenu')?.remove();
  const m = h('div', { class: 'dmenu zaddmenu', role: 'menu' }, (groups || []).length ? groups.map(g => h('button', { type: 'button', role: 'menuitem', onclick: async () => { m.remove(); try { await api(`/groups/${g.id}`, { method: 'PATCH', body: { name: g.name, deviceIds: [...new Set([...(g.deviceIds || []), z.id])] } }); toast(`${z.name} added to ${g.name}`); ctl.refreshAll(); } catch (e) { toast(e.message, true); } } }, g.name))
    : h('p', { class: 'small dim pad' }, 'No zones yet.'), h('button', { type: 'button', role: 'menuitem', onclick: () => { m.remove(); editZone(S, null, ctl.refreshAll); } }, '+ New zone…'));
  anchor.after(m); m.querySelector('button')?.focus();
  const off = ev => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }; setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  m.addEventListener('keydown', ev => { if (ev.key === 'Escape') { m.remove(); anchor.focus(); } });
}

/** 0.3.3 G9: what besides the device shapes an E1 speaker row (highlight, dimmed by a zone pick, Add to zone) - part of its signature. */
export const rowKey = (hl, dim, addable, ng) => `${hl ? 1 : 0}|${dim ? 1 : 0}|${addable ? 1 : 0}|${ng}`;
