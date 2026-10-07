import { h, api, toast, dialog } from './util.js';
import { roomPill, roomPillClass } from './diag.js';
import { openZone } from './zone.js';
import { openCalibration } from './calibrate.js';
import { canControl } from './ui.js';

// Devices are the speakers (one per PC player or phone). ZONES are optional named groups of devices. A device that is in no zone is listed under UNASSIGNED.
const latencyText = z => { const o = z.outputs.find(x => x.active); if (!o) return 'no output'; return o.notCalibrated ? 'delay not measured' : `${Math.round(o.latencyMs)} ms delay`; };
const stateText = z => !z.connected ? 'Offline' : ({ ok: 'Playing', idle: 'Online', buffering: 'Buffering', dropped: 'Dropped', reconnecting: 'Reconnecting', offline: 'Offline' }[z.room?.state] || 'Online');
const dotClass = z => !z.connected ? 'off' : ({ ok: 'ok', idle: 'ok', buffering: 'warn', dropped: 'bad', reconnecting: 'bad' }[z.room?.state] || 'ok');
export const unassigned = (zones, groups) => { const inG = new Set(groups.flatMap(g => g.deviceIds)); return zones.filter(z => !inG.has(z.id)); };

/** Confirm + remove a zone (the group only; its devices stay and become Unassigned). Playback is stopped by the server first when this zone is the one playing. */
export function confirmRemoveZone(S, g, done) {
  dialog(`Remove zone “${g.name}”?`, h('div', null, h('p', null, 'The zone and its settings are deleted. Its devices are not touched - they simply move to Unassigned.'),
    g.active ? h('p', { class: 'warnc' }, 'This zone is the one playing now: playback stops first.') : null),
  [{ text: 'Remove zone', cls: 'danger', onclick: async () => { try { await api(`/groups/${g.id}`, { method: 'DELETE' }); toast(`Zone “${g.name}” removed`); } catch (e) { toast(e.message, true); return false; } done?.(); } }, { text: 'Cancel' }]);
}
/** Create or edit a zone: a name and the devices in it. */
export function editZone(S, g, done) {
  const name = h('input', { type: 'text', maxlength: 60, value: g?.name || '', placeholder: 'e.g. Downstairs', 'aria-label': 'Zone name' }), picked = new Set(g?.deviceIds || []);
  const boxes = S.zones.map(z => h('label', { class: 'row zrow' }, h('input', { type: 'checkbox', checked: picked.has(z.id), onchange: ev => { ev.target.checked ? picked.add(z.id) : picked.delete(z.id); } }), h('span', { class: 'dot ' + dotClass(z) }), z.name + (z.isWeb ? ' (phone)' : '')));
  dialog(g ? 'Edit zone' : 'New zone', h('div', null, h('div', { class: 'field' }, h('label', null, 'Name'), name), h('div', { class: 'sec' }, 'Devices in this zone'), boxes.length ? boxes : h('p', { class: 'dim' }, 'No devices yet. Connect WavWiz Player on a PC, or use this phone as a device.')),
    [{ text: g ? 'Save' : 'Create zone', cls: 'primary', onclick: async () => { try { const body = { name: name.value, deviceIds: [...picked] }; await api(g ? `/groups/${g.id}` : '/groups', { method: g ? 'PATCH' : 'POST', body }); toast('Saved'); } catch (e) { toast(e.message, true); return false; } done?.(); } }, { text: 'Cancel' }]);
}

function volumeRow(S, ctl, z, can) {
  const pct = h('span', { class: 'pct' }, Math.round(z.volume) + '%');
  const vol = h('input', { type: 'range', min: 0, max: 100, value: z.volume, 'aria-label': `${z.name} volume`, disabled: !can, oninput: ev => { pct.textContent = ev.target.value + '%'; clearTimeout(vol._t); vol._t = setTimeout(() => ctl.act(`/zones/${z.id}`, { volume: +ev.target.value }, 'PATCH'), 100); } });
  return [vol, pct];
}

