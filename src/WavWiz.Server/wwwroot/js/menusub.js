// WavWiz 0.3.6 K16-K19: the data behind the menu flyouts (hover submenus). Each builder returns a menu spec (same tuples menu.js uses) and never throws -
// a failed fetch gives an empty list, so the menu still opens. Items that only choose from a list live here; the actions stay in main.js (ctl.*).
import { groupPresets } from './eqsettings.js';   // 0.4.4 F6
import { api, toast } from './util.js';
import { SLEEP, sleepChip } from './scenesched.js';
import { eqTarget, ownEqName } from './eqstyle.js';
import { thisDevice } from './ui.js';

/** File > New shortcuts (K17). Checked against the browser and the app: Ctrl+Shift+Z is redo in a text field (ignored while typing), Ctrl+Shift+J is the Jukebox exit chord (untouched). */
export const NEW_KEYS = { zone: 'Ctrl+Shift+Z', scene: 'Ctrl+Shift+S', alarm: 'Ctrl+Shift+A', schedule: 'Ctrl+Shift+H' };
export const NEW_KIND_BY_CODE = { KeyZ: 'zone', KeyS: 'scene', KeyA: 'alarm', KeyH: 'schedule' };
/** The kind a keydown asks for, or null. Ctrl (or Cmd) + Shift, no Alt; not while typing in a field (so redo and text editing keep working). */
export function newKindForKey(ev, typing = false) {
  if (typing || !(ev.ctrlKey || ev.metaKey) || !ev.shiftKey || ev.altKey) return null;
  return NEW_KIND_BY_CODE[ev.code] || null;
}
export const isTypingTarget = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));

const safe = async fn => { try { return await fn(); } catch { return null; } };
const cap = (s, n = 38) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

/** Playback > Sleep timer (K16): 15 / 30 / 45 / 60 / End of song / Off. */
export function sleepSpec(S) {
  const pick = [[15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '60 minutes'], ['song', 'End of song'], ['off', 'Off']];
  return pick.map(([v, t]) => [t, async () => {
    const body = { zoneIds: [] }; if (v === 'off' || v === 'song') body.mode = v; else body.minutes = v;
    try { const st = await api('/sleep', { method: 'POST', body }); sleepChip(S, st); toast(v === 'off' ? 'Sleep timer is off' : `Sleep timer: ${t.toLowerCase()}`); } catch (e) { toast(e.message, true); }
  }]);
}
export { SLEEP };

/** Playback > Sound / EQ (K16): the presets, applied to this device's output; "Open the EQ" last. */
export async function eqSpec(S, ctl) {
  const presets = (await safe(() => api('/dsp/presets'))) || [];
  const o = eqTarget(S.zones, thisDevice(S));
  const groups = groupPresets(presets);   // 0.4.4 F6: same list as every picker - 8 built-ins, a rule, then My presets
  const one = p => [cap(p.name) + (p.source === 'builtin' ? '' : ' ★'), async () => {
    if (!o) { ctl.go('eq'); return; }
    try { const kept = await assignPreset(o, p, presets);
      window.dispatchEvent(new CustomEvent('wavwiz:eqchanged', { detail: { deviceId: o.deviceId } })); toast(`Sound: ${p.name}${kept ? ' (Direct stays on)' : ''}`); ctl.go('eq'); } catch (e) { toast(e.message, true); }
  }];
  const builtin = groups.filter(g => !g.label).flatMap(g => g.items).map(one), mine = groups.filter(g => g.label).flatMap(g => g.items).map(one);
  const items = [...builtin, ...(builtin.length && mine.length ? ['hr'] : []), ...mine];
  return [...items, ...(items.length ? ['hr'] : []), ['Open the EQ', () => ctl.go('eq')]];
}

/** 0.7.3: Direct (no processing) lives in the speaker's own preset (direct: true). Picking another preset for a speaker that has Direct on
 * copies that preset into the speaker's own preset with direct kept, so the pick never turns Direct off. Pure: the {name, preset} to save, or null. */
