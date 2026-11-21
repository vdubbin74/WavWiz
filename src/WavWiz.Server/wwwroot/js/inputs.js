// 0.7.2 M1: audio inputs of the WavWiz Player on the server PC - Library > Inputs tiles (live meters, play here / Everywhere / stop) and the
// Settings > Devices > Audio inputs card (admin: turn on, rename, gain, Turntable mode, auto-start, microphone as a live source).
// Server: /api/v1/inputs (InputsApi). Events: 'inputs' (list changed) and 'inputlevel' ({ id, peakDb, phonoLow }) arrive as wavwiz:inputs / wavwiz:inputlevel.
import { h, api, toast, getApiZone } from './util.js';
import { canControl, isAdmin } from './ui.js';

export const INPUTS_TITLE = 'Audio inputs';
export const NO_INPUTS = 'No audio inputs found on the server PC.';
export const PHONO_WARN = 'Very quiet - is the turntable plugged in without a phono preamp? Turn on the PHONO/LINE switch on the turntable, or use a phono preamp.';
export const MIC_MUTED = 'Muted - for Announce. An administrator can make it a live source.';
export const INPUT_TERMS = 'audio inputs aux in line in turntable record player vinyl phono s/pdif spdif optical coaxial microphone mic headset announce this pc speakers what you hear loopback';
/** Meters re-ask the server every 20 s while shown (its lease is 30 s, so a closed page stops capture by itself). */
export const METER_RENEW_MS = 20000;

/** Pure: the badges a tile shows, in order. */
export function inputBadges(i) {
  const b = [];
  if (i.playing) b.push(['Playing', 'ok']);
  if (!i.enabled) b.push(['Off', 'idle']);
  else if (i.muted) b.push(['Muted', 'idle']);
  if (i.turntable) b.push(['Turntable', '']);
  if (i.bluetooth) b.push(['Bluetooth', 'warn']);
  if (i.error) b.push(['Problem', 'bad']);
  return b;
}
/** Pure: meter fill 0..100 for a peak in dBFS (-60 dB = empty, 0 dB = full). */
export const meterPct = db => db == null || !isFinite(db) ? 0 : Math.max(0, Math.min(100, Math.round((db + 60) / 60 * 100)));
/** Pure: a meter only where there is a level to show - Aux / S/PDIF in while on (Settings / Library keep them listening), anything while it plays. */
export const showMeter = i => !!i.enabled && (!!i.playing || i.kind === 'aux' || i.kind === 'spdif');
/** Pure: what a tile's main button does: 'play', 'stop' or null (can't play: off, muted mic, view-only user). */
export function mainAction(i, control) {
  if (!control) return null;
  if (i.playing) return 'stop';
  return i.enabled && !i.muted ? 'play' : null;
}
/** Pure: "Playing in Kitchen" / "Playing Everywhere" from the view's zone field. */
export function whereText(i, zones = []) {
  if (!i.playing) return '';
  if (i.zone === 'everywhere') return 'Playing Everywhere';
  const z = zones.find(x => x.groupId === i.groupId || 'g:' + x.id === i.zone);
  return z?.name ? `Playing in ${z.name}` : 'Playing';
}

