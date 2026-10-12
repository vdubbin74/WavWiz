// WavWiz 0.2.5: the phone's mic-only calibration page (/calmic.html?cal=CODE).
// Order is the whole point (see calmic-core.js): nothing here joins as a speaker, opens /ws/room, creates an AudioContext or plays a sound before
// the microphone is open. The Start tap sets the audio session to play-and-record, asks for the microphone, and only then creates a capture-only
// AudioContext. The speakers play the test sounds; this phone only listens and uploads what it heard.
import { openMicFirst, buildPlan, calCode, pageMode, phoneName } from './calmic-core.js';
import { CalError, environment, classifyMicError, describe, detailsText, rms } from './calerrors.js';
import { OffsetEstimator, pairClocks } from './roomsched.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const env = environment();
const log = []; const track = m => { log.push(`${(performance.now() / 1000).toFixed(2)} ${m}`); if (log.length > 300) log.shift(); };
window.__wwCalMic = { log, order: [] };                      // read by the browser tests (order of mic / audio / network steps)
const order = m => window.__wwCalMic.order.push(m);

let code = calCode(location.search), plan = null, sid = null, stopped = false, state = 'opened', helloTimer = 0, mic = null, wake = null, hidden = false;

async function call(path, { method = 'GET', body, raw } = {}) {
  const headers = { 'X-WavWiz-Cal': code || '' };
  let payload; if (raw) { payload = raw; headers['Content-Type'] = 'application/octet-stream'; } else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const r = await fetch('/api/v1' + path, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) { const e = new Error((j && (j.error || j.message)) || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return j;
}
function show(...nodes) { $('loading').hidden = true; const v = $('view'); v.hidden = false; v.replaceChildren(...nodes); }

// ------------------------------------------------------------ boot
async function boot() {
  let signedIn = false;
  if (!code) {   // opened without a code (from the phone-role menu): mint one if this browser is signed in
    try { const r = await fetch('/api/v1/calibration/phone-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' }); if (r.ok) { const j = await r.json(); code = j.token; signedIn = true; history.replaceState(null, '', '/calmic.html?cal=' + code); } } catch { /* offline */ }
  }
  if (!code) return show(h('div', { class: 'card' }, h('h2', { text: 'Scan the QR code on the PC' }),
    h('p', { text: 'On the WavWiz PC open Calibrate › Use your phone, and scan the QR code with this phone’s camera. It opens this page with a one-time code.' }),
    h('p', { class: 'small' }, 'Want to play music on this phone instead? ', h('a', { href: '/?role=speaker' }, 'Open WavWiz as a speaker'))));
  try { plan = await call(`/calibration/phone-link/${code}/plan`); }
  catch (e) { return show(h('div', { class: 'card bad' }, h('h2', { text: 'This link has expired' }), h('p', { text: e.message }), h('p', { class: 'small', text: 'Open Calibrate on the PC again and scan the new QR code.' }))); }
  const mode = pageMode({ protocol: location.protocol, httpsEnabled: !!plan.https, code, signedIn });
  hello('opened'); helloTimer = setInterval(() => hello(state), 5000);
  if (mode === 'setup-phone') return setupPhone();
  if (mode === 'needs-https') return show(h('div', { class: 'card warn' }, h('h2', { text: 'Secure connection needed' }),
    h('p', { text: 'Phones only allow the microphone on a secure (https) page. Secure connections are switched off on this WavWiz server.' }),
    h('p', { class: 'small', text: 'An admin can switch them on in Settings › Phone & HTTPS on the PC. Or use “Use this PC’s microphone” or “By ear” on the PC.' })));
  ready();
}

async function hello(st) {
  if (stopped || !code) return;
  try { const r = await call(`/calibration/phone-link/${code}/hello`, { method: 'POST', body: { state: st, device: phoneName(navigator.userAgent, navigator.maxTouchPoints) } }); if (r && r.stop) stopFromPc(); }
  catch (e) { if (e.status === 404) stopFromPc('This link has expired.'); }
}
function stopFromPc(msg) {
  if (stopped) return; stopped = true; clearInterval(helloTimer); releaseMic();
  show(h('div', { class: 'card' }, h('h2', { text: 'Stopped' }), h('p', { text: msg || 'The calibration mic was stopped from the PC. You can close this page.' })));
}

// ------------------------------------------------------------ not trusted yet: certificate steps right here, then back to calibration by itself
function setupPhone() {
  const ios = env.ios, secure = plan.secureUrl;
  const status = h('p', { class: 'small', 'aria-live': 'polite' }, 'Checking whether this phone trusts WavWiz…');
  const steps = ios ? [
    h('li', null, h('h3', { text: 'Download the certificate' }), h('a', { class: 'btn small', href: '/tls/root-ca.mobileconfig' }, 'Download certificate'), h('p', { class: 'small', text: 'Tap “Allow”, then “Close”.' })),
    h('li', null, h('h3', { text: 'Install it' }), h('p', { text: 'Settings › Profile Downloaded › Install (enter your passcode) › Install › Done.' })),
    h('li', null, h('h3', null, 'Turn trust on ', h('span', { class: 'must', text: '(most often forgotten)' })), h('p', { text: 'Settings › General › About › Certificate Trust Settings › switch the WavWiz certificate on.' })),
    h('li', null, h('h3', { text: 'Come back here' }), h('p', { text: 'This page notices by itself and continues with the calibration.' }))
  ] : [
    h('li', null, h('h3', { text: 'Download the certificate' }), h('a', { class: 'btn small', href: '/tls/root-ca.crt' }, 'Download certificate')),
    h('li', null, h('h3', { text: 'Install it' }), h('p', { text: 'Settings › Security › More security settings › Install from device storage › CA certificate › Install anyway, then pick the downloaded file.' })),
    h('li', null, h('h3', { text: 'Come back here' }), h('p', { text: 'This page notices by itself and continues with the calibration.' }))
  ];
  show(h('div', { class: 'card focus' }, h('h2', { text: 'One-time set-up for this phone' }),
      h('p', { text: 'Phones only allow the microphone on a secure page. This phone does not trust WavWiz yet. Do this once:' }),
      h('ol', { class: 'steps' }, steps),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => check(true) }, 'Check again'), h('span', { class: 'grow' })), status),
    h('p', { class: 'small' }, 'Already done? ', h('a', { href: secure }, 'Continue on the secure page')));
  let busy = false;
  async function check(manual) {
    if (busy || stopped) return; busy = true;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(`https://${plan.host}:${plan.httpsPort}/api/v1/ping`, { cache: 'no-store', signal: ctl.signal, mode: 'cors' }); clearTimeout(t);
      const j = await r.json(); if (j && j.app === 'wavwiz') { status.textContent = 'Trusted. Continuing…'; track('trusted, moving to https'); location.replace(secure); return; }
    } catch { status.textContent = manual ? 'Not trusted yet. Finish the steps above, then come back.' : 'Waiting for the steps above…'; }
    finally { busy = false; }
  }
  check(false); const iv = setInterval(() => { if (document.visibilityState === 'visible') check(false); }, 4000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(false); });
  window.addEventListener('pagehide', () => clearInterval(iv));
}

