// Every way the phone calibration can fail, in plain English, with what to do about it. Pure (no DOM): unit-tested with node.
export class CalError extends Error {
  constructor(code, detail, extra = {}) { super(detail || code); this.code = code; this.detail = detail || ''; Object.assign(this, extra); }
}

export function environment(nav = (typeof navigator !== 'undefined' ? navigator : {}), win = (typeof window !== 'undefined' ? window : {})) {
  const ua = nav.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
  const android = /Android/.test(ua);
  const inApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|GSA\/|Snapchat|Twitter|; wv\)|WebView/.test(ua);
  const safari = ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return { ua, ios, android, inApp, safari, secure: !!win.isSecureContext, hasGum: !!(nav.mediaDevices && nav.mediaDevices.getUserMedia), hasWorklet: !!((win.AudioContext || win.webkitAudioContext) && (win.AudioWorkletNode)), hasCtx: !!(win.AudioContext || win.webkitAudioContext) };
}

/** Turns a browser exception from getUserMedia into one of our codes. */
export function classifyMicError(e) {
  const n = e && e.name || '';
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return 'MIC_DENIED';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'MIC_NONE';
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'MIC_BUSY';
  if (n === 'OverconstrainedError' || n === 'ConstraintNotSatisfiedError') return 'MIC_CONSTRAINT';
  if (n === 'SecurityError') return 'INSECURE';
  if (n === 'TypeError') return 'NO_MEDIA_API';
  return 'MIC_UNKNOWN';
}

