// WavWiz 0.7.2 C: Announce (hold-to-talk) - pure parts of announce.js and the wiring contracts: the button in the Devices header (PC and phone),
// Control-only, the microphone asked for inside the press, no socket for a mis-tap, the https offer, the chime switch, events, handset-gated CSS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const ann = readFileSync(join(js, 'announce.js'), 'utf8');
const tree = readFileSync(join(js, 'tree42.js'), 'utf8');
const main = readFileSync(join(js, 'main.js'), 'utf8');
const set = readFileSync(join(js, 'settings.js'), 'utf8');
const css = readFileSync(join(js, '..', 'app.css'), 'utf8');
const pure = name => { const m = ann.match(new RegExp(`export function ${name}\\b[\\s\\S]*?\\n}\\n`)) || ann.match(new RegExp(`export const ${name} = .*\\n`)); assert.ok(m, name); return m[0].replace('export ', ''); };
const P = new Function(pure('ANNOUNCE_TITLE') + pure('announceTarget') + pure('wsUrl') + pure('toPcm16') + pure('levelOf') + pure('secureUrl') + pure('talkLabel') + pure('buttonTitle') +
  '\nreturn { announceTarget, wsUrl, toPcm16, levelOf, secureUrl, talkLabel, buttonTitle };')();

test('0.7.2 C: the target is the zone this page controls, or every zone', () => {
  assert.equal(P.announceTarget('zone', 'g:3'), 'g:3');
  assert.equal(P.announceTarget('zone', null), null);
  assert.equal(P.announceTarget('everywhere', 'g:3'), 'everywhere');
});

test('0.7.2 C: the socket address follows http/https and carries zone, rate and the chime choice', () => {
  assert.equal(P.wsUrl({ protocol: 'http:', host: 'pc:8080' }, 'g:3', 48000), 'ws://pc:8080/ws/announce?zone=g%3A3&rate=48000');
  assert.equal(P.wsUrl({ protocol: 'https:', host: 'pc:8443' }, null, 44100, false), 'wss://pc:8443/ws/announce?rate=44100&chime=0');
  assert.equal(P.wsUrl({ protocol: 'https:', host: 'pc:8443' }, 'everywhere', 0, true), 'wss://pc:8443/ws/announce?zone=everywhere&rate=48000&chime=1');
});

test('0.7.2 C: microphone floats become clipped 16-bit PCM; the level bar reads the peak', () => {
  assert.deepEqual([...P.toPcm16(new Float32Array([0, 1, -1, 0.5, 2, -3]))], [0, 32767, -32768, 16384, 32767, -32768]);
  assert.equal(P.levelOf(new Float32Array([0, 0.25, -0.5])), 0.8); assert.equal(P.levelOf(new Float32Array([0.9])), 1);
});

test('0.7.2 C: the secure address comes from /tls/info; none while HTTPS is off', () => {
  assert.equal(P.secureUrl({ enabled: true, host: '192.168.1.5', httpsPort: 8443 }, { hostname: 'x' }), 'https://192.168.1.5:8443/');
  assert.equal(P.secureUrl({ enabled: false, httpsPort: 8443 }, { hostname: 'x' }), null);
  assert.equal(P.secureUrl({ enabled: true, httpsPort: 8443 }, { hostname: 'wavwiz.local' }), 'https://wavwiz.local:8443/');
});

test('0.7.2 C: labels - who is talking where', () => {
  assert.equal(P.talkLabel('everywhere'), 'Talking to every zone');
  assert.equal(P.talkLabel('g:2', 'Kitchen'), 'Talking to Kitchen');
  assert.equal(P.buttonTitle(null, 'g:2', 'Kitchen'), 'Hold to announce (Kitchen)');
  assert.equal(P.buttonTitle('Mom', 'g:2', 'Kitchen'), 'Mom is announcing');
});

test('0.7.2 C: hold-to-talk contract - Control only, mic in the press, no socket (no chime) for a tap, end on release, no playback of the mic', () => {
  assert.match(ann, /const can = canControl\(S\)/);
  assert.match(ann, /if \(!can\) \{ btn\.disabled = true/);
  assert.match(ann, /pointerdown[\s\S]*?setPointerCapture[\s\S]*?t\.start\(\)/);
  assert.match(ann, /\['pointerup', 'pointercancel', 'lostpointercapture'\]/);
  assert.match(ann, /export const HOLD_MS = 250/);
  assert.match(ann, /setTimeout\(\(\) => \{[\s\S]*?new WebSocket\(wsUrl\(/);        // the socket opens only after the hold time
  assert.match(ann, /Date\.now\(\) - my\.t0 < HOLD_MS && !my\.ws\) \{ finish\(\); toast\(SHORT_HINT\)/);
  assert.match(ann, /my\.ws\.send\('end'\)/);
  assert.match(ann, /sink\.gain\.value = 0/);                                          // the processor runs into a muted sink: the talker never hears themselves
  assert.match(ann, /getUserMedia\(\{ audio: \{ echoCancellation: true/);
  assert.match(ann, /!window\.isSecureContext[\s\S]*?insecureSheet\(\)/);              // phones on http:// get the https address offer
  assert.match(ann, /ev\.stopPropagation\(\); if \(!ev\.repeat\) t\.start\(\)/);       // Space on the button does not also play / pause
});

test('0.7.2 C: wiring - Devices header button, announce events, Settings > Playback chime switch', () => {
  assert.match(tree, /import \{ announceButton \} from '\.\/announce\.js'/);
  assert.match(tree, /announceButton\(S\), addZoneBtn, addSpkBtn/);
  assert.match(main, /m\.type === 'announce'\) window\.dispatchEvent\(new CustomEvent\('wavwiz:' \+ m\.type/);
  assert.match(ann, /addEventListener\('wavwiz:announce'/);
  assert.match(set, /import \{ announceSettingsRow \} from '\.\/announce\.js'/);
  assert.match(set, /id: 'sec-announce'[\s\S]*?announceSettingsRow\(settings, admin, putSettings\)/);
  assert.match(ann, /settings\['announce\.chime'\] !== false/);                         // on by default
  assert.match(ann, /'data-setting': 'announce\.chime'/);
});

test('0.7.2 C: phone-only Announce CSS is gated on html.handset', () => {
  const block = css.slice(css.indexOf('/* 0.7.2 Announce'));
  assert.ok(block.length > 100);
  assert.match(block, /html\.handset \.tree42-h \.annwrap \.annlbl\{display:none\}/);
  assert.doesNotMatch(block, /@media \(max-width/);
  assert.match(block, /@media \(prefers-reduced-motion:reduce\)\{\.ann-live \.ann-dot\{animation:none\}\}/);
});