// ------------------------------------------------------------ ready: what will be measured + Start
function ready(note) {
  state = 'opened';
  const ref = plan.reference, others = (plan.speakers || []).filter(z => !ref || z.id !== ref.id);
  if (ref && !others.length && !plan.allSpeakers) return show(h('div', { class: 'card' }, h('h2', { text: 'Scan the QR code on the PC' }),
    h('p', { text: 'This phone is ready to be a calibration mic, but this link has no speakers it may measure (you can only calibrate your own speaker, and this phone is not one).' }),
    h('p', { text: 'On the WavWiz PC, an administrator opens Devices › Calibrate speakers › Use your phone. Scan that QR code with this phone.' })));
  if (!ref || !others.length) return show(h('div', { class: 'card warn' }, h('h2', { text: 'Nothing to measure yet' }),
    h('p', { text: !ref ? 'No speaker is playing right now. Start WavWiz on your speakers, then reload this page.' : 'Only one speaker is connected. Calibration lines up two or more speakers.' }),
    h('button', { class: 'btn', onclick: () => location.reload() }, 'Reload')));
  const start = h('button', { class: 'btn big', id: 'start', onclick: () => run() }, 'Start');
  show(note ? h('div', { class: 'card warn' }, note) : null,
    h('div', { class: 'card' }, h('h2', { text: 'Stand where you usually listen' }),
      h('ul', { class: 'fix' }, h('li', { text: 'Hold the phone at ear height and keep still.' }), h('li', { text: 'Keep the room quiet. Music pauses while WavWiz measures.' }), h('li', { text: 'Keep this page open. The screen stays on.' })),
      h('p', { class: 'small', text: `Reference: ${ref.name}. Measures:` }), h('div', { class: 'spk' }, others.map(z => h('span', { text: z.name }))),
      h('p', { class: 'small', text: 'Tap Start, then allow the microphone.' }), start));
}

