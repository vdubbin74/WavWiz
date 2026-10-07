import { h, api, toast, dialog } from './util.js';
import { openCalibration } from './calibrate.js';
import { openEq } from './eq.js';
import { roomPillClass } from './diag.js';
import { latencyControl } from './latency.js';

export function openZone(S, zoneId, refresh) {
  const body = h('div'); const d = dialog('Device', body, [{ text: 'Close' }], { onClose: refresh });
  const can = S.auth.role !== 'view';
  const draw = async () => {
    let z; try { z = (await api('/zones')).find(x => x.id === zoneId); } catch (e) { body.replaceChildren(h('p', { class: 'err' }, e.message)); return; }
    if (!z) { body.replaceChildren(h('p', null, 'This device no longer exists.')); return; }
    d.el.querySelector('header span').textContent = z.name;
    const name = h('input', { type: 'text', value: z.name, maxlength: 40, 'aria-label': 'Device name' });
    const sections = [
      h('div', { class: 'card' }, h('div', { class: 'row' }, name, can ? h('button', { class: 'btn', onclick: async () => { try { await api(`/zones/${z.id}`, { method: 'PATCH', body: { name: name.value } }); toast('Renamed'); draw(); } catch (e) { toast(e.message, true); } } }, 'Rename') : null),
        h('p', { class: 'small dim' }, `${z.connected ? 'Connected' : 'Offline'}${z.remoteIp ? ' • ' + z.remoteIp : ''}${z.link ? ' • ' + z.link : ''}`),
        z.syncErrorMs != null ? h('p', { class: 'small' }, `Sync error ${z.syncErrorMs.toFixed(1)} ms • buffer ${Math.round(z.bufferMs ?? 0)} ms • underruns ${z.underruns ?? 0} • re-syncs ${z.hardResyncs ?? 0}`) : h('p', { class: 'small dim' }, z.isWeb ? 'Sync error: unknown (a phone page cannot measure it). Set the delay by ear.' : 'Sync error: unknown until something plays.'))];

    let hv = null; try { hv = await api(`/zones/${z.id}/health`); } catch { /* optional */ }
    const r = z.room;
    sections.push(h('div', { class: 'card' }, h('h3', null, 'Connection'),
      r ? h('div', { class: 'row wrap' }, h('span', { class: 'pill ' + roomPillClass(r.state) }, r.state), h('b', null, r.text)) : null, r?.detail ? h('p', { class: 'small' }, r.detail) : null,
      r ? h('p', { class: 'small dim' }, `Dropped ${r.drops}× • reconnected ${r.reconnects}× • buffer ran dry ${r.underrunEvents}× (since the server started).${z.link === 'wifi' && !z.isWeb ? ' This PC is on Wi-Fi - a network cable is the most reliable fix for dropouts.' : ''}`) : null,
      can ? h('div', { class: 'row wrap' }, h('button', { class: 'btn', disabled: !z.connected, onclick: async () => { try { await api(`/zones/${z.id}/test-sound`, { method: 'POST' }); toast('Playing a short chime in ' + z.name); } catch (e) { toast(e.message, true); } } }, '🔔 Test sound'), h('span', { class: 'small dim' }, 'A short two-note chime from this device only, to check the speaker is the right one.')) : null,
      hv?.events?.length ? h('details', null, h('summary', { class: 'small' }, `Recent events (${hv.events.length})`), h('table', { class: 'tbl' }, h('tbody', null, hv.events.map(e => h('tr', null, h('td', { class: 'mono small' }, e.at), h('td', null, e.kind), h('td', null, e.text)))))) : null));

    sections.push(h('div', { class: 'card' }, h('h3', null, 'Speakers (outputs)'), h('p', { class: 'dim small' }, 'Pick which output this PC uses. Each output has its own delay; switching is manual in this beta.'),
      z.outputs.length ? z.outputs.map(o => outputRow(z, o)) : h('p', { class: 'dim' }, 'This PC has not reported any outputs yet.')));
    if (S.auth.role === 'admin') sections.push(h('div', { class: 'card' }, h('h3', null, 'Forget this device'),
      h('p', { class: 'small dim' }, 'WavWiz stops trusting this device (its pairing is revoked) and removes it from every list and zone. If WavWiz Player is still running there, it shows “not paired” and offers to pair again.'),
      h('button', { class: 'btn danger', onclick: () => forget(z) }, 'Forget device…')));
    body.replaceChildren(...sections);
  };
  function forget(z) {
    dialog(`Forget “${z.name}”?`, h('div', null, h('p', null, 'Its pairing is revoked and it disappears from the device list and from any zone. Saved delays for its speakers are kept.'),
      h('p', { class: 'small dim' }, z.isWeb ? 'A phone used as a device can simply be added again later.' : 'The PC can be paired again from WavWiz Player (Pair again... in the tray menu) with a new 6-digit code.')),
    [{ text: 'Forget device', cls: 'danger', onclick: async () => { try { await api(`/players/${encodeURIComponent(z.playerId)}`, { method: 'DELETE' }); toast(`${z.name} was forgotten`); d.close(); refresh && refresh(); } catch (e) { toast(e.message, true); return false; } } }, { text: 'Cancel' }]);
  }
  function outputRow(z, o) {
    const put = (v, live) => api(`/outputs/${encodeURIComponent(o.deviceId)}/latency`, { method: 'PUT', body: { latencyMs: v, playerId: z.playerId, method: 'manual', live } });
    const status = h('span', { class: 'small dim latstatus', 'aria-live': 'polite' });
    // 0.0.8: slider + ms box in sync, applied live while dragging (folded into one history entry), saved on release
    const lat = latencyControl({ value: o.latencyMs, onChange: async (v, final) => { try { await put(v, true); status.textContent = final ? `Saved ${v} ms` : `${v} ms (live)`; } catch (e) { status.textContent = ''; toast(e.message, true); } } });
    const bt = h('input', { type: 'text', placeholder: 'AA:BB:CC:DD:EE:FF', maxlength: 17, style: 'width:150px' });
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', null, o.name), ' ', h('span', { class: 'small dim' }, `${o.kind}${o.codec ? ' • ' + o.codec : ''}${o.connected ? '' : ' • not connected'}`)),
        o.active ? h('span', { class: 'pill' }, 'IN USE') : (can && o.connected ? h('button', { class: 'btn', onclick: async () => { try { await api(`/zones/${z.id}/output`, { method: 'POST', body: { endpointId: o.endpointDbId } }); draw(); } catch (e) { toast(e.message, true); } } }, 'Use this output') : null)),
      h('div', { class: 'small ' + (o.notCalibrated ? 'amber' : 'dim'), style: 'margin:4px 0' }, o.label),
      can ? lat.el : null,
      can ? h('div', { class: 'row wrap' }, status, h('span', { class: 'grow' }),
        h('button', { class: 'btn', title: 'Keep this delay as a separate entry in the delay history', onclick: async () => { try { await put(lat.value, false); toast('Delay saved'); draw(); } catch (e) { toast(e.message, true); } } }, 'Save to history'),
        h('button', { class: 'btn primary', onclick: () => openCalibration(S, draw, z.id) }, '🎤 Calibrate')) : null,
      can && o.kind === 'bluetooth' && !o.btAddress ? h('div', { class: 'row wrap small', style: 'margin-top:6px' }, 'Bluetooth address (optional, links this speaker across PCs)', bt, h('button', { class: 'btn', onclick: async () => { try { await api(`/outputs/${o.endpointDbId}/link`, { method: 'POST', body: { btAddress: bt.value } }); toast('Linked'); draw(); } catch (e) { toast(e.message, true); } } }, 'Link')) : null,
      can ? h('div', { class: 'row wrap', style: 'margin-top:6px' }, h('button', { class: 'btn', onclick: async () => { try { await api('/speakers/profiles/capture', { method: 'POST', body: { deviceId: z.id, name: o.name, follow: true } }); toast('Saved profile and enabled Follow this speaker'); } catch (e) { toast(e.message, true); } } }, '📌 Follow this speaker'), h('span', { class: 'small dim' }, 'Saves delay/volume/EQ and moves playback to whichever PC this Bluetooth speaker connects to.')) : null,
      o.btAddress ? h('div', { class: 'small dim' }, 'Bluetooth address ' + o.btAddress) : null,
      can ? h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'btn', onclick: () => openEq(S, draw, o.deviceId) }, '🎚 Sound / EQ…'), h('button', { class: 'btn', onclick: () => history(o) }, 'Delay history…')) : null);
  }
  async function history(o) {
    let rows = []; try { rows = await api(`/outputs/${encodeURIComponent(o.deviceId)}/calibrations`); } catch (e) { return toast(e.message, true); }
    const dd = dialog('Delay history — ' + o.name, rows.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['When', 'Delay', 'How', ''].map(x => h('th', null, x)))), h('tbody', null, rows.map(r =>
      h('tr', null, h('td', null, new Date(r.measuredAt).toLocaleString()), h('td', null, `${Math.round(r.latencyMs)} ms`), h('td', null, r.method), h('td', null, can ? h('button', { class: 'btn', onclick: async () => { try { await api(`/calibrations/${r.id}/restore`, { method: 'POST' }); toast('Restored'); dd.close(); draw(); } catch (e) { toast(e.message, true); } } }, 'Use this') : null))))) : h('p', { class: 'dim' }, 'No saved delays yet.'), [{ text: 'Close' }]);
  }
  draw();
}