/** Right-hand panel of the desktop layout: DEVICES / ZONES / UNASSIGNED. */
export function devicesPanel(S, ctl) {
  const root = h('section', { class: 'devpanel', 'aria-label': 'Devices and zones' }), body = h('div', { class: 'devbody' });
  // 0.0.8: collapse arrow (mirrors the Library panel's); the header stays visible as a thin strip when collapsed
  const colBtn = h('button', { class: 'plus devcol', 'aria-label': 'Collapse or expand devices and zones', 'aria-expanded': 'true', title: 'Collapse / expand devices & zones', onclick: () => ctl.toggleDev?.() }, '›');
  const count = h('span', { class: 'small dim devcount' });
  root.append(h('div', { class: 'pane-h devhead' }, colBtn, h('span', { class: 'devtitle' }, 'DEVICES'), h('span', { class: 'grow devtitle' }), count), body);
  const setCollapsed = c => { colBtn.textContent = c ? '‹' : '›'; colBtn.setAttribute('aria-expanded', String(!c)); };
  function draw() {
    if (body.contains(document.activeElement) && document.activeElement.type === 'range') return;
    const can = canControl(S), un = unassigned(S.zones, S.groups || []);
    const devRow = z => h('div', { class: 'drow' + (z.enabled ? '' : ' off'), 'data-device': z.name },
      h('div', { class: 'dtop' }, h('span', { class: 'dot ' + dotClass(z), title: stateText(z) }), h('button', { class: 'dname ell', title: 'Device settings', onclick: () => openZone(S, z.id, ctl.refreshAll) }, z.name + (z.isWeb ? ' 📱' : '')),
        h('span', { class: 'dstate small dim' }, z.enabled ? stateText(z) : 'Off'),
        h('div', { class: 'sw sm' + (z.enabled ? ' on' : ''), role: 'switch', 'aria-checked': String(z.enabled), 'aria-label': `${z.name} on or off`, tabindex: 0, onclick: () => can && ctl.act(`/zones/${z.id}`, { enabled: !z.enabled }, 'PATCH'), onkeydown: e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.target.click(); } } })),
      h('div', { class: 'dvol' }, h('span', { 'aria-hidden': 'true', class: 'small' }, '🔈'), ...volumeRow(S, ctl, z, can)));
    count.textContent = `${S.zones.filter(z => z.connected).length}/${S.zones.length} online`;
    body.replaceChildren(
      S.zones.length ? S.zones.map(devRow) : h('p', { class: 'dim small pad' }, 'No devices yet. Install WavWiz Player on a PC with speakers (it finds this server by itself), or use this phone as a device.'),
      h('div', { class: 'pane-h' }, h('span', null, 'ZONES'), h('span', { class: 'grow' }), can ? h('button', { class: 'plus zbtn', 'aria-label': 'New zone', title: 'New zone', onclick: () => editZone(S, null, ctl.refreshAll) }, '+') : null),
      (S.groups || []).length ? S.groups.map(g => h('div', { class: 'zrow2' + (g.active ? ' active' : ''), 'data-zone': g.name },
        h('button', { class: 'zname ell', title: can ? 'Play in this zone only' : g.name, onclick: () => can && ctl.act(`/groups/${g.id}/activate`) }, g.name),
        g.active ? h('span', { class: 'badge-active' }, 'ACTIVE') : null, h('span', { class: 'small dim' }, `${g.members} device${g.members === 1 ? '' : 's'}`),
        can ? h('button', { class: 'zbtn zedit', 'aria-label': `Edit zone ${g.name}`, title: 'Edit zone', onclick: () => editZone(S, g, ctl.refreshAll) }, '✎') : null,
        can ? h('button', { class: 'zbtn danger', 'aria-label': `Remove zone ${g.name}`, title: 'Remove zone', onclick: () => confirmRemoveZone(S, g, ctl.refreshAll) }, '✕') : null))
        : h('p', { class: 'dim small pad' }, 'Zones are optional groups, like “Downstairs”. Create one to switch several devices on together.'),
      h('div', { class: 'pane-h' }, h('span', null, 'UNASSIGNED'), h('span', { class: 'grow' }), h('span', { class: 'small dim' }, String(un.length))),
      un.length ? un.map(z => h('div', { class: 'urow' }, h('span', { class: 'dot ' + dotClass(z) }), h('span', { class: 'ell grow' }, z.name), h('span', { class: 'small dim' }, z.isWeb ? 'Mobile' : stateText(z)))) : h('p', { class: 'dim small pad' }, S.zones.length ? 'Every device is in a zone.' : '—'),
      h('div', { class: 'pane-foot' }, h('button', { class: 'btn', onclick: () => ctl.go('devices') }, '⚙ Manage devices & zones')));
  }
  return { el: root, draw, setCollapsed };
}

