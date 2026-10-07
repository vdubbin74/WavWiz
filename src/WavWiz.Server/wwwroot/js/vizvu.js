// VU meters (original code): two analog meters with real needle ballistics (a damped mass-spring needle: rises in about 300 ms, overshoots and
// settles, bounces off the end pegs), peak LEDs with hold, and an LED level bar. Fed by the server's stereo rms/peak (dBFS) when available, otherwise
// by the mono waveform. Styles: Classic (warm backlight), Dark studio, Neon.
// 0.1.3: drawn on the GPU (VuGLScene: the static face is painted once into a texture; needles, glow, LEDs, the level bar and a subtle glass
// reflection are WebGL every frame, with bloom from the post pass). ONE needle per meter (the red peak needle is gone), with more bounce (lower
// damping by default, a kick impulse, livelier pegs); the level bar has more dynamic range (deeper lows, bigger hits). The Canvas 2D VuScene stays
// as the fallback for devices without WebGL.
import { palette, QUALITY } from './vizcore.js';

/** Needle mechanics. target/position are 0..1 of the scale (0 = left peg, 1 = +3 VU). speed scales the natural frequency, damping is zeta
 * (0.2 = lots of overshoot, 1 = critically damped, 1.5 = sluggish). Pure; unit-tested. */
export class Needle {
  constructor() { this.x = 0; this.v = 0; }
  step(target, dtMs, speed = 1, damping = 0.6, rest = 0.35) {
    const w = 2 * Math.PI * 2.1 * speed, z = damping, T = Math.min(0.1, Math.max(0, dtMs / 1000)), n = Math.max(1, Math.ceil(T / 0.004)), dt = T / n;
    for (let i = 0; i < n; i++) {
      const a = w * w * (target - this.x) - 2 * z * w * this.v; this.v += a * dt; this.x += this.v * dt;
      if (this.x < -0.035) { this.x = -0.035; this.v = -this.v * Math.min(0.6, rest * 0.85); }          // left peg
      if (this.x > 1.12) { this.x = 1.12; this.v = -this.v * rest; }             // right peg: the needle slams and bounces back
    }
    return this.x;
  }
}
/** VU value -> scale position 0..1 along the printed arc (-20 at the left end, 0 VU at about two thirds, +3 at the right end; the classic
 * meter-face spacing). Below -20 the needle drops onto the rest peg; above +3 it keeps going into the right peg. Monotonic; unit-tested. */
const VU_MAP = [[-20, 0], [-10, 0.143], [-7, 0.268], [-5, 0.361], [-3, 0.464], [-1, 0.568], [0, 0.664], [1, 0.775], [2, 0.886], [3, 1]];
export const vuPos = vu => {
  if (!(vu > -20)) return Number.isFinite(vu) ? Math.max(-0.035, (vu + 20) * 0.006) : -0.035;
  if (vu >= 3) return 1 + (vu - 3) * 0.11;
  for (let i = 1; i < VU_MAP.length; i++) { const [v1, p1] = VU_MAP[i]; if (vu <= v1) { const [v0, p0] = VU_MAP[i - 1]; return p0 + (p1 - p0) * (vu - v0) / (v1 - v0); } }
  return 1;
};
/** Needle angle (radians from vertical) for a scale position; the pivot sits below the face, hidden by the cap. */
export const vuAngle = p => -0.72 + Math.min(1.12, Math.max(-0.035, p)) * 1.44;
const PIV = 1.45, RAD = 1.15, CREST = 8;   // typical music peak-to-rms difference in dB
export const SCALE = [-20, -10, -7, -5, -3, -1, 0, 1, 2, 3];

