// Pure maths for the WavWiz ring visualizer (no DOM, unit-tested with node): FFT of the 1024-sample waveform that /ws/viz delivers, log-spaced bands,
// smoothing, beat detection, ring geometry. Keeping it DOM-free also keeps the drawing code small and testable.
export const N = 1024;

/** In-place radix-2 FFT. re/im are Float64Array/Float32Array of power-of-two length. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

const HANN = new Float64Array(N); for (let i = 0; i < N; i++) HANN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));

/** Waveform bytes (128 = silence) -> magnitude per FFT bin, 0..~1 (512 bins). */
export function magnitudes(wave, out = new Float64Array(N / 2)) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = ((wave[i] ?? 128) - 128) / 128 * HANN[i];
  fft(re, im);
  for (let k = 0; k < N / 2; k++) out[k] = Math.hypot(re[k], im[k]) / (N / 4);
  return out;
}

/** Log-spaced band edges (bin indices) from ~40 Hz to ~16 kHz at 48 kHz sampling (bin = 46.9 Hz). */
export function bandEdges(bars, sampleRate = 48000) {
  const binHz = sampleRate / N, lo = Math.max(1, Math.round(40 / binHz)), hi = Math.min(N / 2, Math.round(16000 / binHz)), e = [];
  for (let b = 0; b <= bars; b++) e.push(Math.max(lo + b, Math.round(lo * Math.pow(hi / lo, b / bars))));
  for (let b = 1; b <= bars; b++) if (e[b] <= e[b - 1]) e[b] = e[b - 1] + 1;       // strictly increasing: every bar owns at least one bin
  return e;
}

/** Magnitudes -> `bars` values 0..1 (dB scale, floor -62 dB); a gentle tilt lifts the highs which carry less energy.
 * 0.0.8: `gainDb` (auto-gain + sensitivity) shifts the scale so quiet and loud tracks both fill the range; silence stays exactly 0. */
const EDGES = new Map();
export function bands(mags, bars, out = new Float64Array(bars), gainDb = 0, floorDb = 62) {
  let e = EDGES.get(bars); if (!e) { e = bandEdges(bars); EDGES.set(bars, e); }
  for (let b = 0; b < bars; b++) {
    let m = 0; for (let k = e[b]; k < Math.min(e[b + 1], mags.length); k++) m = Math.max(m, mags[k]);
    if (m < 1e-5) { out[b] = 0; continue; }
    const db = 20 * Math.log10(m + 1e-6) + 3 * (b / bars) * 6 + gainDb;
    out[b] = Math.min(1, Math.max(0, (db + floorDb) / floorDb));
  }
  return out;
}

/** Fast attack, slow decay so bars bounce instead of flicker. */
export function smooth(prev, next, attack = 0.65, decay = 0.18) { for (let i = 0; i < next.length; i++) { const p = prev[i] ?? 0, n = next[i]; prev[i] = n > p ? p + (n - p) * attack : p + (n - p) * decay; } return prev; }

/** Beat detector: bass energy against its running average. Returns the pulse 0..1 (decays by itself). */
export class Beat {
  constructor() { this.avg = 0.02; this.pulse = 0; this.cool = 0; }
  push(bass, dtMs = 33) {
    this.cool = Math.max(0, this.cool - dtMs);
    const hit = bass > this.avg * 1.45 && bass > 0.12 && this.cool === 0;
    if (hit) { this.pulse = 1; this.cool = 180; }
    this.avg += (bass - this.avg) * Math.min(1, dtMs / 900);
    this.pulse = Math.max(0, this.pulse - dtMs / 380);
    return { hit, pulse: this.pulse };
  }
}

/** RMS of the waveform, 0..1. */
export function rms(wave) { let s = 0; for (let i = 0; i < N; i++) { const v = ((wave[i] ?? 128) - 128) / 128; s += v * v; } return Math.sqrt(s / N); }

/**
 * Ring geometry. The ring is open at the bottom by `gapDeg`; bar i of n sits at angle a(i) measured clockwise from 12 o'clock-bottom... we use screen angles
 * (0 = right, increasing clockwise) so index 0 starts at the bottom-left, goes up the left side (orange), over the top, down the right side (teal).
 * Returns {a, side: 'L'|'R'}.
 */
export function barAngle(i, n, gapDeg = 56) {
  const span = (360 - gapDeg) * Math.PI / 180, start = (90 + gapDeg / 2) * Math.PI / 180;     // 90deg = straight down on screen; start just left of the bottom
  const a = start + span * (i + 0.5) / n, x = Math.cos(a);
  return { a, side: x < 0 ? 'L' : 'R' };
}

/** Layout of the ring in a banner of w x h: center, inner radius and the longest bar. Never lets bars leave the canvas. */
export function ringLayout(w, h, pulse = 0) {
  const m = Math.min(w, h), cx = w / 2, cy = h / 2, maxBar = m * 0.2, r0 = Math.max(8, m * 0.5 - maxBar - 4 - m * 0.03 * pulse);
  return { cx, cy, r0, maxBar: Math.max(4, m * 0.5 - r0 - 3) };
}

/** Small deterministic particle pool, pure so it can be tested. */
export class Particles {
  constructor(max = 70, rnd = Math.random) { this.max = max; this.p = []; this.rnd = rnd; }
  burst(cx, cy, r, count, colors, speed = 1) {
    for (let i = 0; i < count && this.p.length < this.max; i++) {
      const a = this.rnd() * Math.PI * 2, sp = (0.55 + this.rnd() * 2.2) * speed;
      this.p.push({ x: cx + Math.cos(a) * r * this.rnd(), y: cy + Math.sin(a) * r * this.rnd(), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, c: colors[(this.rnd() * colors.length) | 0], s: 1.2 + this.rnd() * 2.4 });
    }
  }
  step(dtMs) { const k = dtMs / 16.7; for (const q of this.p) { q.x += q.vx * k; q.y += q.vy * k; q.vx *= 0.985; q.vy *= 0.985; q.life -= 0.014 * k; } this.p = this.p.filter(q => q.life > 0); }
}
