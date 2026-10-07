// Particle burst visualizer (0.0.6 default): theme-colored particles drift across the Now Playing banner and burst outward on kicks/snares.
// Calm when quiet; gentle idle animation when nothing is playing. Colors follow --accent / --accent2 and update live.
import { magnitudes, bands, smooth, Beat, rms, Particles } from './vizmath.js';

function cssRgb(varName, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      const n = parseInt(v.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
  } catch { /* ok */ }
  return fallback;
}
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export class ParticleBurst {
  constructor(canvas, { light = false } = {}) {
    this.c = canvas; this.light = light;
    this.vals = new Float64Array(32); this.mags = new Float64Array(512); this.band = new Float64Array(32);
    this.beat = new Beat(); this.snare = new Beat();
    this.parts = new Particles(light ? 40 : 140);
    this.drift = []; this.wave = null; this.last = 0; this.frames = 0; this.t0 = performance.now();
    this.idle = true; this.level = 0; this.accent = [255, 60, 0]; this.accent2 = [25, 195, 177];
    this.refreshTheme();
    this.seedDrift();
  }
  refreshTheme() {
    this.accent = cssRgb('--accent', [255, 60, 0]);
    this.accent2 = cssRgb('--accent2', [25, 195, 177]);
  }
  setLight(l) { this.light = l; this.parts = new Particles(l ? 40 : 140); this.seedDrift(); }
  setWave(u8) { this.wave = u8; this.idle = !u8; }
  seedDrift() {
    const n = this.light ? 18 : 36; this.drift = [];
    for (let i = 0; i < n; i++) {
      this.drift.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.00035, vy: (Math.random() - 0.5) * 0.00025,
        s: 0.6 + Math.random() * 1.8, a: 0.15 + Math.random() * 0.35,
        c: Math.random() < 0.5 ? 0 : 1,
      });
    }
  }
  colors() {
    return [css(this.accent, 1), css(this.accent2, 1), 'rgba(255,255,255,.95)', css(this.accent, 0.85), css(this.accent2, 0.85)];
  }
  draw(now = performance.now()) {
    this.refreshTheme();
    const c = this.c, w = c.width, h = c.height; if (w < 8 || h < 8) return false;
    const g = c.getContext('2d'); const dt = this.last ? Math.min(100, now - this.last) : 33; this.last = now;
    const wave = this.wave; let bass = 0, mid = 0, hit = false, snareHit = false;
    if (wave) {
      magnitudes(wave, this.mags); bands(this.mags, 32, this.band); smooth(this.vals, this.band);
      bass = (this.vals[0] + this.vals[1] + this.vals[2] + this.vals[3]) / 4;
      mid = (this.vals[8] + this.vals[9] + this.vals[10] + this.vals[11]) / 4;
      const b = this.beat.push(bass, dt); const s = this.snare.push(mid, dt);
      hit = b.hit; snareHit = s.hit; this.level = rms(wave); this.idle = this.level < 0.02;
    } else {
      for (let i = 0; i < this.vals.length; i++) this.vals[i] *= 0.92;
      this.beat.push(0, dt); this.snare.push(0, dt); this.level = 0; this.idle = true;
    }
    const cx = w / 2, cy = h / 2, pulse = this.beat.pulse;
    // dark field
    const bg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) / 2);
    bg.addColorStop(0, '#10151c'); bg.addColorStop(1, '#05070b');
    g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0; g.fillStyle = bg; g.fillRect(0, 0, w, h);

    // soft center glow (stronger on beat / idle breathing)
    const breath = this.idle ? 0.35 + 0.25 * Math.sin((now - this.t0) / 1400) : (0.2 + 0.55 * pulse);
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * (0.28 + 0.12 * pulse));
    glow.addColorStop(0, css(this.accent, 0.22 * breath));
    glow.addColorStop(0.45, css(this.accent2, 0.10 * breath));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.fillRect(0, 0, w, h);

    // drifting ambient particles
    const liveliness = this.idle ? 0.35 : (0.45 + Math.min(1, this.level * 4));
    for (const d of this.drift) {
      d.x += d.vx * dt * liveliness; d.y += d.vy * dt * liveliness;
      if (d.x < -0.05) d.x = 1.05; if (d.x > 1.05) d.x = -0.05;
      if (d.y < -0.05) d.y = 1.05; if (d.y > 1.05) d.y = -0.05;
      const col = d.c ? this.accent2 : this.accent;
      g.fillStyle = css(col, d.a * (this.idle ? 0.55 : 0.75 + 0.25 * pulse));
      if (!this.light) { g.shadowBlur = 8; g.shadowColor = css(col, 0.6); }
      g.beginPath(); g.arc(d.x * w, d.y * h, d.s * (h / 180) * (1 + 0.3 * pulse), 0, Math.PI * 2); g.fill();
    }
    g.shadowBlur = 0;

    // bursts on kick / snare
    const cols = this.colors();
    if (hit) this.parts.burst(cx, cy, Math.min(w, h) * 0.05, this.light ? 10 : 22, cols);
    if (snareHit) this.parts.burst(cx, cy, Math.min(w, h) * 0.08, this.light ? 6 : 14, cols);
    // idle: occasional gentle puff from center
    if (this.idle && Math.random() < 0.02) this.parts.burst(cx, cy, Math.min(w, h) * 0.02, 3, cols);

    this.parts.step(dt);
    g.globalCompositeOperation = 'lighter';
    for (const q of this.parts.p) {
      const life = Math.max(0, q.life);
      g.fillStyle = (q.c || css(this.accent, 1)).replace(/[\d.]+\)$/, (life * 0.85).toFixed(2) + ')');
      if (!this.light) { g.shadowBlur = 12; g.shadowColor = g.fillStyle; }
      // soft trail
      g.beginPath(); g.arc(q.x - q.vx * 4, q.y - q.vy * 4, q.s * (h / 280), 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(q.x, q.y, q.s * (h / 200), 0, Math.PI * 2); g.fill();
    }
    g.shadowBlur = 0; g.globalCompositeOperation = 'source-over';

    // faint spectrum sparkles near center when loud
    if (!this.idle && !this.light) {
      for (let i = 0; i < 16; i++) {
        const v = this.vals[i] || 0; if (v < 0.15) continue;
        const a = (i / 16) * Math.PI * 2 + now / 4000;
        const r = Math.min(w, h) * (0.08 + v * 0.18);
        g.fillStyle = css(i % 2 ? this.accent2 : this.accent, 0.35 * v);
        g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.5 + v * 3, 0, Math.PI * 2); g.fill();
      }
    }
    this.frames++; return true;
  }
}
