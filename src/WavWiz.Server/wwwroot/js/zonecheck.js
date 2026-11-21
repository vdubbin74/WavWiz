// 0.7.2 D: acoustic zone-to-zone timing check - "Check with phone" on a zone's Timing vs house row. Stand where you hear two zones at once; the
// other zone's speaker plays the calibration chirps, then this zone's, each scheduled exactly like music (saved delay + "vs house" offset included).
// One recording per run hears both, so the phone's own microphone delay cancels out. Three runs, the median is the result; the suggested
// "Timing vs house" value is only applied when an administrator presses Apply (PUT /groups/{id}/house-offset, as the − / + buttons).
import { h, api, toast, dialog } from './util.js';
import { insecureSheet } from './announce.js';
import { offerResume } from './calibrate.js';

export const RUNS = 3;
export const SPREAD_WARN_MS = 4;
export const MAX_MS = 200;
export const CHECK_LABEL = 'Check with phone';
export const CHECK_TITLE = 'Measure this zone against another one with this device\'s microphone (stand where you hear both)';
export const INSECURE_TITLE = 'The timing check needs the secure address';
/** Raw microphone: no echo cancelling / noise suppression / gain riding - they shift and smear the chirps. */
export const MIC_CONSTRAINTS = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } };

export function median(xs) {
  const o = (xs || []).filter(Number.isFinite).slice().sort((a, b) => a - b), n = o.length;
  if (!n) return null; return n % 2 ? o[(n - 1) / 2] : (o[n / 2 - 1] + o[n / 2]) / 2;
}
export const spreadOf = xs => { const o = (xs || []).filter(Number.isFinite); return o.length ? Math.max(...o) - Math.min(...o) : 0; };
const r1 = x => Math.round(x * 10) / 10;
/** The "Timing vs house" value that lines this zone up: it sounded laterMs late, so it plays that much earlier (same as the server). */
export const suggest = (cur, later) => r1(Math.max(-MAX_MS, Math.min(MAX_MS, (+cur || 0) - later)));
export const outOfRange = (cur, later) => Math.abs((+cur || 0) - later) > MAX_MS;
const ms = x => `${Math.abs(r1(x)).toFixed(1)} ms`;
export const offLabel = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(r1(v)).toFixed(1) + ' ms';
/** One line: how this zone sounds against the other one where the person stands. */
export function resultText(zone, against, later) {
  if (!Number.isFinite(later)) return '';
  if (Math.abs(later) < 1) return `${zone} and ${against} are in step here (${later >= 0 ? '+' : '−'}${ms(later)}).`;
  return later > 0 ? `${zone} sounds ${ms(later)} later than ${against} here.` : `${zone} sounds ${ms(later)} earlier than ${against} here.`;
}
const online = (S, g) => (g?.deviceIds || []).some(id => (S.zones || []).some(z => z.id === id && z.connected));
/** The other zones that can play the test sound (one online speaker or more), in the zone order. */
export const againstOptions = (S, g) => (S.groups || []).filter(x => x.id !== g?.id && online(S, x));
/** Which one is picked first: the zone holding the house reference speaker, else the first one (matches the server's default). */
export function defaultAgainst(S, g) {
  const opts = againstOptions(S, g); if (!opts.length) return null;
  const ref = (S.zones || []).find(z => z.reference);
  return (ref && opts.find(x => (x.deviceIds || []).includes(ref.id))) || opts.find(x => !/^everywhere$/i.test(x.name || '')) || opts[0];
}
/** Joins the recorded blocks into one Float32Array (what the capture endpoint takes). */
export function concat(chunks) {
  let n = 0; for (const c of chunks) n += c.length; const out = new Float32Array(n); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; } return out;
}
const wait = t => new Promise(r => setTimeout(r, t));

/** The Check with phone button for a zone's Timing vs house row. Control+ may check; Apply is Admin. */
export function checkButton(S, g, admin, control, done) {
  const can = control && againstOptions(S, g).length > 0 && online(S, g);
  const title = !control ? 'Your access is view-only.' : !online(S, g) ? `No speaker in ${g.name} is online` : !againstOptions(S, g).length ? 'Needs another zone with a speaker online' : CHECK_TITLE;
  return h('button', { type: 'button', class: 'btn sm zt42-check', 'data-act': 'zt-check', disabled: !can, title, onclick: () => openZoneCheck(S, g, admin, done) }, CHECK_LABEL);
}

