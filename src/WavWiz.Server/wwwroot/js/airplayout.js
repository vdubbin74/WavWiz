import { h, api, toast } from './util.js';
import { adminTag } from './settingsui.js';

/** 0.5.0 stage 10 (WIP until the screenshots are approved): Settings > Network > "AirPlay speakers (experimental)".
 *  Two switches (AirPlay 2 speakers, buffered AAC), the connected outputs and the firewall rules. Admin only. */
export function airplayOutCard(admin) {
  const box = h('div', { class: 'card', id: 'sec-airplay-out' });
  if (!admin) { box.append(h('h3', null, 'AirPlay speakers (experimental) ', adminTag()), h('p', { class: 'dim small' }, 'Only an administrator can change AirPlay speaker output.')); return box; }
  const sw = (key, label, on, hint) => h('label', { class: 'row apo-sw' },
    h('span', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: on, 'aria-label': label, 'data-apo': key, onchange: ev => save({ [key]: ev.target.checked }) }), h('span', { 'aria-hidden': 'true' })),
    h('span', { class: 'grow' }, h('b', null, label), h('span', { class: 'dim small apo-hint' }, hint)));
  async function save(body) { try { await api('/airplay/settings', { method: 'POST', body }); toast('Saved'); paint(); } catch (e) { toast(e.message, true); } }
  async function paint() {
    let s, outs = [];
    try { s = await api('/airplay/settings'); outs = await api('/dev/airplay/outputs'); } catch (e) { box.replaceChildren(h('h3', null, 'AirPlay speakers (experimental)'), h('span', { class: 'err' }, e.message)); return; }
    box.replaceChildren(h('h3', null, 'AirPlay speakers (experimental)'),
      h('p', { class: 'dim small' }, 'Play WavWiz zones on AirPlay speakers. AirPlay 1 speakers work as they are; AirPlay 2 speakers (Sonos, recent receivers) are new and still being tested.'),
      sw('airPlay2Experimental', 'AirPlay 2 speakers', s.airPlay2Experimental, 'WavWiz becomes the speakers’ clock (PTP).'),
      sw('airPlay2Buffered', 'Buffered audio (AAC)', s.airPlay2Buffered, s.ffmpeg ? 'Faster pause and seek. Off: uncompressed realtime audio.' : 'Needs ffmpeg, which was not found - realtime audio is used.'),
      h('div', { class: 'apo-list' }, outs.length ? outs.map(o => h('div', { class: 'apo-out', 'data-key': o.key },
        h('b', null, o.name), h('span', { class: 'dim small' }, ` ${o.kind} · ${o.address}`), o.error ? h('span', { class: 'err small' }, ' ' + o.error) : null))
        : h('div', { class: 'dim small' }, 'No AirPlay speakers connected.')),
      h('details', { class: 'apo-fw' }, h('summary', { class: 'small' }, 'Windows firewall rules'),
        h('p', { class: 'dim small' }, 'Run once in an administrator prompt (private networks only). PTP needs UDP 319 and 320.'),
        ...s.firewall.map(r => h('pre', { class: 'mono small' }, r))));
  }
  paint();
  // F112: Diagnostics Connect/Disconnect asks this card to refresh its connected list (listener drops itself once the card is gone)
  const onOuts = () => { if (!box.isConnected) { window.removeEventListener('wavwiz:airplay-outputs', onOuts); return; } paint(); };
  window.addEventListener('wavwiz:airplay-outputs', onOuts);
  return box;
}