// ------------------------------------------------------------ measure
const CHECKS = [['mic', 'Microphone allowed'], ['clock', 'Clock synced with the server'], ['heard', 'Test sounds heard']];
async function run() {
  if (stopped) return;
  const env2 = environment();
  const checks = h('ul', { class: 'checks' }, CHECKS.map(([k, t]) => h('li', { 'data-k': k, text: t })));
  const mark = (k, s, extra) => { const li = checks.querySelector(`[data-k="${k}"]`); li.className = s; if (extra) li.textContent = `${CHECKS.find(c => c[0] === k)[1]} · ${extra}`; };
  const now = h('div', { class: 'now', 'aria-live': 'polite' }, 'Asking for the microphone…'), sub = h('p', { class: 'small', text: 'Tap Allow if the phone asks.' });
  const bar = h('div', { class: 'bar' }, h('i')), notes = h('ul', { class: 'notes' });
  const note = (t, warn) => notes.append(h('li', { class: warn ? 'warn-t' : '', text: t }));
  const stopBtn = h('button', { class: 'btn ghost', onclick: () => cancel() }, 'Stop');
  show(h('div', { class: 'card' }, now, sub, bar, checks, notes, h('div', { class: 'row' }, h('span', { class: 'grow' }), stopBtn)));
  let canceled = false; const cancel = async () => { canceled = true; releaseMic(); if (sid) { try { await call(`/calibration/sessions/${sid}/end`, { method: 'POST', body: { reason: 'canceled' } }); } catch { /* gone */ } sid = null; } ready(); };
  const onVis = () => { if (document.visibilityState === 'hidden') hidden = true; };
  document.addEventListener('visibilitychange', onVis);
  try {
    if (env2.inApp) throw new CalError('IN_APP_BROWSER', env2.ua);
    if (!window.isSecureContext) throw new CalError('INSECURE', 'isSecureContext=false at ' + location.protocol);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new CalError('NO_MEDIA_API', 'getUserMedia missing');
    // 1-3: audio session, microphone FIRST, then the capture-only audio context (all started inside this tap)
    mark('mic', 'run'); order('start-tap');
    try { mic = await openMicFirst({ nav: navigator, win: window, track: m => { track(m); order(m); } }); }
    catch (e) { throw new CalError(e && e.name === 'NoAudioApi' ? 'NO_AUDIO_API' : classifyMicError(e), `${e && e.name}: ${e && e.message}`); }
    if (!mic.stream.getAudioTracks()[0]) throw new CalError('MIC_NONE', 'no audio track');
    if (!mic.rawOk) note('This phone kept some of its sound processing on; the result may be a little less exact.', true);
    if (mic.ctx.state !== 'running') {   // some phones need a second tap to start the (recording-only) audio engine
      now.textContent = 'Tap once more to start listening'; sub.textContent = '';
      const again = h('button', { class: 'btn big' }, 'Start listening'); sub.after(again);
      await new Promise(res => again.addEventListener('click', async () => { try { await mic.ctx.resume(); } catch { /* checked */ } again.remove(); res(); }, { once: true }));
      if (mic.ctx.state !== 'running') throw new CalError('CTX_SUSPENDED', 'state=' + mic.ctx.state);
    }
    const rec = await makeRecorder(mic.ctx, mic.stream, note);
    mark('mic', 'ok', mic.label || ''); state = 'measuring'; hello(state);
    try { wake = await navigator.wakeLock?.request('screen'); } catch { track('no wake lock'); }
    // 4. clock
    mark('clock', 'run'); now.textContent = 'Syncing the clock…'; sub.textContent = '';
    let off = await syncClock(); mark('clock', 'ok', `round trip ${off.rttMs.toFixed(1)} ms`);
    if (off.rttMs > 60) note('The Wi-Fi round trip is slow; the result may be less exact.', true);
    // 5. session (the music pauses on the server side)
    try { const s = await call('/calibration/sessions', { method: 'POST', body: { mode: 'phone', referenceZoneId: plan.reference.id, micSource: 'phone', micProcessing: mic.rawOk ? 'raw' : 'processed', linkToken: code } }); sid = s.id; }
    catch (e) { throw new CalError('SESSION_FAILED', e.message); }
    order('session'); note('Music is paused while calibrating.');
    const steps = buildPlan(plan); let done = 0, heard = 0, failed = 0;
    mark('heard', 'run');
    for (const r of steps) {
      if (canceled || stopped) return;
      now.textContent = `Listening to ${r.label}`; sub.textContent = `Step ${done + 1} of ${steps.length}`;
      call(`/calibration/sessions/${sid}/progress`, { method: 'POST', body: { step: done + 1, steps: steps.length, label: r.label } }).catch(() => {});
      let res;
      try {
        try { off = await syncClock(); } catch (e) { if (e instanceof CalError && e.code === 'CLOCK_UNSTABLE') throw new CalError('WIFI_UNSTABLE', e.detail); throw e; }
        rec.start(); await sleep(400);
        let play; try { play = await call(`/calibration/sessions/${sid}/play`, { method: 'POST', body: { kind: r.kind, zoneId: r.zone, distanceM: 0, levelDb: -20 } }); } catch (e) { throw new CalError('SESSION_FAILED', e.message); }
        order('play-requested');
        const serverNow = () => performance.now() * 1000 + off.offsetUs;
        const until = Date.now() + Math.max(0, (play.atUs - serverNow()) / 1000) + play.patternMs + 1500;
        while (Date.now() < until) { if (canceled || stopped) return; if (hidden) throw new CalError('SCREEN_HIDDEN', 'page hidden during recording'); await sleep(100); }
        const got = await rec.stop();
        if (!got.total || rms(got.samples) < 1e-5) throw new CalError('MIC_SILENT', 'rms=' + rms(got.samples));
        const q = new URLSearchParams({ zoneId: String(r.zone), kind: r.kind, rate: String(mic.ctx.sampleRate), startServerUs: (got.startPerfMs * 1000 + off.offsetUs).toFixed(0) });
        try { res = await call(`/calibration/sessions/${sid}/capture?${q}`, { method: 'POST', raw: got.samples.buffer }); } catch (e) { throw new CalError('UPLOAD_FAILED', e.message); }
      } catch (e) {
        if (e instanceof CalError && ['SCREEN_HIDDEN', 'MIC_SILENT', 'SESSION_FAILED', 'WIFI_UNSTABLE', 'CLOCK_TIMEOUT', 'CLOCK_WS_FAILED', 'UPLOAD_FAILED'].includes(e.code)) throw e;
        res = { ok: false, note: e.message };
      }
      done++; bar.firstChild.style.width = `${done / steps.length * 100}%`;
      if (res.ok) heard++; else { failed++; note(`${r.label}: ${res.note}`, true); }
      await sleep(300);
    }
    releaseMic(); document.removeEventListener('visibilitychange', onVis);
    if (!heard) throw new CalError('NOT_HEARD', `${steps.length} test sounds, none heard`);
    mark('heard', 'ok', `${heard} of ${steps.length}`); now.textContent = 'Working out the delays…'; sub.textContent = '';
    const fin = await call(`/calibration/sessions/${sid}/finish`, { method: 'POST' });
    state = 'done'; hello(state); results(fin, failed);
  } catch (e) {
    document.removeEventListener('visibilitychange', onVis); releaseMic(); hidden = false;
    if (canceled || stopped) return;
    const err = e instanceof CalError ? e : new CalError('UNKNOWN', String(e && e.message || e));
    track('failed ' + err.code + ' ' + err.detail);
    if (sid) { const id = sid; sid = null; call(`/calibration/sessions/${id}/progress`, { method: 'POST', body: { phase: 'failed', error: describe(err.code, env).title } }).catch(() => {}).finally(() => call(`/calibration/sessions/${id}/end`, { method: 'POST', body: { reason: 'failed' } }).catch(() => {})); }
    const d = describe(err.code, env);
    const copy = h('button', { class: 'btn ghost small', onclick: async () => { try { await navigator.clipboard.writeText(detailsText(err, env, { log: log.join('\n') })); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; } } }, 'Copy details');
    show(h('div', { class: 'card bad', role: 'alert' }, h('h2', { text: d.title }), h('p', { text: d.why }), h('ul', { class: 'fix' }, d.fix.map(f => h('li', { text: f }))),
      d.link ? h('p', null, h('a', { href: d.link.href, text: d.link.text })) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => ready() }, 'Try again'), copy), h('p', { class: 'small', text: `Code: ${err.code}${err.detail && !/^[A-Z_]+$/.test(err.detail) ? ' · ' + err.detail : ''}` })));
  }
}

