// 0.7.1: the recommended reference speaker of a zone and the reference flags. The server ranks the speakers (wired on the server / a WavWiz player >
// wired on a PC > browser > AirPlay / Cast > Bluetooth; ties by the lowest delay, then the steadiest, then online) and sends, per zone,
// recommendedId + a one-line reason, and refFlag (the reference left the zone, is offline, ...). Nothing here changes a reference by itself:
// every switch is one tap by the user (PUT /groups/{id}/reference, which re-bases the saved delays as before).
import { h, api, toast } from './util.js';

const byId = (S, id) => (S.zones || []).find(z => z.id === id) || null;
export const groupOfSpeaker = (S, id) => (S.groups || []).find(g => (g.deviceIds || []).includes(id)) || null;

/** What a zone's reference line says (pure): the current reference, whether it is the recommended one, and what to offer. */
export function refState(S, g) {
  if (!g) return null;
  const ref = g.referenceId != null ? byId(S, g.referenceId) : null, rec = g.recommendedId != null ? byId(S, g.recommendedId) : null;
  return {
    ref, rec, reason: g.recommendedReason || '', warn: !!g.recommendedWarn,
    refIsRec: !!(ref && rec && ref.id === rec.id),
    offer: rec && (!ref || ref.id !== rec.id) ? rec : null,   // "Use <rec>" (one tap) - never applied by itself
    flag: g.refFlag || null,
  };
}
/** The RECOMMENDED tag (+ its reason as the tooltip). */
export const recTag = (reason, warn) => h('span', { class: 'dtag rec' + (warn ? ' warn' : ''), title: reason || 'Recommended reference' }, 'RECOMMENDED');
/** One tap: make a speaker its zone's reference (the saved delays are re-based, nothing is recalibrated). */
export async function useRef(g, z, refresh) {
  try { await api(`/groups/${g.id}/reference`, { method: 'PUT', body: { zoneId: z.id } }); toast(`${z.name} is now the reference for ${g.name}`); refresh?.(); return true; }
  catch (e) { toast(e.message, true); return false; }
}
/** The tree's note under a zone card for a reference flag (pure): text + an optional one-tap action. null = nothing to show. */
export function flagNote(S, g) {
  const f = g?.refFlag; if (!f) return null;
  if (f.kind === 'left') { const next = f.nextId != null ? byId(S, f.nextId) : null; return { kind: 'left', text: f.text, use: next }; }
  if (f.kind === 'changed') return { kind: 'changed', text: f.text, use: null };
  return null;   // "offline" shows in zone settings and Calibrate, not as a note (the OFFLINE tag is already on the speaker)
}

/** Zone settings: the REFERENCE row - the reference (or "None yet"), RECOMMENDED + reason, Use <rec> (one tap), Pick another. */
export function zoneRefBlock(S, g, admin, done) {
  const st = refState(S, g); if (!st) return null;
  const ms = (S.zones || []).filter(z => (g.deviceIds || []).includes(z.id));
  const ro = 'Only an administrator can change the reference speaker.';
  const pick = h('select', { class: 'zp42-refpick', 'aria-label': `Reference speaker of ${g.name}`, disabled: !admin || !ms.length, title: admin ? '' : ro,
    onchange: ev => { const z = byId(S, +ev.target.value); if (z) useRef(g, z, done); } },
    h('option', { value: '', selected: !st.ref }, st.ref ? 'Pick another…' : 'Pick a speaker…'),
    ms.filter(z => z.id !== st.ref?.id).map(z => h('option', { value: z.id }, z.name + (z.id === st.rec?.id ? ' (recommended)' : ''))));
  return h('div', { class: 'zp42-ref', 'data-act': 'zone-reference' },
    h('div', { class: 'row' }, h('span', { class: 'dlbl' }, 'REFERENCE'),
      st.ref ? h('b', null, st.ref.name) : h('span', { class: 'dim' }, 'None yet'),
      st.refIsRec ? recTag(st.reason, st.warn) : null, h('span', { class: 'grow' }), pick),
    st.refIsRec ? h('p', { class: 'small dim zp42-why' }, st.reason) : null,
    st.offer ? h('div', { class: 'row zp42-rec' }, recTag(st.reason, st.warn), h('b', null, st.offer.name), h('span', { class: 'small dim grow' }, st.reason),
      h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'use-recommended', disabled: !admin, title: admin ? `Make ${st.offer.name} the reference` : ro, onclick: () => useRef(g, st.offer, done) }, `Use ${st.offer.name}`)) : null,
    st.warn && st.offer ? h('p', { class: 'small amber' }, 'Bluetooth, AirPlay and Cast can be the reference, but their delay can drift; a wired speaker keeps better time.') : null,
    st.flag && st.flag.kind === 'offline' ? h('p', { class: 'small amber zp42-flag', role: 'status' }, st.flag.text, ' Calibrate can use a stand-in for one session.') : null,
    st.flag && st.flag.kind === 'left' ? h('p', { class: 'small amber zp42-flag', role: 'status' }, st.flag.text) : null);
}

/** Speaker settings: the REFERENCE section (null for a speaker in no zone). */
export function speakerRefSec(S, z, admin, done) {
  const g = groupOfSpeaker(S, z.id); if (!g) return null;
  const st = refState(S, g), isRef = st.ref?.id === z.id, isRec = st.rec?.id === z.id;
  const ro = 'Only an administrator can change the reference speaker.';
  const lines = [];
  if (isRef) {
    lines.push(h('div', { class: 'row' }, h('b', null, `Reference for ${g.name}`), isRec ? recTag(st.reason, st.warn) : null));
    lines.push(h('p', { class: 'small dim' }, 'Its delay stays fixed; the other speakers in the zone are measured against it.' + (isRec ? ' ' + st.reason + '.' : '')));
    if (!isRec && st.rec) lines.push(h('div', { class: 'row zp42-rec' }, recTag(st.reason, st.warn), h('b', null, st.rec.name), h('span', { class: 'small dim grow' }, st.reason),
      h('button', { type: 'button', class: 'btn sm', 'data-act': 'use-recommended', disabled: !admin, title: admin ? '' : ro, onclick: () => useRef(g, st.rec, done) }, `Use ${st.rec.name}`)));
  } else if (isRec) {
    lines.push(h('div', { class: 'row' }, recTag(st.reason, st.warn), h('span', { class: 'small dim grow' }, st.reason)));
    lines.push(h('div', { class: 'row' }, h('span', { class: 'small grow' }, st.ref ? `${g.name}'s reference is ${st.ref.name}.` : `${g.name} has no reference yet.`),
      h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'use-as-reference', disabled: !admin, title: admin ? '' : ro, onclick: () => useRef(g, z, done) }, 'Use as reference')));
  } else {
    lines.push(h('p', { class: 'small dim' }, st.ref ? `Measured against ${st.ref.name}, the reference for ${g.name}.` : `${g.name} has no reference yet.`));
  }
  return h('div', { class: 'dsrefsec' }, ...lines);
}
