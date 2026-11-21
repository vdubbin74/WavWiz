// 0.7.1: the recommended reference speaker of a zone and the reference flags. The server ranks the speakers (wired on the server / a WavWiz player >
// wired on a PC > browser > AirPlay / Cast > Bluetooth; ties by the lowest delay, then the steadiest, then online) and sends, per zone,
// recommendedId + a one-line reason, and refFlag (the reference left the zone, is offline, ...). Nothing here changes a reference by itself:
// every switch is one tap by the user (PUT /groups/{id}/reference, which re-bases the saved delays as before).
import { h, api, toast } from './util.js';
import { wsel } from './wwselect.js';
import { checkButton } from './zonecheck.js';   // 0.7.2 D: acoustic zone-to-zone timing check

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
  if (f.kind === 'output') return { kind: 'output', text: `Reference output changed: ${byId(S, f.refId)?.name ?? 'the reference'}.`, use: null, review: true };   // the 3 choices are in zone settings
  return null;   // "offline" shows in zone settings and Calibrate, not as a note (the OFFLINE tag is already on the speaker)
}

/** "Reference output changed": the reference now plays through another output (or another type) than when it became the reference. Three
 *  choices: switch back to that output, use the next best speaker, or keep it and recalibrate the zone (its output becomes the new baseline). */
export function outputFlagCard(S, g, admin, done) {
  const f = g?.refFlag; if (!f || f.kind !== 'output') return null;
  const ref = byId(S, f.refId), next = f.nextId != null ? byId(S, f.nextId) : null, ro = 'Only an administrator can change the reference speaker.';
  const back = async () => { try { await api(`/zones/${f.refId}/output`, { method: 'POST', body: { endpointId: f.wasEndpointId } }); toast(`${ref?.name ?? 'The reference'} plays through ${f.wasName} again`); done?.(); } catch (e) { toast(e.message, true); } };
  const keep = async () => {
    try { await api(`/groups/${g.id}/reference-output`, { method: 'POST', body: {} }); toast(`Kept ${ref?.name ?? 'the reference'} on ${f.nowName} - recalibrate ${g.name} so the others line up with it`); done?.(); }
    catch (e) { toast(e.message, true); return; }
    try { const m = await import('./calibrate.js'); m.openCalibration(S, done, null, { groupId: g.id }); } catch { /* Calibrate opens from the speaker settings */ }
  };
  return h('div', { class: 'reflag', role: 'status', 'data-flag': 'output' },
    h('div', { class: 'reflag-h' }, 'Reference output changed'),
    h('p', { class: 'small' }, String(f.text || '').replace(/^Reference output changed:\s*/, '')),   // the heading already says it
    h('div', { class: 'row reflag-acts' },
      h('button', { type: 'button', class: 'btn sm', 'data-act': 'ref-switch-back', disabled: !admin || f.wasEndpointId == null, title: !admin ? ro : f.wasEndpointId == null ? `${f.wasName} is not connected right now` : '', onclick: back }, `Switch back to ${f.wasName}`),
      next ? h('button', { type: 'button', class: 'btn sm', 'data-act': 'ref-next-best', disabled: !admin, title: admin ? (f.nextReason || '') : ro, onclick: () => useRef(g, next, done) }, `Use ${next.name}`) : null,
      h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'ref-keep-recal', disabled: !admin, title: admin ? '' : ro, onclick: keep }, 'Keep it and recalibrate')));
}

/** The output-changed card already offers "Use <next best>": no second button for the same speaker. */
const dupNext = (f, z) => !!(f && f.kind === 'output' && z && f.nextId === z.id);