function releaseMic() {
  try { mic?.stream.getTracks().forEach(t => t.stop()); } catch { /* ok */ }
  try { mic?.ctx.close(); } catch { /* ok */ }
  try { wake?.release(); } catch { /* ok */ }
  mic = null; wake = null;
}

/** Records with an AudioWorklet that has NO outputs (nothing reaches the phone's speaker). Reports the page-clock time of the first sample. */
async function makeRecorder(c, stream, note) {
  const src = c.createMediaStreamSource(stream); let blocks = [], total = 0, first = null, on = false;
  const toPerfMs = ctxTime => { const reads = []; for (let i = 0; i < 8; i++) reads.push({ ctxSec: c.currentTime, perfMs: performance.now() }); const p = pairClocks(reads); return p.perfUs / 1000 + (ctxTime - p.ctxSec) * 1000; };
  const finish = () => { const all = new Float32Array(total); let p = 0; for (const b of blocks) { all.set(b, p); p += b.length; } return { samples: all, total, startPerfMs: first ? toPerfMs(first.time) : performance.now() - total / c.sampleRate * 1000 }; };
  if (c.audioWorklet && window.AudioWorkletNode) {
    try {
      await c.audioWorklet.addModule('/js/recorder-worklet.js');
      const node = new AudioWorkletNode(c, 'wavwiz-recorder', { numberOfInputs: 1, numberOfOutputs: 0 }); src.connect(node);
      node.port.onmessage = ev => { const m = ev.data; if (!on) return; if (!first) first = m; blocks.push(m.samples); total += m.samples.length; };
      track('recorder: audio worklet');
      return { start() { blocks = []; total = 0; first = null; on = true; node.port.postMessage('start'); }, async stop() { node.port.postMessage('stop'); await sleep(150); on = false; return finish(); } };
    } catch (e) { track('worklet failed: ' + e.message); }
  }
  // Very old browsers only: ScriptProcessor must be connected to run; it outputs silence (a 0 gain), never sound.
  note('Using the compatibility recorder (a little less exact).', true); track('recorder: script processor');
  const sp = c.createScriptProcessor(2048, 1, 1), mute = c.createGain(); mute.gain.value = 0;
  sp.onaudioprocess = e => { if (!on) return; const d = e.inputBuffer.getChannelData(0), copy = new Float32Array(d); if (!first) first = { time: e.playbackTime - copy.length / c.sampleRate }; blocks.push(copy); total += copy.length; };
  src.connect(sp); sp.connect(mute); mute.connect(c.destination);
  return { start() { blocks = []; total = 0; first = null; on = true; }, async stop() { await sleep(120); on = false; return finish(); } };
}