export function openZoneCheck(S, g, admin, done) {
  const opts = againstOptions(S, g), def = defaultAgainst(S, g);
  const sel = h('select', { class: 'zc-against', 'aria-label': 'Compare with' }, opts.map(x => h('option', { value: String(x.id), selected: def && x.id === def.id }, x.name)));
  const status = h('p', { class: 'zc-status small', 'aria-live': 'polite' }, `Stand where you hear both zones, hold this device still and keep quiet. Music in both zones pauses during the check.`);
  const meter = h('i', { class: 'zc-lvl' }), runs = h('ol', { class: 'zc-runs small' }), result = h('div', { class: 'zc-result', hidden: true });
  const startBtn = h('button', { type: 'button', class: 'btn primary', 'data-act': 'zc-start' }, 'Start');
  const body = h('div', { class: 'zc' },
    h('p', { class: 'small dim' }, `${g.name} is compared with the zone you pick: each plays a few chirps, scheduled exactly like music. ${RUNS} runs take about half a minute.`),
    h('label', { class: 'row zc-pick' }, h('span', { class: 'dlbl' }, 'COMPARE WITH'), sel),
    status, h('span', { class: 'zc-meter' }, meter), runs, result, h('div', { class: 'row zc-actions' }, startBtn));
  let st = null;
  const end = async () => {
    const my = st; st = null; if (!my) return;
    meter.style.width = '0';
    try { my.proc && (my.proc.onaudioprocess = null); my.stream?.getTracks().forEach(t => t.stop()); my.ctx?.close(); } catch { /* gone */ }
    if (my.sid) try { const r = await api(`/groups/${g.id}/timing-check/${my.sid}/end`, { method: 'POST' }); if (r?.canResume) offerResume(r.resumeGroups); } catch { /* expired */ }
  };
  const d = dialog(`Check ${g.name} timing`, body, [], { cls: 'zc-dlg', onClose: () => { end(); } });
  startBtn.onclick = async () => {
    if (st) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { d.close(); insecureSheet(INSECURE_TITLE, 'then press Check with phone again'); return; }
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* not Safari */ }
    const mic = navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);   // asked for right in the press (iOS keeps the user gesture)
    const my = st = { rec: null, vals: [] }; startBtn.disabled = true; sel.disabled = true; result.hidden = true; runs.replaceChildren();
    try { my.stream = await mic; } catch (e) { st = null; startBtn.disabled = false; sel.disabled = false; toast(e && e.name === 'NotAllowedError' ? 'The microphone is blocked for this page. Allow it in the browser, then try again.' : 'Could not open the microphone: ' + (e?.message || e), true); return; }
    const AC = window.AudioContext || window.webkitAudioContext; let ctx;
    try { ctx = new AC({ sampleRate: 48000 }); } catch { ctx = new AC(); }
    my.ctx = ctx; try { await ctx.resume(); } catch { /* resumes on its own */ }
    const src = ctx.createMediaStreamSource(my.stream), proc = ctx.createScriptProcessor(4096, 1, 1), sink = ctx.createGain(); sink.gain.value = 0;
    src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);     // a muted sink: the processor runs, nothing is played back
    proc.onaudioprocess = ev => { const x = ev.inputBuffer.getChannelData(0); let p = 0; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); meter.style.width = Math.round(Math.min(1, p * 2) * 100) + '%'; if (my.rec) my.rec.push(new Float32Array(x)); };
    my.proc = proc;
    let info = null, cur = +(g.houseOffsetMs || 0);
    try {
      for (let i = 1; i <= RUNS && st === my; i++) {
        status.textContent = `Run ${i} of ${RUNS}: listening…`; my.rec = [];
        const r = i === 1 ? await api(`/groups/${g.id}/timing-check`, { method: 'POST', body: { againstId: +sel.value } }) : await api(`/groups/${g.id}/timing-check/${my.sid}/play`, { method: 'POST' });
        info = r; my.sid = r.sessionId; cur = +(r.currentMs || 0);
        await wait(r.recordMs || 9000); if (st !== my) return;
        const samples = concat(my.rec); my.rec = null; status.textContent = `Run ${i} of ${RUNS}: working it out…`;
        const res = await api(`/groups/${g.id}/timing-check/${my.sid}/capture?rate=${ctx.sampleRate}`, { method: 'POST', raw: samples.buffer });
        if (!res.ok) { runs.append(h('li', { class: 'warn' }, res.error || 'Not heard')); continue; }
        my.vals.push(res.laterMs); runs.append(h('li', null, resultText(g.name, r.against?.name || 'the other zone', res.laterMs)));
      }
    } catch (e) { toast(e.message || String(e), true); }
    if (st !== my) return;
    const later = median(my.vals), against = info?.against?.name || sel.selectedOptions[0]?.textContent || 'the other zone';
    startBtn.disabled = false; sel.disabled = false; startBtn.textContent = 'Check again';
    await end();
    if (later == null) { status.textContent = 'Neither zone was heard clearly. Stand where you hear both, turn them up a little, and try again.'; return; }
    status.textContent = resultText(g.name, against, later);
    const sug = suggest(cur, later), steady = spreadOf(my.vals) <= SPREAD_WARN_MS;
    result.hidden = false; result.replaceChildren(
      h('p', null, h('b', null, `Suggested timing vs house: ${offLabel(sug)}`), h('span', { class: 'small dim' }, ` (now ${offLabel(cur)})`)),
      outOfRange(cur, later) ? h('p', { class: 'small warn' }, `That is more than ${MAX_MS} ms - calibrate the speakers first (Settings › Delay › Calibrate), then check again.`) : null,
      !steady ? h('p', { class: 'small warn' }, `The runs differ by ${ms(spreadOf(my.vals))} (echo or noise?). Check again from a quieter spot before applying.`) : null,
      my.vals.length < RUNS ? h('p', { class: 'small dim' }, `${my.vals.length} of ${RUNS} runs were heard.`) : null,
      admin ? h('button', { type: 'button', class: 'btn primary', 'data-act': 'zc-apply', disabled: sug === cur, onclick: async ev => { ev.currentTarget.disabled = true;
        try { const r = await api(`/groups/${g.id}/house-offset`, { method: 'PUT', body: { ms: sug } }); g.houseOffsetMs = r?.ms ?? sug; toast(`${g.name}: timing vs house ${offLabel(g.houseOffsetMs)}`); done?.(); d.close(); } catch (e) { toast(e.message, true); ev.currentTarget.disabled = false; } } }, `Apply ${offLabel(sug)}`)
        : h('p', { class: 'small dim' }, `Only an administrator can apply it - ask one to set ${g.name}'s timing vs house to ${offLabel(sug)}.`));
  };
  return d;
}
