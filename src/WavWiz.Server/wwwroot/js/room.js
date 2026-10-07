import { h, api, toast, dialog } from './util.js';
import { MSG, FrameParser, encodeJson, decodeJson, decodeAudio, decodeEpoch } from './wire.js';
import { OffsetEstimator, pairClocks, ctxTimeFor, FrameScheduler, roomHealth, volumeToGain } from './roomsched.js';
import { environment } from './calerrors.js';
import { openOnce, backoffMs } from './wsconn.js';
import { isPhoneUa, wantsAutoJoin } from './phonejoin.js';
export { isPhoneUa, wantsAutoJoin };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const idKey = 'unison.webRoom.id', nameKey = 'unison.webRoom.name', wantKey = 'unison.webRoom.autojoin';
export function roomId() { let id = localStorage.getItem(idKey); if (!id) { id = 'web-' + [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem(idKey, id); } return id; }
export function defaultRoomName() { return localStorage.getItem(nameKey) || (/iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'This browser'); }

/**
 * The phone (or any browser) as a WavWiz device. It speaks the same wire frames as the Windows player over /ws/room, keeps its clock aligned to the
 * server through /ws/clock, and starts every 20 ms frame on the AudioContext timeline at (server playAt - the device's delay).
 * HONEST LIMITS (shown in the UI): a web page cannot keep playing when the phone locks or another app opens (iOS stops it within seconds; Android Chrome
 * often continues with a media notification). Sync depends on the Wi-Fi and on the delay you set by ear; typical error is a few ms to a few tens of ms.
 */
export class PhoneRoom {
  constructor({ name, onState }) { this.name = name; this.onState = onState || (() => {}); this.sched = new FrameScheduler(); this.est = new OffsetEstimator(40); this.zone = { volume: 1, muted: false, enabled: true, latencyMs: 0, source: 'none', notCalibrated: true }; this.buffered = 0; this.stats = { frames: 0, late: 0 }; this.epoch = 0; this.sources = []; this.state = { state: 'starting', text: 'Starting…' }; this.running = false; }

  emit(extra = {}) {
    const hs = roomHealth({ wsOpen: this.ws?.readyState === 1, ctxState: this.ctx?.state, hidden: document.hidden, bufferMs: this.buffered, clockReady: this.est.ready });
    this.state = { ...hs, ...extra }; this.onState({ ...this.state, zone: this.zone, rtt: this.est.rttUs, stats: { ...this.sched.stats, ...this.stats } });
  }

  /** 0.0.7: the network side starts at once (no gesture needed); the sound starts as soon as the shared AudioContext is unlocked by a tap
   * anywhere (see unlockAudio). It never throws just because iOS has not unlocked audio yet: the device joins, shows "Tap to start sound"
   * and plays from the first tap. Only one AudioContext ever exists per page (iOS allows very few; 0.0.6 leaked one per attempt). */
  async start() {
    const env = environment();
    if (!env.hasCtx) throw new Error('This browser has no Web Audio, so it cannot play audio as a device.');
    this.ctx = sharedCtx();
    this.gain = this.ctx.createGain(); this.gain.connect(this.ctx.destination); this.applyGain();
    this._onCtx = () => this.emit(); this.ctx.addEventListener?.('statechange', this._onCtx);
    this.running = true;
    this.vis = () => { this.emit(); if (!document.hidden && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); if (!document.hidden) this.kickNet(); };
    document.addEventListener('visibilitychange', this.vis);
    this.timer = setInterval(() => { this.pairNow(); this.watchdog(); this.sendStatus(); this.emit(); }, 1000);
    this.clockTimer = setInterval(() => this.pingClock(), 1000);
    await this.syncClock(); await this.connect();
  }
  get audioReady() { return this.ctx?.state === 'running'; }

  pairNow() { const reads = []; for (let i = 0; i < 6; i++) reads.push({ ctxSec: this.ctx.currentTime, perfMs: performance.now() }); this.pair = pairClocks(reads); }

  async syncClock() {
    let ws;
    try { ws = await openOnce('/ws/clock'); }
    catch (e) { throw new Error(location.protocol === 'https:' ? 'Could not open the clock connection (' + e.message + '). If this phone has not trusted the WavWiz certificate yet, open the phone set-up page.' : 'Could not open the clock connection to the server (' + e.message + ').'); }
    this.cws = ws; this.clockRx = Date.now();
    ws.onmessage = ev => { this.clockRx = Date.now(); let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.type === 'clock.pong') this.est.add(m.t0, m.t1, m.t2, performance.now() * 1000); };
    ws.onclose = () => { if (this.cws === ws) this.cws = null; if (this.running) this.retryClock(); };
    for (let i = 0; i < 12; i++) { this.pingClock(); await sleep(70); }
    await sleep(300); this.pairNow();
    if (!this.est.ready) throw new Error('Only a few clock replies came back - the Wi-Fi is too unstable right now. Try again closer to the router.');
  }
  retryClock() { clearTimeout(this._crt); this._crt = setTimeout(() => { if (this.running && !this.cws) this.syncClock().then(() => { this.clockTries = 0; }).catch(() => this.retryClock()); }, backoffMs(this.clockTries = (this.clockTries || 0) + 1)); }
  pingClock() { try { if (this.cws?.readyState === 1) this.cws.send(JSON.stringify({ type: 'clock.ping', seq: ++this.pseq || (this.pseq = 1), t0: performance.now() * 1000 })); } catch { /* reconnect logic handles it */ } }

  async connect() {
    if (!this.running) return;
    const ws = await openOnce('/ws/room', { binary: true }).catch(e => { throw new Error('Could not open the device connection to the server (' + e.message + ').'); });
    this.ws = ws; this.parser = new FrameParser(); this.seq = 0; this.rx = Date.now(); this.netTries = 0;
    ws.onmessage = ev => { this.rx = Date.now(); try { for (const f of this.parser.push(ev.data)) this.onFrame(f); } catch (e) { this.emit({ error: e.message }); try { ws.close(); } catch { /* closing */ } } };
    ws.onclose = () => { if (this.ws === ws) this.ws = null; this.emit(); this.dropAudio(); if (this.running) { this.reconnects = (this.reconnects || 0) + 1; this.retryNet(); } };
    this.send(MSG.Hello, { playerId: roomId(), deviceToken: null, appVersion: 'web', codecs: ['pcm24'], maxRate: 48000, linkType: 'wifi', name: this.name, machineName: 'Web page' });
    this.send(MSG.Outputs, { outputs: [{ endpointId: 'web-speaker', name: 'Phone speaker', kind: 'other', btAddress: null, connected: true, active: true, winLatencyMs: null, codec: null, containerId: null }], reason: 'hello' });
    this.emit();
  }
  retryNet(ms) { clearTimeout(this._nrt); this._nrt = setTimeout(() => { if (this.running && !this.ws) this.connect().catch(() => this.retryNet()); }, ms ?? backoffMs(this.netTries = (this.netTries || 0) + 1)); }
  kickNet() { if (!this.running) return; if (!this.ws) { this.netTries = 0; this.retryNet(50); } if (!this.cws) { this.clockTries = 0; this.retryClock(); } }
  /** The server sends a keepalive every 5 s; 15 s of silence means a half-open Wi-Fi link (common when an iPhone wakes): drop it and reconnect. */
  watchdog() {
    const now = Date.now();
    if (this.ws?.readyState === 1 && now - (this.rx || now) > 15000) { try { this.ws.close(); } catch { /* closing */ } }
    if (this.cws?.readyState === 1 && now - (this.clockRx || now) > 15000) { try { this.cws.close(); } catch { /* closing */ } }
  }
  send(type, body) { try { if (this.ws?.readyState === 1) this.ws.send(encodeJson(type, ++this.seq, body)); } catch { /* socket closing */ } }

  onFrame(f) {
    switch (f.type) {
      case MSG.Welcome: this.welcome = decodeJson(f.payload); this.emit(); break;
      case MSG.Audio: this.onAudio(decodeAudio(f.payload)); break;
      case MSG.Epoch: { const e = decodeEpoch(f.payload); if (e.epoch !== this.epoch) { this.epoch = e.epoch; this.dropAudio(); this.sched.reset(); } break; }
      case MSG.StopAt: { const s = decodeEpoch(f.payload); this.stopAtUs = s.us; this.stopSoon(s.us); break; }
      case MSG.ZoneUpdate: { const z = decodeJson(f.payload); this.zone = { volume: z.volume ?? 1, muted: !!z.muted, enabled: z.enabled !== false, latencyMs: z.latencyMs ?? 0, source: z.latencySource, notCalibrated: !!z.notCalibrated }; this.applyGain(); this.emit(); break; }
      case MSG.CalCmd: { const c = decodeJson(f.payload); this.onCal(c); break; }
      case MSG.Bye: { const b = decodeJson(f.payload); this.emit({ error: b.reason }); break; }
      default: break;      // Outputs/DspConfig: not used by a phone speaker (no EQ in this beta)
    }
  }
  applyGain() { if (this.gain) this.gain.gain.value = this.zone.enabled && !this.zone.muted ? volumeToGain(this.zone.volume) : 0; }

  onAudio(a) {
    if (!this.pair || !this.zone.enabled || this.ctx.state !== 'running') return;      // not unlocked yet: the next tap starts the sound
    if (a.epoch !== this.epoch) { this.epoch = a.epoch; this.dropAudio(); this.sched.reset(); }
    const startCtx = ctxTimeFor(a.playAtUs, { pair: this.pair, offsetUs: this.est.offsetUs, latencyMs: this.zone.latencyMs, outputLatencySec: this.ctx.outputLatency || 0 });
    const now = this.ctx.currentTime, p = this.sched.plan(startCtx, now, a.epoch);
    this.buffered = Math.max(0, (this.sched.next ?? now) - now) * 1000;
    if (p.action === 'drop') { this.stats.late++; return; }
    const buf = this.ctx.createBuffer(2, a.count, 48000); buf.copyToChannel(a.l, 0); buf.copyToChannel(a.r, 1);
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = p.rate; src.connect(this.gain); src.start(p.start);
    this.sources.push(src); src.onended = () => { const i = this.sources.indexOf(src); if (i >= 0) this.sources.splice(i, 1); try { src.disconnect(); } catch { /* gone */ } };
    this.stats.frames++;
  }
  dropAudio() { for (const s of this.sources) { try { s.onended = null; s.stop(); s.disconnect(); } catch { /* already finished */ } } this.sources = []; this.buffered = 0; }
  stopSoon(atUs) {
    if (!this.pair) return; const at = ctxTimeFor(atUs, { pair: this.pair, offsetUs: this.est.offsetUs, latencyMs: this.zone.latencyMs, outputLatencySec: this.ctx.outputLatency || 0 });
    for (const s of this.sources) { try { s.stop(Math.max(this.ctx.currentTime, at)); } catch { /* ended */ } }
  }

  onCal(c) {
    if (c.action === 'test-tone') { this.chime(c.atUs); this.send(MSG.CalResult, { sessionId: c.sessionId, status: 'ok', note: null }); }
    else this.send(MSG.CalResult, { sessionId: c.sessionId, status: 'unsupported', note: 'A phone page cannot play the calibration chirps precisely enough. Set this device\'s delay by ear (Devices > this phone > Delay).' });
  }
  chime(atUs) {
    const when = this.pair ? Math.max(this.ctx.currentTime + 0.02, ctxTimeFor(atUs, { pair: this.pair, offsetUs: this.est.offsetUs, latencyMs: this.zone.latencyMs, outputLatencySec: this.ctx.outputLatency || 0 })) : this.ctx.currentTime + 0.1;
    [[659.25, 0], [880, 0.28]].forEach(([f, dt]) => { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, when + dt); g.gain.linearRampToValueAtTime(0.35, when + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.001, when + dt + 0.5); o.connect(g); g.connect(this.gain); o.start(when + dt); o.stop(when + dt + 0.55); });
  }

  sendStatus() {
    if (!this.ctx) return;
    this.send(MSG.PlayerStatus, { bufferMs: this.buffered, clockOffsetUs: this.est.offsetUs ?? 0, clockSkewPpm: 0, rttUs: Math.round(this.est.rttUs ?? 0), syncErrorMs: 0, ratioPpm: 0, underruns: this.stats.late, hardResyncs: this.sched.stats.resyncs,
      activeOutputId: 'web-speaker', latencyMs: this.zone.latencyMs, linkType: 'wifi', dspLatencyUs: 0, limiterReductionDb: 0, clipCount: 0, playing: this.sources.length > 0, underrunEvents: this.stats.late, reconnects: this.reconnects || 0,
      note: 'Phone page: sync error is not measured (shown as unknown); the delay is the one you set for this phone.' });
  }

  async stop() {
    this.running = false; clearInterval(this.timer); clearInterval(this.clockTimer); clearTimeout(this._nrt); clearTimeout(this._crt); document.removeEventListener('visibilitychange', this.vis); this.ctx?.removeEventListener?.('statechange', this._onCtx);
    try { this.send(MSG.Bye, { reason: 'closed by the user' }); } catch { /* socket gone */ }
    try { this.ws?.close(); } catch { /* ok */ } try { this.cws?.close(); } catch { /* ok */ }
    this.dropAudio(); try { this.gain?.disconnect(); } catch { /* ok */ }      // the shared AudioContext stays open for the next start (never closed: iOS)
    this.onState({ state: 'stopped', text: 'Stopped' });
  }
}