const SVG = {
  vinyl: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width=".8" opacity=".6"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/></svg>',
  aux: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="13" y="8" width="7" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="4" cy="12" r="1.8" fill="currentColor"/></svg>',
  spdif: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h6l2-4 2 8 2-4h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  loopback: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M9 10h2l2-2v6l-2-2H9z" fill="currentColor"/></svg>',
};
export const inputGlyphKey = i => i.turntable ? 'vinyl' : (SVG[i.kind] ? i.kind : 'aux');
function glyph(i) { const el = h('span', { class: 'inp-ic', 'data-ic': inputGlyphKey(i) }); el.innerHTML = SVG[inputGlyphKey(i)]; return el; }
function meter(i) {
  return h('div', { class: 'inp-meter', role: 'meter', 'aria-label': `${i.name} level`, 'aria-valuemin': '-60', 'aria-valuemax': '0', 'aria-valuenow': String(Math.round(i.peakDb ?? -60)), 'data-in': i.id },
    h('span', { class: 'inp-fill', style: `width:${meterPct(i.peakDb)}%` }));
}
/** Live level from the event stream: move the meters of input `id` in this element. */
function paintLevel(root, d) {
  root.querySelectorAll(`.inp-meter[data-in="${CSS.escape(d.id)}"]`).forEach(m => { m.firstChild.style.width = meterPct(d.peakDb) + '%'; m.setAttribute('aria-valuenow', String(Math.round(d.peakDb))); });
  root.querySelectorAll(`.inp-phono[data-in="${CSS.escape(d.id)}"]`).forEach(p => { p.hidden = !d.phonoLow; });
}
/** A window listener for `el` that removes itself once `el` has been on the page and left it (Settings closed, view rebuilt). */
function liveOn(el, type, fn) {
  let seen = false;
  const f = ev => { if (el.isConnected) { seen = true; fn(ev); } else if (seen) window.removeEventListener(type, f); };
  window.addEventListener(type, f);
}
/** Keep the server's meter lease while `root` is on screen. Ends by itself (telling the server) once `root` leaves the page; `alive()` says whether it still runs. */
function meterLease(root) {
  let t = 0, on = false, seen = false, waits = 0;
  const post = v => api('/inputs/meter', { method: 'POST', body: { on: v } }).catch(() => {});
  const tick = () => {
    const vis = root.isConnected && root.getClientRects().length > 0;
    if (vis || on) { on = vis; post(vis); }
    if (root.isConnected) seen = true;
    if ((seen && !root.isConnected) || (!seen && ++waits > 3)) { clearInterval(t); t = 0; }   // left the page (or never got onto it)
  };
  t = setInterval(tick, METER_RENEW_MS); setTimeout(tick, 300);   // first look once the view is mounted
  return { alive: () => t !== 0 };
}

/** Library > Inputs: one tile per input. Tap Play = this page's zone; ⋯ Everywhere plays it in every zone. */
export function inputsView(S) {
  const grid = h('div', { class: 'inp-grid' }), note = h('p', { class: 'dim small inp-note' });
  const el = h('div', { class: 'inputsview' }, note, grid);
  let data = { inputs: [] }, lease = null;
  const go = async (path, body) => { try { data = await api(path, { method: 'POST', body: body || {} }); draw(); } catch (e) { toast(e.message, true); } };
  const tile = i => {
    const act = mainAction(i, canControl(S));
    const kids = [
      h('div', { class: 'inp-top' }, glyph(i), h('div', { class: 'inp-txt' }, h('b', { class: 'ell' }, i.name), h('span', { class: 'small dim ell' }, i.source))),
      h('div', { class: 'inp-badges' }, ...inputBadges(i).map(([t, c]) => h('span', { class: 'pill ' + c }, t))),
      showMeter(i) ? meter(i) : null,
      i.playing ? h('p', { class: 'small inp-where' }, whereText(i, S.zones)) : null,
      i.muted && i.enabled ? h('p', { class: 'small dim' }, MIC_MUTED) : null,
      i.turntable ? h('p', { class: 'small warn-t inp-phono', 'data-in': i.id, hidden: !i.phonoLow }, PHONO_WARN) : null,
      i.error ? h('p', { class: 'small err' }, i.error) : null,
      !i.enabled ? h('p', { class: 'small dim' }, isAdmin(S) ? 'Turn it on in Settings > Devices > Audio inputs.' : 'An administrator can turn it on in Settings > Devices > Audio inputs.') : null,
      act ? h('div', { class: 'row inp-acts' },
        act === 'stop'
          ? h('button', { class: 'btn', onclick: () => go(`/inputs/${i.id}/stop`) }, '■ Stop')
          : [h('button', { class: 'btn primary', onclick: () => go(`/inputs/${i.id}/play`, { zoneId: getApiZone() }) }, '▶ Play'),
             h('button', { class: 'btn quiet', title: 'Play in every zone', onclick: () => go(`/inputs/${i.id}/play`, { zoneId: 'everywhere' }) }, 'Everywhere')]) : null,
    ];
    return h('div', { class: 'card inp-tile' + (i.playing ? ' playing' : '') + (i.enabled ? '' : ' off'), 'data-kind': i.kind, 'data-id': i.id }, ...kids.flat().filter(Boolean));
  };
  function draw() {
    const list = data.inputs || [];
    note.textContent = list.length ? '' : (data.note || NO_INPUTS); note.hidden = !!list.length;
    grid.replaceChildren(...list.map(tile));
  }
  async function reload() {
    try { data = await api('/inputs'); } catch (e) { data = { inputs: [], note: e.message }; }
    draw(); if (!lease?.alive()) lease = meterLease(el);   // the view was shown again after being taken off the page
  }
  window.addEventListener('wavwiz:inputs', () => { if (el.isConnected) reload(); });     // the Library view lives for the whole session
  window.addEventListener('wavwiz:inputlevel', ev => { if (el.isConnected) paintLevel(el, ev.detail || {}); });
  return { el, reload, get count() { return (data.inputs || []).length; } };
}