const STYLES = {
  classic: { bezel: ['#7a7e85', '#3a3d42', '#1c1d20'], face: ['#fbe3b4', '#f1c27d', '#9b6532'], ink: '#2b1d10', red: '#c62f22', needle: '#151515', pk: '#d8261c', cap: '#1a1a1a', glass: 0.14, vu: '#2b1d10' },
  dark: { bezel: ['#4a4e55', '#24272c', '#121316'], face: ['#2a2f37', '#1b1f25', '#0e1014'], ink: '#d7dce4', red: '#ff5a4d', needle: '#f2f4f7', pk: '#ff4040', cap: '#05070a', glass: 0.07, vu: '#9aa3b2' },
};

export class VuScene {
  constructor(opts) { this.kind = '2d'; this.preview = !!opts.preview; this.n = [new Needle(), new Needle()]; this.pk = [0, 0]; this.led = [0, 0]; this.ledHold = [0, 0]; this.bar = 0; this.barPeak = 0; this.barHold = 0; this.ref = -18; this.t = 0; this.face = null; this.configure(opts); }
  configure({ settings, theme }) { if (settings) this.settings = settings; if (theme) this.theme = theme; this.fx = this.settings?.fx || {}; this.pal = palette(this.settings || {}, this.theme || {}); this.face = null; }
  style() {
    const k = this.fx.style || 'classic'; if (k !== 'neon') return STYLES[k] || STYLES.classic;
    const c = (v, a = 1) => `rgba(${Math.round(v[0] * 255)},${Math.round(v[1] * 255)},${Math.round(v[2] * 255)},${a})`, P = this.pal;
    return { bezel: ['#2a2f3a', '#151922', '#0a0c11'], face: ['#141a26', '#0c1019', '#06080d'], ink: c(P.s), red: c(P.p), needle: c(P.a), pk: c(P.p), cap: '#05070a', glass: 0.05, vu: c(P.s, 0.8), neon: true };
  }
  layout(w, h) {
    const ledH = Math.max(8, h * 0.09), gap = Math.max(8, w * 0.025), mh = h * 0.74, mw = Math.min(mh * 1.9, (w - gap * 3) / 2), fh = Math.min(mh, mw / 1.9);
    const total = mw * 2 + gap, x0 = (w - total) / 2, y0 = Math.max(4, (h - fh - ledH - h * 0.07) / 2);
    return { meters: [[x0, y0, mw, fh], [x0 + mw + gap, y0, mw, fh]], bar: [x0 + mw * 0.12, y0 + fh + h * 0.06, total - mw * 0.24, ledH] };
  }
  drawFace(w, h, L) { return faceCanvas(this.style(), w, h, L); }
  draw2d(ctx, w, h, dt, f) {
    const S = this.style(); this.t += dt;
    const L = layout(w, h), key = `${w}x${h}:${this.fx.style}:${this.pal.p}:${this.pal.s}`;
    if (!this.face || this.faceKey !== key) { this.face = this.drawFace(w, h, L); this.faceKey = key; }
    ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, w, h); ctx.drawImage(this.face, 0, 0);
    const m = meterStep(this, dt, f);
    L.meters.forEach(([mx, my, mw, mh], i) => {
      const b = mh * 0.09, fxx = mx + b, fy = my + b, fw = mw - 2 * b, fh = mh - 2 * b, px = fxx + fw / 2, py = fy + fh * PIV, R = fh * RAD, pos = m.pos[i];
      ctx.save(); rr(ctx, fxx, fy, fw, fh, mh * 0.04); ctx.clip();
      const needle = (p, col, wd) => { const a = vuAngle(p); ctx.beginPath(); ctx.moveTo(px + Math.sin(a) * fh * 0.4, py - Math.cos(a) * fh * 0.4); ctx.lineTo(px + Math.sin(a) * R * 1.04, py - Math.cos(a) * R * 1.04); ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.lineCap = 'round'; if (S.neon) { ctx.shadowColor = col; ctx.shadowBlur = fh * 0.06; } ctx.stroke(); ctx.shadowBlur = 0; };
      ctx.save(); ctx.translate(fh * 0.02, fh * 0.03); ctx.globalAlpha = 0.25; needle(pos, '#000', Math.max(1, fh * 0.022)); ctx.restore();
      needle(pos, S.needle, Math.max(1.2, fh * 0.022));
      ctx.beginPath(); ctx.arc(px, fy + fh * 1.02, fh * 0.17, Math.PI, 0); ctx.fillStyle = S.cap; ctx.fill();
      const lx = fxx + fw * 0.87, ly = fy + fh * 0.68, lr2 = Math.max(2, fh * 0.035), red = this.led[i] > 0.05;
      ctx.beginPath(); ctx.arc(lx, ly, lr2, 0, Math.PI * 2); ctx.fillStyle = red ? `rgba(255,60,40,${0.4 + 0.6 * this.led[i]})` : m.audible ? '#29d39a' : '#1d3a30';
      if (red || m.audible) { ctx.shadowColor = red ? '#ff3c28' : '#29d39a'; ctx.shadowBlur = lr2 * 4; } ctx.fill(); ctx.shadowBlur = 0;
      ctx.restore();
    });
    const [bx, by, bw, bh] = L.bar, segs = this.preview ? 24 : 40, gap = bw / segs * 0.22, sw = bw / segs - gap;
    for (let i = 0; i < segs; i++) {
      const on = (i + 0.5) / segs <= this.bar, pk = Math.abs((i + 0.5) / segs - this.barPeak) < 0.5 / segs && this.barPeak > 0.03, x = bx + i * (sw + gap), c = css(barColor(this, i / (segs - 1)));
      ctx.fillStyle = on || pk ? c : 'rgba(255,255,255,0.05)'; if (on || pk) { ctx.shadowColor = c; ctx.shadowBlur = bh * 0.8; } ctx.fillRect(x, by, sw, bh); ctx.shadowBlur = 0;
      if (!on && !pk) { ctx.fillStyle = c; ctx.globalAlpha = 0.09; ctx.fillRect(x, by, sw, bh); ctx.globalAlpha = 1; }
    }
    return true;
  }
}