async function syncClock() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/clock?cal=${encodeURIComponent(code)}`);
  await new Promise((res, rej) => { const t = setTimeout(() => { try { ws.close(); } catch { /* ok */ } rej(new CalError('CLOCK_TIMEOUT', 'open timed out')); }, 6000);
    ws.onopen = () => { clearTimeout(t); res(); }; ws.onerror = () => { clearTimeout(t); rej(new CalError('CLOCK_WS_FAILED', 'WebSocket error before open (' + proto + ')')); }; });
  const est = new OffsetEstimator(40), got = new Map();
  ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.type === 'clock.pong') got.set(m.seq, { t0: m.t0, t1: m.t1, t2: m.t2, t3: performance.now() * 1000 }); };
  for (let i = 0; i < 20; i++) { ws.send(JSON.stringify({ type: 'clock.ping', seq: i, t0: performance.now() * 1000 })); await sleep(60); }
  await sleep(400);
  for (const v of got.values()) est.add(v.t0, v.t1, v.t2, v.t3);
  ws.close();
  if (!got.size) throw new CalError('CLOCK_TIMEOUT', '0 of 20 replies');
  if (got.size < 8 || est.samples.length < 8) throw new CalError('CLOCK_UNSTABLE', `${got.size} of 20 replies`);
  order('clock'); return { offsetUs: est.offsetUs, rttMs: est.rttUs / 1000, n: got.size };
}

function results(fin, failed) {
  const props = fin.proposals || []; const pick = new Map(props.map(p => [p.zoneId, p.commit]));
  const save = h('button', { class: 'btn big', disabled: !props.some(p => p.commit) }, 'Save all');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try { const r = await call(`/calibration/sessions/${sid}/commit`, { method: 'POST', body: { zoneIds: [...pick].filter(([, v]) => v).map(([k]) => k) } }); sid = null;
      show(h('div', { class: 'card ok' }, h('h2', { text: `Saved ${r.saved} speaker${r.saved === 1 ? '' : 's'}` }), r.skipped ? h('p', { class: 'small', text: `${r.skipped} skipped (only your own speaker is saved).` }) : null, h('p', { text: 'Music resumes. You can close this page.' })));
      state = 'left'; hello(state); clearInterval(helloTimer);
    } catch (e) { save.disabled = false; save.textContent = 'Save all (try again)'; alert(e.message); }
  });
  show(h('div', { class: 'card' }, h('h2', { text: 'Results' }),
    props.length ? h('table', { class: 'res' }, h('thead', null, h('tr', null, ['', 'Speaker', 'Delay', 'Confidence'].map(t => h('th', { text: t })))),
      h('tbody', null, props.map(p => h('tr', null,
        h('td', null, h('input', { type: 'checkbox', checked: p.commit, disabled: !p.commit, 'aria-label': 'Save ' + p.zoneName, onchange: ev => pick.set(p.zoneId, ev.target.checked) })),
        h('td', null, p.zoneName, p.warning ? h('div', { class: 'small warn-t', text: p.warning }) : null),
        h('td', { class: 'mono accent', text: `${Math.round(p.proposedLatencyMs)} ms` }), h('td', { class: 'mono', text: `${Math.round(p.confidence * 100)}%` })))))
      : h('p', { class: 'err-t', text: 'Nothing could be measured.' }),
    (fin.messages || []).length ? h('ul', { class: 'notes' }, fin.messages.map(m => h('li', { text: m }))) : null,
    failed ? h('p', { class: 'small', text: `${failed} test sound(s) were not heard. Moving closer, turning the speaker up or a quieter room usually helps.` }) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: async () => { if (sid) { await call(`/calibration/sessions/${sid}/end`, { method: 'POST', body: { reason: 'redo' } }).catch(() => {}); sid = null; } ready(); } }, 'Redo'), h('span', { class: 'grow' })), save));
}

window.addEventListener('pagehide', () => { if (code && !stopped) { try { fetch(`/api/v1/calibration/phone-link/${code}/hello`, { method: 'POST', keepalive: true, headers: { 'X-WavWiz-Cal': code, 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'left' }) }); } catch { /* best effort */ } } });
boot().catch(e => show(h('div', { class: 'card bad' }, h('h2', { text: 'Something went wrong' }), h('p', { text: String(e && e.message || e) }))));
