import { h, api, toast } from './util.js';

/** 0.5.0 AirPlay sender stage 1: admin-only developer card listing AirPlay speakers found on the network (discovery only, nothing connects).
 *  F112: each row has Connect / Disconnect for audio tests (POST /dev/airplay/connect|disconnect). */
export function airplayDevCard(S) {
  if (S?.auth?.role !== 'admin') return null;
  const box = h('div', { class: 'card', id: 'diag-airplay-dev' }), out = h('div', { class: 'small dim' }, 'Looking for AirPlay speakers…');
  // F112: Connect / Disconnect per row (audio test). Only the Action cells are re-painted after a request; the table and page stay put.
  let outs = new Set(); const busy = new Set();
  const self = x => /^WavWiz\s*[–-]/.test(x.name || '') && (x.addresses || []).concat(x.host ? [x.host] : []).some(a => a && (a === location.hostname || String(a).replace(/\.$/, '').toLowerCase() === location.hostname.toLowerCase()));
  async function loadOuts() { try { outs = new Set((await api('/dev/airplay/outputs')).map(o => o.key)); } catch { /* keep last */ } }
  function actCell(x) {
    if (self(x)) return h('span', { class: 'dim small', title: 'This is WavWiz itself.' }, 'this server');
    const on = outs.has(x.id), b = busy.has(x.id), need = !on && (x.password || x.pin);
    return h('button', { class: 'btn sm', type: 'button', 'data-act': on ? 'disconnect' : 'connect', disabled: b || need,
      title: need ? 'Needs a password or PIN — not supported in this test UI yet.' : null, onclick: () => act(x, on) }, b ? (on ? 'Disconnecting…' : 'Connecting…') : on ? 'Disconnect' : 'Connect');
  }
  let rows = [];
  function paintActs() { for (const x of rows) { const td = out.querySelector(`tr[data-id="${CSS.escape(x.id)}"] td.apd-act`); if (td) td.replaceChildren(actCell(x)); } }
  async function act(x, on) {
    if (busy.has(x.id)) return; busy.add(x.id); paintActs();
    try { await api(on ? '/dev/airplay/disconnect' : '/dev/airplay/connect', { method: 'POST', body: { key: x.id } }); toast(on ? `Disconnected ${x.name}` : `Connected ${x.name}`); }
    catch (e) { toast(e.message, true); }
    busy.delete(x.id); await loadOuts(); paintActs(); window.dispatchEvent(new CustomEvent('wavwiz:airplay-outputs'));
  }
  async function paint() {
    await loadOuts();
    let d; try { d = await api('/dev/airplay'); } catch (e) { out.replaceChildren(h('span', { class: 'err' }, e.message)); return; }
    const head = h('div', { class: 'small dim' }, `${d.devices.length} found • ${d.packets} mDNS answers heard${d.problem ? ' • ' + d.problem : ''}`);
    rows = d.devices;
    if (!d.devices.length) { out.replaceChildren(head, h('div', { class: 'small dim' }, 'None yet. Answers usually arrive within a few seconds.')); return; }
    out.replaceChildren(head, h('div', { style: 'overflow-x:auto' }, h('table', { class: 'tbl small', id: 'airplay-dev-table' },
      h('thead', null, h('tr', null, ['Name', 'Address', 'RAOP port', 'AirPlay 2', 'Codecs', 'Encryption', 'Model', 'Route', 'Action'].map(t => h('th', null, t)))),
      h('tbody', null, d.devices.map(x => h('tr', { 'data-id': x.id, title: `id ${x.id} • features ${x.features} (${x.featureNames.join(', ') || 'none'}) • flags ${x.flags}${x.password ? ' • password' : ''}${x.pin ? ' • PIN' : ''}` },
        h('td', null, h('b', null, x.name)), h('td', { class: 'mono', style: 'white-space:nowrap' }, (x.addresses[0] || x.host || '?')),
        h('td', { class: 'mono' }, x.raopPort || '–'), h('td', null, x.airplay2 ? `yes (port ${x.airplayPort || '?'})` : 'no'),
        h('td', null, x.codecs || '–'), h('td', null, x.encryption), h('td', null, x.model || '–'), h('td', { class: 'mono', style: 'white-space:nowrap' }, x.route), h('td', { class: 'apd-act', style: 'white-space:nowrap' }, actCell(x))))))),
      h('div', { class: 'small dim apd-note' }, 'Audio only · experimental. AirPlay 2 needs Settings → Network → AirPlay speakers (experimental) → AirPlay 2 speakers on, plus the PTP firewall rules (UDP 319/320).'));
  }
  const again = async () => { try { await api('/dev/airplay/query', { method: 'POST' }); } catch (e) { toast(e.message, true); } setTimeout(paint, 1200); };
  box.append(h('div', { class: 'row wrap' }, h('h3', { class: 'grow' }, 'AirPlay speakers (developer)'), h('button', { class: 'btn', onclick: again }, 'Search again')),
    h('div', { class: 'small dim' }, 'Admin only. Lists AirPlay speakers on the network; Connect adds one as a test audio output.'), out);
  paint(); setTimeout(paint, 1500); setTimeout(paint, 5000);
  return box;
}