const css = v => `rgb(${Math.round(Math.min(1, v[0]) * 255)},${Math.round(Math.min(1, v[1]) * 255)},${Math.round(Math.min(1, v[2]) * 255)})`;
const hex = s => { const n = parseInt(s.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
function layout(w, h) {
  const ledH = Math.max(8, h * 0.09), gap = Math.max(8, w * 0.025), mh = h * 0.74, mw = Math.min(mh * 1.9, (w - gap * 3) / 2), fh = Math.min(mh, mw / 1.9);
  const total = mw * 2 + gap, x0 = (w - total) / 2, y0 = Math.max(4, (h - fh - ledH - h * 0.07) / 2);
  return { meters: [[x0, y0, mw, fh], [x0 + mw + gap, y0, mw, fh]], bar: [x0 + mw * 0.12, y0 + fh + h * 0.06, total - mw * 0.24, ledH] };
}
/** Level-bar color at u (0..1) for the meter style. */
function barColor(sc, u) {
  const st = sc.fx.style || 'classic', P = sc.pal;
  if (st === 'neon') return u < 0.6 ? P.p : u < 0.92 ? P.s : hex('#ff3b30');
  if (st === 'dark') return hex(u < 0.6 ? '#3ddc84' : u < 0.85 ? '#ffd23f' : '#ff3b30');
  return hex(u < 0.6 ? '#ffa63d' : u < 0.93 ? '#33d6a6' : '#ff4433');
}
/** 0.1.3 meter ballistics shared by the GPU and 2D meters: one bouncy needle per meter (kick impulse, lively pegs), peak LEDs, and a level bar
 * with more dynamic range: a wider dB window and an expansion curve (deeper lows), a transient boost on kicks (bigger hits), quick release. */
export function meterStep(sc, dt, f) {
  const fx = sc.fx, speed = fx.needle ?? 1, zeta = fx.bounce ?? fx.damping ?? 0.42, hold = (fx.peakHold ?? 1) * 1000, barK = fx.bar ?? 1, sens = 20 * Math.log10(Math.max(0.25, f.sensitivity || 1));
  const bounce = Math.min(1, Math.max(0, (1.3 - zeta) / 1.14)), rest = 0.3 + 0.3 * bounce;
  const lr = f.lr || { rmsL: -80, rmsR: -80, pkL: -80, pkR: -80 }, audible = !f.idle && lr.rmsL > -70;
  if (f.autoGain && audible) sc.ref += (Math.max(lr.rmsL, lr.rmsR) + 3 - sc.ref) * Math.min(1, dt / 5000); else if (!f.autoGain) sc.ref = -18;
  const vals = [[lr.rmsL, lr.pkL], [lr.rmsR, lr.pkR]], pos = [0, 0];
  for (let i = 0; i < 2; i++) {
    const vu = audible ? vals[i][0] - sc.ref + sens : -60, pkv = audible ? vals[i][1] - sc.ref + sens - CREST : -60;
    if (audible && f.kick) sc.n[i].v += (0.6 + f.bass) * 2.4 * bounce * (i ? 0.92 : 1);          // the needle jumps on the kick
    pos[i] = sc.n[i].step(audible ? vuPos(vu) : -0.03, dt, speed, zeta, rest);
    if (audible && (pkv >= 3 || pos[i] >= 1)) { sc.led[i] = 1; sc.ledHold[i] = hold; } else if ((sc.ledHold[i] -= dt) <= 0) sc.led[i] = Math.max(0, sc.led[i] - dt / 250);
  }
  const lvlDb = audible ? Math.max(lr.pkL, lr.pkR) - sc.ref + sens - CREST : -80, lo = -30 - 18 * Math.min(1.5, barK);
  let lvl = Math.pow(Math.max(0, Math.min(1, (lvlDb - lo) / (3 - lo))), 1 + 0.7 * Math.min(1.5, barK));
  if (audible && f.kick) lvl = Math.min(1, lvl + 0.1 * barK * (0.5 + f.bass));
  sc.bar = lvl > sc.bar ? lvl : Math.max(lvl, sc.bar - dt / (650 - 200 * Math.min(1, barK)));
  if (sc.bar >= sc.barPeak) { sc.barPeak = sc.bar; sc.barHold = hold; } else if ((sc.barHold -= dt) <= 0) sc.barPeak = Math.max(sc.bar, sc.barPeak - dt / 1500);
  return { pos, audible };
}

/** 0.1.3 VU meters on the GPU (WebGL, the page's shared context). */
export class VuGLScene {
  constructor(g, opts) { this.g = g; this.kind = 'gl'; this.preview = !!opts.preview; this.q = opts.q || QUALITY.high; this.n = [new Needle(), new Needle()]; this.led = [0, 0]; this.ledHold = [0, 0]; this.bar = 0; this.barPeak = 0; this.barHold = 0; this.ref = -18; this.t = 0; this.tex = null; this.faceKey = ''; this.configure(opts); }
  configure({ settings, theme, q }) { if (settings) this.settings = settings; if (theme) this.theme = theme; if (q) this.q = q; this.fx = this.settings?.fx || {}; this.pal = palette(this.settings || {}, this.theme || {}); this.faceKey = ''; }
  style() { return VuScene.prototype.style.call(this); }
  depthMask() { return null; }
  dispose() { this.g.freeTexture(this.tex); this.tex = null; }
  draw(dt, f) {
    const g = this.g, w = g.w, h = g.h, S = this.style(), P = this.pal, I = Math.min(1.6, this.settings?.intensity ?? 1); this.t += dt;
    const L = layout(w, h), key = `${w}x${h}:${this.fx.style}:${P.p}:${P.s}`;
    g.begin(); g.fade(0, [0.02, 0.027, 0.04]);
    if (this.faceKey !== key || !this.tex) { this.tex = g.texture(faceCanvas(S, w, h, L), this.tex); this.faceKey = key; }
    g.image(this.tex, 0, 0, w, h, 1);
    const m = meterStep(this, dt, f), lightFace = !S.neon && (this.fx.style || 'classic') === 'classic';
    const nCol = hex(S.neon ? '#ffffff' : S.needle.startsWith('#') ? S.needle : '#f2f4f7'), glowCol = S.neon ? P.a : lightFace ? [1, 0.55, 0.2] : [0.85, 0.9, 1];
    const meters = L.meters.map(([mx, my, mw, mh], i) => { const b = mh * 0.09, fx = mx + b, fy = my + b, fw = mw - 2 * b, fh = mh - 2 * b; return { fx, fy, fw, fh, px: fx + fw / 2, py: fy + fh * PIV, R: fh * RAD, pos: m.pos[i], i }; });
    const tip = (M, p, r) => { const a = vuAngle(p); return [M.px + Math.sin(a) * r, M.py - Math.cos(a) * r]; };
    // 1) over: needle shadows, dark needles on the light face, unlit bar segments
    for (const M of meters) {
      const [x1, y1] = tip(M, M.pos, M.fh * 0.42), [x2, y2] = tip(M, M.pos, M.R * 1.03), wd = Math.max(1.6, M.fh * 0.03);
      g.line(x1 + M.fh * 0.025, y1 + M.fh * 0.035, x2 + M.fh * 0.025, y2 + M.fh * 0.035, wd * 2.2, [0, 0, 0], 0.32, 1);
      if (lightFace) g.line(x1, y1, x2, y2, wd * 1.25, [0.06, 0.05, 0.05], 1, 1);
    }
    const [bx, by, bw, bh] = L.bar, segs = this.preview ? 24 : 40, gap = bw / segs * 0.22, sw = bw / segs - gap;
    for (let i = 0; i < segs; i++) { const u = (i + 0.5) / segs; if (u > this.bar && !(Math.abs(u - this.barPeak) < 0.5 / segs && this.barPeak > 0.03)) g.quad(bx + i * (sw + gap), by, bx + i * (sw + gap) + sw, by, bx + i * (sw + gap), by + bh, bx + i * (sw + gap) + sw, by + bh, barColor(this, i / (segs - 1)), 0.11); }
    g.flush(true);
    // 2) additive: glowing needles, LEDs, lit bar segments
    for (const M of meters) {
      const [x1, y1] = tip(M, M.pos, M.fh * 0.42), [x2, y2] = tip(M, M.pos, M.R * 1.03), wd = Math.max(1.6, M.fh * 0.03), lvl = Math.max(0, Math.min(1, M.pos));
      g.line(x1, y1, x2, y2, wd * 7, glowCol, (lightFace ? 0.16 : 0.22) * (0.5 + lvl) * I, 0.3);
      if (!lightFace) g.line(x1, y1, x2, y2, wd * 1.2, nCol, 1, 0.6);
      g.sprite(x2, y2, wd * 3.2, glowCol, (0.25 + 0.5 * lvl) * I);
      const lx = M.fx + M.fw * 0.87, ly = M.fy + M.fh * 0.68, lr = Math.max(2, M.fh * 0.035), red = this.led[M.i] > 0.05;
      const lc = red ? [1, 0.24, 0.16] : m.audible ? [0.16, 0.83, 0.6] : [0.06, 0.2, 0.15], la = red ? 0.4 + 0.6 * this.led[M.i] : m.audible ? 0.9 : 0.5;
      g.sprite(lx, ly, lr * 1.6, lc, la); if (red || m.audible) g.sprite(lx, ly, lr * 5, lc, la * 0.35);
    }
    for (let i = 0; i < segs; i++) {
      const u = (i + 0.5) / segs, on = u <= this.bar, pk = Math.abs(u - this.barPeak) < 0.5 / segs && this.barPeak > 0.03; if (!on && !pk) continue;
      const x = bx + i * (sw + gap), c = barColor(this, i / (segs - 1));
      g.quad(x, by, x + sw, by, x, by + bh, x + sw, by + bh, c, 1); g.sprite(x + sw / 2, by + bh / 2, Math.max(sw, bh) * 1.4, c, 0.18 * I);
    }
    g.flush();
    // 3) over: pivot caps on top of the needles, then the glass reflection
    for (const M of meters) {
      const cx = M.px, cy = M.fy + M.fh * 1.02, r = M.fh * 0.17, cap = hex(S.cap), n = 20;
      for (let k = 0; k < n; k++) { const a1 = Math.PI + k / n * Math.PI, a2 = Math.PI + (k + 1) / n * Math.PI; g.tri(cx, cy, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, cx + Math.cos(a2) * r, cy + Math.sin(a2) * r, cap, 1); }
      const ga = S.glass * 1.15, Wt = [1, 1, 1];
      g.quadA(M.fx, M.fy, Wt, ga, M.fx + M.fw * 0.62, M.fy, Wt, 0, M.fx, M.fy + M.fh * 0.75, Wt, 0, M.fx + M.fw * 0.3, M.fy + M.fh * 0.35, Wt, 0);
      g.quadA(M.fx, M.fy, Wt, ga * 0.7, M.fx + M.fw, M.fy, Wt, ga * 0.25, M.fx, M.fy + M.fh * 0.06, Wt, 0, M.fx + M.fw, M.fy + M.fh * 0.06, Wt, 0);
    }
    g.flush(true);
  }
}

function rr(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }
/** Static meter faces, drawn once per size/style/theme into an offscreen canvas (no needle: that is drawn live). */
function faceCanvas(S, w, h, L) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    for (const [mx, my, mw, mh] of L.meters) {
      const r = mh * 0.08, g = x.createLinearGradient(mx, my, mx, my + mh); g.addColorStop(0, S.bezel[0]); g.addColorStop(0.5, S.bezel[1]); g.addColorStop(1, S.bezel[2]);
      rr(x, mx, my, mw, mh, r); x.fillStyle = g; x.fill(); x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = Math.max(1, mh * 0.01); x.stroke();
      const b = mh * 0.09, fx = mx + b, fy = my + b, fw = mw - 2 * b, fh = mh - 2 * b;
      const fg = x.createRadialGradient(fx + fw / 2, fy + fh * 0.75, fh * 0.1, fx + fw / 2, fy + fh * 0.6, fw * 0.62); fg.addColorStop(0, S.face[0]); fg.addColorStop(0.55, S.face[1]); fg.addColorStop(1, S.face[2]);
      rr(x, fx, fy, fw, fh, r * 0.5); x.fillStyle = fg; x.fill(); x.save(); rr(x, fx, fy, fw, fh, r * 0.5); x.clip();
      const px = fx + fw / 2, py = fy + fh * PIV, R = fh * RAD, ang = vuAngle;
      const at = (p, rad) => { const a = ang(p); return [px + Math.sin(a) * rad, py - Math.cos(a) * rad]; };
      // red zone 0..+3
      x.beginPath(); for (let i = 0; i <= 30; i++) { const p = vuPos(i / 10); const [ax, ay] = at(p, R); i ? x.lineTo(ax, ay) : x.moveTo(ax, ay); }
      x.strokeStyle = S.red; x.lineWidth = fh * 0.05; if (S.neon) { x.shadowColor = S.red; x.shadowBlur = fh * 0.08; } x.stroke(); x.shadowBlur = 0;
      // main arc
      x.beginPath(); for (let i = 0; i <= 60; i++) { const p = i / 60; const [ax, ay] = at(p, R - fh * 0.03); i ? x.lineTo(ax, ay) : x.moveTo(ax, ay); }
      x.strokeStyle = S.ink; x.lineWidth = Math.max(1, fh * 0.012); if (S.neon) { x.shadowColor = S.ink; x.shadowBlur = fh * 0.05; } x.stroke();
      // ticks + labels
      x.font = `700 ${Math.max(7, fh * 0.1)}px Nunito, "Segoe UI", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
      for (let v = -20; v <= 3; v++) {
        const p = vuPos(v), major = SCALE.includes(v), [a1, b1] = at(p, R - fh * 0.03), [a2, b2] = at(p, R + (major ? fh * 0.07 : fh * 0.035));
        if (v < -10 && !major && v % 2) continue;
        x.beginPath(); x.moveTo(a1, b1); x.lineTo(a2, b2); x.strokeStyle = v > 0 ? S.red : S.ink; x.lineWidth = Math.max(1, fh * (major ? 0.014 : 0.009)); x.stroke();
        if (major) { const [lx, ly] = at(p, R + fh * 0.16); x.fillStyle = v > 0 ? S.red : S.ink; x.fillText(v > 0 ? '+' + v : String(v), lx, ly); }
      }
      // secondary percentage-style marks under the arc
      x.font = `600 ${Math.max(6, fh * 0.075)}px Nunito, "Segoe UI", sans-serif`;
      for (const [v, t] of [[0, '1'], [3, '+3']]) { const [lx, ly] = at(vuPos(v), R - fh * 0.14); x.fillStyle = v > 0 ? S.red : S.ink; x.fillText(t, lx, ly); }
      x.shadowBlur = 0; x.font = `800 ${Math.max(8, fh * 0.16)}px Nunito, "Segoe UI", sans-serif`; x.fillStyle = S.vu; x.fillText('VU', px, fy + fh * 0.63);
      // pivot cap
      x.beginPath(); x.arc(px, fy + fh * 1.02, fh * 0.17, Math.PI, 0); x.fillStyle = S.cap; x.fill();
      x.restore();
      // glass reflection + inner shadow
      x.save(); rr(x, fx, fy, fw, fh, r * 0.5); x.clip(); const gl = x.createLinearGradient(fx, fy, fx + fw * 0.6, fy + fh); gl.addColorStop(0, `rgba(255,255,255,${S.glass})`); gl.addColorStop(0.45, 'rgba(255,255,255,0)'); x.fillStyle = gl; x.fillRect(fx, fy, fw, fh);
      x.strokeStyle = 'rgba(0,0,0,.55)'; x.lineWidth = fh * 0.03; rr(x, fx, fy, fw, fh, r * 0.5); x.stroke(); x.restore();
      // screws
      for (const [sx, sy] of [[mx + b * 0.5, my + b * 0.5], [mx + mw - b * 0.5, my + b * 0.5], [mx + b * 0.5, my + mh - b * 0.5], [mx + mw - b * 0.5, my + mh - b * 0.5]]) {
        const sr = b * 0.28; const sg = x.createRadialGradient(sx - sr * 0.3, sy - sr * 0.3, sr * 0.1, sx, sy, sr); sg.addColorStop(0, '#c9ccd1'); sg.addColorStop(1, '#3a3c40');
        x.beginPath(); x.arc(sx, sy, sr, 0, Math.PI * 2); x.fillStyle = sg; x.fill(); x.beginPath(); x.moveTo(sx - sr * 0.7, sy - sr * 0.2); x.lineTo(sx + sr * 0.7, sy + sr * 0.2); x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = Math.max(1, sr * 0.25); x.stroke();
      }
    }
    // LED bar housing
    const [bx, by, bw, bh] = L.bar; rr(x, bx - bh * 0.4, by - bh * 0.35, bw + bh * 0.8, bh * 1.7, bh * 0.3); x.fillStyle = '#07090c'; x.fill(); x.strokeStyle = 'rgba(255,255,255,.06)'; x.lineWidth = 1; x.stroke();
    return c;
  }