/** The "This phone as a device" screen. */
export function roomView(S, refreshAll) {
  const root = h('div');
  const env = environment();
  const statusEl = h('div', { class: 'card', 'aria-live': 'polite' }), msgs = h('div');
  const nameIn = h('input', { type: 'text', maxlength: 40, value: defaultRoomName(), 'aria-label': 'Name of this device' });
  const limits = h('div', { class: 'card' }, h('h3', null, 'Please read: what a phone can and cannot do'), h('ul', { class: 'small' },
    h('li', null, env.ios ? 'iPhone / iPad: the sound stops soon after the screen locks or you open another app (Safari pauses web pages). Keep WavWiz on screen. Turn off Auto-Lock (Settings > Display & Brightness) while you listen. This cannot be fixed by a web page.' : 'Android Chrome often keeps playing with the screen off, but some phones stop background pages. Keep WavWiz open if the sound cuts out.'),
    h('li', null, 'The silent switch and volume buttons of the phone control this device; the device volume in WavWiz works too.'),
    h('li', null, 'Timing depends on the Wi-Fi. It is not measured: set this device\'s delay by ear (Devices > this phone > Delay) until it lines up with the other devices. Sync error is shown as “unknown”, never as zero.'),
    h('li', null, 'The microphone calibration chirps cannot be played by a phone page; use “By ear” for this device.')));
  const start = h('button', { class: 'btn primary', onclick: async () => {
    unlockAudio();                       // synchronously inside the tap: unlocks iOS audio
    msgs.replaceChildren(); start.disabled = true;
    try {
      localStorage.setItem(nameKey, nameIn.value.trim());
      await startPhoneAsDevice(nameIn.value.trim() || 'Phone');
      toast('This phone is now a device — joining the stream');
    } catch (e) {
      msgs.replaceChildren(h('div', { class: 'card', role: 'alert', style: 'border-color:#8a2b26' }, h('b', { class: 'err' }, 'Could not start'), h('p', null, e.message)));
    }
    start.disabled = false; sync();
  } }, 'Connect this phone (joins the stream)');
  const stopBtn = h('button', { class: 'btn', hidden: true, onclick: async () => { await stopPhoneDevice(); sync(); refreshAll && refreshAll(); } }, 'Stop');
  function sync() { const on = !!sharedDevice?.running; stopBtn.hidden = !on; start.hidden = on; }
  function draw(st) {
    sync();
    const z = st.zone;
    statusEl.replaceChildren(h('div', { class: 'row' }, h('span', { class: 'pill ' + ({ ok: 'ok', buffering: 'warn', syncing: 'warn', paused: 'bad', reconnecting: 'bad', background: 'warn', stopped: 'idle' }[st.state] || 'idle') }, st.state), h('b', null, st.text)),
      st.error ? h('p', { class: 'err' }, st.error) : null,
      sharedDevice?.running && !sharedDevice.audioReady ? h('button', { class: 'btn primary', onclick: () => unlockAudio() }, 'Tap to start sound') : null,
      z ? h('p', { class: 'small dim' }, `Device delay ${z.notCalibrated ? 'unknown (not set yet) - using 0 ms' : Math.round(z.latencyMs) + ' ms'}${z.source ? ' • ' + z.source : ''} • clock round trip ${st.rtt != null ? (st.rtt / 1000).toFixed(1) + ' ms' : 'unknown'} • frames played ${st.stats?.played ?? 0}, dropped late ${st.stats?.dropped ?? 0}, re-syncs ${st.stats?.resyncs ?? 0}`) : null);
  }
  draw({ state: 'idle', text: 'Not playing in this phone yet', zone: null });
  window.addEventListener('wavwiz:phone', ev => draw(ev.detail));
  root.append(h('h2', null, 'This phone as a device'), h('p', { class: 'dim' }, 'Turn this phone (or any browser) into one more speaker that plays in sync with your other devices. Audio joins the current stream as soon as you connect — no separate Play button.'),
    h('div', { class: 'field' }, h('label', null, 'Name of this device'), nameIn), h('div', { class: 'row wrap' }, start, stopBtn), msgs, statusEl, limits);
  return root;
}

