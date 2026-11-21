// WavWiz 0.7.2 Announce: hold-to-talk from a PC or a phone. Hold the button and talk; every speaker in the zone (or Everywhere) hears a chime
// (Settings > Playback, on by default) and then you, with the music turned down 12 dB - never paused or skipped - and faded back up when you let go.
// The page streams its microphone to the server (WebSocket /ws/announce, 16-bit mono PCM). Browsers only open the microphone on a secure page, so a
// phone on plain http:// is offered the https:// address first. Control (and Admin) may announce; View may not.
import { h, toast, getApiZone } from './util.js';
import { icon } from './icons.js';
import { canControl } from './ui.js';
import * as Z from './zones40.js';

export const ANNOUNCE_TITLE = 'Hold to announce';
export const TO_KEY = 'wavwiz.announceTo';
export const HOLD_MS = 250;              // a tap shorter than this is not an announcement (no chime for a mis-tap)
export const SHORT_HINT = 'Hold the button while you talk, then let go.';
export const INSECURE_TITLE = 'Announcing needs the secure address';
export const DUCK_TEXT = 'Music turns down 12 dB while you talk (it never pauses) and fades back when you let go.';
export const VIEW_ONLY = 'Your access is view-only.';

// ---------------------------------------------------------------- pure parts (unit-tested)
/** Where an announcement goes: 'everywhere', or the zone this page controls (null = the house group). */
export const announceTarget = (pref, zone) => pref === 'everywhere' ? 'everywhere' : (zone || null);
/** The WebSocket address for a target, sample rate and chime choice (null = the server's setting). */
export function wsUrl(loc, target, rate, chime = null) {
  const q = new URLSearchParams(); if (target) q.set('zone', target); q.set('rate', String(Math.round(rate) || 48000)); if (chime != null) q.set('chime', chime ? '1' : '0');
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws/announce?${q}`;
}
/** Float samples (-1..1) to 16-bit little-endian PCM, clipped. */
export function toPcm16(f32) {
  const o = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) { const v = Math.max(-1, Math.min(1, f32[i])); o[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767); }
  return o;
}
/** Peak of a block as 0..1 for the little level bar. */
export const levelOf = f32 => { let p = 0; for (let i = 0; i < f32.length; i++) { const a = Math.abs(f32[i]); if (a > p) p = a; } return Math.min(1, p * 1.6); };
/** The secure address of this page on the server's HTTPS port (from /tls/info), or null when HTTPS is off. */
export const secureUrl = (info, loc) => info && info.enabled && info.httpsPort ? `https://${info.host || loc.hostname}:${info.httpsPort}/` : null;
/** The live label while talking. */
export const talkLabel = (target, zoneName) => target === 'everywhere' ? 'Talking to every zone' : `Talking to ${zoneName || 'this zone'}`;
/** The button tooltip, also for someone else announcing. */
export const buttonTitle = (busyBy, target, zoneName) => busyBy ? `${busyBy} is announcing` : `${ANNOUNCE_TITLE} (${target === 'everywhere' ? 'every zone' : zoneName || 'this zone'})`;
const loadPref = () => { try { return localStorage.getItem(TO_KEY) === 'everywhere' ? 'everywhere' : 'zone'; } catch { return 'zone'; } };
const savePref = v => { try { localStorage.setItem(TO_KEY, v); } catch { /* private mode */ } };

// ---------------------------------------------------------------- live state (one talker per page)
let busyBy = null;
if (typeof window !== 'undefined') window.addEventListener('wavwiz:announce', e => { const d = e.detail || {}; busyBy = d.active ? d.by || 'Someone' : null; document.querySelectorAll('.annbtn').forEach(b => { b.classList.toggle('busy', !!busyBy && !b.classList.contains('talking')); b.title = buttonTitle(busyBy, announceTarget(loadPref(), getApiZone()), Z.current?.()?.name); }); });

/** 0.7.2 t2166u: inside the desktop Player's window (the same test as viz.js inDesktopPlayer, kept here so this module stays light). */
export const inDesktopPlayer = (ua = globalThis.navigator?.userAgent || '') => /WavWizPlayer\//.test(ua);
export function insecureSheet(title = INSECURE_TITLE, again = 'then hold Announce again') {   // 0.7.2 D: also the zone timing check's
  const box = h('div', { class: 'ann-sheet', role: 'dialog', 'aria-label': title },
    h('b', null, title), h('p', { class: 'small' }, `Browsers only let a page use the microphone over https://. Open WavWiz from its secure address on this device, ${again}.`));
  if (inDesktopPlayer()) {   // 0.7.2 t2166u: no links that strand the desktop Player on the phone set-up page; the 0.7.2 Player allows the mic itself
    box.querySelector('p').textContent = 'This WavWiz Player cannot use the microphone yet. Update the Player to 0.7.2 or later, or use a phone or a browser.';
    box.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn sm', onclick: () => box.remove() }, 'Close')));
    document.body.append(box); return;
  }
  const go = h('a', { class: 'btn sm primary', href: '#', hidden: true }, 'Open the secure address');
  const close = h('button', { type: 'button', class: 'btn sm', onclick: () => box.remove() }, 'Close');
  box.append(h('div', { class: 'row' }, go, h('a', { class: 'btn sm', href: '/tls/check' }, 'Check this device'), close));
  document.body.append(box);
  fetch('/tls/info', { cache: 'no-store' }).then(r => r.json()).then(info => { const u = secureUrl(info, location); if (u) { go.href = u; go.hidden = false; } }).catch(() => { /* keep the check link */ });
}

/** Hold-to-talk. Returns { start, stop } so tests and the keyboard can drive it. */
function talker(btn) {
  let st = null;
  const overlay = (label) => {
    const bar = h('i', { class: 'ann-lvl' }), el = h('div', { class: 'ann-live', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'ann-dot' }), h('b', null, label), h('span', { class: 'small dim' }, 'let go to finish'), h('span', { class: 'ann-meter' }, bar));
    document.body.append(el); return { el, bar };
  };
  async function start() {
    if (st) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { insecureSheet(); return; }
    const t0 = Date.now(), target = announceTarget(loadPref(), getApiZone()), name = Z.current?.()?.name;
    st = { t0, target, sent: 0, q: [], ws: null, ready: false, ended: false };
    btn.classList.add('talking'); btn.setAttribute('aria-pressed', 'true');
    // the microphone is asked for right in the press (iOS keeps the user gesture), the socket only after HOLD_MS so a mis-tap rings no chime
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* not Safari */ }
    const mic = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const my = st;
    try { my.stream = await mic; } catch (e) { finish(); toast(e && e.name === 'NotAllowedError' ? 'The microphone is blocked for this page. Allow it in the browser, then hold Announce again.' : 'Could not open the microphone: ' + (e?.message || e), true); return; }
    if (st !== my) { my.stream.getTracks().forEach(t => t.stop()); return; }
    const AC = window.AudioContext || window.webkitAudioContext; let ctx;
    try { ctx = new AC({ sampleRate: 48000, latencyHint: 'interactive' }); } catch { ctx = new AC({ latencyHint: 'interactive' }); }
    my.ctx = ctx; try { await ctx.resume(); } catch { /* resumes on its own */ }
    const src = ctx.createMediaStreamSource(my.stream), proc = ctx.createScriptProcessor(2048, 1, 1), sink = ctx.createGain(); sink.gain.value = 0;
    src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);     // a muted sink: the processor runs, nothing is played back
    my.ui = overlay(talkLabel(target, name));
    proc.onaudioprocess = ev => {
      if (st !== my) return; const x = ev.inputBuffer.getChannelData(0); my.ui.bar.style.width = Math.round(levelOf(x) * 100) + '%';
      const pcm = toPcm16(x).buffer; if (my.ready && my.ws?.readyState === 1) my.ws.send(pcm); else if (!my.ended) { my.q.push(pcm); if (my.q.length > 40) my.q.shift(); }
    };
    my.proc = proc;
    setTimeout(() => {
      if (st !== my || my.ended) return;
      const ws = new WebSocket(wsUrl(location, target, ctx.sampleRate)); ws.binaryType = 'arraybuffer'; my.ws = ws;
      ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'ready') { my.ready = true; for (const b of my.q) ws.send(b); my.q = []; if (my.ended) { ws.send('end'); } }
        else if (m.type === 'error') { toast(m.message || 'Could not announce', true); finish(); }
        else if (m.type === 'done') { try { ws.close(); } catch { /* closed */ } } };
      ws.onerror = () => { if (st === my && !my.ready) { toast('Could not reach the server to announce', true); finish(); } };
    }, Math.max(0, HOLD_MS - (Date.now() - t0)));
  }
  function stop() {
    const my = st; if (!my) return;
    if (Date.now() - my.t0 < HOLD_MS && !my.ws) { finish(); toast(SHORT_HINT); return; }
    my.ended = true; if (my.ready && my.ws?.readyState === 1) my.ws.send('end');
    release(my);
  }
  function release(my) {
    try { my.proc && (my.proc.onaudioprocess = null); my.stream?.getTracks().forEach(t => t.stop()); my.ctx?.close(); } catch { /* gone */ }
    if (my.ui) { my.ui.el.classList.add('done'); setTimeout(() => my.ui.el.remove(), 900); }
    btn.classList.remove('talking'); btn.setAttribute('aria-pressed', 'false'); if (st === my) st = null;
  }
  function finish() { const my = st; if (!my) return; my.ended = true; try { my.ws?.close(); } catch { /* closed */ } release(my); }
  return { start, stop };
}

