/**
 * 0.4.3 #10: EQ for a browser / phone / TV speaker. Until 0.4.2 a browser speaker ignored the server's DSP config, so a saved or previewed EQ
 * changed nothing on it. The plan below is the same math as the PC Player's DSP (WavWiz.Dsp DspProgram): ten RBJ peaking bands (Q 1.4),
 * bass / treble shelves (S = 1, i.e. Q 0.707, which is what Web Audio's lowshelf/highshelf use), the loudness shelves, trim + preamp + auto-preamp
 * and balance. Bypass turns the EQ, shelves and loudness off; the trim stays. The PC Player's peak limiter is not here (a Web Audio compressor
 * would add look-ahead delay and break the sync). 0.7.3: auto-preamp only takes back part of a boost (see autoCutDb), so a boosted plan ends
 * in a soft clip guard instead: a WaveShaper (no oversampling = no added delay) that is exactly linear up to -1.9 dBFS and rounds the peaks off
 * smoothly so nothing passes the limiter's default ceiling (-0.3 dBFS).
 * Pure functions first (unit-tested); EqChain wires them into Web Audio only while a non-flat EQ is assigned, so an idle or flat speaker runs no filters.
 */
export const BAND_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const BAND_Q = 1.4, SHELF_Q = 0.707, FS = 48000;
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pick = (o, k) => o == null ? undefined : o[k] ?? o[k[0].toUpperCase() + k.slice(1)];

/** Pure: the preset as the server normalizes it (ranges clamped, missing fields = Flat). Accepts camelCase or PascalCase keys. */
export function normPreset(p) {
  p = p || {};
  const g = pick(p, 'graphicDb') || [], bass = pick(p, 'bass') || {}, treble = pick(p, 'treble') || {}, loud = pick(p, 'loudness') || {};
  return {
    trimDb: clamp(num(pick(p, 'trimDb')), -24, 6), preampDb: clamp(num(pick(p, 'preampDb')), -24, 12), autoPreamp: pick(p, 'autoPreamp') !== false, bypass: !!pick(p, 'bypass'), direct: !!pick(p, 'direct'),
    balance: clamp(num(pick(p, 'balance')), -100, 100), graphicDb: BAND_HZ.map((_, i) => clamp(num(g[i]), -12, 12)),
    bass: { gainDb: clamp(num(pick(bass, 'gainDb')), -12, 12), hz: clamp(num(pick(bass, 'hz'), 100), 40, 400) },
    treble: { gainDb: clamp(num(pick(treble, 'gainDb')), -12, 12), hz: clamp(num(pick(treble, 'hz'), 10000), 3000, 16000) },
    loudness: { enabled: !!pick(loud, 'enabled'), refVolume: clamp(num(pick(loud, 'refVolume'), 80), 10, 100) },
  };
}

