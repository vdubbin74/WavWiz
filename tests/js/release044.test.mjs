// WavWiz 0.4.4 - pure logic / source checks for the fix list. UI covered by tests/ui/ui044.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = process.env.JS_DIR;
const src = n => readFileSync(`${js}/${n}.js`, 'utf8'), css = () => readFileSync(`${js}/../app.css`, 'utf8');

test('F16 CSS: master + zone VOLUME rows use a 4-column grid so the slider is not stuck in the 38px % column', () => {
  const c = css();
  assert.match(c, /\.devpanel\.expanded \.dexp-top \.dmaster \.dvol-master\{[^}]*grid-template-columns:auto minmax\(120px,1fr\) minmax\(38px,3\.2em\) 28px/);
  assert.match(c, /\.devpanel \.zp42-row\.dvol\{[^}]*grid-template-columns:auto minmax\(120px,1fr\) minmax\(38px,3\.2em\) 28px/);
  assert.match(c, /\.devpanel \.dvol \.pct\{width:auto;min-width:38px/);
  // zone page still builds label + vbar + pct + mute (the 4 cells the grid expects)
  assert.match(src('tree42'), /class: 'zp42-row dvol'.*VOLUME.*bar\.wrap.*bar\.pct.*mute/s);
  // master still puts the CONTROLLING chip before the slider
  assert.match(src('devices'), /class: 'dvol dvol-master'.*zoneChip\('zs-master'\).*sl.*pct.*masterMuteButton/s);
});

test('F11 UI: Copy queue to zone always sends mode=copy (no Move option)', () => {
  const s = src('listtable');
  assert.match(s, /Copy queue to zone/);
  assert.match(s, /mode: 'copy'/);
  assert.doesNotMatch(s, /Move \(clear it here\)/);
  assert.doesNotMatch(s, /'Send to zone/);
});

test('F10 UI: Editing: picker, no (controlling) on queue options', () => {
  const s = src('listtable');
  assert.match(s, /'Editing:'/);
  assert.match(s, /editLbl.*pickSel.*sendBtn/s);
  // options are plain zone names (no suffix); the word may still appear in a comment
  assert.match(s, /cs\.map\(c => h\('option', \{ value: c\.key \}, c\.name\)\)/);
  assert.doesNotMatch(s, /c\.name \+ .*controlling/);
});

test('F8 dragInfo.ref stashed for WebKit drop; listtable accepts lib drag without MIME in types', () => {
  const u = src('ui'), l = src('listtable');
  assert.match(u, /dragInfo\.ref = ref/);
  assert.match(l, /libDragging/);
  assert.match(l, /dragInfo\.ref \? JSON\.stringify\(dragInfo\.ref\)/);
});
test('H1 reg034 seeds queue and waits for row 5 / qgrip', () => {
  const r = readFileSync(new URL('../ui/reg034.mjs', import.meta.url), 'utf8');
  assert.match(r, /tr\[data-i\]:nth-child\(5\)/);
  assert.match(r, /td\.num \.qgrip/);
  assert.match(r, /queue\/clear/);
});

test('F21 Calibrate: no auto-start; title includes mic on PC; PC picker when another PC has a mic', () => {
  const s = src('calibrate');
  assert.doesNotMatch(s, /auto && !autoDone/);
  assert.doesNotMatch(s, /auto: !!opts\.quick/);
  assert.match(s, /Listening with \$\{sess\.micName \|\| mic\.name\} on \$\{pc\.name\}/);
  assert.match(s, /pcsWithMic\.length > 1/);
  assert.match(s, /\(this PC\)/);
  assert.match(src('devices'), /openCalibration\(S, ctl\.refreshAll, zz\.id, \{ quick: true \}/);  // still opens Quick quality path
});

test('F22 chirp pattern matches Measure.ChirpPattern (rate, offsets, length)', async () => {
  const { pathToFileURL } = await import('node:url');
  const base = pathToFileURL(js.endsWith('/') ? js : js + '/').href;
  const { makeChirpPattern, OffsetsMs, SampleRate, ChirpMs, F0, F1, simulateMeasuredOffsetMs } = await import(base + 'chirppattern.js');
  assert.equal(SampleRate, 48000);
  assert.deepEqual([...OffsetsMs], [0, 450, 1000, 1350, 2050, 2400, 3150, 3500]);
  assert.equal(ChirpMs, 50); assert.equal(F0, 700); assert.equal(F1, 7000);
  const p = makeChirpPattern(-20);
  assert.equal(p.lengthMs, 3550);
  assert.equal(p.signal.length, Math.round(3500 * 48) + Math.round(50 * 48));
  // not silence: peak of first chirp is audible
  let peak = 0; for (let i = 0; i < 2400; i++) peak = Math.max(peak, Math.abs(p.signal[i]));
  assert.ok(peak > 0.05 && peak < 0.2, 'level near -20 dBFS, peak=' + peak);
  // measured offset includes injected output latency (sim)
  assert.equal(simulateMeasuredOffsetMs(1e9, { outputLatencyMs: 220, acousticMs: 3 }), 223);
});

test('F22 room.js plays play-pattern via FrameScheduler (not unsupported)', () => {
  const s = src('room');
  assert.match(s, /action === 'play-pattern'/);
  assert.match(s, /playPattern\(/);
  assert.match(s, /scheduleChirpOnScheduler/);
  assert.match(s, /latencyMs:\s*0/);
  assert.match(s, /pattern-ack/);
  assert.match(s, /FrameScheduler/);
  // must not still blanket-unsupported every non-test-tone
  assert.doesNotMatch(s, /A phone page cannot play the calibration chirps precisely enough/);
});

test('F22 calibrate: unlock hint + low-confidence By ear fallback (no up-front divert)', () => {
  const s = src('calibrate');
  assert.match(s, /Tap the phone to unlock sound/);
  assert.match(s, /isLowConfidence|LOW_CONF/);
  assert.match(s, /f22-byear/);
  assert.match(s, /By ear for low-confidence|calbyear/);
  assert.match(s, /chirps OK|plays chirps in sync/);
  // must NOT divert phones away from mic calibration up front
  assert.doesNotMatch(s, /Phone speakers can't play calibration chirps/);
  assert.doesNotMatch(s, /Use By ear for this speaker/);
});

test('F7: collapsed Library rail count - thousands separator + tooltip, vertical/themed CSS', async () => {
  const { libCountLabel } = await import(`${js}/libcount.js`);
  assert.deepEqual(libCountLabel(5372), { text: '5,372', title: '5,372 songs' });
  assert.deepEqual(libCountLabel(1), { text: '1', title: '1 song' });
  assert.equal(libCountLabel(null).text, '');
  assert.match(src('main'), /libCountLabel\(tracks\)/);
  const c = css(); const rule = c.match(/\.libpanel\.israil \.prail-n\{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /writing-mode:vertical-rl/); assert.match(rule, /rotate\(180deg\)/); assert.match(rule, /border:0/); assert.match(rule, /background:none/); assert.match(rule, /align-self:flex-start/);
});

test('F1-F3/F18 CSS + scene subtitle source', () => {
  const c = css();
  assert.match(c, /\.ssc-col \.ssc-sched\{display:grid;[^}]*grid-template-areas:"tm mid pill ed" "tm when when when"/);
  assert.match(c, /\.ssc-col \.ssc-sched>\.ss-when>\.small\{white-space:nowrap\}/);
  assert.match(c, /\.devpanel \.devbody \.ssc-col>\.pane-h\.dsec-h\{margin-left:0;margin-right:0\}/);
  assert.match(c, /\.dtag,\.tag\.dtag\{[^}]*height:17px;font-size:9px[^}]*border-radius:3px/);
  assert.match(src('scenesched'), /used by \$\{usedBy\.join\(', '\)\}/);
});

test('F23: Devices page keeps one detail wrap (no re-attach per tick), skips redraw under a dragged slider; speaker tags/title patched only on change', () => {
  const d = src('devices'), s = src('spkset');
  assert.match(d, /const pwrap = h\('div', \{ class: 'pd42-wrap pd42-sheet'/);
  assert.match(d, /reconcile\(list, \[T\.treeNode\(false\), sel42 \? pwrap : null\]/);
  assert.doesNotMatch(d, /reconcile\(list, \[sel42 \? h\('div'/);
  assert.match(d, /\.spkset input\[type=range\]:active[^)]*\)\) return later\(\);   \/\/ 0\.4\.4 F23/);
  assert.match(s, /if \(sg === tagSig\) return;/); assert.match(s, /if \(sg === titleSig\) return;/);
});

test('F6: every preset picker = 8 built-ins, then My presets; legacy built-ins never listed; themed highlight', async () => {
  if (typeof Element === 'undefined') (await import('./minidom.mjs')).installDom();
  const { groupPresets } = await import(`${js}/eqsettings.js`);
  const B = ['Flat', 'Bass Boost', 'Treble Boost', 'Vocal', 'Late Night', 'Movie Night', 'Bluetooth Speaker', 'Rock / Metal'];
  const list = [...B.map((n, i) => ({ id: i + 1, name: n, source: 'builtin' })), { id: 23, name: 'Bass boost', source: 'builtin' }, { id: 24, name: 'Bright room (softer treble)', source: 'builtin' }, { id: 30, name: 'iPhone EQ', source: 'user' }];
  const g = groupPresets(list), names = g.flatMap(x => x.items.map(p => p.name));
  assert.deepEqual(names, [...B, 'iPhone EQ']); assert.equal(g.at(-1).label, 'My presets');
  assert.match(src('eq'), /groupPresets\(presets\)\.map\(g => \{[^]*optgroup/); assert.doesNotMatch(src('eq'), /\(built-in\)/);
  assert.match(src('menusub'), /const groups = groupPresets\(presets\)/);
  assert.match(css(), /option:checked\{background:var\(--accent-soft/);
});

test('F20: speaker page EQ uses one Preset dropdown (Custom, 8 built-ins, My presets) with Reset + Save as preset beside it; no chip row', () => {
  const s = src('spkset');
  assert.match(s, /class: 'eqall-preset spk-presel', 'aria-label': 'Preset'/);
  assert.match(s, /h\('label', \{ class: 'dlbl spk-prelbl' \}, 'Preset:'\), presetSel, resetBtn, saveAsBtn\)/);
  assert.match(s, /'Custom'\), \.\.\.groups\.flatMap\(g => g\.label \? \[h\('optgroup'/);
  assert.doesNotMatch(s, /spk-pchip/);
});

test('F19: action tags map + read-only tags stay plain', async () => {
  if (typeof Element === 'undefined') (await import('./minidom.mjs')).installDom();
  const d = src('devices');
  assert.match(d, /export const TAG_ACTIONS = \{ capped: 'Change max volume', nodelay: [^}]*ref: [^}]*offline: [^}]*bt: [^}]*zctl: /);
  assert.doesNotMatch(d.match(/export const TAG_ACTIONS = \{[^}]*\}/)[0], /role:|count:|zplaying:|off:/);
  assert.match(d, /document\.addEventListener\('click', onTagAct, true\)/);
  assert.match(src('zones40'), /class: 'dtag zctl tagact', 'data-tag-act': 'zctl'/);
});

test('F8 side panel: the Queue header strip takes Library drops (collapsed Queue) and adds at the end', () => {
  const l = src('listtable');
  assert.match(l, /head\.addEventListener\('drop'/); assert.match(l, /at: V\.queue\.length/);
  assert.match(l, /const headAccepts = ev => canControl\(S\) && !dragging && !ev\.dataTransfer\?\.types\?\.includes\(QMIME\)/);
  assert.match(css(), /\.listpanel>\.pane-h\.qdrop\{/);
});

test('F24 Rebuild album art: admin button in Settings > Library, new picture URLs pushed to every client', () => {
  const s = src('settings');
  assert.match(s, /id: 'art-rebuild'/); assert.match(s, /api\('\/library\/art\/rebuild', \{ method: 'POST' \}\)/); assert.match(s, /setArtCv\(r\.artCv\)/);
  assert.match(s, /admin \? h\('div', \{ class: 'row', style: 'margin-top:8px;gap:8px' \}[\s\S]*'Rebuild album art'\)\) : null/);
  assert.match(src('art'), /if \(d\.kind === 'rebuild'\) \{ if \(d\.cv\) setArtCv\(d\.cv\); return; \}/);
});

test('F25 per-speaker mute toggle: tree rows (right of the %), speaker page (right of the Volume bar); MUTED tag unmutes', () => {
  const t = src('tree42'), s = src('spkset'), d = src('devices');
  assert.match(t, /`\$\{Math\.round\(z\.volume\)\}%`\),\s*\/\/ 0\.4\.4 F25[^\n]*\n\s*ro\(h\('button', \{ type: 'button', class: 'mutebtn sp42-mute'/);
  assert.match(t, /ctl\.act\(`\/zones\/\$\{z\.id\}`, \{ muted: !z\.muted \}, 'PATCH'\)/);
  assert.match(s, /class: 'mutebtn spk-mute'/); assert.match(s, /line\.append\(vol\._input, muteB\)/); assert.match(s, /vol\._set\(Math\.round\(z\.volume\)\); paintMute\(\);/);
  assert.match(d, /muted: 'Unmute' \};/); assert.match(d, /if \(tag\.dataset\.tagAct === 'muted'\) \{[^\n]*\{ muted: false \}/);
  assert.match(css(), /\.spk-volline\{display:flex/);
});