/* ---------------------------------------------------------------- 0.0.7 phone audio unlock + auto-join
 * 0.0.6 regression: the auto-join and the device page BOTH started a PhoneRoom at load (no gesture), each created its own AudioContext, failed
 * after 1.5 s because iOS had not unlocked audio, and every retry made another context (iOS allows only a few) - and the WebSockets could not
 * authenticate on iOS Safari over http (now ticket-based, see wsconn.js). Now: ONE shared AudioContext, ONE PhoneRoom, the network joins at
 * once, and the first tap / click / key anywhere unlocks sound (touchend and click count as user gestures on iOS; pointerdown does not). */
let sharedDevice = null, unlockOverlay = null, ctx0 = null, starting = null, gestureInstalled = false, silentEl = null;

export function getPhoneDevice() { return sharedDevice; }
export function sharedCtx() {
  if (ctx0 && ctx0.state !== 'closed') return ctx0;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) throw new Error('This browser has no Web Audio.');
  try { ctx0 = new AC({ latencyHint: 'interactive' }); } catch { ctx0 = new AC(); }
  try { navigator.audioSession && (navigator.audioSession.type = 'playback'); } catch { /* optional (Safari 16.4+) */ }
  ctx0.addEventListener?.('statechange', () => { if (ctx0.state === 'running') hideUnlock(); else if (sharedDevice?.running) showUnlock(); });
  return ctx0;
}
/** Call synchronously from a gesture handler. Resumes the shared context, plays one silent sample and starts a looping silent <audio>
 * (iOS then routes Web Audio as media playback, so it also plays with the ring/silent switch on, and keeps the page "playing"). */
