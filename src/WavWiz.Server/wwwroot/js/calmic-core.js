// WavWiz 0.2.5: the phone's mic-only calibration page - the parts that decide ORDER and PLAN, kept DOM-free so they are unit tested with node.
//
// Why this page exists (0.2.4 bug on a real iPhone: "InvalidStateError: AudioSession category is not compatible with audio capture", and no
// microphone prompt): the calibration QR opened the normal WavWiz page, which joined the phone as a speaker. Joining set
// navigator.audioSession.type = 'playback' and started an AudioContext, so iOS Safari's audio session was playback-only by the time the wizard
// called getUserMedia, and WebKit refused to capture. This page never joins as a speaker and never plays anything. On the one "Start" tap it
// (1) sets the audio session to 'play-and-record' where Safari offers navigator.audioSession, (2) asks for the microphone FIRST, and only then
// (3) creates a capture-only AudioContext (an AudioWorklet with no outputs; nothing is ever connected to the speakers).

/** Opens the microphone the iOS-safe way. deps: { nav, win, track(msg) }. Returns { stream, ctx, rawOk, steps }. Throws the browser error as is. */
export async function openMicFirst({ nav, win, track = () => {} }) {
  const steps = [];
  const log = m => { steps.push(m); track(m); };
  // 1. iOS 16.4+/17: tell Safari this page records. Must happen before getUserMedia and before any AudioContext exists.
  try { if (nav.audioSession) { nav.audioSession.type = 'play-and-record'; log('audioSession=' + nav.audioSession.type); } else log('audioSession=n/a'); } catch (e) { log('audioSession failed: ' + (e && e.message)); }
  // 2. the microphone FIRST (still inside the tap, so iOS shows its prompt)
  const raw = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } };
  let stream, rawAsked = true;
  try { log('getUserMedia'); stream = await nav.mediaDevices.getUserMedia(raw); }
  catch (e) {
    if (e && (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError')) { rawAsked = false; log('getUserMedia (default settings)'); stream = await nav.mediaDevices.getUserMedia({ audio: true }); }
    else throw e;
  }
  const trk = stream.getAudioTracks()[0]; const set = trk && trk.getSettings ? trk.getSettings() : {};
  const rawOk = rawAsked && set.echoCancellation === false && set.noiseSuppression === false && set.autoGainControl === false;
  // 3. only now an AudioContext - for recording only. It is never connected to anything that makes sound.
  const AC = win.AudioContext || win.webkitAudioContext; if (!AC) throw Object.assign(new Error('AudioContext is missing'), { name: 'NoAudioApi' });
  log('AudioContext'); const ctx = new AC({ latencyHint: 'interactive' });
  try { await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 1500))]); } catch { /* checked by the page */ }
  log('ctx ' + ctx.state);
  return { stream, ctx, rawOk, steps, label: trk && trk.label || '' };
}

/** The measurement plan, same as the PC-mic run: reference x3, each speaker x3, the reference again (drift check). */
export function buildPlan(plan, runs = 3) {
  const out = []; const ref = plan && plan.reference; if (!ref) return out;
  for (let i = 0; i < runs; i++) out.push({ kind: 'ref', zone: ref.id, label: `${ref.name} (reference, ${i + 1}/${runs})` });
  for (const z of plan.speakers || []) if (z.id !== ref.id) for (let i = 0; i < runs; i++) out.push({ kind: 'dev', zone: z.id, label: `${z.name} (${i + 1}/${runs})` });
  out.push({ kind: 'ref-end', zone: ref.id, label: `${ref.name} again (drift check)` });
  return out;
}

/** The ?cal= code from the address (6 letters/digits) or null. */
export function calCode(search) { try { const c = new URLSearchParams(search).get('cal') || ''; return /^[A-Za-z0-9]{6}$/.test(c) ? c.toUpperCase() : null; } catch { return null; } }

/** What the page shows before Start: needs-https | setup-phone (untrusted, inline certificate steps) | no-code | ready. */
export function pageMode({ protocol, httpsEnabled, code, signedIn }) {
  if (!code && !signedIn) return 'no-code';
  if (protocol !== 'https:') return httpsEnabled ? 'setup-phone' : 'needs-https';
  return 'ready';
}

/** A readable name for this phone (shown on the PC as "Phone connected: …"). */
export function phoneName(ua = '', touch = 0) {
  if (/iPhone|iPod/.test(ua)) return 'iPhone'; if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet'; return 'Phone';
}

/** 0.2.5 phone role: a phone opening WavWiz normally is asked once - play music here, or be a calibration mic. Stored per browser. */
export const ROLE_KEY = 'wavwiz.phoneRole';
export function phoneRole(store) { try { const v = store.getItem(ROLE_KEY); return v === 'speaker' || v === 'mic' ? v : null; } catch { return null; } }
export function setPhoneRole(store, v) { try { if (v === 'speaker' || v === 'mic') store.setItem(ROLE_KEY, v); else store.removeItem(ROLE_KEY); } catch { /* private mode */ } }
