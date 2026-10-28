import { orderedZones, orderedGroups, attachDevDrag, setLinkHandler } from './devorder.js';
import { h, api, toast, dialog } from './util.js';
import { roomPill, roomPillClass } from './diag.js';
import { centerEq } from './centerview.js';
import { latencyControl, clampMs } from './latency.js';
import { openCalibration, calHelpLink } from './calibrate.js';
import { canControl, isAdmin, canTune, ADMIN_HINT, thisDevice } from './ui.js';
import { icon, setIcon, iconSvg, setChev } from './icons.js';
import { whenIdle } from './slider.js';
import { scenesColumn } from './scenesched.js';
import { undoToast } from './settingsui.js';
import { speakerSettings } from './spkset.js';
import { mixerButton } from './mixer.js';   // 0.4.8 F49
import { pulse } from './motion.js';
import { itemArtUrl } from './art.js';
import * as Z from './zones40.js';
import { attachCtx, speakerMenuItems, zoneMenuItems } from './ctxmenu.js';
import { treeEl, zonePane, crumb, HINT42, movePlan, isControlling, createZone } from './tree42.js';

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
// 0.5.0: the output type as the first tag (HDMI, TOSLINK, BLUETOOTH, USB, ANALOG); unknown/other shows nothing
const OUT_TAG = { hdmi: 'HDMI', spdif: 'TOSLINK', bluetooth: 'BLUETOOTH', usb: 'USB', analog: 'ANALOG', wired: 'ANALOG' };
export function outputTag(z) {
  const o = z && chosenOutput(z), text = o && OUT_TAG[o.kind]; if (!text) return null;
  return { k: 'otype' + (o.kind === 'bluetooth' ? ' bt' : ''), text, title: o.kind === 'bluetooth' ? 'Bluetooth output: its delay can change when it reconnects. A wired speaker makes a steadier reference.' : `Output: ${outputLabel(o)}` };
}
export function cardTags(z) {
  const t = [], o = chosenOutput(z), ot = outputTag(z);
  if (!z.connected) t.push({ k: 'offline', text: 'OFFLINE', title: 'Not connected right now' });
  if (z.reference) t.push({ k: 'ref', text: 'REF', title: 'Reference speaker - other delays are measured against this one' });
  if (z.muted) t.push({ k: 'muted', text: 'MUTED', title: 'Muted - press the round button to unmute' });
  if (z.connected && !z.reference && o && o.notCalibrated) t.push({ k: 'nodelay', text: 'NO DELAY', title: 'The delay is not set yet: Settings › Delay › Calibrate' });
  if (isPhoneZone(z)) t.push({ k: 'role', text: 'SPEAKER', title: 'This phone plays music. On the phone: Devices › Phone role to use it as a calibration mic instead' });
  return ot ? [ot, ...t.slice(0, 2)] : t.slice(0, 2);
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
  dialog(`Remove zone “${g.name}”?`, h('div', null, h('p', null, 'The zone and its settings are deleted. Its devices are not touched - they simply move to Unassigned.'), (g.deviceIds || []).length ? h('p', { class: 'small', 'data-confirm-speakers': '' }, `${g.deviceIds.length} speaker${g.deviceIds.length === 1 ? '' : 's'} will move to Unassigned: ${(S.zones || []).filter(z => g.deviceIds.includes(z.id)).map(z => z.name).join(', ')}.`) : null,
    g.active ? h('p', { class: 'warnc' }, 'This zone is the one playing now: playback stops first.') : null),
  [{ text: 'Remove zone', cls: 'danger', onclick: async () => { try { await api(`/groups/${g.id}`, { method: 'DELETE' }); toast(`Zone “${g.name}” removed`); } catch (e) { toast(e.message, true); return false; } done?.(); } }, { text: 'Cancel' }]);
}
/** Create or edit a zone: a name and the devices in it (admin). */
export function editZone(S, g, done) {
  const name = h('input', { type: 'text', maxlength: 60, value: g?.name || '', placeholder: 'e.g. Downstairs', 'aria-label': 'Zone name' }), picked = new Set(g?.deviceIds || []);
  const boxes = S.zones.map(z => h('label', { class: 'row zrow' }, h('input', { type: 'checkbox', checked: picked.has(z.id), onchange: ev => { ev.target.checked ? picked.add(z.id) : picked.delete(z.id); } }), h('span', { class: 'dot ' + dotClass(z) }), z.name + (z.isWeb ? ' (browser)' : '')));
  dialog(g ? 'Edit zone' : 'New zone', h('div', null, h('div', { class: 'field' }, h('label', null, 'Name'), name), h('div', { class: 'sec' }, 'Devices in this zone'), boxes.length ? boxes : h('p', { class: 'dim' }, 'No devices yet. Open WavWiz in a browser, or connect WavWiz Player on a PC.')),
    [{ text: g ? 'Save' : 'Create zone', cls: 'primary', onclick: async () => { try { const body = { name: name.value, deviceIds: [...picked] }; if (g) await api(`/groups/${g.id}`, { method: 'PATCH', body }); else await createZone(body.name, body.deviceIds); toast('Saved'); } catch (e) { toast(e.message, true); return false; } done?.(); } }, { text: 'Cancel' }]);
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
  const o = chosenOutput(z); return o ? h('div', { class: 'doutline small dim ell' }, (o.name || '').trim() || outputLabel(o)) : null;   // 0.5.0: the type is the tag now
}
// 0.4.9 F70: Expanded Devices - the master bar lines up with the setting bars of the middle column (Volume, Max volume, Delay, Balance, Bass, Treble):
// the master slider's track gets the same left and right edges (the label / zone chip sit just left of it; All off / All on / Link all stay on the right),
// and (CSS) the speaker Volume bar has the same width as the bars below it. With nothing picked it uses the last measured place (else the column's inset).
let f70ref = null;
export function alignMaster(body) {
  if (body && !body.querySelector(':scope > .dexp-top')) { alignPanelMaster(body); return; }
  const top = body?.querySelector(':scope > .dexp-top'), m = top?.querySelector('.dmaster'), ms = m?.querySelector('.dvol-master input[type=range]'), col = body?.querySelector('.dexp-main .dcol42');
  if (!ms || !col || !col.offsetParent) return;
  const cr = col.getBoundingClientRect(), bars = [...col.querySelectorAll('.spk-row input[type=range], .zp42-row input[type=range]')].filter(i => i.offsetParent && i.getBoundingClientRect().width > 0 && !i.closest('.spk-volline'));
  // 0.4.9 F70 fix: zone settings (.zp42-row) count too - before, only speaker rows were measured, so a zone pane fell back to a stale / default place
  if (bars.length) { const r = bars[0].getBoundingClientRect(); f70ref = { dl: r.left - cr.left, w: r.width }; }
  const ref = f70ref || { dl: 32, w: Math.min(485, cr.width - 64) };
  // widths are set in each element's own CSS px; Display size (CSS zoom) can differ between the top row and the column, so convert from screen px
  const zf = el => { const w = parseFloat(getComputedStyle(el).width) || 0, r = el.getBoundingClientRect().width; return w > 0 && r > 0 ? r / w : 1; };
  const setW = (el, px, extra = 0) => { for (const [k, v] of [['flex', 'none'], ['min-width', '0'], ['max-width', 'none']]) el.style.setProperty(k, v, 'important'); el.style.setProperty('width', (px / zf(el) + extra) + 'px', 'important'); };
  // the speaker Volume bar matches the bars below by CSS (its Mute hangs just right of the bar, app.css F70), so nothing here feeds back into the column width
  m.classList.add('f70'); setW(ms, ref.w);
  const mz = zf(m) || 1;
  for (let k = 0; k < 4; k++) { const d = cr.left + ref.dl - ms.getBoundingClientRect().left; if (Math.abs(d) < 0.25) break; m.style.paddingLeft = Math.max(0, (parseFloat(m.style.paddingLeft) || 0) + d / mz) + 'px'; }
  // 0.4.9 F70 fix: the master % and Mute sit in the same column as the bar's % and Mute (the mixer button follows the Mute)
  const row = bars[0]?.closest('.spk-row, .zp42-row'), bm = row?.querySelector('.mutebtn'), mm = m.querySelector('.mastermute');
  if (bm?.offsetParent && mm) for (let k = 0; k < 3; k++) { const d = bm.getBoundingClientRect().left - mm.getBoundingClientRect().left; if (Math.abs(d) < 0.25) break; mm.style.marginLeft = ((parseFloat(mm.style.marginLeft) || 0) + d / (zf(mm) || 1)) + 'px'; }
}
// 0.4.9 F70b: the regular Devices panel - the master track gets the left / right edges of the zone volume bars below it; MASTER sits on its own line
// above, the %, Mute and mixer get their own columns right of the track (app.css .dmaster.f70p). No zone bar on screen = the stock layout.
function alignPanelMaster(body) {
  const m = body.querySelector(':scope > .dmaster'), ms = m?.querySelector('.dvol-master input[type=range]'); if (!ms || !m.offsetParent) return;
  const bar = [...body.querySelectorAll('.qb42-vol .vbar input[type=range]')].find(i => i.offsetParent && i.getBoundingClientRect().width > 0);
  if (!bar) { m.classList.remove('f70p'); return; }
  const zf = el => { const w = parseFloat(getComputedStyle(el).width) || 0, r = el.getBoundingClientRect().width; return w > 0 && r > 0 ? r / w : 1; };
  const r = bar.getBoundingClientRect(), mr = m.getBoundingClientRect(), mz = zf(m) || 1;
  if (!m.classList.contains('f70p')) { m.classList.add('f70p'); m.style.setProperty('--f70l', Math.max(0, (r.left - mr.left) / mz) + 'px'); m.style.setProperty('--f70w', (r.width / mz) + 'px'); }
  for (let k = 0; k < 4; k++) {
    const a = ms.getBoundingClientRect(), dl = r.left - a.left, dw = r.width - a.width; if (Math.abs(dl) < 0.25 && Math.abs(dw) < 0.25) break;
    m.style.setProperty('--f70l', Math.max(0, (parseFloat(m.style.getPropertyValue('--f70l')) || 0) + dl / mz) + 'px');
    m.style.setProperty('--f70w', Math.max(40, (parseFloat(m.style.getPropertyValue('--f70w')) || 0) + dw / mz) + 'px');
  }
}
let f70raf = 0, f70ro = null;
const alignMasterSoon = body => { if (!HASWIN) return; cancelAnimationFrame(f70raf); f70raf = requestAnimationFrame(() => alignMaster(body));
  if (!f70ro && window.ResizeObserver) { f70ro = new ResizeObserver(() => { cancelAnimationFrame(f70raf); f70raf = requestAnimationFrame(() => alignMaster(body)); }); f70ro.observe(body); window.addEventListener('resize', () => { cancelAnimationFrame(f70raf); f70raf = requestAnimationFrame(() => alignMaster(body)); setTimeout(() => alignMaster(body), 250); }); new MutationObserver(() => { cancelAnimationFrame(f70raf); f70raf = requestAnimationFrame(() => alignMaster(body)); }).observe(body, { childList: true, subtree: true }); } };
