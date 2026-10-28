// WavWiz 0.2.5: the phone's mic-only calibration page - the parts that decide ORDER and PLAN, kept DOM-free so they are unit tested with node.
//
// Why this page exists (0.2.4 bug on a real iPhone: "InvalidStateError: AudioSession category is not compatible with audio capture", and no
// microphone prompt): the calibration QR opened the normal WavWiz page, which joined the phone as a speaker. Joining set
// navigator.audioSession.type = 'playback' and started an AudioContext, so iOS Safari's audio session was playback-only by the time the wizard
// called getUserMedia, and WebKit refused to capture. This page never joins as a speaker and never plays anything. On the one "Start" tap it
// (1) sets the audio session to 'play-and-record' where Safari offers navigator.audioSession, (2) asks for the microphone FIRST, and only then
// (3) creates a capture-only AudioContext (an AudioWorklet with no outputs; nothing is ever connected to the speakers).

/** Opens the microphone the iOS-safe way. deps: { nav, win, track(msg) }. Returns { stream, ctx, rawOk, steps }. Throws the browser error as is. */
export async function openMicFirst({ nav, win, track = () => {}, started = null }) {
  const steps = [];
  const log = m => { steps.push(m); track(m); };
  if (started) return finishMic({ nav, win, log, steps, started });
  return finishMic({ nav, win, log, steps, started: requestMicSync({ nav, track: log }) });
}

/** 0.3.0 (section 10): the SYNCHRONOUS part, called directly in the "Allow microphone" tap handler with no await before it, so iOS keeps the
 * user gesture and shows its prompt: (1) audioSession = play-and-record, (2) getUserMedia. Returns { promise, rawAsked } without awaiting. */
export function requestMicSync({ nav, track = () => {} }) {
  try { if (nav.audioSession) { nav.audioSession.type = 'play-and-record'; track('audioSession=' + nav.audioSession.type); } else track('audioSession=n/a'); } catch (e) { track('audioSession failed: ' + (e && e.message)); }
  const raw = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } };
  track('getUserMedia');
  let promise;
  try { promise = nav.mediaDevices.getUserMedia(raw); } catch (e) { promise = Promise.reject(e); }
  return { promise, raw };
}

async function finishMic({ nav, win, log, steps, started }) {
  let stream, rawAsked = true;
  try { stream = await started.promise; }
  catch (e) {
    if (e && (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError')) { rawAsked = false; log('getUserMedia (default settings)'); stream = await nav.mediaDevices.getUserMedia({ audio: true }); }
    else throw e;
  }
  return afterStream({ win, log, steps, stream, rawAsked });
}

async function afterStream({ win, log, steps, stream, rawAsked }) {
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
/** 0.4.1: Quick (the default) = one test per speaker; the phone keeps the drift check (its clock is the one that drifts). Thorough = 3 per speaker. */
export function buildPlan(plan, runs = (plan && plan.quality === 'thorough' ? 3 : 1)) {
  const out = []; const ref = plan && plan.reference; if (!ref) return out;
  for (let i = 0; i < runs; i++) out.push({ kind: 'ref', zone: ref.id, label: `${ref.name} (reference, ${i + 1}/${runs})` });
  for (const z of plan.speakers || []) if (z.id !== ref.id) for (let i = 0; i < runs; i++) out.push({ kind: 'dev', zone: z.id, label: `${z.name} (${i + 1}/${runs})` });
  out.push({ kind: 'ref-end', zone: ref.id, label: `${ref.name} again (drift check)` });
  return out;
}

/** The ?cal= code from the address (6 letters/digits) or null. */
export function calCode(search) { try { const c = new URLSearchParams(search).get('cal') || ''; return /^[A-Za-z0-9]{6}$/.test(c) ? c.toUpperCase() : null; } catch { return null; } }

/** What the page shows before Start: needs-https | setup-phone (untrusted, inline certificate steps) | no-code | ready. */
/** 0.3.0: the denied help line (spec section 10, exact text). */
export const DENIED_HELP = 'Microphone blocked. On iPhone go to Settings > Safari > Microphone, set to Ask or Allow, then reload.';
export const DENIED_HELP_AA = 'Or in Safari tap aA > Website Settings > Microphone > Allow.';
/** 0.3.0: the on-screen diagnostics line for user reports. */
export function diagLine({ secure, protocol, err }) { return `isSecureContext: ${secure ? 'true' : 'false'} · ${protocol}${err ? ` · ${err.name || 'Error'}: ${err.message || ''}` : ''}`; }

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
export function phoneRole(store) { try { const v = store.getItem(ROLE_KEY); return v === 'speaker' || v === 'remote' || v === 'mic' ? v : null; } catch { return null; } }
export function setPhoneRole(store, v) { try { if (v === 'speaker' || v === 'remote' || v === 'mic') store.setItem(ROLE_KEY, v); else store.removeItem(ROLE_KEY); } catch { /* private mode */ } }

// ---- 0.3.1 B3: guided calibration. One stop per speaker visit (reference, each speaker, the reference again); nothing plays until Ready.
export const COUNTDOWN_KEY = 'wavwiz.cal.countdown', COUNTDOWN_S = 5;
export function guideGroups(steps) {
  const out = [];
  for (const st of steps || []) {
    const last = out[out.length - 1];
    if (last && last.zone === st.zone && last.kind === st.kind) { last.steps.push(st); continue; }
    const name = String(st.label || '').replace(/ \(.*$/, '').replace(/ again$/, '');
    out.push({ zone: st.zone, kind: st.kind, name, steps: [st], canSkip: st.kind === 'dev' });
  }
  return out;
}
export function guideText(name) { return `Walk to ${name}, hold the mic about 3 ft in front of it, then tap Ready`; }
export function guideStep(i, n) { return `Step ${i + 1} of ${n}`; }
export function countdownOn(store) { try { return store.getItem(COUNTDOWN_KEY) === '1'; } catch { return false; } }
export function setCountdown(store, on) { try { store.setItem(COUNTDOWN_KEY, on ? '1' : '0'); } catch { /* private mode */ } }
export function skipNote(name) { return `Skipped ${name}: its delay is unchanged`; }