/** The Announce button (hold to talk) + its "to" picker: This zone / Everywhere. View-only users see it disabled. */
export function announceButton(S, { compact = false } = {}) {
  const can = canControl(S), name = () => Z.current?.()?.name;
  const btn = h('button', { type: 'button', class: 'btn sm annbtn' + (compact ? ' compact' : ''), 'aria-label': ANNOUNCE_TITLE, 'aria-pressed': 'false', title: can ? buttonTitle(busyBy, announceTarget(loadPref(), getApiZone()), name()) : VIEW_ONLY },
    icon('mic'), compact ? null : h('span', { class: 'annlbl' }, 'Announce'));
  if (!can) { btn.disabled = true; btn.classList.add('ro'); btn.setAttribute('aria-disabled', 'true'); return h('span', { class: 'annwrap' }, btn); }
  const t = talker(btn);
  btn.addEventListener('pointerdown', ev => { if (ev.button !== 0) return; ev.preventDefault(); try { btn.setPointerCapture(ev.pointerId); } catch { /* old browser */ } t.start(); });
  for (const e of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(e, () => t.stop());
  btn.addEventListener('keydown', ev => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); if (!ev.repeat) t.start(); } });
  btn.addEventListener('keyup', ev => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); t.stop(); } });
  btn.addEventListener('contextmenu', ev => ev.preventDefault());
  const to = h('button', { type: 'button', class: 'btn sm anntobtn', 'aria-haspopup': 'menu', 'aria-label': 'Announce to', title: 'Announce to this zone or every zone' }, icon('chevD'));
  to.addEventListener('click', ev => {
    ev.stopPropagation(); document.querySelector('.ann-menu')?.remove();
    const pick = v => { savePref(v); m.remove(); btn.title = buttonTitle(busyBy, announceTarget(v, getApiZone()), name()); toast(v === 'everywhere' ? 'Announcements go to every zone' : 'Announcements go to the zone you control'); };
    const cur = loadPref(), r = to.getBoundingClientRect();
    const m = h('div', { class: 'ann-menu', role: 'menu' },
      h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(cur === 'zone'), onclick: () => pick('zone') }, `This zone${name() ? ' (' + name() + ')' : ''}`),
      h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(cur === 'everywhere'), onclick: () => pick('everywhere') }, 'Everywhere'),
      h('p', { class: 'small dim' }, DUCK_TEXT));
    m.style.top = Math.round(r.bottom + 4) + 'px'; m.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    document.body.append(m); setTimeout(() => document.addEventListener('pointerdown', function out(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', out, true); } }, true));
  });
  return h('span', { class: 'annwrap' }, btn, to);
}

/** Settings > Playback: the chime switch (admins). */
export function announceSettingsRow(settings, admin, put) {
  const on = settings['announce.chime'] !== false;
  return h('div', { class: 'setrow', id: 'set-announce' },
    h('div', { class: 'grow' }, h('div', null, 'Chime before announcements'), h('div', { class: 'small dim' }, DUCK_TEXT + ' Hold Announce in Devices to talk.'),
      h('span', { class: 'setterms', hidden: true }, 'announce announcement intercom talk speak hold to talk chime ding duck page')),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: on, disabled: !admin, 'aria-label': 'Chime before announcements', 'data-setting': 'announce.chime',
      onchange: async ev => { try { await put({ 'announce.chime': ev.target.checked }); } catch (e) { ev.target.checked = !ev.target.checked; toast(e.message, true); } } }), h('span', { 'aria-hidden': 'true' })));
}