// 0.4.9 F78: a phone is casting to "WavWiz – Everywhere": a slim bar on top of every Devices panel (sender, title, artist, Stop). Hidden otherwise.
const castKeep = new WeakMap();   // 0.4.9 F82: per container - the same cast bar node while the session lasts; only its song line is patched
export function castBar(S, ctl, host) {
  const c = S.cast; if (!c?.active) return null;
  const key = JSON.stringify([c.kind, c.name, canControl(S)]), old = host && castKeep.get(host);
  if (old && old._k === key && old.isConnected) { const sub = castBar0(S, ctl).querySelector('.cast42-sub'), cur = old.querySelector('.cast42-sub'); if ((sub?.outerHTML || '') !== (cur?.outerHTML || '')) { cur?.remove(); if (sub) old.append(sub); } return old; }
  const el = castBar0(S, ctl); el._k = key; if (host) castKeep.set(host, el); return el;
}
function castBar0(S, ctl) {
  const c = S.cast;
  const what = c.kind === 'spotify' ? 'Spotify Everywhere' : 'AirPlay Everywhere', song = [c.title, c.artist].filter(Boolean).join(' · ');
  const stop = h('button', { type: 'button', class: 'btn sm cast42-stop', 'data-act': 'caststop', title: 'End the phone\'s session; every zone goes back to its own queue',
    onclick: async ev => { ev.currentTarget.disabled = true; try { S.cast = await api('/cast/stop', { method: 'POST', body: {} }); } catch (e) { toast(e.message || 'Could not stop'); } (ctl.refreshAll || ctl.redraw)?.(); } }, 'Stop');
  ro(stop, canControl(S), 'Your access is view-only.');
  return h('div', { class: 'cast42', role: 'status', 'aria-label': `Casting: ${what}` }, h('span', { class: 'cast42-ico', 'aria-hidden': 'true' }, icon('wave')),
    h('b', { class: 'cast42-what ell' }, 'Casting: ', what), stop,
    c.sender || song ? h('span', { class: 'cast42-sub ell' }, c.sender ? h('span', { class: 'dim' }, 'From ' + c.sender + (song ? ' · ' : '')) : null, song || null) : null);
}
function masterRow(S, ctl) {
  const lvl = Math.round(masterLevel(S.zones)), pct = h('span', { class: 'pct' }, lvl + '%');
  const sl = h('input', { type: 'range', min: 0, max: 100, value: lvl, 'aria-label': 'Master volume', title: 'Raises or lowers every speaker that is on by the same factor (keeps the balance between rooms; never un-mutes)',
    oninput: ev => { pct.textContent = ev.target.value + '%'; clearTimeout(sl._t); sl._t = setTimeout(() => ctl.act('/zones/master', { set: +ev.target.value }), 120); } });
  ro(sl, canControl(S), 'Your access is view-only.');
  // 0.3.1 B7: the same track / thumb / length / % position as every device row (.dvol: slider, %, round Mute button) so the bars line up.
  // 0.3.2 F5 (supersedes B8): the slot right of the master bar is the same round mute icon button as the device rows; it mutes everything.
  // 0.3.8 L46: the master row also has All off / All on (every speaker; a view-only user sees them disabled)
  const setAll = on => { for (const z of S.zones || []) { if (!!z.enabled !== on) { z.enabled = on; ctl.act(`/zones/${z.id}`, { enabled: on }, 'PATCH'); } } ctl.redraw?.(); };
  const allOff = h('button', { type: 'button', class: 'btn sm mall alloff', 'data-act': 'alloff', title: 'Switch every speaker off', onclick: () => setAll(false) }, 'All off');
  const allOn = h('button', { type: 'button', class: 'btn sm mall allon', 'data-act': 'allon', title: 'Switch every speaker on', onclick: () => setAll(true) }, 'All on');
  ro(allOff, canControl(S), 'Your access is view-only.'); ro(allOn, canControl(S), 'Your access is view-only.');
  // 0.4.0: Link all = every zone plays the music of the zone being controlled (nothing to do when they already do)
  const linkAllBtn = (S.groups || []).length < 2 ? null : ro(h('button', { type: 'button', class: 'btn sm mall linkall', 'data-act': 'linkall', disabled: Z.allLinked(S.groups) ? '' : null, title: Z.allLinked(S.groups) ? 'Every zone already plays the same music' : 'Make every zone play the music of the zone you are controlling', onclick: () => Z.linkAll(Z.selectedGroupId(), ctl.refreshAll) }, icon('link'), ' Link all'), canControl(S), 'Your access is view-only.');
  return h('div', { class: 'dmaster' }, h('div', { class: 'dlbl' }, 'MASTER', h('span', { class: 'mvword' }, ' VOLUME')),
    h('div', { class: 'dvol dvol-master' }, Z.zoneChip('zs-master'), sl, pct, masterMuteButton(S, ctl), mixerButton('mutebtn dmixbtn')), h('div', { class: 'mallrow' }, allOff, allOn, linkAllBtn));
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
  const cur = Z.current();
  const zs = (S.groups || []).map(g => h('span', { class: 'zchip' + (g.active ? ' active' : '') + (cur?.kind === 'zone' && cur.id === g.id ? ' zsel-on' : ''), 'data-zone': g.name, 'data-group-id': g.id },
    ro(h('button', { class: 'zname ell', title: 'Play in this zone only', onclick: () => ctl.act(`/groups/${g.id}/activate`) }, g.name), can, 'Your access is view-only.'),
    h('span', { class: 'small dim' }, String(g.members)), (g.linked || []).length ? h('span', { class: 'zlinkic', title: Z.linkText(g.linked) }, icon('link')) : null, g.active ? h('span', { class: 'badge-active' }, 'ACTIVE') : null,
    compact ? null : ro(h('button', { class: 'zbtn zedit', 'aria-label': `Edit zone ${g.name}`, title: 'Edit zone', onclick: () => editZone(S, g, ctl.refreshAll) }, '✎'), admin),
    compact ? null : ro(h('button', { class: 'zbtn danger', 'aria-label': `Remove zone ${g.name}`, title: 'Remove zone', onclick: () => confirmRemoveZone(S, g, ctl.refreshAll) }, '✕'), admin)));
  const jb = S.jb?.own ? [h('span', { class: 'zchip' + (cur?.kind === 'jukebox' ? ' zsel-on' : ''), 'data-zone': 'Jukebox', 'data-group-id': 'jukebox' }, h('button', { class: 'zname ell', title: 'Control the Jukebox zone', onclick: () => Z.select(Z.JUKEBOX_KEY) }, 'Jukebox'), h('span', { class: 'small dim' }, String((S.jb.deviceIds || []).length)))] : [];
  return h('div', { class: 'dzones' }, h('span', { class: 'dlbl' }, 'ZONES'), zs.length ? [...zs, ...jb] : h('span', { class: 'small dim' }, 'None yet (optional groups, like “Downstairs”)'), add);
}
/** 0.4.0 phone Devices: one now-playing line per zone (linked zones share a line), then Split off / Link and Link all for the zone being controlled. Additions only. */
function zonesPhone(S, ctl) {
  const groups = S.groups || []; if (!groups.length) return null; const cur = Z.current(), can = canControl(S), seen = new Set(), rows = [];
  for (const g of groups) {
    const key = g.playbackId || 'default'; if (seen.has(key)) continue; seen.add(key);
    const mem = groups.filter(x => (x.playbackId || 'default') === key), sel = cur?.kind === 'zone' && mem.some(x => x.id === cur.id);
    rows.push(h('div', { class: 'zp-row' + (sel ? ' zsel-on' : ''), 'data-playback-id': key, 'data-groups': mem.map(x => x.id).join(',') },
      h('div', { class: 'zp-name' }, h('b', null, mem.map(x => x.name).join(' '), mem.length > 1 ? null : null), mem.length > 1 ? h('span', { class: 'zlinkic', title: Z.linkText(mem.map(x => x.name)) }, icon('link')) : null),
      Z.nowLine(g.now, { at: S._groupsAt || Date.now(), onSelect: () => Z.select('g:' + g.id), selected: sel })));
  }
  if (S.jb?.own) rows.push(h('div', { class: 'zp-row' + (cur?.kind === 'jukebox' ? ' zsel-on' : ''), 'data-playback-id': 'jukebox' }, h('div', { class: 'zp-name' }, h('b', null, 'Jukebox')), Z.nowLine(S.jb.now, { at: S._groupsAt || Date.now(), onSelect: () => Z.select(Z.JUKEBOX_KEY), selected: cur?.kind === 'jukebox' })));
  const g = cur?.kind === 'zone' ? groups.find(x => x.id === cur.id) : null, linked = g && (g.linked || []).length > 0;
  const btns = groups.length < 2 ? null : h('div', { class: 'zp-btns' },
    g ? ro(linked ? h('button', { type: 'button', class: 'btn zlinkbtn split', 'data-act': 'split', onclick: () => Z.splitOff(g, ctl.refreshAll) }, 'Split off ' + g.name)
      : h('button', { type: 'button', class: 'btn zlinkbtn link', 'data-act': 'link', onclick: ev => Z.linkMenu(ev.currentTarget, S, g, ctl.refreshAll) }, 'Link ' + g.name + '…'), can, 'Your access is view-only.') : null,
    ro(h('button', { type: 'button', class: 'btn linkall', 'data-act': 'linkall', disabled: Z.allLinked(groups) ? '' : null, onclick: () => Z.linkAll(Z.selectedGroupId(), ctl.refreshAll) }, 'Link all'), can, 'Your access is view-only.'));
  return h('div', { class: 'zphone' }, rows, btns);
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
  const admin = isAdmin(S), can = canControl(S), groups = orderedGroups(S.groups || []);
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
/** 0.3.6 K5: the card's Settings button in the expanded view: it points the way the settings open (left) and flips to the closing arrow while they are open. */
function settingsOpener(name, active, onToggle) {
  const b = h('button', { type: 'button', class: 'dexpand spk-opener' + (active ? ' on' : ''), 'aria-expanded': String(active), 'aria-label': `${active ? 'Hide' : 'Show'} settings for ${name}`, title: active ? 'Close the settings' : 'Settings: volume, cap, delay, balance, EQ, output, profiles…', onclick: ev => { ev.stopPropagation(); onToggle(); } });
  setChev(b, active ? 'r' : 'l'); return b;
}
/** Re-render one card / row in place after it opened or closed; focus stays on its Expand control. */
function toggleSettings(z, el, render) {
  setCardOpen(z.id, !openSet.has(z.id));
  const fresh = render(); el.replaceWith(fresh); fresh.querySelector('.dexpand')?.focus({ preventScroll: true });
  flushSoon();          // a redraw that waited for this card applies now
  return fresh;
}
/** A redraw (the list refreshes every few seconds) must not drop keyboard focus from a card's Expand control, or Esc would stop closing it. */
function keepExpandFocus(scope) {
  const a = document.activeElement;
  if (!a?.classList?.contains('dexpand') || !scope.contains(a)) return;
  const id = a.closest('[data-zone-id]')?.dataset.zoneId;
  if (id != null) queueMicrotask(() => scope.querySelector(`[data-zone-id="${id}"] .dexpand`)?.focus({ preventScroll: true }));
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
  return !!(dragEl && el.contains(dragEl)) || !!el.querySelector?.('.dragging') || el.classList?.contains('dragging');
}
/** May a live value be written into this control (it has no focus and is not being dragged)? */
const idle = el => !!el && document.activeElement !== el && !(dragEl && el.contains(dragEl));
/** Put kids into parent in order, keeping every element that is already there in place (a moved node would lose focus / an active drag). */
/** 0.4.9 F82: Devices must never jump to the top on a redraw, whatever triggered it (a speaker flapping online / offline, a level, a
 *  track, cast or receiver change...). keepScroll(el) remembers where the user left each scroller in / around el (keyed by its classes, so a
 *  rebuilt node gets it back) and the returned fn puts it back now and on the next frame. A scroll the user makes updates the memory; a
 *  scroll caused by a redraw (content briefly shorter, a node replaced) does not, so a later redraw with full content restores it too. */
const SCR = new Map(); let scrDrawing = 0;
const scrKey = x => x === document.scrollingElement ? 'page' : (typeof x.className === 'string' && x.className.trim() ? '.' + x.className.trim().split(/\s+/).filter(c => !/^(drop|over|hl|on|sel|focus)/.test(c)).map(c => CSS.escape(c)).join('.') : null);
let scrUser = 0; const userNow = () => performance.now() - scrUser < 400;   // a wheel / touch / key / scrollbar drag just now: that scroll is the user's
if (typeof document !== 'undefined' && document.addEventListener) for (const t of ['wheel', 'touchmove', 'keydown', 'pointerdown']) document.addEventListener(t, () => { scrUser = performance.now(); }, { capture: true, passive: true });
if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('scroll', ev => { if (scrDrawing && !userNow()) return; const x = ev.target === document ? document.scrollingElement : ev.target; const k = x?.nodeType === 1 && scrKey(x); if (k) SCR.set(k, x.scrollTop); }, true);
export function keepScroll(el, why = '') {
  if (!el?.querySelectorAll) return () => {};
  const scrollers = () => { const out = []; for (let x = el; x; x = x.parentElement) out.push(x); for (const x of el.querySelectorAll('*')) if (x.scrollHeight > x.clientHeight) out.push(x); return out; };
  for (const x of scrollers()) { const k = scrKey(x); if (k && x.scrollTop > 0 && !SCR.has(k)) SCR.set(k, x.scrollTop); }
  scrDrawing++;
  const put = () => { if (userNow()) return; for (const x of scrollers()) { const k = scrKey(x), t = k && SCR.get(k); if (t && x.isConnected && Math.abs(x.scrollTop - t) > 1 && x.scrollHeight - x.clientHeight >= t - 1) { scrLog('restore', k, x.scrollTop, t, why); x.scrollTop = t; } } };
  // content that fills in a moment later (art, a receiver block, the detail pane) made the scroller short for a while and the browser clamped
  // it toward the top: keep putting it back for 1.5 s unless the user scrolls meanwhile (that updates SCR and is respected)
  const late = (n = 0) => { if (n > 15) return; const want = scrollers().map(x => [x, scrKey(x)]).filter(([x, k]) => k && SCR.get(k) && x.scrollTop < SCR.get(k) - 1); if (!want.length) return; const was = want.map(([, k]) => SCR.get(k));
    setTimeout(() => { if (want.some(([, k], i) => SCR.get(k) !== was[i])) return; scrDrawing++; put(); requestAnimationFrame(() => { scrDrawing = Math.max(0, scrDrawing - 1); }); late(n + 1); }, 100); };
  return () => { put(); requestAnimationFrame(() => { put(); requestAnimationFrame(() => { scrDrawing = Math.max(0, scrDrawing - 1); late(); }); }); };
}
/** 0.4.9 F82: which redraw moved a Devices scroller (window.__wwScrollLog, last 50; console too with localStorage wavwiz.debug.scroll = 1). */
const scrLog = (...a) => { try { const L = (globalThis.__wwScrollLog ||= []); L.push([new Date().toISOString().slice(11, 23), ...a]); if (L.length > 50) L.shift(); if (localStorage.getItem('wavwiz.debug.scroll') === '1') console.info('[scroll]', ...a); } catch { /* node */ } };
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
    (z.outputs || []).map(o => [o.endpointDbId, o.deviceId, o.kind, o.name, !!o.connected, !!o.active, !!o.notCalibrated]),
    ((S.groups || []).flatMap(g => g.claims || []).find(c => c.deviceId === z.id) || {}).zone || '']);   // 0.4.1: a card rebuilds when a smaller zone takes / returns its speaker
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
    oninput: ev => { out.textContent = ev.target.value + '%'; },
    // 0.3.5 J3: an unlocked cap limited nothing, so moving the max-volume slider "did not lock". Setting a max below 100% now locks it right away.
    onchange: ev => { const c = +ev.target.value, lock = c < 100; ctl.act(`/zones/${z.id}/volcap`, { cap: c, locked: lock }, 'PUT'); toast(lock ? `${z.name}: max volume locked at ${c}%` : `${z.name}: no max volume`); } }), admin, 'Only an admin can change the max volume.');
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
  const calib = btn(z.badge === 'uncalibrated' ? 'Calibrate this speaker' : 'Calibrate', () => openCalibration(S, ctl.refreshAll, z.id, { quick: z.badge === 'uncalibrated' }), tune && z.connected && !z.reference, z.reference ? 'This is the reference speaker: the others are measured against it.' : tune ? 'This device is offline.' : OWN_HINT,
    'btn calbtn' + (z.badge === 'recheck' || z.badge === 'uncalibrated' ? ' primary' : ''));
  const eqHost = h('div', { class: 'dseq' }), histHost = h('div', { class: 'dshist' });   // 0.3.5 J9 #4/#5: Sound / EQ and Delay history fold out here
  const more = moreMenu(S, ctl, z, cur, histHost);
  const el = h('div', { class: 'dsettings', role: 'group', id: `dset-${z.id}`, 'aria-label': `${z.name} settings` },
    sec('OUTPUT', out.el),
    sec('MAX VOLUME', volCapControl(S, ctl, z, admin)),
    cur ? sec('DELAY', h('div', { class: 'ddelay' }, delay, calib, calHelpLink('calhelp-dev')), note) : null,   // 0.4.5 F29
    h('div', { class: 'dssec' }, h('div', { class: 'row dsbtns' },
      btn('Test sound', testSound, can && z.connected, can ? 'This device is offline.' : 'Your access is view-only.'),
      btn('Sound / EQ', ev => { const b = ev.currentTarget; if (eqHost.firstChild) { eqHost._eq?.destroy(); eqHost._eq = null; eqHost.replaceChildren(); b.classList.remove('on'); return; } b.classList.add('on'); eqHost._eq = centerEq(S, eqHost, { deviceId: cur?.deviceId }); }   /* 0.3.7 L7: the SAME EQ + All sound settings as the center, for this speaker */, tune && !!cur, cur ? OWN_HINT : 'No output yet.'),
      h('span', { class: 'grow' }), more)),
    eqHost, histHost,
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
function moreMenu(S, ctl, z, cur, histHost = null) {
  const admin = isAdmin(S);
  const wrap = h('div', { class: 'dmore' });
  const item = (label, fn, ok, hint, cls = '') => { const b = h('button', { type: 'button', role: 'menuitem', class: 'mitem' + (cls ? ' ' + cls : ''), onclick: () => { close(); fn(); } }, label); if (!ok) { b.disabled = true; b.title = hint; b.classList.add('ro'); b.setAttribute('aria-disabled', 'true'); } return b; };
  const menu = h('div', { class: 'dmenu', role: 'menu', hidden: true },
    item('Rename', () => rename(S, ctl, z, wrap), admin, ADMIN_HINT),
    item(z.reference ? 'Reference speaker ✓' : 'Set as reference', () => setReference(ctl, z), admin && !z.reference, z.reference ? 'Already the reference speaker' : ADMIN_HINT),
    item('Delay history', () => delayHistory(S, ctl, z, cur, histHost), !!cur, 'No output yet.'),
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
  const el = h('div', { class: 'dsconn small dim', title: z.isWeb ? 'A browser cannot measure its own sync error. Calibrate it (mic, or By ear) or drag Delay while music plays - it applies live.' : 'Sync error shows once something plays.' }, bits.join(' · '));
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
/** 0.3.5 J9 #4: the delay history folds out inside the open card (no window). */
async function delayHistory(S, ctl, z, o, host) {
  if (!o) return;
  if (host?.firstChild) { host.replaceChildren(); return; }
  let rows = []; try { rows = await api(`/outputs/${encodeURIComponent(o.deviceId)}/calibrations`); } catch (e) { return toast(e.message, true); }
  const tune = canTune(S, z);
  const body = rows.length ? h('table', { class: 'tbl dhist' }, h('thead', null, h('tr', null, ['When', 'Delay', 'How', ''].map(x => h('th', null, x)))), h('tbody', null, rows.map(r =>
    h('tr', null, h('td', null, new Date(r.measuredAt).toLocaleString('en-US')), h('td', null, `${Math.round(r.latencyMs)} ms`), h('td', null, r.method), h('td', null, tune ? h('button', { class: 'btn sm', onclick: async () => { try { await api(`/calibrations/${r.id}/restore`, { method: 'POST' }); toast('Restored'); host.replaceChildren(); ctl.refreshAll(); } catch (e) { toast(e.message, true); } } }, 'Use this') : null))))) : h('p', { class: 'dim small' }, 'No saved delays yet.');
  const el = h('div', { class: 'dssec dhistbox' }, h('div', { class: 'row' }, h('span', { class: 'dlbl grow' }, 'DELAY HISTORY · ' + outputLabel(o)), h('button', { type: 'button', class: 'linkbtn', onclick: () => host.replaceChildren() }, 'Hide')), body);
  if (host) host.replaceChildren(el); else toast('Open the speaker card to see its delay history');
}
/** 0.3.5 J9 #3: rename in place - the card's name becomes a text field (Enter saves, Esc cancels). */
function rename(S, ctl, z, from) {
  const card = from?.closest?.('[data-zone-id]') || document.querySelector(`.dc3[data-zone-id="${z.id}"]`); const nm = card?.querySelector('.dname');
  if (!nm) return;
  const input = h('input', { type: 'text', class: 'drename', value: z.name, maxlength: 40, 'aria-label': 'Device name' });
  const done = () => { box.replaceWith(nm); flushSoon(); };
  const save = async () => { const v = input.value.trim(); if (!v || v === z.name) return done(); try { await api(`/zones/${z.id}`, { method: 'PATCH', body: { name: v } }); toast('Renamed'); done(); ctl.refreshAll(); } catch (e) { toast(e.message, true); } };
  input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done(); } });
  const box = h('span', { class: 'drenamebox row' }, input, h('button', { type: 'button', class: 'btn sm primary', onclick: save }, 'Save'), h('button', { type: 'button', class: 'btn sm', onclick: done }, 'Cancel'));
  nm.replaceWith(box); input.focus(); input.select();
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
    // 0.4.3 #8: always a picker ("Output device"), disabled when there is nothing else to choose
    el = h('select', { class: 'dsel dsingle', 'aria-label': `${z.name} output device`, disabled: true, title: 'This is the only output this device reports' },
      h('option', { selected: true }, z.isWeb ? 'This browser’s default output' : cur ? outputLabel(cur) : 'No output reported yet'));
  } else {
    el = h('select', { class: 'dsel', 'aria-label': `${z.name} output`, onchange: ev => pick(ev.target.value) }, ...outs.map(o => h('option', { value: o.endpointDbId, selected: o === cur, disabled: !o.connected }, `${outputLabel(o)}${o.connected ? '' : ' (unplugged)'}`)));
  }
  if (el.tagName === 'SELECT' && !el.disabled) ro(el, can, hint);
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