/** Zone settings: the REFERENCE row - the reference (or "None yet"), RECOMMENDED + reason, Use <rec> (one tap), Pick another. */
export function zoneRefBlock(S, g, admin, done) {
  const st = refState(S, g); if (!st) return null;
  const ms = (S.zones || []).filter(z => (g.deviceIds || []).includes(z.id));
  const ro = 'Only an administrator can change the reference speaker.';
  const pick = wsel({ class: 'zp42-refpick', 'aria-label': `Reference speaker of ${g.name}`, disabled: !admin || !ms.length, title: admin ? '' : ro,
    onchange: ev => { const z = byId(S, +ev.target.value); if (z) useRef(g, z, done); } },
    h('option', { value: '', selected: !st.ref }, st.ref ? 'Pick another…' : 'Pick a speaker…'),
    ms.filter(z => z.id !== st.ref?.id).map(z => h('option', { value: z.id }, z.name + (z.id === st.rec?.id ? ' (recommended)' : ''))));
  return h('div', { class: 'zp42-ref', 'data-act': 'zone-reference' },
    h('div', { class: 'row' }, h('span', { class: 'dlbl' }, 'REFERENCE'),
      st.ref ? h('b', null, st.ref.name) : h('span', { class: 'dim' }, 'None yet'),
      st.refIsRec ? recTag(st.reason, st.warn) : null, h('span', { class: 'grow' }), pick),
    st.refIsRec ? h('p', { class: 'small dim zp42-why' }, st.reason) : null,
    st.offer ? h('div', { class: 'row zp42-rec' }, recTag(st.reason, st.warn), h('b', null, st.offer.name), h('span', { class: 'small dim grow' }, st.reason),
      dupNext(st.flag, st.offer) ? null : h('button', { type: 'button', class: 'btn sm' + (st.ref ? '' : ' primary'), 'data-act': 'use-recommended', disabled: !admin, title: admin ? `Make ${st.offer.name} the reference` : ro, onclick: () => useRef(g, st.offer, done) }, `Use ${st.offer.name}`)) : null,
    st.warn && st.offer ? h('p', { class: 'small amber' }, 'Bluetooth, AirPlay and Cast can be the reference, but their delay can drift; a wired speaker keeps better time.') : null,
    outputFlagCard(S, g, admin, done),
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
    lines.push(h('p', { class: 'small dim dsreftiming' }, `${g.name} timing vs house: ${offText(g.houseOffsetMs)} (zone settings).`));
    const of = outputFlagCard(S, g, admin, done); if (of) lines.push(of);
    if (!isRec && st.rec) lines.push(h('div', { class: 'row zp42-rec' }, recTag(st.reason, st.warn), h('b', null, st.rec.name), h('span', { class: 'small dim grow' }, st.reason),
      dupNext(st.flag, st.rec) ? null : h('button', { type: 'button', class: 'btn sm', 'data-act': 'use-recommended', disabled: !admin, title: admin ? '' : ro, onclick: () => useRef(g, st.rec, done) }, `Use ${st.rec.name}`)));
  } else if (isRec) {
    lines.push(h('div', { class: 'row' }, recTag(st.reason, st.warn), h('span', { class: 'small dim grow' }, st.reason)));
    lines.push(h('div', { class: 'row' }, h('span', { class: 'small grow' }, st.ref ? `${g.name}'s reference is ${st.ref.name}.` : `${g.name} has no reference yet.`),
      h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'use-as-reference', disabled: !admin, title: admin ? '' : ro, onclick: () => useRef(g, z, done) }, 'Use as reference')));
  } else {
    lines.push(h('p', { class: 'small dim' }, st.ref ? `Measured against ${st.ref.name}, the reference for ${g.name}.` : `${g.name} has no reference yet.`));
  }
  return h('div', { class: 'dsrefsec' }, ...lines);
}

// ---- 0.7.1: zone timing "vs house" - an always-on offset added to every speaker of the zone at playback (the saved delays stay as they are).
// 0 = exactly as calibrated (every upgrade starts there). + = the zone sounds later than the rest of the house, - = earlier.
export const HOUSE_OFF_MAX = 200;
/** "+5 ms" / "−3 ms" / "0 ms" (pure). */
export const offText = ms => { const v = Math.round((+ms || 0) * 10) / 10; return v > 0 ? `+${v} ms` : v < 0 ? `−${Math.abs(v)} ms` : '0 ms'; };
/** The next fine-tune value after a step, clamped (pure). */
export const stepOff = (ms, d) => Math.max(-HOUSE_OFF_MAX, Math.min(HOUSE_OFF_MAX, Math.round(((+ms || 0) + d) * 10) / 10));
/** Zone settings: TIMING vs house with − / + (1 ms; Shift = 10 ms) and Reset. Saved after a short pause. */
export const CHECK_HINT = 'Check with phone measures it for you.';
export function zoneTimingRow(S, g, admin, done, control = admin) {
  let v = +(g.houseOffsetMs || 0), t = 0;
  const ro = 'Only an administrator can change the zone timing.';
  const out = h('output', { class: 'mono zt42-v', 'aria-live': 'polite' }, offText(v));
  const save = () => { clearTimeout(t); t = setTimeout(async () => { try { const r = await api(`/groups/${g.id}/house-offset`, { method: 'PUT', body: { ms: v } }); g.houseOffsetMs = r?.ms ?? v; done?.(); } catch (e) { toast(e.message, true); } }, 400); };
  const set = nv => { v = nv; out.textContent = offText(v); reset.disabled = !admin || v === 0; save(); };
  const btn = (txt, d, label) => h('button', { type: 'button', class: 'btn sm zt42-b', 'aria-label': label, 'data-act': d < 0 ? 'zt-minus' : 'zt-plus', disabled: !admin, title: admin ? `${label} (Shift: 10 ms)` : ro, onclick: ev => set(stepOff(v, d * (ev.shiftKey ? 10 : 1))) }, txt);
  const reset = h('button', { type: 'button', class: 'btn sm', 'data-act': 'zt-reset', disabled: !admin || v === 0, title: admin ? 'Back to 0 ms (as calibrated)' : ro, onclick: () => set(0) }, 'Reset');
  return h('div', { class: 'zt42', 'data-act': 'zone-timing' },
    h('div', { class: 'row' }, h('span', { class: 'dlbl' }, 'TIMING VS HOUSE'), btn('−', -1, `${g.name} earlier`), out, btn('+', 1, `${g.name} later`), reset, checkButton(S, g, admin, control, done)),
    h('p', { class: 'small dim' }, `Fine-tune ${g.name} against the other zones when you can hear two zones at once. + plays it later, − earlier. Each speaker's own delay stays as calibrated. ${CHECK_HINT}`));
}