/** The full Devices & zones page (desktop dialog / phone tab): one card per device with the dropped / buffering / reconnecting pill, then the zones. */
export function devicesView(S, ctl) {
  const root = h('div', { id: 'p-zones' }); const list = h('div'), zoneBox = h('div'), foot = h('div', { class: 'row wrap', style: 'margin-top:6px' });
  root.append(h('h2', { class: 'pagetitle' }, 'Devices & zones'), h('div', { class: 'sec' }, 'Devices'), list, h('div', { class: 'row' }, h('div', { class: 'sec grow' }, 'Zones'), canControl(S) ? h('button', { class: 'btn accent-o zadd', 'aria-label': 'Add a zone', onclick: () => editZone(S, null, ctl.refreshAll) }, '+ Add zone') : null), zoneBox, foot);
  function draw() {
    if (list.contains(document.activeElement) && document.activeElement.type === 'range') return;     // do not fight the user's finger
    const can = canControl(S);
    const cards = S.zones.map(z => {
      const act_ = z.outputs.find(o => o.active);
      const sw = h('div', { class: 'sw' + (z.enabled ? ' on' : ''), role: 'switch', 'aria-checked': String(z.enabled), 'aria-label': `${z.name} on or off`, tabindex: 0, onclick: () => can && ctl.act(`/zones/${z.id}`, { enabled: !z.enabled }, 'PATCH'), onkeydown: e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.target.click(); } } });
      const [vol, pct] = volumeRow(S, ctl, z, can);
      const chips = [];
      if (z.badge === 'recheck') chips.push(h('button', { class: 'chip warn', onclick: () => openCalibration(S, ctl.refreshAll, z.id) }, 'Re-check delay'));
      if (z.badge === 'uncalibrated' && can) chips.push(h('button', { class: 'chip warn', onclick: () => openCalibration(S, ctl.refreshAll, z.id) }, z.isWeb ? 'Set delay by ear' : 'Calibrate'));
      if (z.health === 'starved') chips.push(h('span', { class: 'chip warn' }, 'Network is slow'));
      if (can && z.connected) chips.push(h('button', { class: 'chip', 'aria-label': `Play a test sound in ${z.name}`, onclick: async () => { try { await api(`/zones/${z.id}/test-sound`, { method: 'POST' }); toast('Playing a chime in ' + z.name); } catch (e) { toast(e.message, true); } } }, '🔔 Test sound'));
      const zs = (S.groups || []).filter(g => g.deviceIds.includes(z.id)).map(g => g.name);
      return h('div', { class: 'card room' + (z.enabled ? '' : ' off'), 'data-room': z.name }, sw,
        h('div', { class: 'grow', style: 'min-width:0' }, h('div', { class: 'nm', onclick: () => openZone(S, z.id, ctl.refreshAll) }, h('span', { class: 'ell' }, z.name + (z.isWeb ? ' 📱' : '')), roomPill(z)),
          h('div', { class: 'sub small dim ell' }, [z.link, act_?.name, latencyText(z), zs.length ? 'Zone: ' + zs.join(', ') : 'Unassigned'].filter(Boolean).join(' • ') || (z.connected ? 'connected' : 'not connected'))),
        h('div', { class: 'vol row' }, vol, pct), chips.length ? h('div', { class: 'chips' }, chips) : null,
        z.room && z.room.state !== 'ok' && z.room.state !== 'idle' ? h('div', { class: 'small', style: 'grid-column:1/-1;color:var(--amber)' }, z.room.text + (z.room.detail ? ' - ' + z.room.detail : '')) : null);
    });
    list.replaceChildren(...(cards.length ? cards : [h('div', { class: 'card' }, h('h3', null, 'No devices yet'), h('p', { class: 'dim' }, 'Install WavWiz Player on a PC with speakers. It finds this server by itself - you only type the 6-digit code from Settings > Players. Or use this phone as a device.'))]));
    zoneBox.replaceChildren(...((S.groups || []).length ? S.groups.map(g => h('div', { class: 'card zonecard' + (g.active ? ' active' : ''), 'data-zone': g.name },
      h('div', { class: 'row wrap' }, h('b', { class: 'grow ell' }, g.name), g.active ? h('span', { class: 'badge-active' }, 'ACTIVE') : null, h('span', { class: 'small dim' }, `${g.members} device${g.members === 1 ? '' : 's'}, ${g.online} online`)),
      h('div', { class: 'small dim' }, g.deviceIds.map(id => S.zones.find(z => z.id === id)?.name).filter(Boolean).join(', ') || 'No devices in this zone yet.'),
      can ? h('div', { class: 'row wrap', style: 'margin-top:6px' }, h('button', { class: 'btn primary', disabled: !g.members, onclick: () => ctl.act(`/groups/${g.id}/activate`) }, 'Play in this zone'), h('button', { class: 'btn zedit', 'aria-label': `Edit zone ${g.name}`, onclick: () => editZone(S, g, ctl.refreshAll) }, '✎ Edit'), h('button', { class: 'btn danger zdel', onclick: () => confirmRemoveZone(S, g, ctl.refreshAll) }, 'Remove zone')) : null))
      : [h('p', { class: 'dim' }, 'No zones yet. Zones are optional groups of devices, like “Downstairs” or “Garden”. Without zones every device simply plays together.')]));
    const un = unassigned(S.zones, S.groups || []);
    if (un.length && (S.groups || []).length) zoneBox.append(h('div', { class: 'card' }, h('div', { class: 'sec', style: 'margin-top:0' }, 'Unassigned / mobile'), h('div', { class: 'small dim' }, un.map(z => z.name).join(', '))));
    const live = S.zones.some(z => z.enabled && z.connected);
    foot.replaceChildren(h('span', { class: 'dot ' + (live ? 'ok' : 'warn') }), live ? 'Synced playback active' : 'No device is switched on and connected', h('span', { class: 'grow' }),
      can ? h('button', { class: 'btn', onclick: () => openCalibration(S, ctl.refreshAll) }, '🎤 Calibrate') : null);
  }
  return { el: root, draw };
}
export { roomPillClass };