/** 0.4.2: the tree + detail pane, shared by the side panel and the phone page. X = { spk, zsel, size, draw(force), setSpk(id) } (live state of the caller). */
/** 0.4.9 F82: copy the live parts (now-playing lines, volume bars and %, tag rows) of a freshly built tree into the shown one, node for
 *  node; 0 (caller rebuilds) when the two do not line up. A part the user is using (focus, a dragged slider) is left alone. */
const LIVE42 = ['.zl-now', '.qb42-vol', '.sp42-v', '.sp42-tags', '.ztagrow'];
export function patchLive42(cur, fresh) {
  const pairs = [];
  for (const sel of LIVE42) { const a = cur.querySelectorAll(sel), b = fresh.querySelectorAll(sel); if (a.length !== b.length) return 0; a.forEach((x, i) => pairs.push([x, b[i]])); }
  const ae = document.activeElement; let all = 1;
  for (const [x, y] of pairs) { if (x.outerHTML === y.outerHTML) continue; if ((ae && x.contains(ae)) || x.querySelector('input:active')) { all = 2; continue; } x.replaceWith(y); }
  return all;   // 1 = all patched, 2 = some part in use (patched later), 0 = rebuild
}
function tree42Kit(S, ctl, X) {
  // 0.4.2: the tree is rebuilt only when what it shows changed (a position tick alone repaints at most every 10 s), and never while a drag or slider is in use
  let tnode = null, tsig = '', tlive = '';
  // 0.4.9 F82: sig42 = what shapes the tree (a change rebuilds it); live42 = values patched in place (levels, what plays, the cast tags) -
  // an AirPlay session sends those all the time (metadata, progress, the phone's volume) and each used to rebuild the whole tree
  const live42 = () => JSON.stringify([S.cast?.active ? [S.cast.kind, S.cast.zones, S.cast.name] : 0, (S.zones || []).map(z => Math.round(z.volume)),
    (S.groups || []).map(g => [g.now?.state, g.now?.title, g.now?.artist, g.now?.durationMs, Math.floor((g.now?.positionMs || 0) / 10000), (g.now?.positionMs || 0) > 0]), S.jb?.own ? [S.jb.now?.title, S.jb.now?.state] : null]);
  const sig42 = () => JSON.stringify([!!S.cast?.active, (S.zones || []).map(z => [z.id, z.name, z.enabled, z.connected, z.muted, z.volLocked, z.volCap, z.room?.state, z.reference, chosenOutput(z)?.notCalibrated, z.outputs?.length]),
    (S.groups || []).map(g => [g.id, g.name, g.deviceIds, g.playbackId, g.linked, g.online]), Z.current()?.key, X.spk, X.zsel, isAdmin(S), canControl(S), S.jb?.deviceIds, S.jb?.own, S.jb?.showInDevices, S.jb?.running, orderedGroups(S.groups || []).map(g => g.id)]);   // 0.4.6 F30: a zone reorder (local) redraws the tree
  const st42 = { get spk() { return X.spk; }, get zone() { return X.zsel; },
    onZone: id => { X.zsel = id; X.spk = null; try { sessionStorage.removeItem('wavwiz.spk'); } catch { /* private mode */ } if (X.size === 'expanded' || X.size === 'phone') X.draw(true); else { X.f69from = X.size; ctl.setDevSize?.('expanded'); } },
    onSpk: id => { const z = (S.zones || []).find(x => x.id === id); const g = (S.groups || []).find(x => (x.deviceIds || []).includes(id)); X.zsel = g ? g.id : null; if (X.size === 'expanded' || X.size === 'phone') X.setSpk(id); else { X.f69from = X.size; X.spk = id; try { sessionStorage.setItem('wavwiz.spk', String(id)); } catch { /* private mode */ } ctl.setDevSize?.('expanded', id); } void z; } };
  const kit42 = { capBar, onPill, ro, tagEls3, cardTags3, zoneTags3, zoneMembers, zoneMuted, zoneOn, zoneLevel, zoneCap, canControl, isAdmin, promptName, confirmRemoveZone, canTune, dotClass, orderedGroups, openCalibration, forget, jukebox: jukeboxCard, receiverBlock };
  const treeNode = force => {
    const sg = sig42(), lv = live42(); if (!force && tnode && sg === tsig) { if (lv === tlive) return tnode; const r = patchLive42(tnode, treeEl(S, ctl, kit42, st42)); if (r === 1) tlive = lv; if (r) return tnode; }
    const par = tnode?.parentElement, top = par?.scrollTop || 0, ae = document.activeElement, keep = tnode && ae && tnode.contains(ae) ? { id: ae.closest('[data-device-id]')?.dataset.deviceId, gid: ae.closest('[data-group-id]')?.dataset.groupId, cls: typeof ae.className === 'string' ? ae.className.trim().split(/\s+/)[0] : '' } : null;
    tnode = treeEl(S, ctl, kit42, st42); tsig = sg; tlive = lv; tnode._top = top;
    if (keep) queueMicrotask(() => { if (document.activeElement?.closest?.('.tree42')) return;   // 0.4.9 F82: the same control (speaker, else zone, by its first class) gets focus back
      const scope = keep.id ? tnode.querySelector(`[data-device-id="${keep.id}"]`) : keep.gid ? tnode.querySelector(`[data-group-id="${keep.gid}"]`) : tnode;
      const t = (keep.cls && scope?.querySelector('.' + CSS.escape(keep.cls))) || (keep.id ? scope?.querySelector('.sp42-n') : null); t?.focus({ preventScroll: true }); });
    return tnode;
  };
  const restoreScroll = col => { const t = tnode?._top; if (t) requestAnimationFrame(() => { col.scrollTop = t; }); };
  // the middle pane: follows the selected speaker, else the selected zone, else the Controlling zone (a panel for a speaker is kept and patched, never rebuilt, so its EQ is not reloaded)
  function paintDetail(dcol, groups) {
    const cs = Z.current(), spZ = X.spk != null ? S.zones.find(z => z.id === X.spk) : null; if (X.spk != null && !spZ && S.zones.length) X.spk = null;
    const spG = spZ ? groups.find(g => (g.deviceIds || []).includes(spZ.id)) : null;
    const jbSel = !spZ && X.zsel === 'jukebox' && S.jb && (S.jb.own || isAdmin(S));   // 0.4.9 F76: the Jukebox zone settings (speaker picker)
    const zg = jbSel ? null : spZ ? spG : (groups.find(g => g.id === X.zsel) || (cs?.kind === 'zone' ? groups.find(g => g.id === cs.id) : null) || groups[0] || null);
    // 0.4.9 F69: desktop way out of a zone / speaker settings pane - an accent Back (speaker -> its zone's list; zone -> back where you came from)
    const deskBack = X.size === 'phone' || (X.spk == null && X.zsel == null) ? null : h('button', { type: 'button', class: 'btn sm d42-back', 'data-act': 'd42-back', title: 'Back to the Devices list',
      onclick: () => { const from = X.f69from; X.f69from = null; X.zsel = null; if (X.spk != null) X.setSpk(null); else X.draw(true); if (from && from !== 'expanded') ctl.setDevSize?.(from); } }, '‹ Back');
    const crumbEl = h('div', { class: 'dpath42', 'aria-label': 'Selected' }, deskBack, h('b', null, jbSel ? 'Jukebox' : crumb(zg?.name || (spZ ? 'Unassigned' : ''), spZ?.name) || 'Nothing selected'));
    const hint = h('div', { class: 'small dim dhint42' }, dcol.closest('.e42') ? HINT42 : HINT42.replace(' on the right', ''));
    const key = jbSel ? 'jb' : spZ ? 's' + spZ.id : zg ? 'z' + zg.id : 'none';
    let pnl = dcol.querySelector('.d42-pane');
    if (!pnl || pnl.dataset.key !== key || (!spZ && pnl._sig !== sig42() && !pnl.contains(document.activeElement))) {
      pnl?.firstChild?._destroy?.();
      pnl = h('div', { class: 'd42-pane', 'data-key': key });
      if (spZ) {
        const sp = speakerSettings(S, ctl, spZ, { onDone: () => X.setSpk(null), outputPicker: zz => outputPicker(S, ctl, zz), promptName, onRename: z => promptName(`Rename ${z.name}`, z.name, async v => { await api(`/zones/${z.id}`, { method: 'PATCH', body: { name: v } }); ctl.refreshAll?.(); }),
          tags: z => tagEls3(cardTags3(z)), zoneRow: z => zoneRow42(z, groups),
          calibrate: zz => h('button', { type: 'button', class: 'btn calbtn' + (zz.badge === 'recheck' || zz.badge === 'uncalibrated' ? ' primary' : ''), disabled: !(canTune(S, zz) && zz.connected && !zz.reference) || undefined, title: zz.reference ? 'This is the reference speaker.' : '', onclick: () => openCalibration(S, ctl.refreshAll, zz.id, { quick: true }) }, 'Calibrate'),
          calhelp: () => calHelpLink('calhelp-dev'),   // 0.4.5 F29
          more: zz => moreMenu(S, ctl, zz, chosenOutput(zz), null) });
        pnl.append(sp);
      } else if (jbSel) { jbUserOpen = true; const c = jukeboxCard(S, ctl); if (c) { c.classList.add('jbpane76'); pnl.append(h('div', { class: 'pane-h dsec-h' }, h('span', null, 'JUKEBOX ZONE SETTINGS')), c); } }
      else if (zg) pnl.append(zonePane(S, ctl, kit42, zg, st42)); else pnl.append(h('p', { class: 'dim small pad' }, 'No zones yet. Use + in the tree to create one.'));
      pnl._sig = sig42();
    } else if (spZ) pnl.firstChild?._patch?.(spZ);
    reconcile(dcol, [crumbEl, hint, pnl]);
  }
  /** The speaker page's ZONE row: which zone it is in + Move to zone. */
  function zoneRow42(z, groups) {
    const mine = groups.find(g => (g.deviceIds || []).includes(z.id)), admin = isAdmin(S);
    const sel = h('select', { class: 'spk-zsel', 'aria-label': 'Move to zone', 'data-act': 'move-zone', onchange: async ev => { const v = ev.target.value, to = v === '' ? null : +v; try { for (const op of movePlan(S.groups, z.id, to)) await api(`/groups/${op.id}`, { method: 'PATCH', body: { name: op.name, deviceIds: op.deviceIds } }); toast(to == null ? `${z.name} is now unassigned` : `${z.name} moved`); ctl.refreshAll?.(); } catch (e) { toast(e.message, true); } } },
      h('option', { value: '', selected: !mine }, 'Unassigned'), ...groups.map(g => h('option', { value: g.id, selected: mine?.id === g.id }, g.name)));
    return h('div', { class: 'spk-zonerow' }, h('span', { class: 'dlbl' }, 'ZONE'), h('b', { class: 'spk-zname' }, mine?.name || 'Unassigned'), h('span', { class: 'dlbl' }, 'MOVE TO ZONE'), ro(sel, admin, 'Only an administrator can change zones.'));
  }
  return { treeNode, restoreScroll, paintDetail, sig42 };
}