/** Pure: RBJ cookbook coefficients {b0,b1,b2,a1,a2} (a0 = 1), same as BiquadCoeffs.cs. Gain 0 = identity. */
export function coeffs(type, hz, gainDb, q, fs = FS) {
  if (Math.abs(gainDb) < 1e-4) return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  hz = clamp(hz, 10, 0.45 * fs); q = Math.max(q, 0.05);
  const w = 2 * Math.PI * hz / fs, c = Math.cos(w), s = Math.sin(w), A = Math.pow(10, gainDb / 40), al = s / (2 * q);
  if (type === 'peaking') { const a0 = 1 + al / A; return { b0: (1 + al * A) / a0, b1: -2 * c / a0, b2: (1 - al * A) / a0, a1: -2 * c / a0, a2: (1 - al / A) / a0 }; }
  const sq = 2 * Math.sqrt(A) * al;
  if (type === 'lowshelf') { const a0 = (A + 1) + (A - 1) * c + sq; return { b0: A * ((A + 1) - (A - 1) * c + sq) / a0, b1: 2 * A * ((A - 1) - (A + 1) * c) / a0, b2: A * ((A + 1) - (A - 1) * c - sq) / a0, a1: -2 * ((A - 1) + (A + 1) * c) / a0, a2: ((A + 1) + (A - 1) * c - sq) / a0 }; }
  const a0 = (A + 1) - (A - 1) * c + sq;
  return { b0: A * ((A + 1) + (A - 1) * c + sq) / a0, b1: -2 * A * ((A - 1) + (A + 1) * c) / a0, b2: A * ((A + 1) + (A - 1) * c - sq) / a0, a1: 2 * ((A - 1) - (A + 1) * c) / a0, a2: ((A + 1) - (A - 1) * c - sq) / a0 };
}
/** Pure: magnitude (dB) of one biquad at hz. */
export function magDb(k, hz, fs = FS) {
  const w = 2 * Math.PI * hz / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = k.b0 + k.b1 * c1 + k.b2 * c2, ni = -(k.b1 * s1 + k.b2 * s2), dr = 1 + k.a1 * c1 + k.a2 * c2, di = -(k.a1 * s1 + k.a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}
/** Pure: loudness shelf gains at a volume (0 dB at/above the reference, up to +10 dB bass / +3 dB treble at 0), like DspProgram.LoudnessGains. */
export function loudnessGains(volumePercent, refVolume) { const k = clamp((refVolume - volumePercent) / Math.max(refVolume, 1), 0, 1); return [10 * k, 3 * k]; }

/** Pure: the Web Audio plan for a DSP config ({preset, bypass} from the server; preset null = no EQ assigned) at a volume.
 * Returns null when there is nothing to do (no preset, or everything flat) so no filters run. */
export function eqPlan(cfg, volumePercent = 100) {
  if (!cfg || !cfg.preset) return null;
  const p = normPreset(cfg.preset), eq = !(p.bypass || cfg.bypass);
  if (p.direct) return null;   // 0.7.3 Direct (no processing): no filters, no trim / pre-gain, no balance, no clip guard - the music goes straight to the volume
  const filters = [];
  if (eq) {
    BAND_HZ.forEach((hz, i) => filters.push({ type: 'peaking', hz, gainDb: p.graphicDb[i], q: BAND_Q }));
    filters.push({ type: 'lowshelf', hz: p.bass.hz, gainDb: p.bass.gainDb, q: SHELF_Q }, { type: 'highshelf', hz: p.treble.hz, gainDb: p.treble.gainDb, q: SHELF_Q });
    const [lb, lt] = p.loudness.enabled ? loudnessGains(volumePercent, p.loudness.refVolume) : [0, 0];
    filters.push({ type: 'lowshelf', hz: 100, gainDb: lb, q: SHELF_Q }, { type: 'highshelf', hz: 10000, gainDb: lt, q: SHELF_Q });
  }
  const live = filters.filter(f => Math.abs(f.gainDb) >= 1e-4);
  let auto = 0;
  if (eq && p.autoPreamp) auto = -autoCutDb(userPeakDb(filters.slice(0, 12)));   // 0.7.3: EQ + Bass/Treble only (not the loudness shelves)
  const preGainDb = p.trimDb + (eq ? p.preampDb : 0) + auto, b = p.balance / 100;
  const left = b > 0 ? 1 - b : 1, right = b < 0 ? 1 + b : 1;
  if (!live.length && Math.abs(preGainDb) < 1e-4 && left === 1 && right === 1) return null;
  // 0.7.3: the soft clip guard runs whenever something can push the level up (a boost or a positive pre-gain)
  const guard = live.some(f => f.gainDb > 0) || preGainDb > 1e-4;
  return { filters: live, preGainDb, preGain: Math.pow(10, preGainDb / 20), left, right, guard };
}
/** 0.7.3: the range Auto pre-gain looks at (Hz) and the most it ever turns down (dB) - the same as DspProgram.cs. */
export const AUTO_LO_HZ = 40, AUTO_HI_HZ = 12000, AUTO_MAX_CUT_DB = 6;
/** Pure: Auto pre-gain cut (dB, positive = turn down) for a peak boost: half of it, never more than 6 dB (DspProgram.AutoCutDb). */
export const autoCutDb = peakDb => (isFinite(peakDb) ? Math.min(AUTO_MAX_CUT_DB, 0.5 * Math.max(0, peakDb)) : 0);
/** Pure: highest summed boost (dB, >= 0) of some filters between 40 Hz and 12 kHz (DspProgram.UserPeakDb). */
export function userPeakDb(filters) {
  const ks = filters.filter(f => Math.abs(f.gainDb) >= 1e-4).map(f => coeffs(f.type, f.hz, f.gainDb, f.q));
  if (!ks.length) return 0;
  let max = 0;
  for (let f = AUTO_LO_HZ; ; f *= 1.06) { const hz = Math.min(f, AUTO_HI_HZ); max = Math.max(max, ks.reduce((a, k) => a + magDb(k, hz), 0)); if (hz >= AUTO_HI_HZ) break; }
  return max;
}

/** 0.7.3 soft clip guard: exactly linear up to KNEE, then a smooth (tanh) bend that never passes CEIL. Input range of the curve is +-CLIP_RANGE
 * (a pre-scale of 1/CLIP_RANGE goes in front, since a WaveShaper clamps its input to -1..1); louder input sits at the ceiling. */
export const CLIP_KNEE = Math.pow(10, -1.9 / 20), CLIP_CEIL = Math.pow(10, -0.3 / 20), CLIP_RANGE = 4;
/** Pure: the guard's transfer function for one sample. */
export function softClip(x) {
  const a = Math.abs(x); if (!(a > CLIP_KNEE)) return isFinite(x) ? x : 0;
  const room = CLIP_CEIL - CLIP_KNEE, y = CLIP_KNEE + room * Math.tanh((Math.min(a, CLIP_RANGE) - CLIP_KNEE) / room);
  return x < 0 ? -y : y;
}
/** Pure: the WaveShaper curve (odd length so 0 maps to exactly 0) over -CLIP_RANGE..+CLIP_RANGE. */
export function softClipCurve(n = 8193) { const c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = softClip(CLIP_RANGE * (2 * i / (n - 1) - 1)); return c; }

/** Pure: the plan's total response (dB) at hz, pre-gain included (for tests: what a sine through the chain would show). */
export const planResponseDb = (plan, hz) => !plan ? 0 : plan.preGainDb + plan.filters.reduce((a, f) => a + magDb(coeffs(f.type, f.hz, f.gainDb, f.q), hz), 0);

/** Web Audio side: input -> [pre-gain -> biquads -> balance] -> output. With no plan the input goes straight to the output (no filters at all). */
export class EqChain {
  // the input is always stereo (a mono source is up-mixed), so balance has two sides
  constructor(ctx, output) { this.ctx = ctx; this.output = output; this.input = ctx.createGain(); try { this.input.channelCount = 2; this.input.channelCountMode = 'explicit'; this.input.channelInterpretation = 'speakers'; } catch { /* old browser */ } this.nodes = []; this.plan = null; this.input.connect(output); }
  set(plan) {
    const ctx = this.ctx; this.plan = plan;
    try { this.input.disconnect(); } catch { /* ok */ }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* ok */ } }
    this.nodes = [];
    if (!plan) { this.input.gain.value = 1; this.input.connect(this.output); return; }
    this.input.gain.value = plan.preGain;
    let at = this.input;
    for (const f of plan.filters) { const n = ctx.createBiquadFilter(); n.type = f.type; n.frequency.value = f.hz; n.gain.value = f.gainDb; if (f.type === 'peaking') n.Q.value = f.q; at.connect(n); at = n; this.nodes.push(n); }
    if (plan.left !== 1 || plan.right !== 1) {
      const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), gl = ctx.createGain(), gr = ctx.createGain(); gl.gain.value = plan.left; gr.gain.value = plan.right;
      at.connect(sp); sp.connect(gl, 0); sp.connect(gr, 1); gl.connect(mg, 0, 0); gr.connect(mg, 0, 1); this.nodes.push(sp, gl, gr, mg); at = mg;
    }
    if (plan.guard) {   // 0.7.3 soft clip guard: scale into the curve's -1..1 input, shape, no oversampling (no added delay)
      try {
        const pre = ctx.createGain(), ws = ctx.createWaveShaper(); pre.gain.value = 1 / CLIP_RANGE; ws.curve = this._curve ||= softClipCurve(); ws.oversample = 'none';
        at.connect(pre); pre.connect(ws); this.nodes.push(pre, ws); at = ws;
      } catch { /* old browser: no guard */ }
    }
    at.connect(this.output);
  }
  disconnect() { try { this.input.disconnect(); } catch { /* ok */ } for (const n of this.nodes) { try { n.disconnect(); } catch { /* ok */ } } this.nodes = []; }
}
