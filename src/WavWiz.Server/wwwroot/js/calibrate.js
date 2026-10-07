import { h, api, toast, dialog } from './util.js';
import { CalError, environment, describe, classifyMicError, detailsText, rms } from './calerrors.js';
import { OffsetEstimator, pairClocks } from './roomsched.js';
import { openOnce } from './wsconn.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Phone-microphone delay calibration wizard (spec 8). Needs HTTPS (secure context) for the microphone; otherwise it points at the phone set-up page and
// offers the manual / by-ear paths, which work on plain HTTP.
export async function openCalibration(S, refresh, presetZoneId) {
  const zones = S.zones.filter(z => z.connected && z.outputs.some(o => o.active));
  const body = h('div'); let stop = false; let micStream = null, ctx = null, wake = null, clockWs = null;
  const cleanup = () => { stop = true; try { micStream?.getTracks().forEach(t => t.stop()); } catch { } try { ctx?.close(); } catch { } try { wake?.release(); } catch { } try { clockWs?.close(); } catch { } };
  const d = dialog('Calibrate speaker delay', body, [], { onClose: () => { cleanup(); refresh && refresh(); } });
  if (zones.length < 2) { body.replaceChildren(h('p', null, 'You need at least two connected devices: one is the reference (the one you leave alone) and the other is measured against it.'), h('p', { class: 'dim' }, 'You can still type a delay by hand: open a device (tap its name) and use Delay → Save.')); return; }

  const secure = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
  const st = { mode: 'phone', ref: presetZoneId ? (zones.find(z => z.id !== presetZoneId)?.id ?? zones[0].id) : (zones.find(z => z.outputs.find(o => o.active)?.kind === 'wired')?.id ?? zones[0].id), sel: new Set(presetZoneId ? [presetZoneId] : zones.slice(1).map(z => z.id)), dist: 0, level: -20, same: false };
  if (presetZoneId && presetZoneId === st.ref) st.ref = zones.find(z => z.id !== presetZoneId).id;

  function intro() {
    const refSel = h('select', { 'aria-label': 'Reference device', onchange: ev => { st.ref = +ev.target.value; st.sel.delete(st.ref); intro(); } }, zones.map(z => h('option', { value: z.id, selected: z.id === st.ref }, z.name)));
    const mode = h('select', { 'aria-label': 'Method', onchange: ev => { st.mode = ev.target.value; intro(); } },
      h('option', { value: 'phone', selected: st.mode === 'phone' }, 'Phone microphone (recommended)'), h('option', { value: 'same', selected: st.mode === 'same' }, 'Phone microphone — one recording per device (for phones with unreliable timing)'), h('option', { value: 'ear', selected: st.mode === 'ear' }, 'By ear (no microphone)'));
    const lvl = h('input', { type: 'range', min: -40, max: -6, value: st.level, oninput: ev => st.level = +ev.target.value, 'aria-label': 'Test sound level' });
    body.replaceChildren(
      !secure ? h('div', { class: 'card' }, h('p', { class: 'amber' }, 'The phone microphone needs a secure (HTTPS) page, and this page is not secure.'), h('p', { class: 'small' }, 'Open ', h('a', { href: '/tls/setup', target: '_blank', rel: 'noopener' }, 'the phone set-up page'), ' on the server PC, install the certificate on your phone once, then open this site on the HTTPS address. Meanwhile you can use “By ear”.')) : null,
      h('div', { class: 'card' }, h('p', null, 'WavWiz plays a short chirp sequence from one device at a time. The phone listens and works out how late each speaker is compared with the reference device, so everything lines up.'),
        h('ul', { class: 'small dim' }, h('li', null, 'Put the phone about 1–2 m from the speaker being measured, and keep the house quiet.'), h('li', null, 'Keep this screen on; the sound is quiet and takes about a minute per device.'), h('li', null, 'The reference device is not changed.'))),
      h('div', { class: 'field' }, h('label', null, 'Method'), mode),
      h('div', { class: 'field' }, h('label', null, 'Reference device (left as it is)'), refSel),
      h('div', { class: 'field' }, h('label', null, 'Devices to calibrate'), zones.filter(z => z.id !== st.ref).map(z => h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: st.sel.has(z.id), onchange: ev => ev.target.checked ? st.sel.add(z.id) : st.sel.delete(z.id) }), z.name, h('span', { class: 'small dim' }, z.outputs.find(o => o.active)?.label ?? '')))),
      st.mode !== 'ear' ? h('div', { class: 'field' }, h('label', null, 'Test sound level'), lvl) : null,
      h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: () => { st.sel.delete(st.ref); if (!st.sel.size) return toast('Choose at least one device to calibrate.', true); st.mode === 'ear' ? ear() : phone(); } }, 'Start')));
  }

  // ------------------------------------------------------------ phone microphone
  // The wizard shows a live checklist; the FIRST thing that fails stops it with a plain-English reason and what to do (see calerrors.js).
  async function phone() {
    const env = environment();
    const checklist = [['secure', 'Secure page (HTTPS)'], ['mic', 'Microphone allowed'], ['audio', 'Audio engine started'], ['clock', 'Clock synced with the server'], ['heard', 'Test sounds heard']];
    const state = new Map(checklist.map(([k]) => [k, { s: 'todo', t: '' }]));
    const list = h('ul', { class: 'list', 'aria-label': 'Progress' }), status = h('p', { 'aria-live': 'polite' }), bar = h('progress', { max: 100, value: 0, style: 'width:100%' }), log = h('ul', { class: 'small' }), errBox = h('div');
    const paint = () => list.replaceChildren(...checklist.map(([k, label]) => { const v = state.get(k); return h('li', { class: 'chk ' + (v.s === 'ok' ? 'done' : '') }, h('span', { class: 'mark' }, v.s === 'ok' ? '✓' : v.s === 'bad' ? '✕' : v.s === 'run' ? '…' : ''), h('div', null, h('div', null, label), v.t ? h('div', { class: 'small ' + (v.s === 'bad' ? 'err' : 'dim') }, v.t) : null)); }));
    const mark = (k, s, t = '') => { state.set(k, { s, t }); paint(); };
    const note = (t, bad) => log.append(h('li', { class: bad ? 'err' : 'dim' }, t));
    body.replaceChildren(list, status, bar, log, errBox, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { cleanup(); d.close(); } }, 'Cancel'))); paint();
    const diag = { steps: [], t0: Date.now() };
    const track = m => diag.steps.push(`${((Date.now() - diag.t0) / 1000).toFixed(1)}s ${m}`);
    let hiddenDuring = false; const onVis = () => { if (document.hidden) hiddenDuring = true; };
    document.addEventListener('visibilitychange', onVis);
    const fail = (key, e) => {
      const err = e instanceof CalError ? e : new CalError('UNKNOWN', e && e.message || String(e));
      const info = describe(err.code, env); cleanup(); document.removeEventListener('visibilitychange', onVis);
      if (key) mark(key, 'bad', info.title); status.textContent = ''; track('FAILED ' + err.code + ' ' + err.detail);
      const extra = { 'audio context': ctx?.state ?? 'none', 'sample rate': ctx?.sampleRate ?? 'n/a', steps: diag.steps.join(' | ') };
      const text = detailsText(err, env, extra);
      errBox.replaceChildren(h('div', { class: 'card', role: 'alert', style: 'border-color:#8a2b26' },
        h('h3', { class: 'err' }, info.title), h('p', null, info.why), err.detail && !/^[A-Z_]+$/.test(err.detail) ? h('p', { class: 'small dim' }, 'Technical detail: ' + err.detail) : null,
        h('b', null, 'What to do'), h('ol', null, info.fix.map(x => h('li', null, x))), info.link ? h('p', null, h('a', { class: 'btn', href: info.link.href, target: '_blank', rel: 'noopener' }, info.link.text)) : null,
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: () => { stop = false; phone(); } }, 'Try again'), h('button', { class: 'btn', onclick: () => { stop = false; st.mode = 'ear'; ear(); } }, 'Use “by ear” instead'),
          h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Details copied'); } catch { const ta = h('textarea', { rows: 8 }, text); errBox.append(ta); ta.select(); toast('Select and copy the text below', false); } } }, 'Copy details'))));
    };
    try {
      // 1. environment checks - all synchronous, so the audio context below is still created inside the tap (iOS needs that)
      if (env.inApp) throw new CalError('IN_APP_BROWSER', env.ua);
      if (!env.secure) throw new CalError('INSECURE', 'isSecureContext=false at ' + location.protocol);
      mark('secure', 'ok', location.protocol === 'https:' ? '' : 'localhost');
      if (!env.hasGum) throw new CalError('NO_MEDIA_API', 'navigator.mediaDevices.getUserMedia is missing');
      if (!env.hasCtx) throw new CalError('NO_AUDIO_API', 'AudioContext is missing');
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC({ latencyHint: 'interactive' }); track('AudioContext created, state ' + ctx.state);
      const resumed = ctx.resume();                                                    // still inside the tap
      // 2. microphone
      mark('mic', 'run'); status.textContent = 'Asking for the microphone… (tap Allow if the phone asks)';
      const raw = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } };
      try { micStream = await navigator.mediaDevices.getUserMedia(raw); }
      catch (e) {
        const code = classifyMicError(e);
        if (code === 'MIC_CONSTRAINT') { note('This phone cannot switch off its sound processing; using its default settings (less exact).', true); try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e2) { throw new CalError(classifyMicError(e2), `${e2.name}: ${e2.message}`); } }
        else throw new CalError(code, `${e.name}: ${e.message}`);
      }
      const trk = micStream.getAudioTracks()[0]; if (!trk) throw new CalError('MIC_NONE', 'no audio track');
      const set = trk.getSettings ? trk.getSettings() : {};
      const rawOk = set.echoCancellation === false && set.noiseSuppression === false && set.autoGainControl === false;
      track(`mic ok: ${trk.label || 'unnamed'} ${JSON.stringify(set)}`);
      if (!rawOk) note('This phone did not switch off its sound processing; the result may be less exact. The check at the end will tell you.', true);
      mark('mic', 'ok', trk.label || '');
      // 3. audio engine
      mark('audio', 'run'); await Promise.race([resumed, sleep(1500)]);
      if (ctx.state !== 'running') { try { await ctx.resume(); } catch { /* checked below */ } await sleep(300); }
      if (ctx.state !== 'running') throw new CalError('CTX_SUSPENDED', 'state=' + ctx.state);
      const recorder = await makeRecorder(ctx, micStream, note, track);
      try { wake = await navigator.wakeLock?.request('screen'); } catch { track('no wake lock'); }
      mark('audio', 'ok', `${ctx.sampleRate} Hz, ${recorder.kind}`);
      // 4. clock
      mark('clock', 'run'); status.textContent = 'Syncing the phone clock with the server…';
      const off = await syncClock(); track(`clock ok rtt ${off.rttMs.toFixed(1)}ms n=${off.n}`);
      mark('clock', 'ok', `round trip ${off.rttMs.toFixed(1)} ms`);
      if (off.rttMs > 60) note('The Wi-Fi round trip is slow; the result may be less exact.', true);
      const serverUsNow = () => performance.now() * 1000 + off.offsetUs;
      let sess, pat;
      try { sess = await api('/calibration/sessions', { method: 'POST', body: { mode: st.mode === 'same' ? 'same-recording' : 'phone', referenceZoneId: st.ref, micSource: 'phone', micProcessing: rawOk ? 'raw' : 'processed' } }); pat = await api('/calibration/pattern'); }
      catch (e) { throw new CalError('SESSION_FAILED', e.message); }
      const sid = sess.id;

      const record = async (playPath, playBody, lengthMsFn, cap) => {
        recorder.start(); await sleep(400);
        const play = await api(playPath, { method: 'POST', body: playBody }).catch(e => { throw new CalError('SESSION_FAILED', e.message); });
        const wait = Math.max(0, (play.atUs - serverUsNow()) / 1000) + lengthMsFn(play) + 1500;
        const until = Date.now() + wait; while (Date.now() < until) { if (stop) throw new CalError('UNKNOWN', 'canceled'); if (hiddenDuring) throw new CalError('SCREEN_HIDDEN', 'page hidden during recording'); await sleep(100); }
        const rec = await recorder.stop();
        if (!rec.total) throw new CalError('MIC_SILENT', 'no samples delivered');
        if (rms(rec.samples) < 1e-5) throw new CalError('MIC_SILENT', 'rms=' + rms(rec.samples));
        const startServerUs = rec.startPerfMs * 1000 + off.offsetUs;
        const q = new URLSearchParams({ zoneId: String(cap.zone), kind: cap.kind, rate: String(ctx.sampleRate), startServerUs: startServerUs.toFixed(0) });
        try { return await api(`/calibration/sessions/${sid}/capture?${q}`, { method: 'POST', raw: rec.samples.buffer }); } catch (e) { throw new CalError('UPLOAD_FAILED', e.message); }
      };
      const plan = [];
      if (st.mode === 'phone') {
        for (let i = 0; i < 3; i++) plan.push({ label: `Reference device (${i + 1}/3)`, kind: 'ref', zone: st.ref });
        for (const z of zones.filter(z => st.sel.has(z.id))) for (let i = 0; i < 3; i++) plan.push({ label: `${z.name} (${i + 1}/3)`, kind: 'dev', zone: z.id });
        plan.push({ label: 'Reference device again (drift check)', kind: 'ref-end', zone: st.ref });
      } else for (const z of zones.filter(z => st.sel.has(z.id))) for (let i = 0; i < 3; i++) plan.push({ label: `${z.name} with reference (${i + 1}/3)`, kind: 'pair', zone: z.id });
      mark('heard', 'run');
      let done = 0, failed = 0, heard = 0;
      for (const r of plan) {
        if (stop) return; status.textContent = `Measuring: ${r.label}`;
        let res;
        try {
          res = r.kind === 'pair'
            ? await record(`/calibration/sessions/${sid}/play-pair`, { zoneId: r.zone, levelDb: st.level }, p => (p.gapSec * 1000) + p.patternMs, r)
            : await record(`/calibration/sessions/${sid}/play`, { kind: r.kind, zoneId: r.zone, distanceM: st.dist, levelDb: st.level }, p => p.patternMs, r);
        } catch (e) { if (e instanceof CalError && ['SCREEN_HIDDEN', 'MIC_SILENT', 'SESSION_FAILED'].includes(e.code)) return fail('heard', e); res = { ok: false, note: e.message }; }
        done++; bar.value = done / plan.length * 100; track(`${r.label}: ${res.ok ? 'heard' : res.note}`);
        if (res.ok) { heard++; note(`${r.label}: heard it (confidence ${(res.confidence * 100).toFixed(0)}%).`); } else { failed++; note(`${r.label}: ${res.note}`, true); }
        await sleep(600);
      }
      micStream.getTracks().forEach(t => t.stop()); micStream = null; recorder.close();
      document.removeEventListener('visibilitychange', onVis);
      if (heard === 0) return fail('heard', new CalError('NOT_HEARD', plan.length + ' test sounds, none heard'));
      mark('heard', 'ok', `${heard} of ${plan.length}`);
      status.textContent = 'Working out the delays…';
      const fin = await api(`/calibration/sessions/${sid}/finish`, { method: 'POST' });
      results(sid, fin, failed);
    } catch (e) {
      const key = e instanceof CalError ? ({ IN_APP_BROWSER: 'secure', INSECURE: 'secure', NO_MEDIA_API: 'secure', NO_AUDIO_API: 'audio', MIC_DENIED: 'mic', MIC_NONE: 'mic', MIC_BUSY: 'mic', MIC_UNKNOWN: 'mic', MIC_CONSTRAINT: 'mic', CTX_SUSPENDED: 'audio', CLOCK_WS_FAILED: 'clock', CLOCK_TIMEOUT: 'clock', CLOCK_UNSTABLE: 'clock' }[e.code] || null) : null;
      fail(key, e);
    }
  }

  /** AudioWorklet recorder when available, ScriptProcessor otherwise. Both report the page-clock time of the first sample. */
  async function makeRecorder(c, stream, note, track) {
    const src = c.createMediaStreamSource(stream); let blocks = [], total = 0, first = null, on = false, node, kind;
    const pairNow = () => { const reads = []; for (let i = 0; i < 8; i++) reads.push({ ctxSec: c.currentTime, perfMs: performance.now() }); return pairClocks(reads); };
    const toPerfMs = ctxTime => { const p = pairNow(); return p.perfUs / 1000 + (ctxTime - p.ctxSec) * 1000; };
    if (c.audioWorklet && window.AudioWorkletNode) {
      try {
        await c.audioWorklet.addModule('/js/recorder-worklet.js');
        node = new AudioWorkletNode(c, 'wavwiz-recorder', { numberOfInputs: 1, numberOfOutputs: 0 }); src.connect(node); kind = 'audio worklet';
        node.port.onmessage = ev => { const m = ev.data; if (!on) return; if (!first) first = m; blocks.push(m.samples); total += m.samples.length; };
        return { kind, start() { blocks = []; total = 0; first = null; on = true; node.port.postMessage('start'); }, async stop() { node.port.postMessage('stop'); await sleep(150); on = false; return finish(); }, close() { try { node.disconnect(); src.disconnect(); } catch { /* closed */ } } };
      } catch (e) { track('worklet failed: ' + e.message); note('The precise recorder could not load; using the compatibility recorder (a little less exact).', true); }
    } else { track('no audioWorklet'); note('This browser has no AudioWorklet; using the compatibility recorder (a little less exact).', true); }
    const sp = c.createScriptProcessor(2048, 1, 1); kind = 'compatibility recorder'; const mute = c.createGain(); mute.gain.value = 0;
    sp.onaudioprocess = e => { if (!on) return; const d = e.inputBuffer.getChannelData(0), copy = new Float32Array(d); if (!first) first = { time: e.playbackTime - copy.length / c.sampleRate }; blocks.push(copy); total += copy.length; };
    src.connect(sp); sp.connect(mute); mute.connect(c.destination);
    function finish() {
      const all = new Float32Array(total); let p = 0; for (const b of blocks) { all.set(b, p); p += b.length; }
      return { samples: all, total, startPerfMs: first ? toPerfMs(first.time) : performance.now() - total / c.sampleRate * 1000 };
    }
    return { kind, start() { blocks = []; total = 0; first = null; on = true; }, async stop() { await sleep(120); on = false; return finish(); }, close() { try { sp.disconnect(); src.disconnect(); mute.disconnect(); } catch { /* closed */ } } };
  }

  async function syncClock() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws; try { ws = await openOnce('/ws/clock', { timeoutMs: 6000 }); } catch (e) { throw new CalError(e.message === 'timed out' ? 'CLOCK_TIMEOUT' : 'CLOCK_WS_FAILED', e.message === 'timed out' ? 'open timed out' : 'WebSocket error before open (' + proto + ')'); }
    clockWs = ws;
    const est = new OffsetEstimator(40); const got = new Map();
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.type !== 'clock.pong') return; got.set(m.seq, { t0: m.t0, t1: m.t1, t2: m.t2, t3: performance.now() * 1000 }); };
    for (let i = 0; i < 20; i++) { ws.send(JSON.stringify({ type: 'clock.ping', seq: i, t0: performance.now() * 1000 })); await sleep(60); }
    await sleep(400);
    for (const v of got.values()) est.add(v.t0, v.t1, v.t2, v.t3);
    ws.close(); clockWs = null;
    if (got.size === 0) throw new CalError('CLOCK_TIMEOUT', '0 of 20 replies');
    if (got.size < 8 || est.samples.length < 8) throw new CalError('CLOCK_UNSTABLE', `${got.size} of 20 replies`);
    return { offsetUs: est.offsetUs, rttMs: est.rttUs / 1000, n: got.size };
  }

  function results(sid, fin, failed) {
    const props = fin.proposals;
    const checks = new Map(props.map(p => [p.zoneId, p.commit]));
    body.replaceChildren(
      h('div', { class: 'steps' }, ['Listen', 'Calculate', 'Save'].map((n, j) => h('span', { class: 'step ' + (j < 2 ? 'done' : 'on') }, n))),
      props.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Save', 'Device', 'Delay', 'Spread', 'Confidence', 'Note'].map(x => h('th', null, x)))), h('tbody', null, props.map(p =>
        h('tr', null, h('td', null, h('input', { type: 'checkbox', checked: p.commit, disabled: !p.commit, 'aria-label': 'Save ' + p.zoneName, onchange: ev => checks.set(p.zoneId, ev.target.checked) })), h('td', null, p.zoneName), h('td', { class: 'amber mono' }, `${Math.round(p.proposedLatencyMs)} ms`),
          h('td', null, `±${p.spreadMs.toFixed(1)} ms`), h('td', null, `${Math.round(p.confidence * 100)}%`), h('td', { style: 'white-space:normal' }, p.warning ?? '')))))
        : h('p', { class: 'err' }, 'Nothing could be measured.'),
      fin.messages.length ? h('ul', { class: 'small amber' }, fin.messages.map(m => h('li', null, m))) : null,
      failed ? h('p', { class: 'small dim' }, `${failed} test sound(s) were not heard. Moving the phone closer, turning the device up or quieting the house usually fixes it.`) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => intro() }, 'Redo'), h('span', { class: 'grow' }),
        h('button', { class: 'btn primary', disabled: !props.some(p => p.commit), onclick: async () => { try { const r = await api(`/calibration/sessions/${sid}/commit`, { method: 'POST', body: { zoneIds: [...checks].filter(([, v]) => v).map(([k]) => k) } }); toast(`Saved ${r.saved} device(s).`); d.close(); } catch (e) { toast(e.message, true); } } }, 'Save delays')));
  }

  // ------------------------------------------------------------ by ear (no microphone, works on http)
  function ear() {
    const zs = zones.filter(z => st.sel.has(z.id) && z.id !== st.ref); const refZ = zones.find(z => z.id === st.ref); let i = 0;
    const show = () => {
      const z = zs[i]; if (!z) { d.close(); return; }
      const base = refZ.outputs.find(o => o.active)?.latencyMs ?? 0, out = z.outputs.find(o => o.active);
      const ms = h('input', { type: 'range', min: 0, max: 600, step: 1, value: 0, 'aria-label': 'Extra delay', oninput: ev => { n.value = ev.target.value; } });
      const n = h('input', { type: 'number', min: 0, max: 1500, value: 0, style: 'width:90px', oninput: ev => { ms.value = ev.target.value; } });
      body.replaceChildren(h('h3', null, `${z.name} (${i + 1}/${zs.length})`), h('p', { class: 'dim' }, `Press “Play”. You hear a short tick pattern from ${refZ.name} and from ${z.name}. Move the slider until both sound like a single sound, with no echo.`),
        h('div', { class: 'row' }, ms, n, 'ms'), h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: async () => { try { await api('/calibration/ear/play', { method: 'POST', body: { referenceZoneId: st.ref, deviceZoneId: z.id, candidateMs: +n.value } }); } catch (e) { toast(e.message, true); } } }, '▶ Play'),
          h('button', { class: 'btn', onclick: async () => { try { await api(`/outputs/${encodeURIComponent(out.deviceId)}/latency`, { method: 'PUT', body: { latencyMs: base + +n.value, playerId: z.playerId, method: 'ear' } }); toast(`${z.name}: ${Math.round(base + +n.value)} ms saved`); i++; show(); } catch (e) { toast(e.message, true); } } }, 'Save & next'),
          h('button', { class: 'btn', onclick: () => { i++; show(); } }, 'Skip')));
    };
    show();
  }
  intro();
}