const T = {
  IN_APP_BROWSER: env => ({ title: 'This browser cannot use the microphone', why: 'You opened WavWiz inside another app (a chat, social or mail app). Those built-in browsers block the microphone.', fix: [env.ios ? 'Tap the share / "..." button and choose "Open in Safari".' : 'Tap the "..." menu and choose "Open in Chrome" (or your normal browser).', 'Then start the calibration again.'] }),
  INSECURE: env => ({ title: 'The page is not secure, so the phone will not allow the microphone', why: 'Phones only allow the microphone on a trusted HTTPS page. This page is plain HTTP, or its certificate is not trusted yet.', fix: ['On the WavWiz PC open Settings > Phone & HTTPS and press "Set up HTTPS".', 'On this phone open the set-up page (QR code in that same card) and follow the steps. Then tap "Check my phone".', 'Open WavWiz again from the https:// address.', 'No time for that? Use "By ear" instead - it needs no microphone.'], link: { href: '/tls/setup', text: 'Open the phone set-up page' } }),
  NO_MEDIA_API: env => ({ title: 'This browser has no microphone support', why: 'The browser does not offer the microphone interface (often an old browser or an in-app browser).', fix: [env.ios ? 'Use Safari on iOS 14.3 or newer.' : 'Use a current Chrome, Edge, Firefox or Samsung Internet.', 'Or use "By ear" - it needs no microphone.'] }),
  MIC_DENIED: env => ({ title: 'The microphone is blocked', why: 'The phone said no to microphone access for this page (you tapped "Don\'t Allow", or it is blocked in settings).', fix: env.ios ? ['In Safari tap the "aA" button in the address bar > Website Settings > Microphone > Allow.', 'Or: Settings > Safari > Microphone > Ask (or Allow).', 'Reload this page, then try again.'] : ['Tap the padlock / tune icon next to the address > Permissions > Microphone > Allow.', 'Reload this page, then try again.'] }),
  MIC_NONE: () => ({ title: 'No microphone was found', why: 'The phone did not report any microphone.', fix: ['Unplug headsets or adapters and try again.', 'Check the phone\'s microphone works in another app (voice memo).', 'Or use "By ear".'] }),
  MIC_BUSY: () => ({ title: 'The microphone is busy', why: 'Another app (a call, voice chat, recorder or another browser tab) is using the microphone.', fix: ['Close the other app or tab that uses the microphone, hang up any call.', 'Then try again.'] }),
  MIC_CONSTRAINT: () => ({ title: 'The microphone does not support the settings WavWiz asked for', why: 'WavWiz asked for an unprocessed microphone signal; this microphone could not provide it.', fix: ['Try again - WavWiz will retry with the phone\'s default settings (result may be less exact).', 'If it keeps failing, use "By ear".'] }),
  MIC_UNKNOWN: () => ({ title: 'The microphone could not be started', why: 'The phone gave an unexpected error when opening the microphone.', fix: ['Reload the page and try again.', 'Tap "Copy details" and keep them if you ask for help.'] }),
  MIC_SILENT: env => ({ title: 'The microphone heard nothing at all', why: 'The microphone worked but delivered pure silence - it is probably muted or another input (like a Bluetooth headset) was selected.', fix: [env.ios ? 'Disconnect Bluetooth headphones, and make sure no other app is holding the microphone.' : 'Disconnect Bluetooth headsets and check the microphone is not muted.', 'Hold the phone near a speaker and try again.'] }),
  CTX_SUSPENDED: env => ({ title: 'The phone would not start its audio engine', why: 'The audio system stayed "suspended". Phones only start audio right after you tap something.', fix: ['Tap "Try again" (the tap itself starts the audio).', env.ios ? 'Check the ring/silent switch and volume; turn Low Power Mode off for the measurement.' : 'Check the media volume is not zero.'] }),
  NO_AUDIO_API: () => ({ title: 'This browser has no Web Audio support', why: 'The browser does not provide the audio engine WavWiz needs.', fix: ['Use a current Safari, Chrome or Edge.', 'Or use "By ear".'] }),
  WORKLET_FAILED: () => ({ title: 'Recording helper could not load', why: 'The recording helper script failed to load. WavWiz will use a compatibility recorder instead (a little less exact).', fix: ['Nothing to do - you can continue.'] }),
  CLOCK_WS_FAILED: env => ({ title: 'Could not connect the clock to the server', why: 'The phone could not open the live clock connection. On https this almost always means the phone does not trust the certificate yet, or Wi-Fi is off.', fix: ['Make sure the phone is on the home Wi-Fi (not mobile data).', 'Open the phone set-up page and tap "Check my phone".', 'Check that the WavWiz PC is on and WavWiz is running.'], link: { href: '/tls/check', text: 'Check my phone\'s trust' } }),
  CLOCK_TIMEOUT: () => ({ title: 'The server did not answer the clock requests', why: 'The connection opened but answers did not come back in time.', fix: ['Move closer to the Wi-Fi router and try again.', 'If several people stream video, wait a minute.'] }),
  CLOCK_UNSTABLE: () => ({ title: 'The Wi-Fi link is too unstable to measure', why: 'Too few clock replies came back, or their timing jumped around too much for an accurate measurement.', fix: ['Move closer to the router.', 'Pause large downloads on the network and try again.', 'Or use "By ear".'] }),
  SESSION_FAILED: () => ({ title: 'The server refused to start a calibration', why: 'The server answered with an error (shown below).', fix: ['Make sure the two devices are connected and playing is stopped.', 'Check you are signed in as a person who may calibrate (Control or Admin).'] }),
  UPLOAD_FAILED: () => ({ title: 'The recording could not be sent to the server', why: 'The phone recorded sound but sending it failed (network or server error).', fix: ['Check the Wi-Fi and try again.'] }),
  SCREEN_HIDDEN: () => ({ title: 'The screen turned off or you left the page', why: 'Phones pause web pages as soon as the screen locks or another app opens, which stops the recording.', fix: ['Keep WavWiz on screen during the measurement (about a minute per device).', 'iPhone: Settings > Display & Brightness > Auto-Lock > 5 minutes or Never, just for this.'] }),
  NOT_HEARD: () => ({ title: 'The test sounds were not heard', why: 'The chirps were too quiet, too noisy, or the phone was too far from the speaker.', fix: ['Hold the phone 1-2 meters from the speaker being measured.', 'Quiet the device (TV, dishwasher, fans).', 'Raise the "Test sound level" a little and try again.'] }),
  UNKNOWN: () => ({ title: 'Something unexpected went wrong', why: 'An unexpected error stopped the calibration.', fix: ['Tap "Try again".', 'Tap "Copy details" if you need help.'] }),
};

export function describe(code, env = environment()) {
  const f = T[code] || T.UNKNOWN; return { code: T[code] ? code : 'UNKNOWN', ...f(env) };
}

/** Maps the server's per-capture note (RunResult) to a code, else null. */
export function classifyServerNote(note) {
  const n = (note || '').toLowerCase();
  if (!n) return null;
  if (/not heard|no click|could not find|too quiet|nothing|no chirp|weak/.test(n)) return 'NOT_HEARD';
  return null;
}

export function rms(samples) { let s = 0; for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i]; return samples.length ? Math.sqrt(s / samples.length) : 0; }

export function detailsText(err, env, extra = {}) {
  const d = describe(err.code, env);
  return [`WavWiz calibration problem`, `code: ${d.code}`, `what: ${d.title}`, `detail: ${err.detail || ''}`, `time: ${new Date().toString()}`, `secure page: ${env.secure}`, `ios: ${env.ios} android: ${env.android} safari: ${env.safari} in-app: ${env.inApp}`,
    `has getUserMedia: ${env.hasGum} has audio worklet: ${env.hasWorklet}`, ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`), `agent: ${env.ua}`].join('\n');
}