/** Settings > Devices > Audio inputs (admins change things; everyone else sees them). */
export function inputsCard(S, { admin }) {
  const list = h('div', { class: 'inp-setlist' }), note = h('p', { class: 'dim small' });
  const card = h('div', { class: 'card', id: 'sec-inputs' }, h('h3', null, INPUTS_TITLE),
    h('p', { class: 'small dim' }, 'Sound plugged into the server PC: Aux in (with Turntable mode for a record player), S/PDIF in, microphones and headsets, and anything else this PC plays. Each one plays like a radio station in a zone; Stop brings back what was there, paused.'),
    note, list, h('span', { class: 'setterms', hidden: true }, INPUT_TERMS));
  let data = { inputs: [] };
  const put = async (id, body) => { try { data = await api(`/inputs/${id}`, { method: 'PUT', body }); draw(); } catch (e) { toast(e.message, true); draw(); } };
  const sw = (label, on, change, dis = false, hint = null) => h('label', { class: 'row inp-sw' }, h('input', { type: 'checkbox', checked: !!on, disabled: !admin || dis, onchange: ev => change(ev.target.checked) }), h('span', null, label), hint ? h('span', { class: 'small dim' }, hint) : null);
  const row = i => {
    const name = h('input', { type: 'text', value: i.name, maxlength: 40, 'aria-label': `Name for ${i.device}`, disabled: !admin, onchange: ev => put(i.id, { name: ev.target.value.trim() || null }) });
    const gain = h('input', { type: 'range', min: -12, max: 6, step: 0.5, value: i.gainDb, 'aria-label': `${i.name} gain`, disabled: !admin });
    const gv = h('span', { class: 'mono small inp-gv' }, fmtGain(i.gainDb));
    gain.oninput = () => { gv.textContent = fmtGain(+gain.value); }; gain.onchange = () => put(i.id, { gainDb: +gain.value });
    return h('div', { class: 'inp-setrow', 'data-kind': i.kind, 'data-id': i.id },
      h('div', { class: 'row inp-sethead' }, glyph(i), h('div', { class: 'grow' }, name, h('div', { class: 'small dim ell' }, i.source + (i.kind !== 'loopback' && i.device && i.device !== i.name ? ' · ' + i.device : ''))),
        ...inputBadges(i).map(([t, c]) => h('span', { class: 'pill ' + c }, t))),
      showMeter(i) ? meter(i) : null,
      h('div', { class: 'row wrap inp-setctl' },
        sw('On', i.enabled, v => put(i.id, { enabled: v })),
        h('label', { class: 'row inp-gain' }, h('span', null, 'Gain'), gain, gv),
        i.kind === 'aux' ? sw('Turntable mode', i.turntable, v => put(i.id, { turntable: v })) : null,
        i.kind === 'aux' && i.turntable ? sw('Start when the needle drops', i.autoStart, v => put(i.id, { autoStart: v }), false, 'stops 25 s after the side ends') : null,
        i.kind === 'mic' ? sw('Live source', i.liveSource, v => put(i.id, { liveSource: v }), false, 'off = Announce only (starts muted)') : null),
      i.turntable ? h('p', { class: 'small warn-t inp-phono', 'data-in': i.id, hidden: !i.phonoLow }, PHONO_WARN) : null,
      i.bluetooth ? h('p', { class: 'small dim' }, 'Bluetooth headset mics switch the headset to call quality while they are open.') : null,
      i.error ? h('p', { class: 'small err' }, i.error) : null);
  };
  function draw() {
    const l = data.inputs || [];
    note.textContent = l.length ? (admin ? '' : 'Only an administrator can change audio inputs.') : (data.note || NO_INPUTS);
    note.hidden = !note.textContent;
    list.replaceChildren(...l.map(row));
  }
  api('/inputs').then(r => { data = r; draw(); meterLease(card); }).catch(e => { note.textContent = e.message; });
  liveOn(card, 'wavwiz:inputs', () => api('/inputs').then(r => { data = r; draw(); }).catch(() => {}));
  liveOn(card, 'wavwiz:inputlevel', ev => paintLevel(card, ev.detail || {}));
  return card;
}
export const fmtGain = db => (db > 0 ? '+' : db < 0 ? '−' : '') + Math.abs(Number(db) || 0).toFixed(1) + ' dB';
