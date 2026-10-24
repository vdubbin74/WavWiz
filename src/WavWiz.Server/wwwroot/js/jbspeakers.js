// WavWiz 0.4.9 F76: the Jukebox speaker picker shared by Settings > Jukebox (Default speakers) and Playback > Start Jukebox….
import { h, api } from './util.js';
/** Pure: the ids to start with - the saved defaults, else the Jukebox zone's current speakers; only ids that still exist. */
export function initialPick(defaults, current, zones) { const have = new Set((zones || []).map(z => z.id)); return [...new Set((defaults ?? current ?? []).filter(id => have.has(id)))]; }
/** A checkbox list of every speaker (online first, then by name). onChange(ids) gets the new selection. */
export function speakerPicker(zones, selected, onChange, { disabled = false, label = 'Jukebox speakers' } = {}) {
  const sel = new Set(selected || []);
  const list = (zones || []).slice().sort((a, b) => (b.connected - a.connected) || String(a.name).localeCompare(b.name));
  const el = h('div', { class: 'jbspk76', role: 'group', 'aria-label': label },
    list.length ? list.map(z => h('label', { class: 'jbspk76-r' + (sel.has(z.id) ? ' on' : ''), 'data-device-id': z.id },
      h('input', { type: 'checkbox', checked: sel.has(z.id), disabled: disabled || undefined, 'aria-label': z.name, onchange: ev => { ev.target.checked ? sel.add(z.id) : sel.delete(z.id); ev.target.closest('label').classList.toggle('on', ev.target.checked); onChange?.([...sel]); } }),
      h('span', { class: 'dot ' + (z.connected ? 'ok' : 'off'), title: z.connected ? 'Online' : 'Offline' }), h('span', { class: 'ell' }, z.name))) : h('p', { class: 'small dim' }, 'No speakers yet.'));
  el.value = () => [...sel];
  return el;
}
/** Make these the Jukebox zone's speakers (and tell Devices). */
export async function applyJukeboxSpeakers(ids) { const r = await api('/jukebox/zone', { method: 'PUT', body: { deviceIds: ids } }); window.dispatchEvent(new CustomEvent('wavwiz:zones-changed')); return r; }
