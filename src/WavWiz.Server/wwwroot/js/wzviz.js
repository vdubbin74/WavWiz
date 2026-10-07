// The "WavWiz" visualizer: a ring spectrum (radial bars) with a waveform ring inside, orange on the left half, teal on the right, glow, particles and a beat pulse
// on a dark navy background, centered in whatever box it is given. Plain 2D canvas (works everywhere, also the big-TV PC and phones in light mode); fed with the
// 1024-sample waveform from /ws/viz. Light mode = fewer bars, no glow, no particles, lower frame rate.
import { fft as _f, magnitudes, bands, smooth, Beat, rms, barAngle, ringLayout, Particles } from './vizmath.js';
void _f;
const ORANGE = [255, 60, 0], TEAL = [25, 195, 177];
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class WavWizRing {
  constructor(canvas, { light = false } = {}) {
    this.c = canvas; this.light = light; this.bars = light ? 48 : 96; this.vals = new Float64Array(this.bars); this.mags = new Float64Array(512); this.band = new Float64Array(this.bars);
    this.beat = new Beat(); this.parts = new Particles(light ? 0 : 70); this.wave = null; this.last = 0; this.frames = 0; this.t0 = performance.now(); this.rot = 0; this.level = 0;
  }
  setLight(l) { this.light = l; this.bars = l ? 48 : 96; this.vals = new Float64Array(this.bars); this.band = new Float64Array(this.bars); this.parts = new Particles(l ? 0 : 70); }
  setWave(u8) { this.wave = u8; }
  /** Draw one frame. Returns true when something was drawn. */
  draw(now = performance.now()) {
    const c = this.c, w = c.width, h = c.height; if (w < 8 || h < 8) return false;
    const g = c.getContext('2d'); const dt = this.last ? Math.min(100, now - this.last) : 33; this.last = now;
    const wave = this.wave;
    if (wave) {
      magnitudes(wave, this.mags); bands(this.mags, this.bars, this.band); smooth(this.vals, this.band);
      const bass = (this.vals[0] + this.vals[1] + this.vals[2] + this.vals[3] + this.vals[4]) / 5; const b = this.beat.push(bass, dt); this.level = rms(wave);
      this.hit = b.hit;
    } else { for (let i = 0; i < this.vals.length; i++) this.vals[i] *= 0.9; this.beat.push(0, dt); this.hit = false; }
    const pulse = this.beat.pulse, L = ringLayout(w, h, pulse), { cx, cy, r0, maxBar } = L;
    // background: dark navy with a soft vignette; a faint center-line waveform across the whole banner uses the width of a wide banner
    const bg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) / 2); bg.addColorStop(0, '#0d1526'); bg.addColorStop(1, '#050811');
    g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0; g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (wave) {
      g.beginPath(); for (let i = 0; i < 1024; i += 4) { const x = i / 1023 * w, y = cy + ((wave[i] - 128) / 128) * h * 0.22; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      const lg = g.createLinearGradient(0, 0, w, 0); lg.addColorStop(0, css(ORANGE, 0.28)); lg.addColorStop(0.5, 'rgba(255,255,255,0.06)'); lg.addColorStop(1, css(TEAL, 0.28));
      g.strokeStyle = lg; g.lineWidth = Math.max(1, h / 160); g.stroke();
    }
    // radial bars
    const n = this.bars, lw = Math.max(1.5, (2 * Math.PI * r0 * 0.78) / n * 0.62);
    g.lineCap = 'round'; g.lineWidth = lw;
    if (!this.light) { g.shadowBlur = Math.max(4, h * 0.035) * (1 + pulse); }
    for (let i = 0; i < n; i++) {
      const { a, side } = barAngle(i, n), v = this.vals[i], len = Math.max(lw * 0.6, v * maxBar), ca = Math.cos(a), sa = Math.sin(a);
      const base = side === 'L' ? ORANGE : TEAL, col = mixc(base, [255, 255, 255], Math.min(0.5, v * 0.45));
      g.strokeStyle = css(col, 0.55 + 0.45 * v); g.shadowColor = css(base, 0.9);
      g.beginPath(); g.moveTo(cx + ca * r0, cy + sa * r0); g.lineTo(cx + ca * (r0 + len), cy + sa * (r0 + len)); g.stroke();
    }
    g.shadowBlur = 0;
    // waveform ring (inside the bars), gradient orange -> teal
    if (wave) {
      const rw = r0 * 0.84, amp = r0 * (0.10 + 0.07 * pulse);
      g.beginPath();
      const step = this.light ? 8 : 4;
      for (let i = 0; i <= 1024; i += step) { const k = i % 1024, ang = i / 1024 * Math.PI * 2 + Math.PI / 2, r = rw + ((wave[k] - 128) / 128) * amp; const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.closePath();
      const rg = g.createLinearGradient(cx - rw, cy, cx + rw, cy); rg.addColorStop(0, css(ORANGE)); rg.addColorStop(0.49, css(mixc(ORANGE, [255, 255, 255], .3))); rg.addColorStop(0.51, css(mixc(TEAL, [255, 255, 255], .3))); rg.addColorStop(1, css(TEAL));
      g.strokeStyle = rg; g.lineWidth = Math.max(1.5, h / 110); if (!this.light) { g.shadowBlur = 10; g.shadowColor = 'rgba(255,255,255,.35)'; } g.stroke(); g.shadowBlur = 0;
    }
    // inner glow on the beat
    if (!this.light && pulse > 0.02) { const gg = g.createRadialGradient(cx, cy, r0 * 0.2, cx, cy, r0 * 1.0); gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(1, css(mixc(ORANGE, TEAL, 0.5), 0.10 * pulse)); g.fillStyle = gg; g.beginPath(); g.arc(cx, cy, r0 * 1.0, 0, Math.PI * 2); g.fill(); }
    // particles
    if (!this.light) {
      if (this.hit) this.parts.burst(cx, cy, r0 + maxBar * 0.5, 10, [css(ORANGE, 1), css(TEAL, 1), 'rgba(255,255,255,.9)']);
      this.parts.step(dt);
      for (const q of this.parts.p) { g.fillStyle = q.c.replace(/[\d.]+\)$/, (q.life * 0.8).toFixed(2) + ')'); g.beginPath(); g.arc(q.x, q.y, q.s * (h / 220), 0, Math.PI * 2); g.fill(); }
    }
    this.frames++; return true;
  }
}
