// WavWiz WebGL visualizers: Particle burst (3D warp), Waveform river, Speaker cone, Ring, Neon tunnel, Terrain, Graphic EQ (+ VU meters in vizvu.js).
// 0.0.8 crash fix: ONE WebGL context per page, shared by the banner, full screen and every preview card. Each view renders into its own framebuffer
// (so trails persist per view) and the result is composited onto the view's plain 2D canvas (dark from the first frame, never white).
// 0.1.3 richer graphics: WebGL 2 with automatic WebGL 1 fallback (GLSL ES 1.00 shaders run on both); half-float render targets where the device can
// render to them (EXT_color_buffer_float / _half_float, OES_texture_half_float(+_linear)) for real bloom, HDR-style highlight roll-off and smooth
// gradients, else 8-bit targets; every frame ends with a soft tone curve and dithering (fights banding on 8-bit screens). GPU instanced particles
// (WebGL 2 core / ANGLE_instanced_arrays): tens of thousands of stars and spark bursts on High/Ultra, scaled down on Low/phones. Post-processing:
// soft bloom (1-3 blur levels), light streaks, color fringing on big hits, depth blur (Terrain, Ring), each with its own knob.
// 0.1.3: Lightning was replaced by Graphic EQ. No eval, no external files.
import { palette, particleCount, rng, persp, QUALITY, isLight } from './vizcore.js';

const VS = `attribute vec2 a_pos; attribute vec4 a_col; attribute vec2 a_uv; uniform vec2 u_res; uniform vec2 u_shake; uniform float u_zoom;
varying vec4 v_col; varying vec2 v_uv;
void main(){ vec2 c = u_res * 0.5; vec2 p = (a_pos - c) * u_zoom + c + u_shake; vec2 n = p / u_res * 2.0 - 1.0; gl_Position = vec4(n.x, -n.y, 0.0, 1.0); v_col = a_col; v_uv = a_uv; }`;
const FS = `precision mediump float; varying vec4 v_col; varying vec2 v_uv;
void main(){ float d = dot(v_uv, v_uv); float f = clamp(1.0 - d, 0.0, 1.0); f = f * f; gl_FragColor = vec4(v_col.rgb * v_col.a * f, 1.0); }`;
// 0.1.3: the same soft shapes drawn "over" (premultiplied alpha): solid Terrain hills, VU needles on a light face, glass reflections
const FS_OVER = `precision mediump float; varying vec4 v_col; varying vec2 v_uv;
void main(){ float d = dot(v_uv, v_uv); float f = clamp(1.0 - d, 0.0, 1.0); f = f * f; float a = clamp(v_col.a * f, 0.0, 1.0); gl_FragColor = vec4(v_col.rgb * a, a); }`;
const QVS = `attribute vec2 a_p; varying vec2 v_p; void main(){ v_p = a_p * 0.5 + 0.5; gl_Position = vec4(a_p, 0.0, 1.0); }`;
const FADE = `precision mediump float; uniform vec4 u_col; void main(){ gl_FragColor = u_col; }`;
const GLOW = `precision mediump float; varying vec2 v_p; uniform vec2 u_res; uniform vec2 u_c; uniform float u_r; uniform vec3 u_col; uniform float u_i;
void main(){ vec2 px = v_p * u_res; px.y = u_res.y - px.y; float d = length(px - u_c) / u_r; float f = exp(-d * d * 2.2) + 0.25 * exp(-d * 1.4); gl_FragColor = vec4(u_col * f * u_i, 1.0); }`;
// post: 2x downsample (4 bilinear taps = soft tent), separable gaussian (9 taps in 5 fetches), streaks (long horizontal decaying blur), composite
const DOWN = `precision mediump float; varying vec2 v_p; uniform sampler2D u_tex; uniform vec2 u_tx;
void main(){ vec3 c = texture2D(u_tex, v_p + u_tx * vec2(-1.0, -1.0)).rgb + texture2D(u_tex, v_p + u_tx * vec2(1.0, -1.0)).rgb + texture2D(u_tex, v_p + u_tx * vec2(-1.0, 1.0)).rgb + texture2D(u_tex, v_p + u_tx * vec2(1.0, 1.0)).rgb; gl_FragColor = vec4(c * 0.25, 1.0); }`;
const BLUR = `precision mediump float; varying vec2 v_p; uniform sampler2D u_tex; uniform vec2 u_dir;
void main(){ vec3 c = texture2D(u_tex, v_p).rgb * 0.2270270; c += (texture2D(u_tex, v_p + u_dir * 1.3846154).rgb + texture2D(u_tex, v_p - u_dir * 1.3846154).rgb) * 0.3162162;
  c += (texture2D(u_tex, v_p + u_dir * 3.2307692).rgb + texture2D(u_tex, v_p - u_dir * 3.2307692).rgb) * 0.0702703; gl_FragColor = vec4(c, 1.0); }`;
const STREAK = `precision mediump float; varying vec2 v_p; uniform sampler2D u_tex; uniform vec2 u_dir; uniform float u_thr; uniform float u_first;
vec3 br(vec3 c){ if (u_first < 0.5) return c; float l = max(c.r, max(c.g, c.b)); return c * max(0.0, l - u_thr) / max(l, 0.0001); }
void main(){ vec3 c = br(texture2D(u_tex, v_p).rgb); float w = 1.0, tw = 1.0;
  for (int i = 1; i <= 7; i++) { w *= 0.82; float o = float(i); c += (br(texture2D(u_tex, v_p + u_dir * o).rgb) + br(texture2D(u_tex, v_p - u_dir * o).rgb)) * w; tw += 2.0 * w; }
  gl_FragColor = vec4(c / tw * (u_first > 0.5 ? 1.0 : 1.6), 1.0); }`;
