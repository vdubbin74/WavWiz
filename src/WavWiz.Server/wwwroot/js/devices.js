import { h, api, toast, dialog } from './util.js';
import { roomPill, roomPillClass } from './diag.js';
import { openEq } from './eq.js';
import { latencyControl } from './latency.js';
import { openCalibration } from './calibrate.js';
import { canControl, isAdmin, canTune, ADMIN_HINT, thisDevice } from './ui.js';
import { icon, setIcon } from './icons.js';

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
export const arrowSize = s => (s === 'collapsed' ? 'standard' : 'collapsed');
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
const stateText = z => !z.enabled ? 'Off' : z.muted ? 'Muted' : !z.connected ? 'Offline' : ({ ok: 'Playing', idle: 'Not playing', buffering: 'Buffering', dropped: 'Dropped', reconnecting: 'Reconnecting', offline: 'Offline' }[z.room?.state] || 'Online');
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
  return { vol, pct, mute: muteButton(S, ctl, z) };
}
function onSwitch(S, ctl, z) {
  const sw = h('div', { class: 'sw sm' + (z.enabled ? ' on' : ''), role: 'switch', 'aria-checked': String(z.enabled), 'aria-label': `${z.name} on or off`, tabindex: 0, onclick: () => canControl(S) && ctl.act(`/zones/${z.id}`, { enabled: !z.enabled }, 'PATCH'), onkeydown: e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.target.click(); } } });
  if (!canControl(S)) { sw.setAttribute('aria-disabled', 'true'); sw.classList.add('ro'); sw.title = 'Your access is view-only.'; }
  return sw;
}
function badges(S, z, compact = false) {
  const me = thisDevice(S);
  if (compact) return [z.reference ? h('span', { class: 'dbadge ref', title: 'House reference speaker' }, 'REF') : null];   // Standard: this device = accent name; only the reference badge
  return [z.isWeb ? h('span', { class: 'dbadge' }, 'BROWSER') : null, z === me || (me && z.id === me.id) ? h('span', { class: 'dbadge me' }, 'THIS DEVICE') : null, z.reference ? h('span', { class: 'dbadge ref', title: 'House reference speaker: calibration measures the other speakers against this one' }, 'REFERENCE') : null];
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
  return h('div', { class: 'dmaster' }, h('div', { class: 'dlbl' }, 'MASTER VOLUME'), h('div', { class: 'dvol' }, icon('volume'), sl, pct, muteAllButton(S, ctl)));
}
/** 0.2.1 F17: every device muted? (drives the Mute all / Unmute all button) */
export const allMuted = zones => (zones || []).length > 0 && zones.every(z => z.muted);
/** 0.2.1 F17: Mute all on the master strip. Mutes every device; Unmute all brings back only the ones it muted (the server remembers),
 * so a device muted on its own stays muted - per-device Mute stays separate. */
