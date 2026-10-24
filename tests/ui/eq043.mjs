// WavWiz 0.4.3 #10: a browser / phone / TV speaker's EQ really changes the sound. Renders tones through roomeq.js EqChain (the chain room.js
// puts between the music and the volume) in the browser's own Web Audio (OfflineAudioContext) and measures the level.
// Usage: WW_SESS=/tmp/ww032/sess node eq043.mjs [chromium|webkit|firefox]   (server on 172.30.0.2:47800)
import * as pw from 'playwright';
const B = 'http://172.30.0.2:47800', kind = process.argv[2] || 'chromium';
let pass = 0, fail = 0;
const ok = (n, c, i = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (i !== '' ? ' :: ' + String(i).slice(0, 300) : '')); };
const br = await pw[kind].launch(); const p = await (await br.newContext()).newPage();
await p.goto(B + '/js/roomeq.js');      // same origin, no app UI needed
const r = await p.evaluate(async () => {
  const { EqChain, eqPlan } = await import('/js/roomeq.js');
  async function level(hz, cfg, vol = 100) {
    const ctx = new OfflineAudioContext(2, 48000, 48000), o = ctx.createOscillator(); o.frequency.value = hz;
    const ch = new EqChain(ctx, ctx.destination); ch.set(eqPlan(cfg, vol)); o.connect(ch.input); o.start();
    const buf = await ctx.startRendering(), db = c => { const d = buf.getChannelData(c); let s = 0; for (let i = 24000; i < d.length; i++) s += d[i] * d[i]; return 10 * Math.log10(s / (d.length - 24000)); };
    return [db(0), db(1)];
  }
  const cut = { preset: { graphicDb: [0, 0, 0, 0, 0, -12, 0, 0, 0, 0] } };
  return {
    flat1k: await level(1000, null), cut1k: await level(1000, cut), cut100: await level(100, cut), flat100: await level(100, null),
    bypass1k: await level(1000, { ...cut, bypass: true }), preview4k: await level(4000, { preset: { graphicDb: [0, 0, 0, 0, 0, 0, 0, 6, 0, 0], autoPreamp: false }, preview: true }),
    flat4k: await level(4000, null), bal: await level(1000, { preset: { balance: 100 } }), trim: await level(1000, { preset: { trimDb: -6 } }),
  };
});
const d = (a, b) => a[0] - b[0];
ok('a -12 dB 1 kHz band lowers a 1 kHz tone by ~12 dB', Math.abs(d(r.cut1k, r.flat1k) + 12) < 0.5, d(r.cut1k, r.flat1k).toFixed(2));
ok('...and leaves a 100 Hz tone alone', Math.abs(d(r.cut100, r.flat100)) < 0.5, d(r.cut100, r.flat100).toFixed(2));
ok('bypass plays it flat', Math.abs(d(r.bypass1k, r.flat1k)) < 0.1, d(r.bypass1k, r.flat1k).toFixed(2));
ok('a +6 dB 4 kHz preview raises 4 kHz by ~6 dB', Math.abs(d(r.preview4k, r.flat4k) - 6) < 0.5, d(r.preview4k, r.flat4k).toFixed(2));
ok('balance full right silences the left channel', r.bal[0] < -80 && Math.abs(r.bal[1] - r.flat1k[1]) < 0.1, r.bal.map(x => x.toFixed(1)).join('/'));
ok('trim -6 dB lowers everything by 6 dB', Math.abs(d(r.trim, r.flat1k) + 6) < 0.1, d(r.trim, r.flat1k).toFixed(2));
await br.close(); console.log(`eq043 ${kind}: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