const COMP = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_p; uniform sampler2D u_scene; uniform sampler2D u_h1; uniform sampler2D u_q1; uniform sampler2D u_e1; uniform sampler2D u_st;
uniform vec4 u_k; uniform vec4 u_dp; uniform vec3 u_tint; uniform float u_levels; uniform float u_thr; uniform float u_seed;
vec3 br(vec3 c){ float l = max(c.r, max(c.g, c.b)); return c * max(0.0, l - u_thr) / max(l, 0.0001); }
void main(){
  vec2 uv = v_p; vec3 col;
  if (u_k.z > 0.0005) { vec2 d = (uv - 0.5) * u_k.z * 0.012; col = vec3(texture2D(u_scene, uv + d).r, texture2D(u_scene, uv).g, texture2D(u_scene, uv - d).b); }
  else col = texture2D(u_scene, uv).rgb;
  if (u_k.w > 0.0005) {
    float m = 0.0;
    if (u_dp.x < 1.5) m = smoothstep(u_dp.y, u_dp.z, uv.y) * (1.0 - 0.7 * smoothstep(u_dp.z + 0.04, u_dp.z + 0.25, uv.y));
    else { vec2 q = (uv - 0.5) * vec2(u_dp.w, 1.0); m = smoothstep(0.02, u_dp.z, abs(length(q) - u_dp.y)); }
    vec3 bl = u_levels > 1.5 ? mix(texture2D(u_h1, uv).rgb, texture2D(u_q1, uv).rgb, 0.5) : texture2D(u_h1, uv).rgb;
    col = mix(col, bl, clamp(m * u_k.w, 0.0, 1.0));
  }
  if (u_k.x > 0.0005) { vec3 b = br(texture2D(u_h1, uv).rgb) * 0.55; if (u_levels > 1.5) b += br(texture2D(u_q1, uv).rgb) * 0.75; if (u_levels > 2.5) b += br(texture2D(u_e1, uv).rgb) * 0.9; col += b * u_k.x; }
  if (u_k.y > 0.0005) col += texture2D(u_st, uv).rgb * u_tint * u_k.y;
  col = max(col, vec3(0.0));
  vec3 hi = 0.8 + 0.2 * (1.0 - exp(-(col - 0.8) / 0.2));                 // soft highlight roll-off (HDR-style) instead of a hard clip
  col = mix(col, hi, step(vec3(0.8), col));
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy + u_seed, vec2(0.06711056, 0.00583715))));   // interleaved-gradient dither
  float n2 = fract(52.9829189 * fract(dot(gl_FragCoord.yx + u_seed * 1.37 + 17.0, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(col + (n + n2 - 1.0) / 255.0, 1.0);
}`;
const IMG_VS = `attribute vec2 a_p; uniform vec4 u_rect; uniform vec2 u_res; varying vec2 v_t;
void main(){ v_t = a_p * 0.5 + 0.5; vec2 px = u_rect.xy + vec2(v_t.x, 1.0 - v_t.y) * u_rect.zw; vec2 n = px / u_res * 2.0 - 1.0; gl_Position = vec4(n.x, -n.y, 0.0, 1.0); }`;
const IMG_FS = `precision mediump float; varying vec2 v_t; uniform sampler2D u_tex; uniform float u_a; void main(){ gl_FragColor = vec4(texture2D(u_tex, vec2(v_t.x, 1.0 - v_t.y)).rgb * u_a, u_a); }`;
// GPU instanced particles. a_corner = (0..1 along, -1..1 across), a_seed = 4 random numbers per instance.
const INST_HEAD = `attribute vec2 a_corner; attribute vec4 a_seed; uniform vec2 u_res; uniform vec2 u_shake; uniform float u_zoom; uniform vec3 u_p; uniform vec3 u_s; uniform vec3 u_a;
varying vec4 v_col; varying vec2 v_uv;
float h1(float n){ return fract(sin(n) * 43758.5453123); }
void emit(vec2 tail, vec2 head, float size, vec3 col, float a, float tailA){
  vec2 d2 = head - tail; float L = max(length(d2), 0.001); vec2 dn = d2 / L; vec2 nn = vec2(-dn.y, dn.x);
  vec2 p = mix(tail, head + dn * size * 0.5, a_corner.x) + nn * a_corner.y * size * 0.5;
  v_col = vec4(col, a * mix(tailA, 1.0, a_corner.x)); v_uv = vec2(0.0, a_corner.y);
  vec2 c = u_res * 0.5; vec2 q = (p - c) * u_zoom + c + u_shake; vec2 n = q / u_res * 2.0 - 1.0; gl_Position = vec4(n.x, -n.y, 0.0, 1.0);
}`;
// mode 0: warp starfield (perspective, streaks grow as they approach); mode 1: radial light streaks rushing out of the tunnel
const STAR_VS = INST_HEAD + `
uniform float u_mode; uniform float u_dist; uniform float u_streak; uniform float u_size; uniform float u_bright; uniform float u_asp; uniform float u_time; uniform float u_high; uniform float u_energy; uniform float u_R;
void main(){
  vec2 c = u_res * 0.5; float sp = 0.6 + a_seed.z * 0.8;
  float t = a_seed.w * 7.0 + u_dist * sp; float cyc = floor(t); float f = t - cyc;
  float r1 = h1(a_seed.x * 97.31 + cyc * 13.17), r2 = h1(a_seed.y * 61.73 + cyc * 7.91);
  vec2 head; vec2 tail; float size; float a; vec3 col;
  if (u_mode < 0.5) {
    float z = max(0.03, 1.0 - f); float ang = r1 * 6.28318; float rr = 0.06 + sqrt(r2) * 1.1;
    vec2 xy = vec2(cos(ang) * rr * u_asp * 0.9, sin(ang) * rr * 0.9); float focal = u_res.y * 0.5;
    head = c + xy / z * focal; tail = c + xy / (z + u_streak * sp) * focal;
    float near = clamp(1.0 - z, 0.0, 1.0);
    size = (0.5 + near * near * 3.2 * (0.6 + a_seed.x * 1.2)) * u_size;
    a = min(1.0, (0.15 + near * 1.1) * u_bright) * smoothstep(0.0, 0.12, f);
    col = mix(u_p, u_s, clamp(0.5 + xy.x / (u_asp * 0.9) * 1.6 + (r1 - 0.5) * 0.5, 0.0, 1.0));
  } else {
    float ang = r1 * 6.28318; vec2 dir = vec2(cos(ang) * 1.3, sin(ang));
    float rA = u_R * 0.08 + f * f * max(u_res.x, u_res.y) * 0.7; float rB = rA + (8.0 + f * 60.0 * (0.5 + u_energy)) * u_size;
    tail = c + dir * rA; head = c + dir * rB; size = (0.7 + a_seed.x * 0.9) * u_size;
    a = (0.12 + 0.5 * f) * u_bright; col = r2 < 0.5 ? u_s : mix(u_a, u_p, 0.5);
  }
  if (a_seed.y > 0.93) col = mix(u_a, vec3(1.0), 0.4);
  if (h1(a_seed.x * 31.7 + floor(u_time * 12.0)) < u_high * 0.012) a = 1.6;          // sparkle on the highs
  emit(tail, head, size, col, a, 0.05);
}`;
// a spark burst: every instance flies out of (x,y) with its own direction/speed, exponential drag, fades over its own life
const BURST_VS = INST_HEAD + `
uniform vec4 u_b; uniform float u_bseed; uniform float u_speed; uniform float u_drag; uniform float u_life; uniform float u_size;
void main(){
  float r1 = fract(a_seed.x + u_bseed * 0.6180339), r2 = fract(a_seed.y + u_bseed * 0.3819660), r3 = fract(a_seed.z + u_bseed * 0.7548776);
  float ang = r1 * 6.28318; vec2 dir = vec2(cos(ang), sin(ang));
  float v = (0.2 + r2 * r2 * 1.4) * u_speed * (0.6 + 0.6 * u_b.w), k = u_drag, age = u_b.z;
  float dist = v * (1.0 - exp(-k * age)) / k, vel = v * exp(-k * age), life = 1.0 - age / (u_life * (0.45 + r3 * 0.9));
  if (life <= 0.0) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); v_col = vec4(0.0); v_uv = vec2(0.0); return; }
  vec2 head = u_b.xy + dir * dist; vec2 tail = head - dir * max(1.0, vel * 0.045);
  vec3 col = r2 > 0.92 ? mix(u_a, vec3(1.0), 0.3) : (a_seed.w < 0.5 ? u_p : u_s);
  emit(tail, head, (0.8 + r3 * 1.4) * u_size, col, life * min(1.2, u_b.w), 0.02);
}`;
const CONE = `precision mediump float; varying vec2 v_p; uniform vec2 u_res; uniform vec2 u_shake; uniform float u_t; uniform float u_exc; uniform float u_glow; uniform float u_level; uniform float u_flash;
uniform vec3 u_p; uniform vec3 u_s; uniform vec3 u_a; uniform vec4 u_rip[6]; uniform float u_idle;
float ring(float r, float a, float w){ float d = (r - a) / w; return exp(-d * d); }
void main(){
  vec2 uv = (v_p * u_res - 0.5 * u_res - u_shake) / u_res.y;
  float r = length(uv); float R = 0.36 * (1.0 + 0.05 * u_exc);
  vec3 col = mix(vec3(0.035, 0.045, 0.06), vec3(0.012, 0.016, 0.022), clamp(r * 1.4, 0.0, 1.0));
  // ambient rings around the speaker (mockup), louder music = brighter, drifting outward
  float amb = 0.5 + 0.5 * cos((r - u_t * 0.06) * 70.0);
  float outside = smoothstep(R * 1.02, R * 1.15, r) * exp(-(r - R) * 2.2);
  col += u_s * amb * amb * outside * (0.10 + 0.55 * u_level) * (1.0 - 0.5 * u_idle);
  for (int i = 0; i < 6; i++) { vec4 q = u_rip[i]; if (q.y > 0.0) col += mix(u_s, u_a, 0.25) * ring(r, q.x, 0.012 + 0.02 * q.x) * q.y * 1.4 * smoothstep(R, R * 1.08, r); }
  if (r < R) {
    float sp = 0.0;
    if (r > R * 0.92) { float k = (r - R * 0.92) / (R * 0.08); col = mix(vec3(0.10, 0.11, 0.12), vec3(0.03), k) + 0.12 * pow(max(0.0, dot(normalize(uv), vec2(-0.6, 0.7))), 6.0);
      vec2 au = abs(uv); float sc = length(vec2(au.x, au.y) - vec2(R * 0.678, R * 0.678)); col += vec3(0.25) * smoothstep(R * 0.035, R * 0.015, sc); }
    else if (r > R * 0.78) { float k = (r - R * 0.78) / (R * 0.14); float h = sin(3.14159 * k); vec2 n2 = normalize(uv);
      float lit = 0.5 + 0.5 * dot(n2, vec2(-0.55, 0.65)) * cos(3.14159 * k); col = vec3(0.04 + 0.12 * h * lit) * (1.0 + 0.25 * u_exc); }
    else {
      float rc = R * 0.31 * (1.0 + 0.09 * u_exc);
      if (r > rc) { float k = (r - rc) / (R * 0.78 - rc); float ridge = 0.5 + 0.5 * cos(k * 40.0); vec2 n2 = normalize(uv);
        float lit = 0.5 + 0.5 * dot(n2, vec2(-0.5, 0.7)); col = vec3(0.025 + 0.06 * (1.0 - k)) + vec3(0.02) * ridge + vec3(0.07) * lit * (0.6 + 0.6 * u_exc) * (1.0 - k);
        col += u_p * 0.12 * u_glow * (1.0 - k); }
      else { float k = r / rc; float n = sqrt(max(0.0, 1.0 - k * k)); vec2 l = uv / rc - vec2(-0.35, 0.4); float spec = exp(-dot(l, l) * 6.0);
        col = u_p * (0.25 + 0.85 * n) + vec3(1.0) * spec * 0.55 + u_p * u_glow * 0.6; }
    }
  }
  float halo = exp(-pow(r / (R * 0.4), 2.0) * 1.5) * (0.12 + 0.6 * u_glow) * (1.0 - smoothstep(R * 0.3, R * 0.45, r) * 0.0);
  col += u_p * halo * smoothstep(R * 0.30, R * 0.34, r) * 0.6;
  col += mix(u_p, u_a, 0.5) * u_flash * 0.18 * exp(-r * 2.0);
  gl_FragColor = vec4(col, 1.0);
}`;


function compile(gl, type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('shader: ' + gl.getShaderInfoLog(s)); return s; }
function program(gl, vs, fs, attribs = []) {
  const p = gl.createProgram(); gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));            // attribute 0 is always a real per-vertex array (fast path on WebGL 1)
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0; for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace('[0]', '')] = gl.getUniformLocation(p, a.name); }
  const at = {}; const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES) || 0; for (let i = 0; i < na; i++) { const a = gl.getActiveAttrib(p, i); at[a.name] = gl.getAttribLocation(p, a.name); }
  return { p, u, at };
}
function setU(gl, P, obj) {
  for (const [k, v] of Object.entries(obj)) {
    const loc = P.u[k]; if (loc == null) continue;
    if (typeof v === 'number') gl.uniform1f(loc, v); else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]); else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]); else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
  }
}

/** True when this page can draw WebGL (asks the shared context; never creates throw-away contexts any more). */
export function webglOk() { try { return !!sharedGL(); } catch { return false; } }
/** Tests / Diagnostics: force the WebGL 1 path (localStorage wavwiz.viz.webgl1 = 1, or ?webgl1 in the address). */
export function forceWebGL1() { try { return localStorage.getItem('wavwiz.viz.webgl1') === '1' || /[?&]webgl1\b/.test(location.search); } catch { return false; } }

/** Batched soft quads (lines, sprites, fills) + full-screen effects + instanced particles, drawing into the current render target (a view's framebuffer). */
export class GL {
  constructor(canvas, { forceV1 = false } = {}) {
    const opts = { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, premultipliedAlpha: false, powerPreference: 'high-performance' };
    let gl = null, v2 = false;
    if (!forceV1) { try { gl = canvas.getContext('webgl2', opts); v2 = !!gl; } catch { gl = null; } }
    if (!gl) gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('WebGL is not available on this device.');
    this.gl = gl; this.v2 = v2; this.c = canvas; this.target = null; this.init();
  }
  /** (Re)creates every GPU object; called again after the context is restored. */
  init() {
    const gl = this.gl, A = ['a_pos', 'a_col', 'a_uv'];
    this.soft = program(gl, VS, FS, A); this.softOver = program(gl, VS, FS_OVER, A); this.fadeP = program(gl, QVS, FADE, ['a_p']); this.glowP = program(gl, QVS, GLOW, ['a_p']);
    this.downP = program(gl, QVS, DOWN, ['a_p']); this.blurP = program(gl, QVS, BLUR, ['a_p']); this.streakP = program(gl, QVS, STREAK, ['a_p']); this.compP = program(gl, QVS, COMP, ['a_p']);
    this.imgP = program(gl, IMG_VS, IMG_FS, ['a_p']); this.coneP = null; this.starP = null; this.burstP = null;
    this.buf = gl.createBuffer(); this.qbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.qbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    this.cornerBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    this.seedBuf = null; this.seedN = 0;
    this.cap = this.cap || 1 << 16; this.data = this.data || new Float32Array(this.cap * 8); this.n = 0;
    this.maxTex = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048);
    this.shake = [0, 0]; this.zoom = 1; gl.disable(gl.DEPTH_TEST); gl.clearColor(0.02, 0.025, 0.035, 1);
    this.on = new Set(); this.divs = new Set(); this.scratch = new Map(); this.frame = 0;
    // instancing: core in WebGL 2, ANGLE_instanced_arrays on WebGL 1 (every iPhone/Android/WebView2 has it); null = CPU particles
    if (this.v2) this.inst = { div: (i, d) => gl.vertexAttribDivisor(i, d), draw: (m, f, c, n) => gl.drawArraysInstanced(m, f, c, n) };
    else { const e = gl.getExtension('ANGLE_instanced_arrays'); this.inst = e ? { div: (i, d) => e.vertexAttribDivisorANGLE(i, d), draw: (m, f, c, n) => e.drawArraysInstancedANGLE(m, f, c, n) } : null; }
    this.hdrFmt = this.probeHdr();
    try { const ri = gl.getExtension('WEBGL_debug_renderer_info'); this.renderer = String(ri ? gl.getParameter(ri.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || ''); } catch { this.renderer = ''; }
  }
  /** Half-float color targets the device can actually render to AND filter, or null (8-bit + dithering). */
  probeHdr() {
    const gl = this.gl; let fmt = null;
    try {
      if (this.v2) { if (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')) fmt = { internal: gl.RGBA16F, type: gl.HALF_FLOAT, name: 'RGBA16F' }; }
      else { const h = gl.getExtension('OES_texture_half_float'), lin = gl.getExtension('OES_texture_half_float_linear'); gl.getExtension('EXT_color_buffer_half_float'); if (h && lin) fmt = { internal: gl.RGBA, type: h.HALF_FLOAT_OES, name: 'RGBA half-float' }; }
      if (!fmt) return null;
      const tex = gl.createTexture(), fb = gl.createFramebuffer(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, 4, 4, 0, gl.RGBA, fmt.type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(tex); while (gl.getError()) { /* drain */ }
      return ok ? fmt : null;
    } catch { return null; }
  }
  /** A view's own framebuffer (its trails live here), cleared to the dark background. hdr = half-float when the device supports it. */
  makeTarget(w, h, hdr = false) { const gl = this.gl, t = { tex: gl.createTexture(), fb: gl.createFramebuffer(), w: 0, h: 0, hdr: false }; this.sizeTarget(t, w, h, hdr); return t; }
  sizeTarget(t, w, h, hdr = t.hdr) {
    const gl = this.gl; w = Math.max(16, Math.min(this.maxTex, w | 0)); h = Math.max(16, Math.min(this.maxTex, h | 0)); hdr = !!(hdr && this.hdrFmt);
    if (t.w === w && t.h === h && t.hdr === hdr) return t;
    t.w = w; t.h = h; t.hdr = hdr; gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, this.hdrFmt.internal, w, h, 0, gl.RGBA, this.hdrFmt.type, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    if (hdr && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { this.hdrFmt = null; gl.bindFramebuffer(gl.FRAMEBUFFER, null); t.w = 0; return this.sizeTarget(t, w, h, false); }
    gl.viewport(0, 0, w, h); gl.clear(gl.COLOR_BUFFER_BIT); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return t;
  }
  freeTarget(t) { if (!t) return; try { this.gl.deleteFramebuffer(t.fb); this.gl.deleteTexture(t.tex); } catch { /* lost */ } t.fb = t.tex = null; }
  use(t) { this.target = t; }
  /** Post-processing scratch targets for one view size (half, quarter, eighth resolution + streak ping-pong); at most two sizes are kept. */
  scratchFor(t) {
    const key = `${t.w}x${t.h}:${t.hdr ? 1 : 0}`; let S = this.scratch.get(key); if (S) return S;
    if (this.scratch.size >= 2) { for (const [k, old] of this.scratch) { Object.values(old).forEach(x => this.freeTarget(x)); this.scratch.delete(k); break; } }
    const mk = d => this.makeTarget(Math.ceil(t.w / d), Math.ceil(t.h / d), t.hdr);
    S = { h1: mk(2), h1b: mk(2), q1: mk(4), q1b: mk(4), e1: mk(8), e1b: mk(8), st: mk(4), stb: mk(4) }; this.scratch.set(key, S); return S;
  }
  pass(P, src, dst, u = {}) {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, dst.w, dst.h); gl.useProgram(P.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex); if (P.u.u_tex) gl.uniform1i(P.u.u_tex, 0);
    setU(gl, P, { u_tx: [1 / src.w, 1 / src.h], ...u }); this.quadDraw(P);
  }
  blur(t, tmp, spread = 1) { this.pass(this.blurP, t, tmp, { u_dir: [spread / t.w, 0] }); this.pass(this.blurP, tmp, t, { u_dir: [0, spread / t.h] }); }
  /**
   * Composites a view's framebuffer to the bottom-left of the shared canvas (the caller copies that area onto the view's 2D canvas):
   * bloom / streaks / fringe / depth blur as asked (post = null: tone curve + dither only), then the soft highlight roll-off and dithering.
   */
  present(t, post = null) {
    const gl = this.gl, c = this.c; this.frame++;
    if (c.width < t.w || c.height < t.h) { c.width = Math.max(c.width, t.w); c.height = Math.max(c.height, t.h); }
    gl.disable(gl.BLEND);
    const P = post || {}, levels = Math.max(0, Math.min(3, P.levels | 0)); let h1 = t, q1 = t, e1 = t, st = t, used = 0;
    const want = levels > 0 && ((P.bloom || 0) > 0.001 || (P.depth || 0) > 0.001 || (P.streaks || 0) > 0.001);
    if (want && t.w >= 64 && t.h >= 64) {
      const S = this.scratchFor(t);
      this.pass(this.downP, t, S.h1); this.blur(S.h1, S.h1b); h1 = S.h1; used = 1;
      if (levels >= 2) { this.pass(this.downP, S.h1, S.q1); this.blur(S.q1, S.q1b, 1.4); q1 = S.q1; used = 2; }
      if (levels >= 3) { this.pass(this.downP, S.q1, S.e1); this.blur(S.e1, S.e1b, 1.8); e1 = S.e1; used = 3; }
      if ((P.streaks || 0) > 0.001) {
        const src = used >= 2 ? S.q1 : S.h1, thr = t.hdr ? 0.85 : 0.62;
        this.pass(this.streakP, src, S.st, { u_dir: [1 / src.w, 0], u_thr: thr, u_first: 1 });
        this.pass(this.streakP, S.st, S.stb, { u_dir: [4 / S.st.w, 0], u_thr: thr, u_first: 0 });
        this.pass(this.streakP, S.stb, S.st, { u_dir: [12 / S.st.w, 0], u_thr: thr, u_first: 0 }); st = S.st;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, t.w, t.h); const C = this.compP; gl.useProgram(C.p);
    [[t, 'u_scene'], [h1, 'u_h1'], [q1, 'u_q1'], [e1, 'u_e1'], [st, 'u_st']].forEach(([x, name], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, x.tex); if (C.u[name]) gl.uniform1i(C.u[name], i); });
    const dm = P.mask || null;
    setU(gl, C, { u_k: [used ? P.bloom || 0 : 0, st !== t ? P.streaks || 0 : 0, P.fringe || 0, used && dm ? P.depth || 0 : 0], u_dp: dm ? [dm.mode, dm.a, dm.b, t.w / t.h] : [0, 0, 1, 1],
      u_tint: P.tint || [1, 1, 1], u_levels: used, u_thr: t.hdr ? 0.8 : 0.6, u_seed: (this.frame % 64) * 7.31 });
    this.quadDraw(C); gl.activeTexture(gl.TEXTURE0);
  }
  get w() { return this.target ? this.target.w : this.c.width; } get h() { return this.target ? this.target.h : this.c.height; }
  lost() { return this.gl.isContextLost(); }
  begin(shakeX = 0, shakeY = 0, zoom = 1) { this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.target ? this.target.fb : null); this.gl.viewport(0, 0, this.w, this.h); this.shake = [shakeX, shakeY]; this.zoom = zoom; this.n = 0; }
  grow(need) { if (this.n + need <= this.cap) return; while (this.n + need > this.cap) this.cap *= 2; const d = new Float32Array(this.cap * 8); d.set(this.data.subarray(0, this.n * 8)); this.data = d; }
  v(x, y, r, g, b, a, u, w) { const o = this.n * 8, d = this.data; d[o] = x; d[o + 1] = y; d[o + 2] = r; d[o + 3] = g; d[o + 4] = b; d[o + 5] = a; d[o + 6] = u; d[o + 7] = w; this.n++; }
  /** Soft line from (x1,y1) to (x2,y2), width w px; color c at the head (x2,y2), tail alpha ta (0..1 of a). */
  line(x1, y1, x2, y2, w, c, a, ta = 0.15) {
    let dx = x2 - x1, dy = y2 - y1; const L = Math.hypot(dx, dy) || 1e-3; const nx = -dy / L * w * 0.5, ny = dx / L * w * 0.5; this.grow(6);
    const [r, g, b] = c, a2 = a * ta;
    this.v(x1 + nx, y1 + ny, r, g, b, a2, 0, -1); this.v(x1 - nx, y1 - ny, r, g, b, a2, 0, 1); this.v(x2 + nx, y2 + ny, r, g, b, a, 0, -1);
    this.v(x2 + nx, y2 + ny, r, g, b, a, 0, -1); this.v(x1 - nx, y1 - ny, r, g, b, a2, 0, 1); this.v(x2 - nx, y2 - ny, r, g, b, a, 0, 1);
  }
  sprite(x, y, s, c, a) { this.grow(6); const [r, g, b] = c; this.v(x - s, y - s, r, g, b, a, -1, -1); this.v(x + s, y - s, r, g, b, a, 1, -1); this.v(x - s, y + s, r, g, b, a, -1, 1); this.v(x - s, y + s, r, g, b, a, -1, 1); this.v(x + s, y - s, r, g, b, a, 1, -1); this.v(x + s, y + s, r, g, b, a, 1, 1); }
  /** Solid translucent quad (4 corners, top pair then bottom pair). */
  quad(x1, y1, x2, y2, x3, y3, x4, y4, c, a1, a2 = a1) { this.quadC(x1, y1, x2, y2, x3, y3, x4, y4, c, a1, c, a2); }
  /** Quad with a top color/alpha and a bottom color/alpha (vertical gradients). */
  quadC(x1, y1, x2, y2, x3, y3, x4, y4, c1, a1, c2, a2) { this.quadA(x1, y1, c1, a1, x2, y2, c1, a1, x3, y3, c2, a2, x4, y4, c2, a2); }
  /** Quad with a color/alpha per corner (diagonal sheens). Corners: 1 top-left, 2 top-right, 3 bottom-left, 4 bottom-right. */
  quadA(x1, y1, c1, a1, x2, y2, c2, a2, x3, y3, c3, a3, x4, y4, c4, a4) {
    this.grow(6); const V = (x, y, c, a) => this.v(x, y, c[0], c[1], c[2], a, 0, 0);
    V(x1, y1, c1, a1); V(x2, y2, c2, a2); V(x3, y3, c3, a3); V(x3, y3, c3, a3); V(x2, y2, c2, a2); V(x4, y4, c4, a4);
  }
  tri(x1, y1, x2, y2, x3, y3, c, a) { this.grow(3); const [r, g, b] = c; this.v(x1, y1, r, g, b, a, 0, 0); this.v(x2, y2, r, g, b, a, 0, 0); this.v(x3, y3, r, g, b, a, 0, 0); }
  /** Enables exactly these vertex arrays (and instancing divisors); everything else is switched off so no stale array or divisor leaks into a draw. */
  attribs(list) {
    const gl = this.gl;
    for (const l of this.on) gl.disableVertexAttribArray(l); for (const l of this.divs) this.inst?.div(l, 0); this.on.clear(); this.divs.clear();
    for (const [loc, buf, size, stride, off, div] of list) {
      if (loc == null || loc < 0) continue; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
      if (div) { this.inst.div(loc, div); this.divs.add(loc); } this.on.add(loc);
    }
  }
  /** Draws the batch: additive glow (default) or over = premultiplied "paint on top" (solid shapes). */
  flush(over = false) {
    const gl = this.gl; if (!this.n) return; const P = over ? this.softOver : this.soft; gl.useProgram(P.p); gl.enable(gl.BLEND);
    if (over) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.n * 8), gl.STREAM_DRAW);
    this.attribs([[P.at.a_pos, this.buf, 2, 32, 0], [P.at.a_col, this.buf, 4, 32, 8], [P.at.a_uv, this.buf, 2, 32, 24]]);
    gl.uniform2f(P.u.u_res, this.w, this.h); gl.uniform2f(P.u.u_shake, this.shake[0], this.shake[1]); gl.uniform1f(P.u.u_zoom, this.zoom);
    gl.drawArrays(gl.TRIANGLES, 0, this.n); this.n = 0;
  }
  quadDraw(prog) { this.attribs([[prog.at.a_p, this.qbuf, 2, 8, 0]]); this.gl.drawArrays(this.gl.TRIANGLES, 0, 6); }
  /** Darken what was drawn before by `keep` (0 = clear, 0.9 = long trails): motion blur without a second buffer. */
  fade(keep, bg = [0.02, 0.025, 0.035]) {
    const gl = this.gl; gl.useProgram(this.fadeP.p); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform4f(this.fadeP.u.u_col, bg[0], bg[1], bg[2], Math.min(1, Math.max(0.02, 1 - keep))); this.quadDraw(this.fadeP);
  }
  glow(cx, cy, r, c, i) {
    if (i <= 0.003) return; const gl = this.gl; gl.useProgram(this.glowP.p); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform2f(this.glowP.u.u_res, this.w, this.h); gl.uniform2f(this.glowP.u.u_c, cx + this.shake[0], cy + this.shake[1]); gl.uniform1f(this.glowP.u.u_r, Math.max(1, r)); gl.uniform3f(this.glowP.u.u_col, c[0], c[1], c[2]); gl.uniform1f(this.glowP.u.u_i, i); this.quadDraw(this.glowP);
  }
  cone(u) {
    const gl = this.gl; if (!this.coneP) this.coneP = program(gl, QVS, CONE, ['a_p']); const P = this.coneP; gl.useProgram(P.p); gl.disable(gl.BLEND);
    gl.uniform2f(P.u.u_res, this.w, this.h); gl.uniform2f(P.u.u_shake ?? null, this.shake[0], -this.shake[1]); for (const k of ['u_t', 'u_exc', 'u_glow', 'u_level', 'u_flash', 'u_idle']) gl.uniform1f(P.u[k] ?? null, u[k]);
    gl.uniform3fv(P.u.u_p ?? null, u.u_p); gl.uniform3fv(P.u.u_s ?? null, u.u_s); gl.uniform3fv(P.u.u_a ?? null, u.u_a); gl.uniform4fv(P.u.u_rip ?? null, u.u_rip); this.quadDraw(P);
  }
  /** A texture from a canvas (re-uploads into `tex` when given). */
  texture(canvas, tex = null) {
    const gl = this.gl; tex = tex || gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return tex;
  }
  freeTexture(tex) { try { if (tex) this.gl.deleteTexture(tex); } catch { /* lost */ } }
  image(tex, x, y, w, h, a = 1) {
    const gl = this.gl, P = this.imgP; gl.useProgram(P.p); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(P.u.u_tex, 0);
    setU(gl, P, { u_rect: [x + this.shake[0], y + this.shake[1], w, h], u_res: [this.w, this.h], u_a: a }); this.quadDraw(P);
  }
  /** Shared per-instance random seeds (vec4 each), grown on demand; every particle system reads the first n. */
  ensureSeeds(n) {
    if (this.seedBuf && this.seedN >= n) return; const gl = this.gl, N = Math.max(n, 4096), r = rng(1234567), d = new Float32Array(N * 4);
    for (let i = 0; i < d.length; i++) d[i] = r();
    if (!this.seedBuf) this.seedBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuf); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW); this.seedN = N;
  }
  instanced(P, n, u) {
    const gl = this.gl; if (!this.inst || n <= 0) return; this.ensureSeeds(n); gl.useProgram(P.p); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    setU(gl, P, { u_res: [this.w, this.h], u_shake: this.shake, u_zoom: this.zoom, ...u });
    this.attribs([[P.at.a_corner, this.cornerBuf, 2, 8, 0, 0], [P.at.a_seed, this.seedBuf, 4, 16, 0, 1]]);
    this.inst.draw(gl.TRIANGLE_STRIP, 0, 4, n);
  }
  /** GPU starfield / tunnel streaks (see STAR_VS). */
  stars(n, u) { if (!this.starP) this.starP = program(this.gl, STAR_VS, FS, ['a_corner', 'a_seed']); this.instanced(this.starP, n, u); }
  /** One GPU spark burst (see BURST_VS). */
  burst(n, u) { if (!this.burstP) this.burstP = program(this.gl, BURST_VS, FS, ['a_corner', 'a_seed']); this.instanced(this.burstP, n, u); }
}

/** The page's single WebGL context. Lost -> wait up to 3 s for the browser to restore it, then build a fresh one (at most 4 tries a minute, then 2D). */
const shared = { g: null, gen: 0, lostAt: 0, failed: false, tries: [], error: '', losses: 0 };
export function sharedGL() {
  if (shared.failed) return null;
  if (shared.g) { if (!shared.g.lost()) return shared.g; if (performance.now() - shared.lostAt < 3000) return null; shared.g = null; }
  const now = performance.now(); shared.tries = shared.tries.filter(t => now - t < 60000);
  if (shared.tries.length >= 4) { shared.failed = true; shared.error = 'the graphics chip kept resetting'; return null; }
  shared.tries.push(now);
  try {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    c.addEventListener('webglcontextlost', e => { e.preventDefault(); shared.lostAt = performance.now(); shared.losses++; });
    c.addEventListener('webglcontextrestored', () => { try { if (shared.g?.c === c) { shared.g.init(); shared.gen++; } } catch { shared.g = null; } });
    shared.g = new GL(c, { forceV1: forceWebGL1() }); shared.gen++; return shared.g;
  } catch (e) { shared.failed = true; shared.error = e.message || String(e); shared.g = null; return null; }
}
export const sharedGen = () => shared.gen;
export const sharedInfo = () => ({ gen: shared.gen, failed: shared.failed, error: shared.error, lost: !!shared.g?.lost(), losses: shared.losses, webgl2: !!shared.g?.v2, hdr: shared.g?.hdrFmt?.name || null, instancing: !!shared.g?.inst, renderer: shared.g?.renderer || '' });
/** Tests / Diagnostics: simulate the browser taking the context away (and, after restoreMs, giving it back). */
export function loseSharedForTest(restoreMs = 0) { try { const e = shared.g?.gl.getExtension('WEBGL_lose_context'); e?.loseContext(); if (restoreMs > 0) setTimeout(() => { try { e?.restoreContext(); } catch { /* ignore */ } }, restoreMs); } catch { /* ignore */ } }

export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE = [1, 1, 1];

/** Kick / snare spark bursts drawn entirely on the GPU (one instanced draw per live burst). */
export class Bursts {
  constructor(max = 10) { this.list = []; this.max = max; this.k = 0; }
  emit(x, y, strength = 1) { this.k++; this.list.push({ x, y, age: 0, s: strength, seed: (this.k * 0.7548776) % 1 * 977 }); if (this.list.length > this.max) this.list.shift(); }
  step(ds, life) { this.list = this.list.filter(b => (b.age += ds) < life * 1.4); }
  draw(g, n, P, { speed, drag = 0.9, life = 0.65, size = 2 }) { for (const b of this.list) g.burst(n, { u_b: [b.x, b.y, b.age, b.s], u_bseed: b.seed, u_speed: speed, u_drag: drag, u_life: life, u_size: size, u_p: P.p, u_s: P.s, u_a: P.a }); }
}

/** Base class: owns the GL wrapper, palette, quality and camera shake. */
class Scene {
  constructor(gl, opts) { this.g = gl; this.preview = !!opts.preview; this.q = opts.q || QUALITY.high; this.light = isLight(this.q.tier); this.settings = opts.settings; this.fx = this.settings.fx || {}; this.theme = opts.theme || {}; this.r = rng(opts.seed || 7); this.t = 0; this.pal = palette(this.settings, this.theme); }
  configure({ settings, theme, q }) { if (settings) { this.settings = settings; this.fx = settings.fx || {}; } if (theme) this.theme = theme; if (q) { this.q = q; this.light = isLight(q.tier); } this.pal = palette(this.settings, this.theme); this.rebuild?.(); }
  fxv(k, d = 1) { const v = this.fx[k]; return Number.isFinite(v) ? v : d; }
  /** 0.1.3: Camera shake is a 0-100 % level (raw 0..1.4) instead of on/off. */
  cam(f) { const s = this.settings, k = !this.preview ? f.shake * s.intensity * (Number(s.shake) || 0) : 0, m = Math.min(this.g.w, this.g.h) * 0.018 * k; return [(Math.random() - 0.5) * m * 2, (Math.random() - 0.5) * m * 2, 1 + 0.035 * f.flash * s.intensity]; }
  /** How many GPU particles: base x quality x density (previews stay small). */
  gpuCount(base, previewBase) { return Math.max(300, Math.round(this.preview ? previewBase : base * this.q.particles * Math.max(0.25, this.settings.density))); }
  /** Depth-blur mask for the post pass (null = none). */
  depthMask() { return null; }
  dispose() { }
}
/** Particle burst: true 3D warp starfield (perspective, z-depth, streaks that grow as they approach), radial shockwave bursts on kicks. */
export class WarpScene extends Scene {
  constructor(gl, opts) { super(gl, opts); this.dist = 0; this.bursts = new Bursts(8); this.rebuild(); this.rings = []; this.sparks = []; }
  rebuild() {
    // 0.1.3: GPU instanced stars (about 26 000 on High, 68 000 on Ultra, 8 000 on Low); the CPU field stays as the no-instancing fallback
    this.gpu = !!this.g.inst;
    if (this.gpu) { this.n = this.gpuCount(26000, 1500); this.nb = this.gpuCount(2600, 300); return; }
    const n = particleCount(this.preview ? 900 : this.light ? 2600 : 4200, this.settings.density, this.light && !this.preview);
    if (this.n === n && this.x) return; this.n = n;
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n); this.sp = new Float32Array(n); this.hue = new Float32Array(n); this.sz = new Float32Array(n);
    for (let i = 0; i < n; i++) this.spawn(i, this.r());
  }
  spawn(i, z = 1) {
    const asp = Math.max(1, this.g.w / Math.max(1, this.g.h)), a = this.r() * Math.PI * 2, rr = 0.06 + Math.sqrt(this.r()) * 1.1;
    this.x[i] = Math.cos(a) * rr * asp * 0.9; this.y[i] = Math.sin(a) * rr * 0.9; this.z[i] = 0.15 + z * 0.85; this.sp[i] = 0.6 + this.r() * 0.8; this.sz[i] = 0.6 + this.r() * 1.2;
    const side = this.x[i] / (asp * 0.9); this.hue[i] = this.r() < 0.07 ? 2 : Math.min(1, Math.max(0, 0.5 + side * 1.6 + (this.r() - 0.5) * 0.5));
  }
  draw(dt, f) {
    const g = this.g, s = this.settings, P = this.pal, w = g.w, h = g.h, cx = w / 2, cy = h / 2, I = s.intensity, ds = dt / 1000; this.t += ds;
    const [sx, sy, zoom] = this.cam(f); g.begin(sx, sy, zoom);
    const trail = this.fxv('trail', 0.5) * this.q.trails, warp = this.fxv('warp', 1);
    g.fade(Math.min(0.95, (f.idle ? 0.4 : 0.47 + 0.18 * Math.min(1, f.surge + f.bass)) + trail * 0.3));
    const speed = (f.idle ? 0.07 : 0.18 + f.bass * 1.1 * I + f.surge * 2.0 * I + f.energy * 0.3) * s.speed * warp;
    const focal = h * 0.5, streak = Math.min(0.45, (0.01 + speed * 0.12 * (1 + f.surge)) * (0.4 + trail * 1.2));
    const pxs = Math.max(1, h / 260), bright = f.idle ? 0.5 : 0.6 + 0.6 * f.energy * I;
    this.dist += speed * ds;
    if (this.gpu) {
      const k = Math.min(1, Math.pow(4200 / this.n, 0.32)), asp = Math.max(1, w / Math.max(1, h));
      g.stars(this.n, { u_mode: 0, u_dist: this.dist, u_streak: streak, u_size: pxs * Math.max(0.6, Math.pow(4200 / this.n, 0.22)), u_bright: bright * Math.max(0.5, k), u_asp: asp, u_time: this.t, u_high: f.high > 0.25 ? f.high * I : 0, u_energy: f.energy, u_R: 0, u_p: P.p, u_s: P.s, u_a: P.a });
    } else
    for (let i = 0; i < this.n; i++) {
      let z = this.z[i] - speed * this.sp[i] * ds;
      if (z <= 0.03) { this.spawn(i, 1); z = this.z[i]; }
      this.z[i] = z;
      const x = this.x[i], y = this.y[i], hx = cx + x / z * focal, hy = cy + y / z * focal;
      if (hx < -50 || hx > w + 50 || hy < -50 || hy > h + 50) { this.spawn(i, 1); continue; }
      const zt = z + streak * this.sp[i], tx = cx + x / zt * focal, ty = cy + y / zt * focal;
      const near = Math.min(1, Math.max(0, 1 - z)), size = (0.5 + near * near * 3.2 * this.sz[i]) * pxs;
      const hu = this.hue[i], col = hu > 1.5 ? mixc(P.a, WHITE, 0.4) : mixc(P.p, P.s, hu);
      let a = Math.min(1, (0.15 + near * 1.1) * bright);
      if (f.high > 0.25 && this.r() < f.high * 0.012 * I) a = 1.6;              // sparkle on the highs
      g.line(tx, ty, hx, hy, size, col, a, 0.05);
      if (near > 0.55) g.sprite(hx, hy, size * 1.8, col, a * 0.35);
    }
    // shockwave burst on kicks: an expanding ring + radial sparks
    if (f.kick && !f.idle && this.gpu) { this.rings.push({ r: Math.min(w, h) * 0.04, life: 1 }); this.bursts.emit(cx, cy, 0.7 + f.bass * 0.6); }
    else if (f.kick && !f.idle) {
      this.rings.push({ r: Math.min(w, h) * 0.04, life: 1 });
      const ns = Math.round((this.preview ? 40 : this.light ? 110 : 220) * s.density);
      for (let i = 0; i < ns; i++) { const a = this.r() * Math.PI * 2, v = (0.4 + this.r() * 1.2) * Math.min(w, h) * (0.9 + f.bass); this.sparks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c: this.r() < 0.5 ? 0 : 1 }); }
      if (this.sparks.length > 3000) this.sparks.splice(0, this.sparks.length - 3000);
    }
    const rr = Math.min(w, h);
    this.rings = this.rings.filter(q => (q.life -= ds * 1.4) > 0);
    for (const q of this.rings) {
      q.r += rr * 1.5 * ds * (1 + q.life); const seg = 72, col = mixc(P.p, P.a, 0.35), wd = (2 + 7 * q.life) * pxs, a = q.life * 0.9 * I;
      for (let k = 0; k < seg; k++) { const a1 = k / seg * Math.PI * 2, a2 = (k + 1) / seg * Math.PI * 2, ex = 1.6; g.line(cx + Math.cos(a1) * q.r * ex, cy + Math.sin(a1) * q.r, cx + Math.cos(a2) * q.r * ex, cy + Math.sin(a2) * q.r, wd, k < seg / 4 || k > seg * 3 / 4 ? P.s : col, a, 1); }
    }
    this.sparks = this.sparks.filter(q => (q.life -= ds * 1.6) > 0);
    for (const q of this.sparks) { q.x += q.vx * ds; q.y += q.vy * ds; q.vx *= 0.985; q.vy *= 0.985; const c = q.c ? P.s : P.p; g.line(q.x - q.vx * 0.05, q.y - q.vy * 0.05, q.x, q.y, 2.2 * pxs, c, q.life, 0.02); }
    g.flush();
    if (this.gpu) { this.bursts.step(ds, 0.65); this.bursts.draw(g, this.nb, P, { speed: Math.min(w, h) * 1.1, drag: 0.9, life: 0.65, size: 2.2 * pxs }); }
    // core glow (breathes when idle) + bloom flash on kicks
    const breath = f.idle ? 0.22 + 0.1 * Math.sin(this.t * 1.6) : 0.25 + 0.5 * f.energy;
    g.glow(cx, cy, rr * (0.22 + 0.25 * f.flash), mixc(P.p, WHITE, 0.25), breath * I * 0.9);
    g.glow(cx + rr * 0.25, cy, rr * 0.3, P.s, breath * 0.35 * I);
    g.glow(cx, cy, Math.max(w, h) * 0.7, mixc(P.p, P.a, 0.5), f.flash * 0.45 * I);
  }
}

/** Waveform river: layered translucent ribbons flowing across, played portion bright (primary), the rest in secondary, glowing position marker. */
export class RiverScene extends Scene {
  constructor(gl, opts) { super(gl, opts); this.phase = 0; this.pulses = []; this.progress = null; }
  draw(dt, f) {
    const g = this.g, s = this.settings, P = this.pal, w = g.w, h = g.h, cy = h * 0.5, I = s.intensity, ds = dt / 1000; this.t += ds;
    const [sx, sy, zoom] = this.cam(f); g.begin(sx, sy, zoom); g.fade(0.5);
    this.phase += ds * (f.idle ? 0.35 : 0.6 + f.bass * 2.2 * I + f.surge * 2) * s.speed;
    const mx = (this.progress == null ? 0.5 : Math.min(0.98, Math.max(0.02, this.progress))) * w;
    if (f.kick && !f.idle) this.pulses.push({ d: 0, life: 1, amp: 0.6 + f.bass });
    this.pulses = this.pulses.filter(q => (q.life -= ds * 0.9) > 0); for (const q of this.pulses) q.d += w * 0.7 * ds;
    const layers = Math.max(3, Math.round((this.preview ? 6 : 9) * s.density * this.fxv('layers', 1))), N = this.preview ? 70 : this.light ? 110 : 170;
    // 0.0.8 color-shift sweep: a soft primary/secondary blend that sweeps left and right across the ribbons (speed slider; 0 = still split at the marker)
    this.sweepT = (this.sweepT || 0) + ds * this.fxv('sweep', 1) * (0.6 + f.energy * 0.8);
    const sweepOn = this.fxv('sweep', 1) > 0.01, sweepX = mx + Math.sin(this.sweepT * 1.3) * w * 0.22, soft = w * 0.12;
    const amp0 = h * (f.idle ? 0.16 : 0.2 + 0.4 * Math.min(1, f.energy * 1.4 + f.beat * 0.3) * I), pxs = Math.max(1, h / 300);
    const bands = f.bands, wave = f.wave;
    for (let L = 0; L < layers; L++) {
      const depth = L / Math.max(1, layers - 1), sc = persp((1 - depth) * 1.2, 1.6), yo = cy + (depth - 0.5) * h * 0.08;     // far layers smaller and higher
      const ph = this.phase * (0.7 + depth * 0.6) + L * 1.7, k1 = 1.6 + L * 0.37, k2 = 3.1 + L * 0.53, b1 = bands[2 + (L % 5)] || 0, b2 = bands[14 + L * 2] || 0;
      let px = 0, pu = yo, pl = yo;
      for (let i = 0; i <= N; i++) {
        const u = i / N, x = u * w, env = Math.pow(Math.sin(Math.PI * u), 0.8);
        let bulge = 1; for (const q of this.pulses) { const dd = Math.abs(x - mx) - q.d; bulge += q.amp * q.life * Math.exp(-dd * dd / (w * w * 0.004)) * I; }
        const wv = wave[Math.min(255, (u * 255) | 0)] || 0;
        const a = amp0 * sc * env * bulge * (0.55 * Math.sin(u * k1 * Math.PI * 2 - ph) * (0.6 + b1) + 0.3 * Math.sin(u * k2 * Math.PI * 2 + ph * 1.3) * (0.4 + b2) + 0.35 * wv);
        const yu = yo - a, yl = yo + a * 0.55;
        if (i) {
          const played = x <= mx, edge = sweepOn ? sweepX : mx, tt = Math.min(1, Math.max(0, (x - edge + soft) / (2 * soft))), col = sweepOn ? mixc(P.p, P.s, tt * tt * (3 - 2 * tt)) : (played ? P.p : P.s), br = (played ? 1 : 0.6) * (0.35 + 0.65 * sc) * (f.idle ? 0.6 : 1);
          g.quad(px, pu, x, yu, px, pl, x, yl, col, 0.035 * br, 0.02 * br);
          g.line(px, pu, x, yu, (1.4 + 1.6 * sc) * pxs, col, 0.75 * br, 1);
          g.line(px, pl, x, yl, (1 + 1.2 * sc) * pxs, col, 0.4 * br, 1);
        }
        px = x; pu = yu; pl = yl;
      }
    }
    // playback marker with glow and the little triangles of the mockup
    const mcol = mixc(P.p, WHITE, 0.25), top = h * 0.12, bot = h * 0.88, tw = h * 0.035;
    g.line(mx, top, mx, bot, 3 * pxs, mcol, 1, 1); g.line(mx, top, mx, bot, 14 * pxs, P.p, 0.25 + 0.4 * f.flash, 1);
    g.tri(mx - tw, top - tw * 1.4, mx + tw, top - tw * 1.4, mx, top, P.p, 1); g.tri(mx - tw, bot + tw * 1.4, mx + tw, bot + tw * 1.4, mx, bot, P.p, 1);
    if (f.high > 0.3 && !f.idle) for (let i = 0; i < 6 * I; i++) g.sprite(mx + (this.r() - 0.5) * w * 0.5, cy + (this.r() - 0.5) * h * 0.4, 2 * pxs, this.r() < 0.5 ? P.a : P.s, f.high);
    g.flush();
    g.glow(mx, cy, h * (0.35 + 0.3 * f.flash), P.p, (0.18 + 0.6 * f.flash) * I);
    g.glow(w * 0.5, cy, w * 0.6, mixc(P.p, P.s, 0.5), f.flash * 0.25 * I);
  }
}

/** Speaker cone: a woofer drawn in a fragment shader; the cone flexes with the bass, shockwave ripples expand on beats. */
export class ConeScene extends Scene {
  constructor(gl, opts) { super(gl, opts); this.rips = []; this.exc = 0; this.vel = 0; this.rip = new Float32Array(24); }
  draw(dt, f) {
    const g = this.g, s = this.settings, P = this.pal, I = s.intensity, ds = dt / 1000; this.t += ds;
    const [sx, sy] = this.cam(f); g.begin(sx, sy, 1);
    const flex = this.fxv('flex', 1), ripple = this.fxv('ripple', 1);
    const target = f.idle ? 0.15 * Math.sin(this.t * 2.2) : Math.min(2.4, (f.bass * 1.6 + f.surge * 1.0 + f.beat * 0.4) * I * flex) * (0.75 + 0.25 * Math.sin(this.t * 40 * s.speed));
    this.vel += (target - this.exc) * 0.5; this.vel *= 0.55; this.exc += this.vel;                     // a springy cone, not a jumpy one
    if (f.kick && !f.idle) this.rips.push({ r: 0.37, life: 1 });
    if (this.rips.length > 6) this.rips.shift();
    this.rips = this.rips.filter(q => (q.life -= ds * 0.7 / Math.max(0.5, s.speed) / ripple) > 0);
    this.rip.fill(0); this.rips.forEach((q, i) => { q.r += ds * (0.45 + 0.3 * q.life) * s.speed * ripple; this.rip[i * 4] = q.r; this.rip[i * 4 + 1] = q.life * I; });
    g.cone({ u_t: this.t * s.speed, u_exc: this.exc, u_glow: f.idle ? 0.15 + 0.1 * Math.sin(this.t * 1.5) : 0.25 + f.flash * I + f.bass * 0.4, u_level: Math.min(1, f.energy * 1.2 * I), u_flash: f.flash * I, u_idle: f.idle ? 1 : 0,
      u_p: P.p, u_s: P.s, u_a: P.a, u_rip: this.rip });
    // dust in the air on the highs, drawn on top
    if (!f.idle && f.high > 0.2) { const h = g.h, w = g.w; for (let i = 0; i < 30 * s.density; i++) { const a = this.r() * Math.PI * 2, rr = h * (0.42 + this.r() * 0.5); g.sprite(w / 2 + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr, 1.6 * Math.max(1, h / 300), this.r() < 0.6 ? P.s : P.a, f.high * 0.8); } g.flush(); }
  }
}

/** Ring: a 3D spectrum ring that wobbles in depth; bars extrude toward the viewer, shockwave rings fly out of the screen on kicks. */
export class RingScene extends Scene {
  constructor(gl, opts) { super(gl, opts); this.rings = []; this.sparks = []; this.rot = 0; }
  /** 0.1.3 depth blur: sharp on the ring, softer away from it. */
  depthMask() { return { mode: 2, a: 0.3, b: 0.3 }; }
  draw(dt, f) {
    const g = this.g, s = this.settings, P = this.pal, w = g.w, h = g.h, cx = w / 2, cy = h / 2, I = s.intensity, ds = dt / 1000; this.t += ds;
    const [sx, sy, zoom] = this.cam(f); g.begin(sx, sy, zoom); g.fade(0.6 + 0.15 * f.energy);
    const spin = this.fxv('spin', 1), thick = this.fxv('thick', 1);
    this.rot += ds * (0.15 + f.bass * 0.8 * I + f.surge) * s.speed * spin;
    const tiltX = 0.45 + 0.12 * Math.sin(this.t * 0.4), tiltY = 0.25 * Math.sin(this.t * 0.27), R = h * 0.3 * (1 + 0.08 * f.flash), pxs = Math.max(1, h / 300);
    const cX = Math.cos(tiltX), sX = Math.sin(tiltX), cY = Math.cos(tiltY), sY = Math.sin(tiltY), F = 2.2;
    const proj = (x, y, z) => { let y1 = y * cX - z * sX, z1 = y * sX + z * cX; const x2 = x * cY + z1 * sY, z2 = -x * sY + z1 * cY; const k = persp(z2, F); return [cx + x2 * k * R, cy + y1 * k * R, k]; };
    const bars = Math.max(24, Math.round((this.preview ? 48 : this.q.tier === 'ultra' ? 144 : this.light ? 72 : 96) * Math.min(1.5, s.density)));
    for (let i = 0; i < bars; i++) {
      const a = i / bars * Math.PI * 2 + this.rot, bi = Math.floor((i < bars / 2 ? i : bars - i) / (bars / 2) * 52), v = f.bands[bi] || 0;
      const len = (f.idle ? 0.04 + 0.03 * Math.sin(this.t * 2 + i * 0.3) : 0.05 + v * 0.75 * I);
      const c = Math.cos(a), sn = Math.sin(a);
      const [x1, y1, k1] = proj(c, sn, 0), [x2, y2, k2] = proj(c * (1 + len * 0.6), sn * (1 + len * 0.6), -len * 0.9);     // toward the viewer
      const col = mixc(P.p, P.s, (1 - c) / 2); const a1 = (0.45 + 0.55 * v) * (f.idle ? 0.6 : 1);
      g.line(x1, y1, x2, y2, (2.2 + 4 * v) * pxs * (k1 + k2) / 2 * thick, col, Math.min(1, a1 + 0.2), 0.4);
      const pk = f.peaks ? f.peaks[bi] : 0; if (!f.idle && pk > 0.08) { const [px, py, pk3] = proj(c * (1 + (0.05 + pk * 0.75 * I) * 0.6), sn * (1 + (0.05 + pk * 0.75 * I) * 0.6), -(0.05 + pk * 0.75 * I) * 0.9); g.sprite(px, py, (2 + 2 * thick) * pxs * pk3, mixc(col, WHITE, 0.5), 0.9); }     // peak caps
      if (v > 0.55 && f.high > 0.2 && this.r() < 0.08 * I) this.sparks.push({ x: x2, y: y2, vx: (x2 - cx) * 1.5, vy: (y2 - cy) * 1.5, life: 1, c: col });
    }
    // inner oscilloscope ring from the waveform
    const seg = this.preview ? 64 : 128; let pp = null;
    for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2 + this.rot * 0.5, wv = f.wave[(i % seg) * 2] || 0, rr = 0.62 + wv * 0.35 * I; const q = proj(Math.cos(a) * rr, Math.sin(a) * rr, 0.05); if (pp) g.line(pp[0], pp[1], q[0], q[1], 2 * pxs, mixc(P.a, P.p, 0.4), 0.7, 1); pp = q; }
    if (f.kick && !f.idle) this.rings.push({ r: 1, z: 0, life: 1 });
    this.rings = this.rings.filter(q => (q.life -= ds * 1.2) > 0);
    for (const q of this.rings) { q.r += ds * 1.6; q.z -= ds * 1.3; let p0 = null; for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2, p = proj(Math.cos(a) * q.r, Math.sin(a) * q.r, q.z); if (p0) g.line(p0[0], p0[1], p[0], p[1], (2 + 6 * q.life) * pxs * p[2], i < 32 ? P.p : P.s, q.life * 0.8 * I, 1); p0 = p; } }
    this.sparks = this.sparks.filter(q => (q.life -= ds * 1.5) > 0); if (this.sparks.length > 800) this.sparks.splice(0, 200);
    for (const q of this.sparks) { q.x += q.vx * ds; q.y += q.vy * ds; g.line(q.x - q.vx * 0.04, q.y - q.vy * 0.04, q.x, q.y, 2 * pxs, q.c, q.life, 0.05); }
    g.flush();
    g.glow(cx, cy, R * (0.9 + 0.4 * f.flash), mixc(P.p, P.s, 0.5), (f.idle ? 0.12 : 0.18 + 0.5 * f.energy) * I);
    g.glow(cx, cy, Math.max(w, h) * 0.6, P.a, f.flash * 0.3 * I);
  }
}

/** 0.0.8 Neon tunnel: fly through glowing rings (alternating primary / secondary); the tunnel bends, rings brighten with the spectrum, every kick
 * launches an extra bright ring toward the viewer; radial light streaks rush past. */
export class TunnelScene extends Scene {
  constructor(gl, opts) { super(gl, opts); this.dist = 0; this.sdist = 0; this.boosts = []; this.bursts = new Bursts(6); this.rebuild(); this.streaks = []; for (let i = 0; i < 160; i++) this.streaks.push({ a: this.r() * Math.PI * 2, d: this.r(), s: 0.4 + this.r() * 1.2, c: this.r() }); }
  /** 0.1.3: thousands of GPU light streaks (about 9 000 on High, 23 000 on Ultra, 2 900 on Low) instead of 160 drawn on the CPU. */
  rebuild() { this.gpu = !!this.g.inst; this.ns = this.gpuCount(9000, 600); this.nb = this.gpuCount(1600, 200); }
  draw(dt, f) {
    const g = this.g, s = this.settings, P = this.pal, w = g.w, h = g.h, cx = w / 2, cy = h / 2, I = s.intensity, ds = dt / 1000; this.t += ds;
    const [sx, sy, zoom] = this.cam(f); g.begin(sx, sy, zoom); g.fade(f.idle ? 0.25 : 0.28 + 0.12 * f.energy);   // short trails: crisp rings on a dark tunnel
    const fly = this.fxv('fly', 1), twist = this.fxv('twist', 0.25), count = Math.max(6, Math.round((this.preview ? 14 : 24) * this.fxv('rings', 1)));
    const speed = (f.idle ? 0.35 : 0.7 + f.bass * 2.6 * I + f.surge * 3 * I) * s.speed * fly; this.dist += speed * ds;
    const R = Math.min(w * 0.42, h * 0.62), pxs = Math.max(1, h / 300), seg = this.preview ? 40 : this.light ? 64 : 96;
    const off = z => { const k = Math.min(1, z / count) * twist; return [Math.sin(this.t * 0.6 + z * 0.22) * w * 0.16 * k, Math.cos(this.t * 0.45 + z * 0.19) * h * 0.14 * k]; };
    const rad = z => R * 0.95 / (z * 0.45 + 0.12);
    // streaks of light rushing outward (behind the rings)
    if (this.gpu) {
      this.sdist += ds * speed * 0.35;
      g.stars(this.ns, { u_mode: 1, u_dist: this.sdist, u_streak: 0, u_size: 1.4 * pxs, u_bright: (f.idle ? 0.5 : 1) * Math.max(0.35, Math.pow(160 / this.ns, 0.22)), u_asp: 1, u_time: this.t, u_high: 0, u_energy: f.energy, u_R: R, u_p: P.p, u_s: P.s, u_a: P.a });
    } else
    for (const q of this.streaks) {
      q.d += ds * q.s * speed * 0.35; if (q.d > 1) { q.d = 0; q.a = this.r() * Math.PI * 2; }
      const r1 = R * 0.08 + q.d * q.d * Math.max(w, h) * 0.7, r2 = r1 + (8 + q.d * 60 * (0.5 + f.energy)) * pxs, ca = Math.cos(q.a), sa = Math.sin(q.a);
      g.line(cx + ca * r1 * 1.3, cy + sa * r1, cx + ca * r2 * 1.3, cy + sa * r2, 1.4 * pxs, q.c < 0.5 ? P.s : mixc(P.a, P.p, 0.5), (0.15 + 0.5 * q.d) * (f.idle ? 0.5 : 1), 0.1);
    }
    const ring = (z, col, a, wd) => {
      const r = rad(z), [ox, oy] = off(z), rx = r * 1.28, ry = r; if (rx > Math.max(w, h) * 2.2) return;
      let px = cx + ox + rx, py = cy + oy;
      for (let i = 1; i <= seg; i++) { const t = i / seg * Math.PI * 2, x = cx + ox + Math.cos(t) * rx, y = cy + oy + Math.sin(t) * ry; g.line(px, py, x, y, wd * 4.2, col, a * 0.3, 1); g.line(px, py, x, y, wd, mixc(col, WHITE, 0.12), a, 1); px = x; py = y; }
    };
    const n0 = Math.floor(this.dist) + 1;
    for (let n = n0 + count; n >= n0; n--) {
      const z = n - this.dist; if (z < 0.12) continue;
      const b = f.bands[(n * 7) % 48] || 0, depthFade = Math.pow(1 - Math.min(1, z / (count + 1)), 0.8);
      const a = depthFade * (f.idle ? 0.45 : 0.45 + 0.8 * b * I + 0.35 * f.flash) * (z < 0.6 ? z / 0.6 : 1);
      ring(z, n % 2 ? P.p : P.s, Math.min(1.3, a), (1.2 + 3.5 / (z + 0.4)) * pxs * (0.7 + b * 0.8));
    }
    if (f.kick && !f.idle) { this.boosts.push({ z: count, life: 1 }); if (this.gpu) this.bursts.emit(cx, cy, 0.45 + f.bass * 0.4); }
    this.boosts = this.boosts.filter(q => (q.z -= ds * speed * 3) > 0.15 && (q.life -= ds * 0.35) > 0);
    for (const q of this.boosts) ring(q.z, mixc(P.p, P.a, 0.5), Math.min(1.4, 1.1 * q.life * I), (2.5 + 6 / (q.z + 0.4)) * pxs);
    g.flush();
    if (this.gpu) { this.bursts.step(ds, 0.9); this.bursts.draw(g, this.nb, P, { speed: Math.max(w, h) * 0.9, drag: 0.4, life: 0.9, size: 1.8 * pxs }); }
    // the vanishing point stays dark (no white blob); only a faint colored breath and a soft flash on big hits
    g.glow(cx, cy, R * 0.25, mixc(P.p, P.s, 0.5), (f.idle ? 0.03 : 0.04 + 0.08 * f.energy) * I);
    g.glow(cx, cy, Math.max(w, h) * 0.7, P.a, f.flash * 0.1 * I);
  }
}

/** 0.1.3 Terrain: SOLID landscapes painted far-to-near with opaque fills (0.1.2 summed translucent additive fills, which washed out to white, and
 * left the space below the nearest ridge empty). Each ridge fills down to the next nearer row's ground line (the nearest one to the bottom edge),
 * valleys are shaded dark, crests lit, the far rows fade into a colored haze; starry sky and soft nebulae above the horizon; depth blur on the distance. */
export class TerrainScene extends Scene {
  constructor(gl, opts) { super(gl, opts); this.scroll = 0; this.seed = 0; this.stars = null; this.rebuild(); }
  depthMask() { return { mode: 1, a: 0.18, b: 0.6 }; }
  rebuild() {
    const gd = this.fxv('grid', 1.35), tier = this.preview ? 0.5 : this.q.tier === 'ultra' ? 1.35 : this.light ? 0.78 : 1;
    const nr = Math.max(12, Math.round(36 * tier * gd / 1.35)), nc = Math.max(25, Math.round(64 * tier * gd / 1.35)) | 1;
    if (this.nr === nr && this.nc === nc && this.rows) return; this.nr = nr; this.nc = nc;
    this.rows = []; for (let i = 0; i < nr; i++) this.rows.push(this.makeRow(null));
    const n = this.preview ? 40 : this.light ? 80 : 140; this.stars = [];
    for (let i = 0; i < n; i++) this.stars.push({ x: this.r(), y: this.r() * 0.38, s: 0.4 + this.r() * 1.4, a: 0.35 + this.r() * 0.65 });
  }
  /** Vibrant left-to-right flow (purple / magenta -> cyan -> amber), tinted by the theme. */
  flow(u, P) {
    const t = (u + 1) * 0.5;
    const purple = mixc([0.52, 0.16, 0.82], P.p, 0.28), magenta = mixc([0.88, 0.22, 0.62], P.p, 0.22), cyan = mixc([0.06, 0.82, 0.78], P.s, 0.35), amber = mixc([0.95, 0.48, 0.12], P.p, 0.25);
    if (t < 0.28) return mixc(purple, magenta, t / 0.28);
    if (t < 0.55) return mixc(magenta, cyan, (t - 0.28) / 0.27);
    return mixc(cyan, amber, (t - 0.55) / 0.45);
  }
  makeRow(f) {
    const nc = this.nc, row = new Float32Array(nc), relief = this.fxv('relief', 1.3); this.seed++;
    for (let c = 0; c < nc; c++) {
      const u = c / (nc - 1) * 2 - 1, side = Math.abs(u);
      const m = Math.min(1, Math.max(0, (side - 0.02) / 0.12)), mm = m * m * (3 - 2 * m);
      const bi = Math.min(63, Math.floor(Math.max(0, side) / 0.98 * 60));
      const hill = 0.55 + 0.5 * Math.sin(c * 0.22 + this.seed * 0.17) * Math.cos(c * 0.11 - this.seed * 0.14) + 0.28 * Math.sin(c * 0.55 + this.seed * 0.33) * Math.sin(c * 0.08 + this.seed * 0.09)
        + 0.14 * Math.sin(c * 1.35 + this.seed * 0.51) + 0.08 * Math.sin(c * 2.4 + this.seed * 0.77);
      const e = f && !f.idle ? 0.5 + 0.75 * Math.min(1, f.energy) : 0.42;
      const v = f && !f.idle ? Math.max(f.bands[bi] || 0, (f.peaks?.[bi] || 0) * 0.75) : 0;
      row[c] = (0.08 + Math.pow(Math.max(0, hill), 1.2) * 1.55 * e * relief + Math.pow(v, 1.2) * 1.05 * (0.5 + 0.5 * Math.min(1, side * 1.8))) * (0.35 + 0.65 * mm);
    }
    return row;
  }
  draw(dt, f) {
    const g = this.g, s = this.settings, P = this.pal, w = g.w, h = g.h, cx = w / 2, I = s.intensity, ds = dt / 1000; this.t += ds;
    const [sx, sy, zoom] = this.cam(f); g.begin(sx, sy, zoom);
    const sky0 = [0.008, 0.01, 0.03], haze = mixc(mixc(P.p, P.s, 0.45), [0.05, 0.04, 0.12], 0.55);
    g.fade(0, sky0);
    this.scroll += ds * (f.idle ? 0.45 : 0.95 + f.energy * 1.8 + f.surge * 2.0) * s.speed * this.fxv('scroll', 0.85);
    while (this.scroll >= 1) { this.scroll -= 1; this.rows.shift(); this.rows.push(this.makeRow(f)); }
    const nr = this.nr, nc = this.nc, hy = h * 0.40, camH = 0.22, Hs = 1.85 * this.fxv('height', 1.2) * Math.min(1.4, 0.55 + 0.45 * I), vs = Math.min(w * 0.34, h * 2.4),
      pxs = Math.max(1, h / 300), sun = this.fxv('sun', 0.7);
    // sky: dark at the top, a colored haze toward the horizon
    g.quadC(-20, -20, w + 20, -20, -20, hy + 4, w + 20, hy + 4, sky0, 1, mixc(sky0, haze, 0.7), 1); g.flush(true);
    if (this.stars) for (const q of this.stars) g.sprite(q.x * w, q.y * h, q.s * pxs * (0.7 + 0.3 * Math.sin(this.t * 1.7 + q.x * 20)), WHITE, q.a * (0.55 + 0.45 * (f.idle ? 0.7 : 0.5 + 0.5 * f.flash)) * Math.min(1.2, I));
    g.flush();
    g.glow(w * 0.22, hy * 0.55, h * 0.28 * Math.max(0.2, sun), mixc(P.s, [0.1, 0.7, 0.75], 0.55), (0.10 + 0.08 * f.energy) * sun * I);
    g.glow(w * 0.78, hy * 0.5, h * 0.26 * Math.max(0.2, sun), mixc(P.p, [0.75, 0.2, 0.7], 0.5), (0.10 + 0.08 * f.energy) * sun * I);
    g.glow(cx, hy, h * (0.16 + 0.06 * f.flash) * Math.max(0.2, sun), mixc(P.p, P.s, 0.4), (0.18 + 0.2 * f.energy + 0.25 * f.flash) * sun * I);
    // project every row (z = distance; rows are 1 apart)
    const proj = [];
    for (let r = 0; r < nr; r++) {
      const z = r + 1 - this.scroll; if (z < 0.4) { proj.push(null); continue; }
      const row = this.rows[r], cur = new Array(nc), near = 0.18 + 0.82 * Math.pow(Math.min(1, (z - 0.4) / 5), 0.85);
      for (let c = 0; c < nc; c++) { const u = c / (nc - 1) * 2 - 1; cur[c] = [cx + u * 2.05 / z * w * 0.44, hy + (camH - row[c] * Hs * near) / z * vs, row[c], u]; }
      proj.push({ z, cur });
    }
    const groundY = z => z < 0.4 ? h + 4 : Math.min(h + 4, hy + camH / z * vs);
    const light = 0.75 + 0.25 * f.energy;
    // far -> near, opaque: nearer hills cover farther ones
    for (let r = nr - 1; r >= 0; r--) {
      const R = proj[r]; if (!R) continue;
      const { z, cur } = R, gy = groundY(z - 1), depth = Math.min(1, (z - 0.4) / nr), fog = Math.pow(depth, 0.75) * 0.85;
      const shadeAt = (v, slope, u) => { const base = this.flow(u, P), b = (0.22 + 0.78 * Math.min(1, v * 0.85)) * (0.85 + Math.max(-0.25, Math.min(0.35, slope * 1.4))) * light; return mixc(base.map(x => x * b), haze, fog); };
      // flat plains out to the screen edges at the row's edge height
      const L = cur[0], Rt = cur[nc - 1];
      if (L[0] > -10) { const c = shadeAt(L[2], 0, -1); g.quadC(-20, L[1], L[0], L[1], -20, gy, L[0], gy, c, 1, mixc(c.map(x => x * 0.3), haze, fog), 1); }
      if (Rt[0] < w + 10) { const c = shadeAt(Rt[2], 0, 1); g.quadC(Rt[0], Rt[1], w + 20, Rt[1], Rt[0], gy, w + 20, gy, c, 1, mixc(c.map(x => x * 0.3), haze, fog), 1); }
      for (let c = 1; c < nc; c++) {
        const [x1, y1, v1, u1] = cur[c - 1], [x2, y2, v2, u2] = cur[c];
        if (x2 < -20 || x1 > w + 20) continue;
        const top = shadeAt((v1 + v2) * 0.5, v1 - v2, (u1 + u2) * 0.5), bot = mixc(top.map(x => x * 0.28), haze, fog);
        g.quadC(x1, y1, x2, y2, x1, gy, x2, gy, top, 1, bot, 1);
        const lit = mixc(top, WHITE, 0.3 + 0.25 * f.flash);
        g.line(x1, y1, x2, y2, (1.1 + 1.5 / Math.max(0.5, z)) * pxs, lit, (1 - fog) * (0.55 + 0.4 * Math.min(1, (v1 + v2) * 0.5)) * Math.min(1, 0.6 + 0.4 * I), 1);
      }
    }
    g.flush(true);
    g.glow(cx, h * 0.98, w * 0.5, mixc(P.p, P.s, 0.45), f.flash * 0.1 * I);
  }
}

/** 0.1.3 Graphic EQ: a classic graphic-equalizer bar display on the GPU. Theme colors run up each bar (primary -> secondary -> hot accent), LED
 * segments (or smooth bars), falling peak caps, a glowing floor line and a reflection on the floor. Bars fall with gravity, caps float then drop. */
export class GeqScene extends Scene {
  constructor(gl, opts) { super(gl, opts); this.v = new Float32Array(64); this.cap = new Float32Array(64); this.capV = new Float32Array(64); this.capHold = new Float32Array(64); }
  draw(dt, f) {
    const g = this.g, s = this.settings, P = this.pal, w = g.w, h = g.h, I = s.intensity, ds = dt / 1000, k = dt / 16.7; this.t += ds;
    const [sx, sy, zoom] = this.cam(f); g.begin(sx, sy, zoom); g.fade(0.3 * this.q.trails);
    const N = Math.max(8, Math.min(64, Math.round(this.fxv('bands', 31) * (this.preview ? 0.6 : 1)))), segK = this.fxv('segments', 0.5), capK = this.fxv('caps', 0.5), refl = this.fxv('reflect', 0.45);
    const segN = this.preview ? 14 : this.q.tier === 'ultra' ? 32 : this.light ? 18 : 24, segmented = segK > 0.04;
    const left = w * 0.05, right = w * 0.95, top = h * 0.08, floor = h * (refl > 0.02 ? 0.76 : 0.9), H = floor - top, bw = (right - left) / N, gap = Math.max(1, bw * 0.2), pxs = Math.max(1, h / 300);
    const hot = mixc(P.a, WHITE, 0.25), colAt = u => u < 0.6 ? mixc(P.p, P.s, u / 0.6) : mixc(P.s, hot, (u - 0.6) / 0.4);
    const gain = 0.72 + 0.4 * I, fall = 1.5 * s.speed, hold = capK * 900;
    for (let i = 0; i < N; i++) {
      const b0 = Math.floor(i * 64 / N), b1 = Math.max(b0 + 1, Math.floor((i + 1) * 64 / N)); let val = 0;
      for (let b = b0; b < b1; b++) val = Math.max(val, f.bands[b] || 0);
      const target = f.idle ? 0.03 + 0.025 * (1 + Math.sin(this.t * 1.8 + i * 0.45)) : Math.min(1, val * gain * (0.92 + 0.22 * i / N));
      const v = this.v[i]; this.v[i] = target > v ? v + (target - v) * Math.min(1, 0.7 * k * Math.max(0.5, s.speed)) : Math.max(target, v - ds * fall * (0.4 + v));
      if (this.v[i] >= this.cap[i]) { this.cap[i] = this.v[i]; this.capV[i] = 0; this.capHold[i] = hold; }
      else if ((this.capHold[i] -= dt) <= 0) { this.capV[i] += ds * 2.2; this.cap[i] = Math.max(this.v[i], this.cap[i] - this.capV[i] * ds); }
    }
    for (let i = 0; i < N; i++) {
      const x1 = left + i * bw + gap / 2, x2 = x1 + bw - gap, v = this.v[i];
      if (segmented) {
        const sh = H / segN, sg = sh * (0.12 + 0.45 * segK);
        for (let j = 0; j < segN; j++) {
          const yb = floor - j * sh, yt = yb - sh + sg, u = (j + 0.5) / segN, on = u <= v, c = colAt(u);
          if (on) { g.quad(x1, yt, x2, yt, x1, yb, x2, yb, c, 0.95); if (refl > 0.02) { const d = floor + j * sh, a = 0.95 * refl * 0.5 * Math.max(0, 1 - u * 1.6); if (a > 0.01) g.quad(x1, d + sg, x2, d + sg, x1, d + sh, x2, d + sh, c, a); } }
          else g.quad(x1, yt, x2, yt, x1, yb, x2, yb, c, 0.055);
        }
      } else {
        const yt = floor - v * H; g.quadC(x1, yt, x2, yt, x1, floor, x2, floor, colAt(v), 0.95, P.p, 0.95);
        if (refl > 0.02) { const yr = floor + v * H * 0.6; g.quadC(x1, floor + 2, x2, floor + 2, x1, yr, x2, yr, P.p, 0.5 * refl, colAt(v * 0.4), 0); }
      }
      if (!f.idle && v > 0.05) g.sprite((x1 + x2) / 2, floor - v * H, bw * 0.9, colAt(v), 0.12 * I * v);
      if (capK > 0.02 && this.cap[i] > 0.02) { const yc = floor - this.cap[i] * H - 2 * pxs; g.quad(x1, yc - 2.2 * pxs, x2, yc - 2.2 * pxs, x1, yc, x2, yc, hot, 1); g.sprite((x1 + x2) / 2, yc - pxs, bw * 0.55, hot, 0.25); }
    }
    g.line(left - bw * 0.3, floor + 1, right + bw * 0.3, floor + 1, (2 + 2 * f.flash) * pxs, mixc(P.p, WHITE, 0.2), 0.7 + 0.3 * f.flash, 1);
    g.flush();
    g.glow(w * 0.5, floor, w * 0.45, P.p, (0.06 + 0.25 * f.flash + 0.1 * f.energy) * I);
  }
}

export const SCENES = { particles: WarpScene, river: RiverScene, cone: ConeScene, wavwiz: RingScene, tunnel: TunnelScene, terrain: TerrainScene, geq: GeqScene };