export function unlockAudio() {
  let c; try { c = sharedCtx(); } catch { return false; }
  try { c.resume().catch(() => {}); } catch { /* old Safari */ }
  try { const b = c.createBuffer(1, 1, c.sampleRate), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch { /* ok */ }
  try {
    if (!silentEl) {
      const sr = 8000, n = sr, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf), w = (o, t) => [...t].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
      w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
      silentEl = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))); silentEl.loop = true; silentEl.setAttribute('playsinline', ''); silentEl.volume = 0.01;
    }
    const p = silentEl.play(); p && p.catch(() => {});
  } catch { /* optional */ }
  return true;
}
export function installPhoneAutoJoin(S, refreshAll) {
  const phone = isPhoneUa() || matchMedia('(max-width:900px)').matches && matchMedia('(pointer:coarse)').matches;
  let stored = null; try { stored = localStorage.getItem(wantKey); } catch { /* ignore */ }
  installGestureUnlock();
  if (!wantsAutoJoin(stored, phone)) return;
  const go = () => startPhoneAsDevice(defaultRoomName()).then(() => refreshAll && refreshAll()).catch(e => { showUnlock(e.message); setTimeout(() => { if (!sharedDevice?.running) go(); }, 4000); });
  setTimeout(go, 150);
}
function installGestureUnlock() {
  if (gestureInstalled) return; gestureInstalled = true;
  const onGesture = () => { if (sharedDevice?.running && !sharedDevice.audioReady) unlockAudio(); else if (!ctx0 || ctx0.state !== 'running') { if (sharedDevice?.running) unlockAudio(); } };
  for (const ev of ['touchend', 'click', 'pointerup', 'keydown']) document.addEventListener(ev, onGesture, true);
}