/** Right-hand panel of the desktop layout in three sizes. ctl.setDevSize(size, highlightZoneId) switches size. */
export function devicesPanel(S, ctl) {
  const root = h('section', { class: 'devpanel', 'aria-label': 'Devices and zones' }), body = h('div', { class: 'devbody' });
  let size = loadDevSize(), hl = null, zpick = loadZonePick(), zedit = null;
  let spk = (() => { try { const v = sessionStorage.getItem('wavwiz.spk'); return v == null ? null : +v; } catch { return null; } })();   // 0.3.6 K5: the speaker whose settings are open
  const setSpk = id => { spk = id; try { if (id == null) sessionStorage.removeItem('wavwiz.spk'); else sessionStorage.setItem('wavwiz.spk', String(id)); } catch { /* private mode */ } draw(true); };
  tagNav.panel = { spk: id => { if (size === 'expanded') setSpk(id); else { spk = id; try { sessionStorage.setItem('wavwiz.spk', String(id)); } catch { /* private mode */ } ctl.setDevSize?.('expanded', id); } },
    zone: gid => { zsel = gid; spk = null; try { sessionStorage.removeItem('wavwiz.spk'); } catch { /* private mode */ } if (size === 'expanded') draw(true); else ctl.setDevSize?.('expanded'); } };   // 0.4.4 F19
  const setPick = v => { zpick = v; saveZonePick(v); draw(true); };
  const setEdit = v => { zedit = v; draw(true); };
  // 0.2.2 T5: a true mirror of the Library header. Library = title … Esc, arrow, Expand (outer edge); Devices = Expand, arrow (outer edge), Esc, title …
  const colBtn = h('button', { class: 'plus devcol', 'aria-label': arrowLabel('Devices', 'standard'), 'aria-expanded': 'true', title: 'Fold / open the Devices panel ( ] )', onclick: ev => { ev.stopPropagation(); ctl.toggleDev?.(); } }); setChev(colBtn, 'r');
  const expBtn = h('button', { class: 'plus devexp', 'aria-label': expandLabel('Devices', false), 'aria-pressed': 'false', title: 'Expand', onclick: ev => { ev.stopPropagation(); ctl.toggleDevExpanded?.(); } }, icon(expandIcon('right', false)));
  const count = h('span', { class: 'small dim devcount' });
  // 0.2.3 U7: the DEVICES title sits at the right edge, the true mirror image of LIBRARY at the left edge of the Library header
  // 0.3.0 §6: two controls kept apart - Expand on the inner edge (becomes "⤡ Esc"), chevron on the outer edge; a 30 px rail with icon + title
  root.append(h('div', { class: 'prail', 'aria-hidden': 'true' }, h('span', { class: 'prail-ic' }, '◉'), h('span', { class: 'prail-t' }, 'DEVICES'), h('span', { class: 'prail-n', title: 'Devices online / total' })),
    h('div', { class: 'pane-h devhead' }, expBtn, h('button', { type: 'button', class: 'btn sm libswap', title: 'Show the queue here again', onclick: ev => { ev.stopPropagation(); ctl.libSwap?.(false); } }, '‹ Queue'), h('span', { class: 'grow devtitle' }), count, h('span', { class: 'devtitle' }, 'DEVICES'), colBtn), body);   // 0.3.5 J11
  root.addEventListener('click', ev => { if (size === 'collapsed' && !ev.target.closest('.devcol')) ctl.toggleDev?.(false); });
  const setSize = (s, highlight = null) => {
    size = s; hl = highlight;
    setChev(colBtn, s === 'collapsed' ? 'l' : 'r'); colBtn.setAttribute('aria-expanded', String(s !== 'collapsed'));
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
  const removedShown = () => [...body.querySelectorAll('[data-zone-id].sp42, .dcard[data-zone-id]')].some(el => !S.zones.some(z => String(z.id) === el.dataset.zoneId));
  redrawers.add(() => { if (pending) { clearTimeout(pending); pending = 0; draw(); } });
  const kid = (parent, cls) => [...parent.children].find(e => e.classList.contains(cls));
  const X = { get spk() { return spk; }, set spk(v) { spk = v; }, get zsel() { return zsel; }, set zsel(v) { zsel = v; }, get size() { return size; }, draw: f => draw(f), setSpk: id => setSpk(id) };
  let zsel = null;
  const { treeNode, restoreScroll, paintDetail } = tree42Kit(S, ctl, X);
  // 0.4.9 F82: any redraw keeps every scroll position (the panel's own scrollers, the expanded columns, the phone page .desk and the page itself)
  function draw(force) { const back = keepScroll(root, 'panel ' + size + (force ? ' forced' : '')); try { draw0(force); } finally { back(); } }
  function draw0(force) {
    if (root.isConnected && getComputedStyle(root).display === 'none') { if (body.querySelector('.tree42')) body.replaceChildren(); return; }   // 0.4.2: the phone layout hides this panel; only the Devices page draws the tree
    if (!force && removedShown()) force = true;
    if (!force && body.querySelector('.tree42.dragging, .tree42 .vbar input:active, .spkset .spk-range:active')) return later();
    if (!force && body.querySelector('.dmenu:not([hidden])')) return later();
    clearTimeout(pending); pending = 0; keepExpandFocus(body);
    const busy = { v: false };
    count.textContent = `${S.zones.length} device${S.zones.length === 1 ? '' : 's'} • ${S.zones.filter(z => z.connected).length} online`;
    if (size === 'collapsed') { body.replaceChildren(); return; }
    // 0.4.2: ONE tree (zones hold their speakers). Standard = the tree; Expanded = Scenes & Schedules | detail pane | the same tree.
    const groups = orderedGroups(S.groups || []);
    if (size === 'expanded') {
      body.classList.remove('rich');
      const etop = kid(body, 'dexp-top') || h('div', { class: 'dexp-top' }), emain = kid(body, 'dexp-main') || h('div', { class: 'dexp-main e42' });
      emain.classList.add('e42'); emain.classList.remove('e1', 'spk-open');
      reconcile(etop, [castBar(S, ctl, etop), keepSection(kid(etop, 'dmaster'), masterRow(S, ctl), busy), btHint(S, ctl), keepMic(kid(etop, 'dmicline'), S)].filter(Boolean));
      alignMasterSoon(body);
      const sscol = kid(emain, 'sscol') || h('div', { class: 'sscol ecol' });
      if (!sscol.firstChild) sscol.append(scenesColumn(S, { refresh: ctl.refreshAll, zones: () => S.zones, groups: () => S.groups || [] })); else sscol.firstChild._refresh?.();
      const dcol = kid(emain, 'dcol42') || h('div', { class: 'dcol42 ecol', 'aria-label': 'Settings of the selected zone or speaker' });
      paintDetail(dcol, groups);
      const tcol = kid(emain, 'tcol42') || h('div', { class: 'tcol42 ecol' });
      const tn = treeNode(force); if (tcol.firstChild !== tn) { tcol.replaceChildren(tn); restoreScroll(tcol); }
      reconcile(emain, [sscol, dcol, tcol]);
      reconcile(body, [etop, emain]);
      if (busy.v) later();
      return;
    }
    // 0.3.3 G10 (slim): one-line master, Speakers / Unassigned / Zones subheads with counts, 2-line rows (~56 px), output name in the tooltip
    // 0.3.5 J4: three-line cards for speakers and zones (name + OFF|ON pill, one tag row, full-width bar + mute)
    reconcile(body, [castBar(S, ctl, body), keepSection(kid(body, 'dmaster'), masterRow(S, ctl), busy), btHint(S, ctl), keepMic(kid(body, 'dmicline'), S), (() => { const n = treeNode(force); const w = kid(body, 'tcol42s') || h('div', { class: 'tcol42s' }); if (w.firstChild !== n) { w.replaceChildren(n); } return w; })(), ssCompact(S, ctl)]);
    alignMasterSoon(body);
    // 0.3.8 L46 (option A): with few devices the cards grow and show what is playing in each; many devices stay compact
    const rich = S.zones.length + groups.length <= 8; body.classList.toggle('rich', rich);
    const it = S.now?.item, np = it?.title ? `▶ ${it.title}${it.artist ? ' · ' + it.artist : ''}` : 'Nothing playing'; body.style.setProperty('--np', JSON.stringify(np));
    if (busy.v) later();
  }
  setSize(size); if (HASWIN) window.addEventListener('wavwiz:devredraw', () => whenIdle(draw, draw));
  return { el: root, draw, setSize, get size() { return size; }, setCollapsed: c => setSize(c ? 'collapsed' : (size === 'collapsed' ? 'standard' : size)) };
}

/** 0.3.9 L51: "Now playing in each zone" strip of the expanded view. The server has ONE stream, so every zone that is on while something plays shows that
 *  one song (art, title, artist, progress); a zone that is off says so; with nothing playing every zone says "Nothing playing". Pure data in, element out. */
export function zoneNowTiles(S, groups) {
  const it = S.now?.item, st = S.now?.state, playing = !!it && (st === 'playing' || st === 'paused');
  const prog = playing && S.now?.durationMs ? Math.min(100, Math.round((S.now.positionMs || 0) / S.now.durationMs * 100)) : 0;
  const own = (g, on) => { // 0.4.0: each zone shows ITS playback group's song (the server sends it as g.now); older data falls back to the one house stream
    const n = g.now; if (!n) return null; const has = !!n.title && n.state !== 'stopped';
    if (!has) return { id: g.id, name: g.name, state: on ? 'idle' : 'off', title: on ? 'Nothing playing' : 'Off - nothing playing', artist: '', progress: 0, item: null, linked: (g.linked || []).length > 0 };
    const item = { kind: n.kind, refId: n.refId, artUrl: n.artUrl, title: n.title };
    return { id: g.id, name: g.name, state: n.state, title: n.title, artist: n.artist || '', progress: n.durationMs ? Math.min(100, Math.round((n.positionMs || 0) / n.durationMs * 100)) : 0, item, linked: (g.linked || []).length > 0 };
  };
  return (groups || []).map(g => {
    const on = zoneOn(S.zones || [], g), o = own(g, on); if (o) return on || o.item ? o : { ...o, state: 'off', title: 'Off - nothing playing' };
    if (playing && on) return { id: g.id, name: g.name, state: st, title: it.title || 'Untitled', artist: it.artist || '', progress: prog, item: it };
    return { id: g.id, name: g.name, state: on ? 'idle' : 'off', title: on ? 'Nothing playing' : 'Off - nothing playing', artist: '', progress: 0, item: null };
  });
}
function zonesNowStrip(S, groups) {
  const tiles = zoneNowTiles(S, groups), cur = Z.current();
  if (S.jb?.own) { const n = S.jb.now, has = !!n?.title && n.state !== 'stopped'; tiles.push({ id: 'jukebox', name: 'Jukebox', state: has ? n.state : 'idle', title: has ? n.title : 'Nothing playing', artist: has ? n.artist || '' : '', progress: has && n.durationMs ? Math.min(100, Math.round((n.positionMs || 0) / n.durationMs * 100)) : 0, item: has ? { kind: n.kind, refId: n.refId, artUrl: n.artUrl, title: n.title } : null, key: Z.JUKEBOX_KEY }); }
  return h('section', { class: 'znow', 'aria-label': 'Now playing in each zone' },
    h('div', { class: 'pane-h dsec-h znow-h' }, h('span', null, 'NOW PLAYING IN EACH ZONE'), h('span', { class: 'small dim' }, String(tiles.length)), h('span', { class: 'grow' }), h('span', { class: 'small dim' }, S.now?.state === 'playing' ? 'live' : '')),
    h('div', { class: 'znow-row' }, tiles.length ? tiles.map(t => {
      const url = t.item ? itemArtUrl(t.item, 96) : null;
      const key = t.key || 'g:' + t.id;
      return h('div', { class: 'znow-tile ' + t.state + (cur?.key === key ? ' zsel-on' : ''), 'data-group-id': t.id, role: 'button', tabindex: 0, title: 'Control this zone', onclick: () => Z.select(key), onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); Z.select(key); } } },
        h('div', { class: 'znow-art', style: url ? `background-image:url("${url}")` : '' }),
        h('div', { class: 'znow-t' }, h('div', { class: 'znow-z' }, t.name, t.linked ? h('span', { class: 'znow-link', title: 'Linked: plays the same song as another zone' }, icon('link')) : null), h('div', { class: 'znow-s ell' }, t.title), h('div', { class: 'znow-a ell' }, t.artist), t.item ? h('div', { class: 'znow-p', style: `--p:${t.progress}%` }, h('i')) : null));
    }) : h('p', { class: 'dim small pad' }, 'Create a zone to see what plays in each.')));
}