export function directKeepBody(picked, current, speaker) {
  if (!current?.json?.direct || !picked) return null;
  const name = ownEqName(speaker);
  return { name, preset: { ...(picked.json || {}), name, direct: true } };
}
/** 0.7.3: assign a preset to an output, keeping Direct on when it was on. Returns true when Direct was kept. apiFn is injectable for tests. */
export async function assignPreset(o, p, presets, apiFn = api) {
  const dev = encodeURIComponent(o.deviceId);
  const a = await apiFn(`/dsp/assignments/${dev}`).catch(() => null);
  const current = a?.presetId != null ? (presets || []).find(x => x.id === a.presetId) : null;
  const keep = directKeepBody(p, current, o.zone);
  let id = p.id;
  if (keep) {
    const mine = (presets || []).find(x => x.source !== 'builtin' && x.name === keep.name);
    if (mine) { await apiFn(`/dsp/presets/${mine.id}`, { method: 'PUT', body: keep }); id = mine.id; } else id = (await apiFn('/dsp/presets', { method: 'POST', body: keep })).id;
  }
  await apiFn(`/dsp/assignments/${dev}`, { method: 'PUT', body: { presetId: id, enabled: true, bypass: false } });
  return !!keep;
}

/** Library > Playlists… (K16): the saved playlists (click opens it in the Library) and "All playlists…". */
export async function playlistsSpec(S, ctl) {
  const lists = (await safe(() => api('/playlists'))) || [];
  return [...lists.map(p => [cap(p.name), () => ctl.openPlaylist ? ctl.openPlaylist(p.id) : ctl.go('playlists')]), ...(lists.length ? ['hr'] : []), ['All playlists…', () => ctl.go('playlists')]];
}

/** Devices menu (K18): devices / zones / scenes, each ends with "New…". Clicking jumps to the item (no Start buttons here; File > Run is the one place to start). */
export const devicesSpec = S => [...(S.zones || []).map(z => [cap(z.name), () => window.dispatchEvent(new CustomEvent('wavwiz:jump', { detail: { kind: 'device', id: z.id } }))])];
export const zonesSpec = (S, ctl) => [...(S.groups || []).map(g => [cap(g.name), () => ctl.jumpTo('zone', g.id)]), ...((S.groups || []).length ? ['hr'] : []), ['New…', () => ctl.openNew('zone'), () => !ctl.canAdmin?.()]];
export async function scenesSpec(S, ctl) {
  const scenes = (await safe(() => api('/scenes'))) || [];
  return [...scenes.map(s => [cap(s.name), () => ctl.jumpTo('scene', s.id)]), ...(scenes.length ? ['hr'] : []), ['New…', () => ctl.openNew('scene'), () => !ctl.canAdmin?.()]];
}
export const deviceListSpec = (S, ctl) => [...(S.zones || []).map(z => [cap(z.name), () => ctl.jumpTo('device', z.id)]), ...((S.zones || []).length ? ['hr'] : []), ['Pair a player…', () => ctl.go('settings:players'), () => !ctl.canAdmin?.()]];

/** File > Run (K19): scenes, schedules and alarms in ONE submenu; the only place to start them. */
export async function runSpec(S, ctl) {
  const [scenes, rows] = await Promise.all([safe(() => api('/scenes')), safe(() => api('/schedules'))]);
  const out = [];
  const group = (title, arr, fn) => { if (!arr?.length) return; if (out.length) out.push('hr'); out.push([title, null, () => true, null, { heading: true }]); for (const x of arr) out.push([cap(x.name), () => fn(x)]); };
  group('Scenes', scenes, async s => { try { await api(`/scenes/${s.id}/apply`, { method: 'POST' }); toast(`${s.name} is on`); ctl.refreshAll(); } catch (e) { toast('The scene could not run. ' + e.message, true); } });
  const runRow = async r => { try { await api(`/schedules/${r.id}/run`, { method: 'POST' }); toast(`Ran ${r.name}`); ctl.refreshAll(); } catch (e) { toast(e.message, true); } };
  group('Schedules', (rows || []).filter(r => !r.alarm), runRow);
  group('Alarms', (rows || []).filter(r => r.alarm), runRow);
  return out.length ? out : [['Nothing to run yet', null, () => true]];
}