function showUnlock(detail) {
  if (unlockOverlay || ctx0?.state === 'running' && !detail) return;
  unlockOverlay = h('div', { class: 'phone-unlock', role: 'button', tabindex: 0, 'aria-label': 'Tap to start the music on this phone', onclick: () => { unlockAudio(); if (!sharedDevice?.running) startPhoneAsDevice(defaultRoomName()).catch(() => {}); if (ctx0?.state === 'running' || !detail) hideUnlock(); } },
    h('div', { class: 'card' }, h('div', { class: 'unlock-icon', 'aria-hidden': 'true' }, '▶'), h('h2', null, 'Tap anywhere to start sound'), h('p', { class: 'dim' }, 'This phone will play in sync with your other speakers.'), detail ? h('p', { class: 'small dim' }, detail) : null));
  document.body.append(unlockOverlay);
}
function hideUnlock() { unlockOverlay?.remove(); unlockOverlay = null; }

export async function startPhoneAsDevice(name) {
  if (sharedDevice?.running) return sharedDevice;
  if (starting) return starting;
  const dev = new PhoneRoom({ name: name || defaultRoomName(), onState: st => { try { window.dispatchEvent(new CustomEvent('wavwiz:phone', { detail: st })); } catch { /* ignore */ } } });
  starting = (async () => {
    try {
      sharedDevice = dev; await dev.start();
      try { localStorage.setItem(wantKey, '1'); } catch { /* ignore */ }
      if (dev.audioReady) hideUnlock(); else showUnlock();
      return dev;
    } catch (e) { try { await dev.stop(); } catch { /* ok */ } if (sharedDevice === dev) sharedDevice = null; throw e; }
    finally { starting = null; }
  })();
  return starting;
}
export async function stopPhoneDevice() { const d = sharedDevice; sharedDevice = null; hideUnlock(); try { localStorage.setItem(wantKey, '0'); } catch { /* ignore */ } await d?.stop(); }