/** The Devices & zones page (phone tab / narrow screens): master + zones on top, then one Expanded card per device. */
export function devicesView(S, ctl) {
  const root = h('div', { id: 'p-zones' }), top = h('div'), list = h('div', { class: 'dgrid one' }), foot = h('div', { class: 'row wrap', style: 'margin-top:6px' });
  root.append(h('h2', { class: 'pagetitle' }, 'Devices & zones'), top, list, foot);
  let pending = 0;      // 0.2.3 U11: same rule as the side panel - retry a skipped redraw, never keep a removed device on screen
  const later = () => { clearTimeout(pending); pending = setTimeout(() => { pending = 0; draw(); }, 700); };
  redrawers.add(() => { if (pending) { clearTimeout(pending); pending = 0; draw(); } });
  let spk = (() => { try { const v = sessionStorage.getItem('wavwiz.spk.phone'); return v == null ? null : +v; } catch { return null; } })(), zsel = null;
  const X = { get spk() { return spk; }, set spk(v) { spk = v; }, get zsel() { return zsel; }, set zsel(v) { zsel = v; }, size: 'phone', draw: () => draw(), setSpk: id => { spk = id; if (id == null) zsel = null; try { id == null ? sessionStorage.removeItem('wavwiz.spk.phone') : sessionStorage.setItem('wavwiz.spk.phone', String(id)); } catch { /* private mode */ } draw(); } };
  tagNav.page = { spk: id => X.setSpk(id), zone: gid => { X.zsel = gid; X.spk = null; draw(); } };   // 0.4.4 F19
  const T = tree42Kit(S, ctl, X), pdet = h('div', { class: 'dcol42 pd42', 'aria-label': 'Settings of the selected zone or speaker' });
  // 0.4.6 F41: zone / speaker settings open as a full-width sheet over the tree (header: Back + title + Done); the tree stays underneath, so closing
  // always lands on it where it was. Fits 390 px.
  // 0.4.9 F69: the sheet is a history entry, so the browser / iOS back gesture closes it too
  const closeSheet = () => { if (history.state?.pd42) { history.back(); return; } X.zsel = null; X.setSpk(null); };
  window.addEventListener('popstate', () => { if ((X.spk != null || X.zsel != null) && !history.state?.pd42) { X.zsel = null; X.setSpk(null); } });
  const ptitle = h('b', { class: 'pd42-title ell' });
  const pwrap = h('div', { class: 'pd42-wrap pd42-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' },
    h('div', { class: 'pd42-head' }, h('button', { type: 'button', class: 'btn sm pd42-close', 'data-act': 'pd-close', onclick: closeSheet }, '‹ Back'), ptitle,
      h('button', { type: 'button', class: 'btn sm pd42-done', 'data-act': 'pd-done', onclick: closeSheet }, 'Done')), pdet);
  pwrap.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.stopPropagation(); closeSheet(); } });
  let wasSel = spk != null, treeTop = 0;
  const scroller = el => { for (let e = el.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowY; if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e; } return document.scrollingElement; };
  function draw() { const back = keepScroll(root, 'page'); try { draw0(); } finally { back(); } }   // 0.4.9 F82
  function draw0() {
    const gone = [...list.querySelectorAll('[data-zone-id]')].some(el => !S.zones.some(z => String(z.id) === el.dataset.zoneId));
    if (!gone && root.querySelector('.dmenu:not([hidden])')) return later();
    if (!gone && root.querySelector('.tree42.dragging, .tree42 .vbar input:active, .spkset input[type=range]:active, .spkset .spk-range:active')) return later();   // 0.4.4 F23: never under a dragged slider
    clearTimeout(pending); pending = 0; keepExpandFocus(list);
    const busy = { v: false };      // 0.2.3 fix: cards are kept and patched in place, exactly like the side panel
    reconcile(top, [castBar(S, ctl, top), keepSection(top.querySelector(":scope > .dmaster"), masterRow(S, ctl), busy), keepMic(top.querySelector(".dmicline"), S)].filter(Boolean));
    const sel42 = X.spk != null || X.zsel != null;
    // 0.4.6 F41: opening a speaker / zone remembers where the tree was scrolled; closing returns to the tree at that spot (the standalone PWA has no Back)
    const sc = scroller(root);
    if (sel42 && !wasSel) { treeTop = sc ? sc.scrollTop : 0; if (!history.state?.pd42) try { history.pushState({ ...(history.state || {}), pd42: 1 }, ''); } catch { /* sandboxed */ } }
    if (!sel42 && wasSel) { const t = treeTop; requestAnimationFrame(() => { const c = scroller(root); if (c) c.scrollTop = t; }); }
    wasSel = sel42;
    if (sel42) { T.paintDetail(pdet, orderedGroups(S.groups || [])); const z = X.spk != null ? (S.zones || []).find(x => x.id === X.spk) : null, g = X.zsel != null ? (S.groups || []).find(x => x.id === X.zsel) : null;
      ptitle.textContent = z ? `Speaker: ${z.name}` : g ? `Zone: ${g.name}` : 'Settings'; pwrap.setAttribute('aria-label', ptitle.textContent); }
    document.documentElement.classList.toggle('pd42-open', sel42);
    reconcile(list, [T.treeNode(false), sel42 ? pwrap : null].filter(Boolean));   // 0.4.4 F23: the same wrap every tick (a new one re-attached the open speaker page: flash, scroll + focus lost)
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
  const zs = orderedZones(zones || []), gs = groups || [];
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
  row = h('div', { class: 'dcard srow' + (z.enabled ? '' : ' off') + (z.connected ? '' : ' gone') + (z.muted ? ' muted' : '') + (hl ? ' hl' : '') + (dim ? ' dimmed' : '') + (cl ? ' claimed' : '') + (open ? ' dset' : ''), 'data-room': z.name, 'data-zone-id': z.id },
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

// ---- 0.3.5 J3 / J4: three-line cards (56 px) for speakers AND zones - (1) dot, name, labeled OFF|ON pill; (2) one tag row; (3) full-width bar + mute.
// J3: a locked max volume makes the bar visibly different (second theme color, hatched track past the cap, a marker at the cap) and the thumb
// stops at the cap while dragging (the server clamps every source as well).
/** The cap a bar must respect, or null (pure). Locked caps only: an unlocked cap limits nothing. */
export const capOf = z => (z && z.volLocked && z.volCap != null && z.volCap < 100 ? Math.max(0, Math.min(100, z.volCap)) : null);
/** The highest level a zone bar can reach = the average of each member's limit (pure; null when no member is capped). */
export function zoneCap(zones, g) {
  const ms = zoneMembers(zones, g); if (!ms.length || !ms.some(z => capOf(z) != null)) return null;
  return Math.round(ms.reduce((a, z) => a + (capOf(z) ?? 100), 0) / ms.length);
}
/** A slider value clamped to the cap (pure). */
export const clampToCap = (v, cap) => (cap != null && v > cap ? cap : v);
/** J4: the one tag row of a speaker card - OFF, OFFLINE, REF, MUTED, NO DELAY, BT, CAPPED n%, a phone's SPEAKER role (pure, all of them, in this order). */
export function cardTags3(z) {
  const t = [], o = chosenOutput(z), cap = capOf(z), ot = outputTag(z);
  if (ot) t.push(ot);
  if (!z.enabled) t.push({ k: 'off', text: 'OFF', title: 'Switched off' });
  if (!z.connected) t.push({ k: 'offline', text: 'OFFLINE', title: 'Not connected right now' });
  if (z.reference) t.push({ k: 'ref', text: 'REF', title: 'Reference speaker - other delays are measured against this one' });
  if (z.muted) t.push({ k: 'muted', text: 'MUTED', title: 'Muted - press the mute button to unmute' });
  if (z.connected && !z.reference && o && o.notCalibrated) t.push({ k: 'nodelay', text: 'NO DELAY', title: 'The delay is not set yet: Settings › Delay › Calibrate' });
  if (cap != null) t.push({ k: 'capped', text: `CAPPED ${Math.round(cap)}%`, title: `Max volume locked at ${Math.round(cap)}%`, lock: true });
  if (isPhoneZone(z)) t.push({ k: 'role', text: 'SPEAKER', title: 'This phone plays music.' });
  return t;
}
/** J4: a zone card's tags - N DEVICES, PLAYING, MUTED, BT (a member is Bluetooth), CAPPED n% (pure). */
export function zoneTags3(zones, g) {
  const ms = zoneMembers(zones, g), cap = zoneCap(zones, g), t = [{ k: 'count', text: `${ms.length} DEVICE${ms.length === 1 ? '' : 'S'}`, title: ms.map(z => z.name).join(' · ') || 'No devices yet' }];
  if (g.active) t.push({ k: 'zplaying', text: 'PLAYING', title: 'Playing in this zone only' });
  if (zoneMuted(zones, g)) t.push({ k: 'muted', text: 'MUTED', title: 'Every speaker in this zone is muted' });
  if (ms.some(isBluetooth)) t.push({ k: 'bt', text: 'BT', title: 'A speaker in this zone uses Bluetooth' });
  if (cap != null) t.push({ k: 'capped', text: `CAPPED ${cap}%`, title: `The locked speakers keep this zone at or below ${cap}%`, lock: true });
  return t;
}
/** 0.4.4 F19: tags that jump to the setting that controls them (read-only ones - SPEAKER, N DEVICES, PLAYING, OFF, MUTED - stay plain). Pure map, unit-tested. */
export const TAG_ACTIONS = { capped: 'Change max volume', nodelay: 'Set the delay or calibrate', ref: 'Change the reference speaker (Calibrate)', offline: 'Choose the output device', bt: 'Output device and calibration', zctl: 'Control this zone', muted: 'Unmute' };   // 0.4.4 F25: the amber MUTED tag unmutes
const tagEls3 = list => list.map(t => { const tip = TAG_ACTIONS[t.k]; return h('span', tip ? { class: 'dtag tagact ' + t.k, title: tip, 'data-tag-act': t.k, role: 'button', tabindex: 0, 'aria-label': `${t.text}: ${tip}` } : { class: 'dtag ' + t.k, title: t.title }, t.lock ? icon('lock') : null, t.text); });
/** 0.4.4 F19: where a tag leads, inside an open speaker page / zone page. */
export function tagFocusTarget(kind, pane) {
  if (!pane) return null;
  const row = lbl => { const l = [...pane.querySelectorAll('.spk-l span, .dlbl, label')].find(e => e.textContent.trim().toLowerCase().startsWith(lbl)); let r = l; for (let i = 0; r && i < 4; i++, r = r.parentElement) { const x = r.querySelector('input[type=range], select'); if (x) return x; } return null; };
  if (kind === 'capped') return row('max volume') || pane.querySelector('input[type=range]');
  if (kind === 'nodelay') return row('delay') || pane.querySelector('.calbtn');
  if (kind === 'ref') return pane.querySelector('.calbtn');
  if (kind === 'offline' || kind === 'bt') { const ok = e => e && !e.disabled ? e : null;
    const lbl = [...pane.querySelectorAll('.dlbl')].find(e => /output device/i.test(e.textContent)); if (lbl) lbl.tabIndex = -1;
    return ok(pane.querySelector('select[aria-label$="output device"]')) || (kind === 'bt' ? ok(pane.querySelector('.calbtn')) : null) || lbl || null; }
  return null;
}
const tagNav = { panel: null, page: null };
/** 0.5.0 F109: open one speaker's settings (desktop: Devices panel expands to that speaker; phone: Devices page + its settings sheet).
 *  Callers outside Devices dispatch `wavwiz:openspk` {detail: zoneId}; main.js routes it here (after go('devices') on the phone). */
export function openSpeakerSettings(zoneId, phone = false) {
  const id = +zoneId; if (!id) return false;
  if (phone) { try { sessionStorage.setItem('wavwiz.spk.phone', String(id)); } catch { /* private mode */ } if (tagNav.page) { tagNav.page.spk(id); return true; } return false; }
  if (tagNav.panel) { tagNav.panel.spk(id); return true; }
  return false;
}
function focusLater(kind, find) { let n = 0; const t = () => { const el = find(); const f = el && tagFocusTarget(kind, el); if (f) { f.scrollIntoView?.({ block: 'center' }); f.focus?.({ preventScroll: true }); f.classList.add('tagflash'); setTimeout(() => f.classList.remove('tagflash'), 1500); } else if (n++ < 20) setTimeout(t, 100); }; setTimeout(t, 60); }
function onTagAct(ev) {
  const tag = ev.target.closest?.('.dtag.tagact'); if (!tag) return;
  if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
  ev.preventDefault(); ev.stopPropagation();
  // 0.4.4 F25: MUTED = unmute this speaker right here (row, card, speaker page; panel, expanded and phone)
  if (tag.dataset.tagAct === 'muted') { const id = +(tag.closest('[data-zone-id]')?.dataset.zoneId); if (id) api(`/zones/${id}`, { method: 'PATCH', body: { muted: false } }).then(() => { tag.remove(); }).catch(e => toast(e.message, true)); return; }
  const kind = tag.dataset.tagAct, page = tag.closest('#p-zones') ? tagNav.page : tagNav.panel; if (!page) return;
  const spk = tag.closest('[data-zone-id]'), grp = tag.closest('[data-group-id]');
  if (kind === 'zctl') { const gid = grp?.dataset.groupId; if (gid && Z.current()?.key !== 'g:' + gid) Z.select('g:' + gid); return; }
  if (spk && !spk.matches('[data-group-id]')) { const id = +spk.dataset.zoneId; if (!spk.closest('.spkset') && !tag.closest('.spkset')) page.spk(id); focusLater(kind, () => document.querySelector(`.spkset[data-zone-id="${id}"]`)); return; }
  if (grp) { const gid = +grp.dataset.groupId; page.zone(gid); focusLater(kind, () => document.querySelector('.d42-pane')); }
}
if (HASWIN) { document.addEventListener('click', onTagAct, true); document.addEventListener('keydown', onTagAct, true); }
/** J4: the labeled OFF | ON pill (replaces the unlabeled switch). */
export function onPill(label, on, can, toggle) {
  const b = h('button', { type: 'button', class: 'onpill' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on), 'aria-label': `${label} on or off`, title: on ? 'On - press to switch off' : 'Off - press to switch on',
    onclick: ev => { ev.stopPropagation(); if (can) toggle(); } }, h('span', { class: 'op-off' }, 'OFF'), h('span', { class: 'op-on' }, 'ON'));
  b._set = v => { b.classList.toggle('on', !!v); b.setAttribute('aria-checked', String(!!v)); b.title = v ? 'On - press to switch off' : 'Off - press to switch on'; };
  return ro(b, can, 'Your access is view-only.');
}
/** J3: a bar with an optional cap: --v paints the fill, --cap places the marker and the hatched part; input stops at the cap. */
function capBar(label, value, cap, can, send, title) {
  const pct = h('span', { class: 'pct' }, Math.round(value) + '%');
  const vol = h('input', { type: 'range', min: 0, max: 100, value, 'aria-label': label, title: title || '' });
  const wrap = h('div', { class: 'vbar' }, vol);
  const paint = (v, c) => { wrap.classList.toggle('capped', c != null); wrap.style.setProperty('--v', v + '%'); if (c != null) wrap.style.setProperty('--cap', c + '%'); else wrap.style.removeProperty('--cap');
    vol.dataset.cap = c != null ? String(c) : ''; vol.setAttribute('aria-valuemax', String(c ?? 100)); };
  vol.addEventListener('input', () => { const c = vol.dataset.cap ? +vol.dataset.cap : null; const v = clampToCap(+vol.value, c); if (v !== +vol.value) vol.value = String(v);
    pct.textContent = v + '%'; wrap.style.setProperty('--v', v + '%'); clearTimeout(vol._t); vol._t = setTimeout(() => send(v), 100); });
  ro(vol, can, 'Your access is view-only.'); paint(Math.round(value), cap);
  return { wrap, vol, pct, patch: (v, c) => { if (idle(vol)) { vol.value = String(v); pct.textContent = Math.round(v) + '%'; paint(Math.round(v), c); } else paint(+vol.value, c); } };
}
// 0.4.1: dropping a zone card on the middle of another zone card links the two zones
setLinkHandler(async (fromId, toId) => { if (!fromId || fromId === toId) return; try { await api(`/groups/${fromId}/link`, { method: 'POST', body: { with: Number(toId) } }); toast('Zones linked: they play the same music, in sync'); window.dispatchEvent(new CustomEvent('wavwiz:zones-changed')); } catch (e) { toast(e.message, true); } });
/** 0.4.1: a small "type a name" dialog (Rename in the card menus). */
function promptName(title, value, onSave) {
  const inp = h('input', { type: 'text', maxlength: 60, value, 'aria-label': 'Name' });
  dialog(title, h('div', { class: 'field' }, inp), [{ text: 'Save', cls: 'primary', onclick: async () => { const v = inp.value.trim(); if (!v) { toast('Type a name first', true); return false; } try { await onSave(v); } catch (e) { toast(e.message, true); return false; } } }, { text: 'Cancel' }]);
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
}
/** 0.4.1: right-click menu of a speaker card. */
function speakerCtx(S, ctl, z, card, openIt) {
  attachCtx(card, () => {
    const admin = isAdmin(S), can = canControl(S);
    const act = { settings: () => openIt?.(), rename: () => promptName(`Rename ${z.name}`, z.name, async v => { await api(`/zones/${z.id}`, { method: 'PATCH', body: { name: v } }); ctl.refreshAll?.(); }),
      mute: () => ctl.act(`/zones/${z.id}`, { muted: !z.muted }, 'PATCH'), off: () => ctl.act(`/zones/${z.id}`, { enabled: !z.enabled }, 'PATCH'),
      calibrate: () => openCalibration(S, ctl.refreshAll, z.id, { quick: true }), move: () => addToZoneMenu(S, ctl, z, card, S.groups || []), remove: () => forget(ctl, z) };
    return speakerMenuItems({ admin, can, muted: !!z.muted, on: !!z.enabled, canCalibrate: canTune(S, z) && z.connected }).map(it => it.sep ? it : { ...it, onclick: act[it.id] });
  }, `${z.name} actions`);
}
/** 0.4.1: right-click menu of a zone card. */
function zoneCtx(S, ctl, g, card, ms, { onEdit = null } = {}) {
  attachCtx(card, () => {
    const admin = isAdmin(S), can = canControl(S), muted = zoneMuted(S.zones, g), on = zoneOn(S.zones, g), linked = (g.linked || []).length > 0, canLink = (S.groups || []).length > 1;
    const act = { settings: () => (onEdit ? onEdit(g.id) : editZone(S, g, ctl.refreshAll)), rename: () => promptName(`Rename zone ${g.name}`, g.name, async v => { await api(`/groups/${g.id}`, { method: 'PATCH', body: { name: v, deviceIds: g.deviceIds || [] } }); ctl.refreshAll?.(); }),
      mute: () => ctl.act(`/groups/${g.id}/mute`, { muted: !muted }), off: () => { for (const z of ms) ctl.act(`/zones/${z.id}`, { enabled: !on }, 'PATCH'); },
      split: () => Z.splitOff(g, ctl.refreshAll), link: () => Z.linkMenu(card, S, g, ctl.refreshAll), remove: () => confirmRemoveZone(S, g, ctl.refreshAll) };
    return zoneMenuItems({ admin, can, muted, on, linked, canLink }).map(it => it.sep ? it : { ...it, onclick: act[it.id] });
  }, `${g.name} zone actions`);
}

/** J4: one speaker card. Standard panel: the name opens Expanded with this card highlighted. Expanded / phone page: the card opens its settings in place (J6). */
function card3(S, ctl, z, { hl = false, dim = false, addable = false, groups = [], settings: withSettings = false, openDevice = null, slim = false, onSettings = null, active = false } = {}) {
  z = { ...z };
  // 0.3.6 K5: in the expanded view a speaker's settings open in the wide Speaker Settings column (onSettings) instead of folding out inside the card
  const can = canControl(S), me = thisDevice(S)?.id === z.id, open = withSettings && !onSettings && openSet.has(z.id);
  let card;
  const flip = onSettings ? () => onSettings(z.id) : () => { card = toggleSettings(z, card, () => card3(S, ctl, (S.zones || []).find(x => x.id === z.id) || z, { hl, dim, addable, groups, settings: withSettings, openDevice, slim })); };
  const dot = h('span', { class: 'dot ' + dotClass(z), title: stateText(z) });
  const name = openDevice ? h('button', { type: 'button', class: 'dname ell', title: (me ? 'This device. ' : '') + 'Show this device with all of its controls and settings', onclick: () => openDevice(z.id) }, z.name)
    : withSettings ? h('button', { type: 'button', class: 'dname ell', title: (open || active) ? 'Hide settings' : 'Show settings', 'aria-expanded': String(open || active), onclick: flip }, z.name)
    : h('b', { class: 'dname ell' }, z.name);
  const pill = onPill(z.name, z.enabled, can, () => { z.enabled = !z.enabled; pill._set(z.enabled); ctl.act(`/zones/${z.id}`, { enabled: z.enabled }, 'PATCH'); });
  const bar = capBar(`${z.name} volume`, z.volume, capOf(z), can, v => ctl.act(`/zones/${z.id}`, { volume: v }, 'PATCH'));
  const mute = muteButton(S, ctl, z);
  const tags = h('div', { class: 'dtagrow dc3tags' }, tagEls3(cardTags3(z))); tags._k = JSON.stringify(cardTags3(z));
  const hide = open ? h('button', { type: 'button', class: 'linkbtn dhide', 'aria-controls': `dset-${z.id}`, onclick: flip }, '▲ Hide settings') : null;
  const cl = (S.groups || []).flatMap(g => g.claims || []).find(c => c.deviceId === z.id);   // 0.4.1: a smaller zone is playing on this speaker
  const big = !!onSettings;   // 0.3.9 L51/L56: the expanded view's card: output device line, zone chips + delay, mute bottom right
  const add = addable ? ro(h('button', { type: 'button', class: 'btn sm saddzone', title: 'Add this speaker to a zone', onclick: ev => { ev.stopPropagation(); addToZoneMenu(S, ctl, z, ev.currentTarget, groups); } }, '+ Add to zone'), isAdmin(S)) : null;
  const set = open ? cardSettings(S, ctl, z) : null;
  const ol = outputTypeLine(z);
  card = h('div', { class: 'dcard dc3' + (slim ? ' drow slim' : '') + (z.enabled ? '' : ' off') + (z.connected ? '' : ' gone') + (z.muted ? ' muted' : '') + (hl || active ? ' hl' : '') + (active ? ' spk-active' : '') + (dim ? ' dimmed' : '') + (open ? ' dset' : '') + (me || z.mine ? ' mine' : ''),
    'data-room': z.name, 'data-device': z.name, 'data-zone-id': z.id, title: ol ? `${z.name} - ${ol}` : z.name },
    h('div', { class: 'dtop dc3l1' }, dot, name, h('span', { class: 'grow' }), hide, pill),
    h('div', { class: 'dc3l2' }, tags, add, cl ? h('span', { class: 'dtag zin', title: `${z.name} is playing in the smaller zone ${cl.zone} right now` }, `playing in ${cl.zone}`) : null),
    big ? h('div', { class: 'dc3out' }, h('span', { class: 'dlbl' }, 'OUTPUT DEVICE'), h('b', { class: 'dout ell' }, (chosenOutput(z)?.name || '').trim() || 'No output chosen')) : null,
    h('div', { class: 'dvol dc3l3' }, bar.wrap, bar.pct, big ? null : mute),
    big ? h('div', { class: 'dc3foot' }, ...(groups || []).filter(g => (g.deviceIds || []).includes(z.id)).map(g => h('span', { class: 'zchip', title: `In zone ${g.name}` }, g.name)),
      (() => { const o = chosenOutput(z); return h('span', { class: 'dchip delay', title: 'Delay (change it in Speaker Settings)' }, `Delay ${o && !o.notCalibrated ? '+' + Math.round(o.latencyMs) + ' ms' : 'not set'}`); })(), h('span', { class: 'grow' }), mute) : null,
    set);
  // 0.3.9 L54: the whole card opens the speaker's settings; its own controls keep their actions
  const open_ = openDevice ? () => openDevice(z.id) : withSettings ? flip : null;
  if (open_) { card.classList.add('clickable'); card.addEventListener('click', ev => { if (ev.defaultPrevented || ev.target.closest('button,input,select,textarea,a,[role=switch],.vbar,.dlatency,.dgrip')) return; open_(); }); }
  speakerCtx(S, ctl, z, card, open_ || flip);
  card._sig = cardSig(S, z, `3|${rowKey(hl, dim, addable, groups.length)}|${withSettings ? 1 : 0}|${slim ? 1 : 0}|${active ? 1 : 0}`);
  card._patch = nz => {
    Object.assign(z, nz);
    card.classList.toggle('off', !z.enabled); card.classList.toggle('muted', !!z.muted); card.classList.toggle('gone', !z.connected);
    dot.className = 'dot ' + dotClass(z); dot.title = stateText(z); pill._set(z.enabled);
    bar.patch(z.volume, capOf(z));
    mute.classList.toggle('on', !!z.muted); mute.setAttribute('aria-pressed', String(!!z.muted)); mute.setAttribute('aria-label', (z.muted ? 'Unmute ' : 'Mute ') + z.name); setIcon(mute, z.muted ? 'mute' : 'volume');
    const t = JSON.stringify(cardTags3(z)); if (tags._k !== t) { tags._k = t; tags.replaceChildren(...tagEls3(cardTags3(z))); }
    set?._patch?.(z);
  };
  return withSettings && !onSettings ? escCloses(card, z, flip) : card;
}
/** J4 zone card: the same three lines; picking it highlights its speakers (Expanded); ✎ edits it in place (J9 #2). */
function zcard3(S, ctl, g, { pick = null, onPick = null, onEdit = null, shared = false } = {}) {
  const can = canControl(S), ms = zoneMembers(S.zones, g), muted = zoneMuted(S.zones, g), on = zoneOn(S.zones, g);
  const dot = h('span', { class: 'dot ' + (ms.some(z => z.connected) ? 'ok' : 'off'), title: `${ms.filter(z => z.connected).length} of ${ms.length} online` });
  const name = ro(h('button', { type: 'button', class: 'dname zname ell', title: 'Play in this zone only', onclick: ev => { ev.stopPropagation(); ctl.act(`/groups/${g.id}/activate`); } }, g.name), can, 'Your access is view-only.');
  const pill = onPill(`Zone ${g.name}`, on, can, () => { const want = !zoneOn(S.zones, g); for (const z of ms) { z.enabled = want; ctl.act(`/zones/${z.id}`, { enabled: want }, 'PATCH'); } pill._set(want); });
  const bar = capBar(`${g.name} zone volume`, zoneLevel(S.zones, g), zoneCap(S.zones, g), can, v => ctl.act(`/groups/${g.id}/volume`, { set: v }), 'Moves every speaker in this zone together (keeps their balance)');
  const mute = ro(h('button', { type: 'button', class: 'mutebtn zmute' + (muted ? ' on' : ''), 'aria-pressed': String(muted), 'aria-label': (muted ? 'Unmute zone ' : 'Mute zone ') + g.name, title: muted ? 'Unmute this zone' : 'Mute every speaker in this zone',
    onclick: ev => { ev.stopPropagation(); const m = !zoneMuted(S.zones, g); for (const z of ms) z.muted = m; ctl.act(`/groups/${g.id}/mute`, { muted: m }); } }, icon(muted ? 'mute' : 'volume')), can, 'Your access is view-only.');
  mute.dataset.icon = muted ? 'mute' : 'volume';
  const edit = onEdit ? ro(h('button', { type: 'button', class: 'zbtn zedit', 'aria-label': `Edit zone ${g.name}`, title: 'Edit zone', onclick: ev => { ev.stopPropagation(); onEdit(g.id); } }, '✎'), isAdmin(S)) : null;
  // 0.4.0: Link / Split off, the link badge, the CONTROLLING tag and the zone's own now-playing line (additions only)
  const sel = Z.current()?.kind === 'zone' && Z.current().id === g.id, linked = (g.linked || []).length > 0, groups = S.groups || [];
  const linkBtn = groups.length < 2 ? null : ro(linked
    ? h('button', { type: 'button', class: 'btn sm zlinkbtn split', 'data-act': 'split', title: 'Give this zone its own music (the zones it was linked with keep playing)', onclick: ev => { ev.stopPropagation(); Z.splitOff(g, ctl.refreshAll); } }, 'Split off')
    : h('button', { type: 'button', class: 'btn sm zlinkbtn link', 'data-act': 'link', title: 'Play the same music as another zone, in sync', onclick: ev => { ev.stopPropagation(); Z.linkMenu(ev.currentTarget, S, g, ctl.refreshAll); } }, icon('link'), ' Link'), can, 'Your access is view-only.');
  const select = () => Z.select('g:' + g.id);
  const card = h('div', { class: 'zcard dlike dc3 zc3 hasnow' + (g.active ? ' active' : '') + (muted ? ' muted' : '') + (on ? '' : ' off') + (pick === g.id ? ' picked' : '') + (sel ? ' zsel-on' : '') + (linked ? ' zlinked' : ''), 'data-zone': g.name, 'data-group-id': g.id, 'data-playback-id': g.playbackId || 'default', title: ms.length ? ms.map(z => z.name).join(' · ') : 'No speakers yet' },
    h('div', { class: 'dtop zc-top dc3l1' }, dot, name, h('span', { class: 'small dim zkind' }, 'zone'), h('span', { class: 'grow' }), linkBtn, edit, pill),
    h('div', { class: 'dc3l2' }, h('div', { class: 'dtagrow ztagrow dc3tags' }, tagEls3(zoneTags3(S.zones, g)), sel ? Z.controllingTag() : null, Z.linkBadge(g), Z.hereTag(g))),
    shared ? null : Z.nowLine(g.now, { at: S._groupsAt || Date.now(), onSelect: select, selected: sel }),
    h('div', { class: 'dvol dc3l3' }, bar.wrap, bar.pct, mute));
  zoneCtx(S, ctl, g, card, ms, { onEdit: onEdit && isAdmin(S) ? onEdit : null });
  if (onPick) card.setAttribute('aria-pressed', String(pick === g.id));
  // 0.3.9 L54: the whole zone card is the target: it opens the zone (admin: its settings in place; otherwise it picks / un-picks the zone); inner controls keep their own actions
  const act_ = onPick ? () => onPick(pick === g.id ? 'all' : g.id) : onEdit && isAdmin(S) ? () => onEdit(g.id) : null;   // 0.4.1: clicking the picked zone again clears the pick (the ✎ button and the right-click menu open the settings)
  if (act_) { card.classList.add('clickable'); card.addEventListener('click', ev => { if (ev.defaultPrevented || ev.target.closest('button,input,select,textarea,a,[role=switch],.vbar,.dgrip,.zl-now.tap')) return; act_(); }); }
  if (onEdit) card.append(h('div', { class: 'dc3mem' }, h('span', { class: 'dlbl' }, 'SPEAKERS IN ZONE'), h('div', { class: 'dc3chips' }, ms.length ? ms.map(z => { const c = (g.claims || []).find(x => x.deviceId === z.id); return h('span', { class: 'zchip' + (c ? ' claimed' : ''), title: c ? `${z.name} is playing in ${c.zone}` : z.name }, z.name, c ? h('small', { class: 'zc-in' }, ` · playing in ${c.zone}`) : null); }) : h('span', { class: 'small dim' }, 'No speakers yet'))));
  return card;
}
/** 0.4.1: the zone cards in order; zones that play the same song (linked) share ONE now-playing box: "A + B + C · IN SYNC", one song, one shared volume, and each member keeps its own card, volume and controls.
 *  `inline(g)` may return a replacement element (the in-place zone editor). */
function zoneRows(S, ctl, groups, inline, opts) {
  const seen = new Set(), out = [];
  for (const g of groups) {
    const pid = g.playbackId || 'default', members = (g.linked || []).length ? groups.filter(x => (x.playbackId || 'default') === pid) : [g];
    if (members.length < 2) { out.push(inline(g) || zcard3(S, ctl, g, opts)); continue; }
    if (seen.has(pid)) continue; seen.add(pid); out.push(sharedBox(S, ctl, members, inline, opts));
  }
  return out;
}
function sharedBox(S, ctl, members, inline, opts) {
  const can = canControl(S), sel = Z.current(), selMember = sel?.kind === 'zone' ? members.find(m => m.id === sel.id) : null, lead = selMember || members[0];
  const level = Math.round(members.reduce((a, g) => a + zoneLevel(S.zones, g), 0) / members.length);
  const bar = capBar('Shared volume', level, null, can, v => { for (const g of members) ctl.act(`/groups/${g.id}/volume`, { set: v }); }, 'Moves every linked zone together');
  const names = members.map(m => m.name).join(' + ');
  return h('div', { class: 'zshared', 'data-playback-id': lead.playbackId || 'default', 'data-members': members.map(m => m.id).join(',') },
    h('div', { class: 'zsh-head' }, h('span', { class: 'zsh-ico', 'aria-hidden': 'true' }, icon('link')), h('b', { class: 'zsh-names' }, names), h('span', { class: 'grow' }), h('span', { class: 'zsh-sync' }, 'IN SYNC')),
    h('div', { class: 'zsh-now' }, Z.nowLine(lead.now, { at: S._groupsAt || Date.now(), onSelect: () => Z.select('g:' + lead.id), selected: !!selMember }),
      h('div', { class: 'zsh-vol' }, h('span', { class: 'dlbl' }, 'SHARED VOLUME'), h('div', { class: 'dvol' }, bar.wrap, bar.pct))),
    h('div', { class: 'zsh-members' }, members.map(m => inline(m) || zcard3(S, ctl, m, { ...opts, shared: true }))));
}
/** 0.4.0: the Jukebox zone card - its own music, its own speakers (picked here), selectable like any zone. Admins pick the speakers; everyone else sees them. */
function jukeboxCard(S, ctl) {
  const jb = S.jb; if (!jb) return null; const admin = isAdmin(S), can = canControl(S), ids = new Set(jb.deviceIds || []), picks = new Set((jb.running === false ? jb.defaultSpeakers : jb.deviceIds) || []);   // 0.4.9 F76 fix: idle = default speakers
  if (!jb.own && !admin) return null;
  const ms = (S.zones || []).filter(z => ids.has(z.id)), on = ms.some(z => z.enabled), muted = ms.length > 0 && ms.every(z => z.muted), sel = Z.current()?.kind === 'jukebox';
  const dot = h('span', { class: 'dot ' + (ms.some(z => z.connected) ? 'ok' : 'off'), title: `${ms.filter(z => z.connected).length} of ${ms.length} online` });
  const name = ro(h('button', { type: 'button', class: 'dname zname ell', title: 'Control the Jukebox zone', onclick: ev => { ev.stopPropagation(); Z.select(Z.JUKEBOX_KEY); } }, 'Jukebox'), can, 'Your access is view-only.');
  const pill = onPill('Jukebox zone', on, can, () => { const want = !ms.some(z => z.enabled); for (const z of ms) { z.enabled = want; ctl.act(`/zones/${z.id}`, { enabled: want }, 'PATCH'); } pill._set(want); });
  const lvl = ms.length ? Math.round(ms.reduce((a, z) => a + z.volume, 0) / ms.length) : 0;
  const bar = capBar('Jukebox zone volume', lvl, 100, can && ms.length > 0, v => api('/jukebox/zone/volume', { method: 'POST', body: { set: v } }).catch(e => toast(e.message, true)), 'Moves every speaker of the Jukebox zone together');
  const mute = ro(h('button', { type: 'button', class: 'mutebtn zmute' + (muted ? ' on' : ''), 'aria-pressed': String(muted), 'aria-label': (muted ? 'Unmute' : 'Mute') + ' the Jukebox zone', onclick: ev => { ev.stopPropagation(); api('/jukebox/zone/mute', { method: 'POST', body: { muted: !muted } }).then(() => ctl.refreshAll()).catch(e => toast(e.message, true)); } }, icon(muted ? 'mute' : 'volume')), can && ms.length > 0, 'Your access is view-only.');
  const inZone = z => (S.groups || []).find(g => (g.deviceIds || []).includes(z.id))?.name;
  const pick = async (z, checked) => { const next = new Set(picks); checked ? next.add(z.id) : next.delete(z.id); try { await api('/jukebox/zone', { method: 'PUT', body: { deviceIds: [...next] } }); ctl.refreshAll(); } catch (e) { toast(e.message, true); } };
  const rows = (S.zones || []).slice(0, 200).map(z => h('label', { class: 'jbrow' + (picks.has(z.id) ? ' on' : ''), 'data-device-id': z.id }, ro(h('input', { type: 'checkbox', checked: picks.has(z.id), 'aria-label': `${z.name} plays the Jukebox`, onchange: ev => pick(z, ev.target.checked) }), admin, 'Only an admin can pick the Jukebox devices.'),
    h('span', { class: 'jbn ell' }, z.name), inZone(z) ? h('span', { class: 'small dim jbin ell' }, 'in ' + inZone(z)) : null));
  return h('div', { class: 'zcard dlike dc3 zc3 hasnow zjuke' + (on ? '' : ' off') + (sel ? ' zsel-on' : '') + (muted ? ' muted' : ''), 'data-group-id': 'jukebox', 'data-zone': 'Jukebox', 'data-playback-id': jb.zoneId || 'jukebox' },
    h('div', { class: 'dtop zc-top dc3l1' }, dot, name, h('span', { class: 'small dim zkind' }, 'zone'), h('span', { class: 'grow' }), pill),
    h('div', { class: 'dc3l2' }, h('div', { class: 'dtagrow ztagrow dc3tags' }, tagEls3(zoneTags3(S.zones, { deviceIds: [...ids] })), h('span', { class: 'dtag zjb', title: 'Guests choose the songs; they play only on these devices' }, 'JUKEBOX'), sel ? Z.controllingTag() : null)),
    Z.nowLine(jb.own ? jb.now : null, { at: S._groupsAt || Date.now(), onSelect: jb.own ? () => Z.select(Z.JUKEBOX_KEY) : null, selected: sel }),
    h('div', { class: 'dvol dc3l3' }, bar.wrap, bar.pct, mute),
    h('div', { class: 'dc3mem jbpick' }, h('span', { class: 'dlbl' }, 'SPEAKERS FOR JUKEBOX'),
      h('div', { class: 'dc3chips' }, ms.length ? ms.map(z => h('span', { class: 'zchip', title: z.name }, z.name)) : h('span', { class: 'small dim' }, 'None picked: the Jukebox plays in the main zone')),
      jbDisclosure(ms.length, h('div', { class: 'jblist', role: 'group', 'aria-label': 'Devices for the Jukebox zone' }, rows))));
}
/** 0.4.1 L62: with 0 speakers in the Jukebox the long picker folds behind "Choose speakers" (the card was cut off by it); once speakers are picked it is open. The user's own open / close is kept across refreshes. */
let jbUserOpen = null;
function jbDisclosure(count, list) {
  const d = h('details', { class: 'jbdisc' }, h('summary', null, count ? `Choose speakers (${count} picked)` : 'Choose speakers'), list);
  d.open = jbUserOpen == null ? count > 0 : jbUserOpen; d.addEventListener('toggle', () => { jbUserOpen = d.open; }); return d;
}
/** J9 #2: a zone's settings open in place in the Zones column (name, devices, play here, remove); also the inline New zone form. */
/** 0.4.0 Stage 4: one name per zone for phone casting. "WavWiz – <zone>" shows in AirPlay and in the Spotify app; what a phone sends plays in this zone only. */
export function receiverBlock(g, admin) {
  const wrap = h('div', { class: 'zrecv', 'data-zone-recv': g.id }), msg = h('span', { class: 'small dim', role: 'status' });
  const draw = row => {
    const sw = (k, label, st) => ro(h('label', { class: 'row zsmember' }, h('input', { type: 'checkbox', checked: !!st?.enabled, 'data-recv': k, 'aria-label': label,
      onchange: async ev => { try { const r = await api(`/receivers/zones/${g.id}`, { method: 'PUT', body: { [k]: ev.target.checked } }); draw(r.zones.find(z => z.zoneId === g.id)); } catch (e) { ev.target.checked = !ev.target.checked; msg.textContent = e.message; } } }),
      h('span', null, label), h('span', { class: 'small dim grow' }, st?.enabled ? (st.running ? (st.inSession ? ' · playing' : ' · ready') : st.installed === false ? ' · not installed' : ' · starting…') : '')), admin, 'Only an admin can change this.');
    wrap.replaceChildren(h('div', { class: 'dlbl' }, 'PHONE CASTING'), h('p', { class: 'small dim' }, `Shows as “${row.name}” on phones. Plays in this zone only.`), sw('airplay', 'AirPlay', row.airplay), sw('spotify', 'Spotify Connect', row.spotify), msg);
  };
  api('/receivers/zones').then(r => { const row = (r.zones || []).find(z => z.zoneId === g.id); if (row) draw(row); }).catch(() => {});
  return wrap;
}

function zoneInline(S, ctl, g, close) {
  const admin = isAdmin(S), can = canControl(S);
  const name = ro(h('input', { type: 'text', maxlength: 60, value: g?.name || '', placeholder: 'e.g. Downstairs', 'aria-label': 'Zone name' }), admin), picked = new Set(g?.deviceIds || []);
  const boxes = (S.zones || []).map(z => h('label', { class: 'row zsmember' }, ro(h('input', { type: 'checkbox', checked: picked.has(z.id), onchange: ev => { ev.target.checked ? picked.add(z.id) : picked.delete(z.id); } }), admin), h('span', { class: 'dot ' + dotClass(z) }), h('span', { class: 'ell' }, z.name)));
  const err = h('span', { class: 'small err', role: 'status' });
  const save = ro(h('button', { type: 'button', class: 'btn sm primary', onclick: async () => { try { { const body = { name: name.value, deviceIds: [...picked] }; if (g) await api(`/groups/${g.id}`, { method: 'PATCH', body }); else await createZone(body.name, body.deviceIds); } toast(g ? 'Zone saved' : `Zone “${name.value.trim()}” created`); close(); ctl.refreshAll(); } catch (e) { err.textContent = e.message; } } }, g ? 'Save' : 'Create zone'), admin);
  const play = g ? ro(h('button', { type: 'button', class: 'btn sm', onclick: () => ctl.act(`/groups/${g.id}/activate`) }, g.active ? '▶ Playing here' : '▶ Play here only'), can, 'Your access is view-only.') : null;
  const del = g ? ro(h('button', { type: 'button', class: 'btn sm danger', onclick: () => confirmRemoveZone(S, g, () => { close(); ctl.refreshAll(); }) }, 'Remove zone'), admin) : null;
  const el = h('div', { class: 'zcard zinline card', 'data-group-id': g?.id ?? 'new', role: 'group', 'aria-label': g ? `Zone settings for ${g.name}` : 'New zone' },
    h('div', { class: 'row' }, h('b', null, g ? 'Edit zone' : 'New zone'), h('span', { class: 'grow' }), h('button', { type: 'button', class: 'linkbtn', onclick: close }, '▲ Close')),
    h('div', { class: 'dlbl' }, 'ZONE NAME'), name, h('div', { class: 'dlbl' }, 'DEVICES'), h('div', { class: 'zsmembers' }, boxes.length ? boxes : h('p', { class: 'small dim' }, 'No devices yet.')),
    g ? receiverBlock(g, admin) : null,
    h('div', { class: 'row wrap zsactions' }, del, h('span', { class: 'grow' }), play, h('button', { type: 'button', class: 'btn sm', onclick: close }, 'Cancel'), save), err);
  el.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); } });
  queueMicrotask(() => { if (!g) name.focus?.(); });
  return el;
}