function muteAllButton(S, ctl) {
  const on = allMuted(S.zones);
  const b = h('button', { type: 'button', class: 'btn mutealls' + (on ? ' on' : ''), 'aria-pressed': String(on), title: on ? 'Un-mute the devices that Mute all muted' : 'Mute every device (each device keeps its own Mute too)',
    onclick: () => { const want = !allMuted(S.zones); for (const z of S.zones || []) if (want) z.muted = true; ctl.act('/zones/mute-all', { muted: want }); paint(want); } });
  const paint = m => { b.classList.toggle('on', m); b.setAttribute('aria-pressed', String(m)); b.replaceChildren(icon(m ? 'mute' : 'volume'), h('span', null, m ? 'Unmute all' : 'Mute all')); };
  paint(on); ro(b, canControl(S), 'Your access is view-only.');
  return b;
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
  const scenes = h('div', { class: 'zscenes' });
  loadScenes().then(list => scenes.replaceChildren(...(list.length ? [h('div', { class: 'zshead' }, h('span', { class: 'dlbl' }, 'SCENES'), h('span', { class: 'grow' }), h('span', { class: 'small dim' }, 'optional')),
    h('div', { class: 'zschips' }, list.map(sc => ro(h('button', { type: 'button', class: 'chip zscene', title: `Apply the scene “${sc.name}”`, onclick: async () => { try { await api(`/scenes/${sc.id}/apply`, { method: 'POST' }); toast(`Scene “${sc.name}” applied`); ctl.refreshAll(); } catch (e) { toast(e.message, true); } } }, '▶ ' + sc.name), can, 'Your access is view-only.')))] : [])));
  side.append(h('div', { class: 'zshead' }, h('span', { class: 'dlbl' }, 'ZONES'), h('span', { class: 'grow' }), add), list,
    groups.length ? null : h('p', { class: 'small dim zsempty' }, 'Zones are optional groups, like “Downstairs”.'), scenes);
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

/** 0.2.1 F18 + F19: each card has its own settings view (the ••• button flips the card). Calibrate and Test sound moved here off the card face;
 * the old device Details… pop-up is gone - everything it had lives here (sound check, Sound / EQ, delay history, connection, Bluetooth
 * follow) or on the card itself (output + delay), and zone settings live in the zones sidebar's edit view (F7). One card at a time. */
let settingsFor = null;
export const cardInSettings = id => settingsFor === id;
function toggleSettings(S, ctl, z, card, hl) {
  settingsFor = settingsFor === z.id ? null : z.id;
  const fresh = expandedCard(S, ctl, (S.zones || []).find(x => x.id === z.id) || z, hl); card.replaceWith(fresh);
  (settingsFor === z.id ? fresh.querySelector('.dsback') : fresh.querySelector('.dmore'))?.focus();
}
function cardSettings(S, ctl, z, back) {
  const admin = isAdmin(S), tune = canTune(S, z), can = canControl(S), cur = chosenOutput(z), r = z.room;
  const testSound = async () => { try { await api(`/zones/${z.id}/test-sound`, { method: 'POST' }); toast('Playing a chime in ' + z.name); } catch (e) { toast(e.message, true); } };
  const sec = (title, ...kids) => h('div', { class: 'dssec' }, h('div', { class: 'dlbl' }, title), ...kids);
  const btn = (label, fn, ok = true, hint = OWN_HINT, cls = 'btn') => ro(h('button', { type: 'button', class: cls, onclick: fn }, label), ok, hint);
  const conn = [z.connected ? 'Connected' : 'Offline', z.link === 'wifi' ? 'Wi-Fi' : z.link === 'wired' ? 'Network cable' : z.link, z.remoteIp].filter(Boolean).join(' · ');
  const sync = z.syncErrorMs != null ? `Sync error ${z.syncErrorMs.toFixed(1)} ms · buffer ${Math.round(z.bufferMs ?? 0)} ms · re-syncs ${z.hardResyncs ?? 0}` : z.isWeb ? 'A browser cannot measure its own sync error - set the delay by ear.' : 'Sync error shows once something plays.';
  return h('div', { class: 'dsettings', role: 'group', 'aria-label': `${z.name} settings` },
    h('div', { class: 'dstop' }, h('button', { type: 'button', class: 'btn dsback', 'aria-label': `Back to ${z.name}`, onclick: back }, '‹ Back'), h('b', { class: 'ell grow', title: z.name }, z.name), h('span', { class: 'small dim' }, 'Settings')),
    sec('SOUND CHECK',
      h('div', { class: 'row wrap dsbtns' },
        btn(z.isWeb ? 'Set delay by ear' : '🎤 Calibrate', () => openCalibration(S, ctl.refreshAll, z.id), tune && z.connected, tune ? 'This device is offline.' : OWN_HINT, 'btn' + (z.badge === 'recheck' || z.badge === 'uncalibrated' ? ' primary' : '')),
        btn('🔔 Test sound', testSound, can && z.connected, can ? 'This device is offline.' : 'Your access is view-only.')),
      h('div', { class: 'small dim' }, z.badge === 'recheck' ? 'The delay needs a re-check.' : z.badge === 'uncalibrated' ? 'The delay is not set yet.' : 'Test sound plays a short chime on this device only.')),
    cur ? sec('DELAY (EXACT)', exactDelay(S, ctl, z, cur, tune)) : null,
    sec('SOUND',
      h('div', { class: 'row wrap dsbtns' },
        btn('Sound / EQ…', () => openEq(S, ctl.refreshAll, cur?.deviceId), tune && !!cur, cur ? OWN_HINT : 'No output yet.'),
        btn('Delay history…', () => delayHistory(S, ctl, z, cur), !!cur, 'No output yet.'),
        cur?.kind === 'bluetooth' ? btn('📌 Follow this speaker', async () => { try { await api('/speakers/profiles/capture', { method: 'POST', body: { deviceId: z.id, name: cur.name, follow: true } }); toast('Saved profile and enabled Follow this speaker'); } catch (e) { toast(e.message, true); } }, tune) : null)),
    sec('CONNECTION',
      h('div', { class: 'row wrap' }, r ? h('span', { class: 'pill ' + roomPillClass(r.state) }, r.state) : null, h('span', { class: 'small' }, conn)),
      h('div', { class: 'small dim' }, sync),
      r && (r.drops || r.reconnects || r.underrunEvents) ? h('div', { class: 'small dim' }, `Dropped ${r.drops}× · reconnected ${r.reconnects}× · ran dry ${r.underrunEvents}×`) : null),
    sec('DEVICE',
      h('div', { class: 'row wrap dsbtns' },
        btn('Rename…', () => rename(S, ctl, z), admin, ADMIN_HINT),
        btn(z.reference ? 'Reference speaker ✓' : 'Set as reference', () => setReference(ctl, z), admin && !z.reference, z.reference ? 'Already the reference speaker' : ADMIN_HINT),
        btn('Forget device…', () => forget(ctl, z), admin, ADMIN_HINT, 'btn danger'))));
}
/** Slider + ms box for typing an exact delay (0.0.8 item 7; was in the Details pop-up). Live while dragging, saved on release. */
function exactDelay(S, ctl, z, o, tune) {
  const put = (v, live) => api(`/outputs/${encodeURIComponent(o.deviceId)}/latency`, { method: 'PUT', body: { latencyMs: v, playerId: z.playerId, method: 'manual', live } });
  const status = h('span', { class: 'small dim latstatus', 'aria-live': 'polite' });
  const lat = latencyControl({ value: o.notCalibrated ? 0 : o.latencyMs, onChange: async (v, final) => { try { await put(v, !final); status.textContent = final ? `Saved ${v} ms` : `${v} ms (live)`; } catch (e) { status.textContent = ''; toast(e.message, true); } } });
  if (!tune) lat.el.querySelectorAll('input').forEach(i => ro(i, false, OWN_HINT));
  return h('div', null, lat.el, status);
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
function outputAndDelay(S, ctl, z) {
  const can = canTune(S, z), hint = canControl(S) ? OWN_HINT : 'Your access is view-only.';
  const outs = z.outputs.filter(o => o.connected || o.active || o.deviceId === z.chosenDeviceId);
  let cur = chosenOutput(z);
  let outEl;
  if (z.outputUnavailable) {
    outEl = h('select', { class: 'dsel warn', 'aria-label': `${z.name} output`, onchange: ev => pick(ev.target.value) },
      h('option', { value: '', selected: true }, '⚠ Output unavailable'), ...outs.filter(o => o.connected).map(o => h('option', { value: o.endpointDbId }, `${outputLabel(o)} — ${dms(o)}`)));
  } else if (outs.length <= 1) {
    outEl = h('div', { class: 'small dim dsingle' }, z.isWeb ? 'One output (this browser\'s default)' : cur ? `${outputLabel(cur)} (the only output)` : 'No output reported yet');
  } else {
    outEl = h('select', { class: 'dsel', 'aria-label': `${z.name} output`, onchange: ev => pick(ev.target.value) }, ...outs.map(o => h('option', { value: o.endpointDbId, selected: o === cur, disabled: !o.connected }, `${outputLabel(o)} — ${dms(o)}${o.connected ? '' : ' (unplugged)'}`)));
  }
  if (outEl.tagName === 'SELECT') ro(outEl, can, hint);
  async function pick(id) { if (!id) return; try { await api(`/zones/${z.id}/output`, { method: 'POST', body: { endpointId: +id } }); toast('Output switched - its own delay is back'); ctl.refreshAll(); } catch (e) { toast(e.message, true); ctl.refreshAll(); } }
  const ms = cur && !cur.notCalibrated ? Math.round(cur.latencyMs) : 0;
  const val = h('span', { class: 'dms' }, cur && cur.notCalibrated ? 'not set' : ms + ' ms');
  const sl = h('input', { type: 'range', min: 0, max: 1000, step: 5, value: Math.min(1000, ms), 'aria-label': `${z.name} delay in milliseconds`,
    oninput: ev => { val.textContent = ev.target.value + ' ms'; clearTimeout(sl._t); sl._t = setTimeout(() => put(+ev.target.value, true), 220); },
    onchange: ev => put(+ev.target.value, false) });
  async function put(v, live) { if (!cur) return; try { await api(`/outputs/${encodeURIComponent(cur.deviceId)}/latency`, { method: 'PUT', body: { latencyMs: v, playerId: z.playerId, method: 'manual', live } }); if (!live) toast(`Delay ${v} ms saved for ${outputLabel(cur)}`); } catch (e) { toast(e.message, true); } }
  ro(sl, can && !!cur, cur ? hint : 'No output yet.');
  return [h('div', { class: 'dlbl' }, 'OUTPUT'), outEl,
    h('div', { class: 'dlbl row' }, h('span', { class: 'grow' }, 'DELAY'), val), sl, h('div', { class: 'dscale small dim' }, h('span', null, '0'), h('span', null, '1000 ms'))];
}

function expandedCard(S, ctl, z, hl) {
  const cls = 'dcard' + (z.enabled ? '' : ' off') + (hl ? ' hl' : '') + (z.mine ? ' mine' : '');
  let card;
  const flip = () => toggleSettings(S, ctl, z, card, hl);
  if (settingsFor === z.id) return (card = h('div', { class: cls + ' dset', 'data-room': z.name, 'data-zone-id': z.id }, cardSettings(S, ctl, z, flip)));
  const { vol, pct, mute } = volumeRow(S, ctl, z);
  const moreBtn = h('button', { class: 'dmore', 'aria-label': `Settings for ${z.name}`, title: 'Settings: calibrate, test sound, EQ, rename…', 'aria-expanded': 'false', onclick: ev => { ev.stopPropagation(); flip(); } }, '•••');
  // 0.2.1 F18: no Calibrate / Test sound buttons on the card face - a small status chip opens the card's settings when the delay needs attention
  const chips = [];
  if (canTune(S, z) && (z.badge === 'recheck' || z.badge === 'uncalibrated')) chips.push(h('button', { class: 'chip warn', title: 'Open this device\'s settings to calibrate', onclick: flip }, z.badge === 'recheck' ? 'Delay needs a re-check' : 'Delay not set'));
  if (z.health === 'starved') chips.push(h('span', { class: 'chip warn' }, 'Network is slow'));
  return (card = h('div', { class: cls, 'data-room': z.name, 'data-zone-id': z.id },
    // name gets its own line so it never truncates to "C…" next to the badges and switch
    h('div', { class: 'dtop' }, h('span', { class: 'dot ' + dotClass(z), title: stateText(z) }), h('b', { class: 'dname ell grow', title: z.name }, z.name), onSwitch(S, ctl, z), moreBtn),
    h('div', { class: 'dsub' }, ...badges(S, z), h('span', { class: 'dstate small' + (z.muted ? ' err' : ' dim') }, stateText(z))),
    h('div', { class: 'dlbl row' }, h('span', { class: 'grow' }, 'VOLUME'), pct), h('div', { class: 'dvol' }, icon('volume'), vol, mute),
    ...outputAndDelay(S, ctl, z),
    chips.length ? h('div', { class: 'chips' }, chips) : null,
    z.room && z.room.state !== 'ok' && z.room.state !== 'idle' && z.connected ? h('div', { class: 'small', style: 'color:var(--amber)' }, z.room.text + (z.room.detail ? ' - ' + z.room.detail : '')) : null));
}

function standardRow(S, ctl, z, open) {
  const { vol, pct, mute } = volumeRow(S, ctl, z);
  return h('div', { class: 'drow' + (z.enabled ? '' : ' off') + (z.mine ? ' mine' : ''), 'data-device': z.name },
    h('div', { class: 'dtop' }, h('span', { class: 'dot ' + dotClass(z), title: stateText(z) }),
      h('button', { class: 'dname ell', title: (z.mine ? 'This device. ' : '') + 'Show this device with all of its controls', onclick: () => open(z.id) }, z.name), ...badges(S, z, true),
      h('span', { class: 'dstate small' + (z.muted ? ' err' : ' dim') }, stateText(z)), h('span', { class: 'grow' }), onSwitch(S, ctl, z)),
    outputLine(z),
    h('div', { class: 'dvol' }, icon('volume'), vol, pct, mute));
}

const EMPTY = 'No devices yet. Every browser that opens WavWiz joins as a speaker by itself; for a PC with speakers, install WavWiz Player there (it finds this server by itself).';

/** Right-hand panel of the desktop layout in three sizes. ctl.setDevSize(size, highlightZoneId) switches size. */
export function devicesPanel(S, ctl) {
  const root = h('section', { class: 'devpanel', 'aria-label': 'Devices and zones' }), body = h('div', { class: 'devbody' });
  let size = loadDevSize(), hl = null, zpick = loadZonePick(), zedit = null;
  const setPick = v => { zpick = v; saveZonePick(v); draw(true); };
  const setEdit = v => { zedit = v; draw(true); };
  const colBtn = h('button', { class: 'plus devcol', 'aria-label': 'Collapse or open the Devices panel', 'aria-expanded': 'true', title: 'Collapse / open the Devices panel', onclick: () => ctl.toggleDev?.() }, '›');
  const expBtn = h('button', { class: 'plus devexp', 'aria-label': 'Expand the Devices panel', 'aria-pressed': 'false', title: 'Expanded devices (Esc returns)', onclick: () => ctl.toggleDevExpanded?.() }, '⤢');
  const escHint = h('span', { class: 'eschint small dim', 'aria-hidden': 'true' }, 'Esc');
  const count = h('span', { class: 'small dim devcount' });
  root.append(h('div', { class: 'pane-h devhead' }, colBtn, expBtn, h('span', { class: 'devtitle' }, 'DEVICES'), h('span', { class: 'grow devtitle' }), escHint, count), body);
  const setSize = (s, highlight = null) => {
    size = s; hl = highlight;
    colBtn.textContent = s === 'collapsed' ? '‹' : '›'; colBtn.setAttribute('aria-expanded', String(s !== 'collapsed'));
    colBtn.setAttribute('aria-label', s === 'collapsed' ? 'Open the Devices panel' : 'Collapse the Devices panel');
    expBtn.textContent = s === 'expanded' ? '⤡' : '⤢'; expBtn.setAttribute('aria-pressed', String(s === 'expanded'));
    expBtn.setAttribute('aria-label', s === 'expanded' ? 'Back to the normal layout' : 'Expand the Devices panel');
    root.classList.toggle('expanded', s === 'expanded'); draw(true);
    if (hl != null) setTimeout(() => body.querySelector(`.dcard[data-zone-id="${hl}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
  };
  function draw(force) {
    if (!force && body.contains(document.activeElement) && (document.activeElement.type === 'range' || document.activeElement.tagName === 'SELECT')) return;   // do not fight the user's finger
    if (!force && body.querySelector('.dmenu')) return;
    if (!force && size === 'expanded' && zedit !== null) return;          // F19: never redraw a zone's settings under the user's typing
    count.textContent = `${S.zones.length} device${S.zones.length === 1 ? '' : 's'} • ${S.zones.filter(z => z.connected).length} online`;
    if (size === 'collapsed') { body.replaceChildren(); return; }
    if (size === 'expanded') {
      // 0.2.1 F7: master volume keeps the full-width strip; zones move to the ~180 px sidebar on the right (variant B) and filter the cards
      if (zpick !== 'all' && !(S.groups || []).some(g => g.id === zpick)) zpick = 'all';
      const shown = zoneFilter(S.zones, S.groups, zpick);
      body.replaceChildren(h('div', { class: 'dexp-top' }, masterRow(S, ctl)),
        h('div', { class: 'dexp-main' },
          S.zones.length ? (shown.length ? h('div', { class: 'dgrid' }, shown.map(z => expandedCard(S, ctl, z, z.id === hl))) : h('p', { class: 'dim small pad' }, 'No devices in this zone yet. Use ⚙ next to the zone to add some.')) : h('p', { class: 'dim small pad' }, EMPTY),
          zonesSidebar(S, ctl, zpick, setPick, zedit, setEdit)));
      return;
    }
    const un = unassigned(S.zones, S.groups || []);
    body.replaceChildren(masterRow(S, ctl),
      S.zones.length ? S.zones.map(z => standardRow(S, ctl, z, id => ctl.setDevSize?.('expanded', id))) : h('p', { class: 'dim small pad' }, EMPTY),
      h('div', { class: 'pane-h' }, h('span', null, 'ZONES'), h('span', { class: 'grow' }), ro(h('button', { class: 'plus zbtn', 'aria-label': 'New zone', title: 'New zone', onclick: () => editZone(S, null, ctl.refreshAll) }, '+'), isAdmin(S))),
      (S.groups || []).length ? S.groups.map(g => h('div', { class: 'zrow2' + (g.active ? ' active' : ''), 'data-zone': g.name },
        ro(h('button', { class: 'zname ell', title: 'Play in this zone only', onclick: () => ctl.act(`/groups/${g.id}/activate`) }, g.name), canControl(S), 'Your access is view-only.'),
        g.active ? h('span', { class: 'badge-active' }, 'ACTIVE') : null, h('span', { class: 'small dim' }, `${g.members} device${g.members === 1 ? '' : 's'}`)))
        : h('p', { class: 'dim small pad' }, 'Zones are optional groups, like “Downstairs”. An administrator can create one to switch several devices on together.'),
      un.length && (S.groups || []).length ? [h('div', { class: 'pane-h' }, h('span', null, 'UNASSIGNED'), h('span', { class: 'grow' }), h('span', { class: 'small dim' }, String(un.length))),
        un.map(z => h('div', { class: 'urow' }, h('span', { class: 'dot ' + dotClass(z) }), h('span', { class: 'ell grow' }, z.name), h('span', { class: 'small dim' }, stateText(z))))] : null);
  }
  setSize(size);
  return { el: root, draw, setSize, get size() { return size; }, setCollapsed: c => setSize(c ? 'collapsed' : (size === 'collapsed' ? 'standard' : size)) };
}

/** The Devices & zones page (phone tab / narrow screens): master + zones on top, then one Expanded card per device. */
export function devicesView(S, ctl) {
  const root = h('div', { id: 'p-zones' }), top = h('div'), list = h('div', { class: 'dgrid one' }), foot = h('div', { class: 'row wrap', style: 'margin-top:6px' });
  root.append(h('h2', { class: 'pagetitle' }, 'Devices & zones'), top, list, foot);
  function draw() {
    if (root.contains(document.activeElement) && (document.activeElement.type === 'range' || document.activeElement.tagName === 'SELECT')) return;
    if (root.querySelector('.dmenu')) return;
    top.replaceChildren(masterRow(S, ctl), zonesStrip(S, ctl, false));
    list.replaceChildren(...(S.zones.length ? S.zones.map(z => expandedCard(S, ctl, z, false)) : [h('div', { class: 'card' }, h('h3', null, 'No devices yet'), h('p', { class: 'dim' }, EMPTY))]));
    const live = S.zones.some(z => z.enabled && z.connected);
    foot.replaceChildren(h('span', { class: 'dot ' + (live ? 'ok' : 'warn') }), live ? 'Synced playback active' : 'No device is switched on and connected', h('span', { class: 'grow' }),
      canControl(S) ? h('button', { class: 'btn', onclick: () => openCalibration(S, ctl.refreshAll) }, '🎤 Calibrate') : null);
  }
  return { el: root, draw };
}
export { roomPillClass, roomPill };
