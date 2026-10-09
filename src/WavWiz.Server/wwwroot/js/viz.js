// Visualizers. Eight looks (0.1.3): Particle burst (default, 3D warp), Waveform river, Speaker cone, Ring, Neon tunnel, Terrain, VU meters and Graphic EQ
// (Graphic EQ replaced Lightning), all WebGL 2 with WebGL 1 fallback (iPhone Safari included), with a plain 2D fallback.
// 0.1.3 Quality (Auto / Low / High / Ultra): Auto picks by device (phones Low, strong desktop GPUs Ultra) and a frame-time governor steps it down when
// frames miss their budget, so a phone never stutters. The visualizer only READS the server's analysis feed; it is never on the audio path. Every look is fed by the SERVER over /ws/viz (1024 samples + stereo levels,
// ~30 per second, timed to what is audible now) - local files, internet radio and network streams alike, because the feed is tapped from the house stream
// itself. One feed per page is shared by the banner, the full-screen view and the preview cards.
// 0.0.8 crash fix: every view draws on its own plain 2D canvas (dark from the first frame, never white); all WebGL looks share ONE context (vizgl.js
// sharedGL) and render into a per-view framebuffer. Context loss keeps the last picture, waits for the restore (or builds a fresh context) and falls
// back to 2D if the graphics chip keeps resetting.
import { WavWizRing } from './wzviz.js';
import { ParticleBurst } from './particles.js';
import { liveSocket } from './wsconn.js';
import { Features, VIZ_LIST, normEngine, vizName, effectiveSettings, loadReact, reactRaw, loadPost, postRaw, DEFAULT_ENGINE, QUALITY, normQuality, qualityFromLight, autoTier, FrameGovernor, isLight, safeStart, startsLow, StallWatchdog, TIERS } from './vizcore.js';
import { isTvUa, migrateKey } from './phonejoin.js';
const toast = (...a) => { import('./util.js').then(m => m.toast(...a)).catch(() => {}); };   // lazy: util.js needs the DOM (viz.js is also loaded by node tests)
import { SCENES, webglOk, sharedGL, sharedGen, sharedInfo } from './vizgl.js';
import { VuScene, VuGLScene } from './vizvu.js';
const KEY = 'wavwiz.viz.v1';           // 0.2.0 item 12: was unison.viz.v1 (0.0.2..0.1.3); moved over once so a device keeps its choices
const migrate = () => { try { migrateKey(localStorage, 'unison.viz.v1', KEY); } catch { /* no storage */ } };   // read lazily: the old value moves over the first time it is read
export const isPhone = () => { try { return matchMedia('(max-width:900px)').matches || /iPhone|iPad|Android/.test(navigator?.userAgent || ''); } catch { return false; } };
export const inDesktopPlayer = () => /(WavWiz|Unison)Player\//.test(navigator.userAgent);
export const ENGINES = VIZ_LIST.map(([k, t]) => [k, k === DEFAULT_ENGINE ? t + ' (default)' : t]);
export { VIZ_LIST, vizName };

/** quality: 'auto' | 'low' | 'high' | 'ultra' (0.1.3; a 0.1.2 "Detail" choice carries over: Automatic -> Auto, Light -> Low, Full -> High). */
export function vizPrefs() {
  let p = {}; try { migrate(); p = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignore */ }
  const quality = p.quality ? normQuality(p.quality) : qualityFromLight(p.light);
  const ss = startInfo(p.on);                                  // 0.2.0 item 3: ?lite / ?viz=off / TV default off
  return { on: !ss.forceOff && ss.defaultOn, forced: ss.forceOff, engine: normEngine(p.engine), quality, light: quality === 'low' || (quality === 'auto' && isPhone()), lightSetting: p.light || 'auto', names: p.names !== false };
}
export function saveVizPrefs(p) { try { let on = p.on; if (p.forced) { try { on = JSON.parse(localStorage.getItem(KEY) || '{}').on; } catch { on = undefined; } }   // ?lite never overwrites the saved on/off
  localStorage.setItem(KEY, JSON.stringify({ on, engine: normEngine(p.engine), quality: normQuality(p.quality), light: p.lightSetting, names: p.names })); } catch { /* ignore */ } }
/** 0.2.0 item 3: the safe-start facts for this page. */
export function startInfo(storedOn) { let search = ''; try { search = location.search; } catch { /* worker */ } return safeStart({ search, tv: isTvUa(), storedOn }); }
/** Never create a WebGL context before the page is interactive: wait for "load" and one idle moment (or 1.5 s at most). */
let interactive = null;
export function whenInteractive() {
  if (interactive) return interactive;
  interactive = new Promise(res => {
    const idle = () => { if (globalThis.requestIdleCallback) requestIdleCallback(() => res(), { timeout: 1500 }); else setTimeout(res, 200); };
    try { if (document.readyState === 'complete') idle(); else addEventListener('load', idle, { once: true }); } catch { res(); }
  });
  return interactive;
}
export function webgl2Ok() { return webglOk(); }      // kept name for older callers: true when WebGL (2 or 1) works
/** What Auto starts with on this device. */
export function deviceFacts() {
  const ua = navigator?.userAgent || '';
  let coarse = false; try { coarse = matchMedia('(pointer:coarse)').matches; } catch { /* old browser */ }
  return { coarse, minSide: Math.min(screen?.width || 1920, screen?.height || 1080), cores: navigator.hardwareConcurrency || 8, memory: navigator.deviceMemory || 0,
    phoneUa: /iPhone|iPad|iPod|Android/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1), renderer: (() => { try { return sharedGL()?.renderer || ''; } catch { return ''; } })() };
}
export const autoQuality = () => autoTier(deviceFacts());
/** 0.2.0: where Auto STARTS: Low on TVs and unknown graphics chips (it climbs to the ceiling only after measured smooth frames). */
export const autoStart = () => { const f = deviceFacts(); return startsLow({ tv: isTvUa(), renderer: f.renderer }) ? 'low' : null; };

function themeColors() { try { const cs = getComputedStyle(document.documentElement); return { accent: cs.getPropertyValue('--accent').trim().toUpperCase(), accent2: cs.getPropertyValue('--accent2').trim().toUpperCase() }; } catch { return {}; } }

/** Playback position 0..1 (null = live/unknown) for the Waveform river marker; set by Now Playing. */
let progress = null; export function setVizProgress(f) { progress = f; }

/** One /ws/viz connection per page, shared by every visualizer on it. */
const feed = { subs: new Set(), live: null, win: null, extra: null, audible: false, lastData: 0, frames: 0 };
function feedSub(v) {
  feed.subs.add(v);
  if (!feed.live) feed.live = liveSocket('/ws/viz?delayMs=0', { binary: true, pingText: null, silentMs: 1e9,
    onMessage: ev => { const u = new Uint8Array(ev.data); if (u[0] === 1 && u.length >= 1025) { feed.win = u.subarray(1, 1025).slice(); feed.extra = u.length >= 1029 ? u.subarray(1025, 1029).slice() : null; feed.audible = true; feed.lastData = performance.now(); feed.frames++; } else if (u[0] === 0) { feed.audible = false; feed.win = null; feed.extra = null; } for (const s of feed.subs) s.kick(); },
    onClose: () => { feed.audible = false; } });
}
function feedUnsub(v) { feed.subs.delete(v); if (!feed.subs.size && feed.live) { feed.live.close(); feed.live = null; feed.audible = false; feed.win = null; } }

export const live = new Set();          // running controllers, read by Diagnostics
export function vizStats() { const v = [...live].find(x => !x.preview) || [...live][0]; return v ? v.stats() : null; }
const BG = '#05070a';

/** Controller for one host element. It owns ONE 2D canvas for its whole life (no new canvas or context per switch).
 * opts.engine fixes the look (preview cards); opts.preview = small, 30 fps, no camera shake. */
export class Viz {
  constructor(host, { onStatus, engine = null, preview = false } = {}) {
    this.host = host; this.onStatus = onStatus || (() => {}); this.fixed = engine ? normEngine(engine) : null; this.preview = preview; this.prefs = vizPrefs();
    this.engine = this.fixed || this.prefs.engine; this.running = false; this.frames = 0; this.lastError = ''; this.failed = null; this.presetName = '';
    this.features = new Features(); this.applyReact(); this.applyQuality(true, true); this.ftInt = 16.7; this.ftWork = 1; this.lastRaf = 0; this.fpsT = performance.now(); this.fpsN = 0; this.fps = 0; this.canvas = null; this.ctx = null; this.mode = null; this.target = null; this.gen = -1; live.add(this);
  }
  get ok() { return !this.failed && !!(this.scene || this.fallback); }
  get audible() { return feed.audible; }
  status(kind, text) { try { this.onStatus(kind, text); } catch { /* ui gone */ } }
  setError(msg) { this.lastError = msg; this.status('error', msg); }
  applyReact() { const r = reactRaw(loadReact()); this.features.sensitivity = r.sensitivity; this.features.autoGain = r.autoGain; this.features.mood = r.energy; this.post = postRaw(loadPost()); }
  /** Quality from the prefs: an explicit tier, or Auto = the device's tier as a ceiling with the frame-time governor below it. */
  applyQuality(first = false, noProbe = false) {
    const want = this.prefs.quality, auto = want === 'auto';
    if (this.preview) { this.tier = 'low'; this.gov = null; }
    else if (auto && noProbe) { this.tier = 'low'; this.gov = null; }      // 0.2.0: probing the graphics chip creates WebGL - wait until the page is interactive
    else if (auto) { const ceil = autoQuality(); if (!this.gov || this.gov.ceilingName !== ceil) { this.gov = new FrameGovernor(ceil); this.gov.ceilingName = ceil; const lo = first && autoStart(); if (lo && TIERS.indexOf(lo) < this.gov.level) this.gov.level = TIERS.indexOf(lo); } this.tier = this.gov.tier; }
    else { this.gov = null; this.tier = want; }
    this.q = QUALITY[this.tier] || QUALITY.high;
    if (!first) { this.resize(); this.scene?.configure?.({ q: this.q }); }
  }

  makeCanvas() {
    if (this.canvas) return;
    this.canvas = document.createElement('canvas'); this.canvas.className = 'vizcanvas'; this.canvas.style.background = BG; this.host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: false }); this.sizeCanvas(true); this.paintDark();
    this.io = new IntersectionObserver(es => { this.visible = es[0].isIntersecting; this.kick(); }); this.io.observe(this.canvas);
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.host);
  }
  paintDark() { try { this.ctx.fillStyle = BG; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); } catch { /* no 2d */ } }
  /** Backing-store size from the host's real on-screen size; never smaller than 64 and never taken from a hidden (0-size) host. */
  boxSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.preview ? 1 : this.q.dpr);
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return null;
    return [Math.max(64, Math.round(w * dpr)), Math.max(64, Math.round(h * dpr))];
  }
  sizeCanvas(force) { const s = this.boxSize(); if (!s) return false; const [w, h] = s; if (force || w !== this.canvas.width || h !== this.canvas.height) { this.canvas.width = w; this.canvas.height = h; this.paintDark(); return true; } return false; }

  async start() {
    if (this.started) return; this.started = true;
    if (!this.preview && vizPrefs().forced) { this.fail('The visualizer is off for this page (?lite or ?viz=off).'); return; }
    try { this.makeCanvas(); } catch (e) { this.fail(e.message || String(e)); return; }
    await whenInteractive(); if (this.destroyed) return;          // 0.2.0 item 3: no WebGL before the page is interactive
    this.applyQuality(true);
    if (!this.preview) this.watch = new StallWatchdog({ startTier: this.tier });
    try { this.useEngine(this.engine); feedSub(this); this.attach(); }
    catch (e) { this.fail(e.message || String(e)); }
  }
  freeTarget() { const g = this.scene?.g; try { this.scene?.dispose?.(); } catch { /* lost */ } if (this.target && g && !g.lost()) g.freeTarget(this.target); this.target = null; }
  useFallback(why) {
    this.freeTarget(); this.scene = null; this.mode = '2d'; if (why) this.lastError = 'WebGL is not available here (' + why + '); showing a simpler 2D picture.';
    this.fallback = this.engine === 'wavwiz' ? new WavWizRing(this.canvas, { light: this.prefs.light }) : new ParticleBurst(this.canvas, { light: this.prefs.light });
  }
  buildScene() {
    const settings = effectiveSettings(this.engine), theme = themeColors();       // 0.1.1: scaled by the global Mood
    const g = sharedGL(); if (!g) { if (sharedInfo().failed) { if (this.engine === 'vu') { this.freeTarget(); this.scene = new VuScene({ settings, theme, preview: this.preview }); this.mode = '2d-native'; } else this.useFallback(sharedInfo().error || 'no WebGL'); } else { this.scene = null; this.mode = 'waiting'; } return; }
    this.freeTarget(); this.target = g.makeTarget(this.canvas.width, this.canvas.height, this.q.hdr && !this.preview); g.use(this.target);
    const Cls = this.engine === 'vu' ? VuGLScene : SCENES[this.engine];
    try { this.scene = new Cls(g, { settings, theme, q: this.q, preview: this.preview, seed: 11 }); this.mode = 'webgl'; this.gen = sharedGen(); }
    finally { g.use(null); }
  }
  useEngine(engine) {
    this.stopLoop(); this.engine = normEngine(engine); this.fallback = null; this.makeCanvas(); this.paintDark(); this.features.reset();
    try { this.buildScene(); } catch (e) { this.useFallback(e.message || String(e)); }
    this.canvas.setAttribute('aria-label', 'Music visualizer: ' + vizName(this.engine));
    this.presetName = vizName(this.engine); this.status('preset', this.presetName); this.status('engine', this.engine); this.kick();
  }
  /** Re-read colors / energy / effect settings, reactivity and the theme (live, no restart). */
  configure() { const was = this.prefs.quality; this.prefs = vizPrefs(); this.applyReact(); if (was !== this.prefs.quality) this.applyQuality(); this.scene?.configure({ settings: effectiveSettings(this.engine), theme: themeColors(), q: this.q }); this.fallback?.refreshTheme?.(); }
  setEngine(engine) { if (this.fixed) return; const p = vizPrefs(); p.engine = normEngine(engine); saveVizPrefs(p); this.prefs = p; this.lastError = ''; this.useEngine(p.engine); }
  next() { if (this.fixed) return; const i = VIZ_LIST.findIndex(([k]) => k === this.engine); this.setEngine(VIZ_LIST[(i + 1) % VIZ_LIST.length][0]); }
  prev() { if (this.fixed) return; const i = VIZ_LIST.findIndex(([k]) => k === this.engine); this.setEngine(VIZ_LIST[(i - 1 + VIZ_LIST.length) % VIZ_LIST.length][0]); }

  /** Animate while the box is on screen and the page is visible (battery!); idle music = calm idle animation. */
  attach() {
    this._vc = () => this.kick(); document.addEventListener('visibilitychange', this._vc);
    this._t = setInterval(() => this.kick(), 500);
    this._th = () => this.configure(); window.addEventListener('wavwiz:theme', this._th); window.addEventListener('wavwiz:vizsettings', this._th);
  }
  resize() { if (this.canvas) this.sizeCanvas(false); }
  kick() {
    const should = this.ok || this.mode === 'waiting';
    const run = should && !this.destroyed && this.visible !== false && !document.hidden;
    if (run && !this.running) { this.running = true; this.last = 0; this.raf = requestAnimationFrame(t => this.loop(t)); }
    else if (!run && this.running) this.stopLoop();
    this.status('audible', feed.audible ? 'yes' : 'no');
  }
  stopLoop() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  loop(t) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(tt => this.loop(tt));
    const cap = this.preview ? 30 : this.q.fps, minGap = cap ? 1000 / (cap + 1) : 0; if (this.last && t - this.last < minGap) return;
    const dt = this.last ? Math.min(100, t - this.last) : 16.7, interval = this.last ? t - this.last : 0; this.last = t;
    const fresh = feed.audible && performance.now() - feed.lastData < 1500, w = fresh ? feed.win : null, t0 = performance.now();
    try {
      if (this.mode === 'webgl' || this.mode === 'waiting') {
        const g = sharedGL();
        if (!g) { if (sharedInfo().failed) { if (this.engine === 'vu') this.buildScene(); else this.useFallback(sharedInfo().error); } return; }   // lost: keep the last picture while the browser restores it
        if (this.mode === 'waiting' || this.gen !== sharedGen() || this.scene?.g !== g) { this.target = null; this.buildScene(); if (this.mode !== 'webgl') return; }
        this.features.push(w, dt, fresh ? feed.extra : null); if (this.scene.progress !== undefined) this.scene.progress = progress;
        const cw = this.canvas.width, ch = this.canvas.height; g.sizeTarget(this.target, cw, ch, this.q.hdr && !this.preview);
        g.use(this.target); try { this.scene.draw(dt, this.features); g.present(this.target, this.postFor()); } finally { g.use(null); }
        if (g.lost()) return;
        this.ctx.drawImage(g.c, 0, g.c.height - this.target.h, this.target.w, this.target.h, 0, 0, cw, ch); this.frames++;
      } else if (this.mode === '2d-native') {
        this.features.push(w, dt, fresh ? feed.extra : null); this.scene.draw2d(this.ctx, this.canvas.width, this.canvas.height, dt, this.features); this.frames++;
      } else if (this.fallback) { this.fallback.setWave(w); if (this.fallback.draw(t)) this.frames++; }
      this.fpsN++; const now = performance.now(); if (now - this.fpsT > 1000) { this.fps = Math.round(this.fpsN * 1000 / (now - this.fpsT)); this.fpsN = 0; this.fpsT = now; }
      const work = now - t0; if (interval) { this.ftInt += (interval - this.ftInt) * 0.05; this.ftWork += (work - this.ftWork) * 0.05; }
      if (this.watch && interval && !document.hidden) this.stall(this.watch.push(interval));
      if (this.gov && interval && !document.hidden) { const before = this.tier, tier = this.gov.push(interval, work); if (tier !== before) { this.tier = tier; this.q = QUALITY[tier]; this.resize(); this.scene?.configure?.({ q: this.q }); } }
    } catch (e) { this.fail('The picture stopped: ' + (e.message || e)); this.paintDark(); }
  }
  /** Post-processing for this frame: the device-wide knobs, limited by the quality tier; previews only get the tone curve + dither. */
  postFor() {
    if (this.preview) return null;
    const p = this.post || {}, q = this.q, f = this.features, P = this.scene?.pal;
    return { levels: q.bloom, bloom: p.bloom || 0, streaks: q.streaks ? p.streaks || 0 : 0, fringe: (p.fringe || 0) * Math.min(1, f.flash * 1.2), depth: q.depth ? p.depth || 0 : 0,
      mask: this.scene?.depthMask?.() || null, tint: P ? [0.55 + 0.45 * P.p[0], 0.55 + 0.45 * P.p[1], 0.55 + 0.45 * P.p[2]] : [1, 1, 1] };
  }
  /** 0.2.0 item 3: the first-seconds watchdog said the page is stalling: Low first (with a toast), then Off (saved for this browser, with a toast). */
  stall(step) {
    if (!step) return;
    if (step === 'low') {
      this.tier = 'low'; this.q = QUALITY.low; if (this.gov) { this.gov.level = Math.min(this.gov.level, TIERS.indexOf('low')); this.gov.reset(); }
      this.resize(); this.scene?.configure?.({ q: this.q }); try { toast('The visualizer was slow here, so its quality is now Low.'); } catch { /* no DOM */ }
    } else if (step === 'off') {
      if (this.mode === 'webgl' && !this.triedFallback) { this.triedFallback = true; this.useFallback('too slow on this device'); this.watch = new StallWatchdog({ startTier: 'low' }); return; }   // hard fallback: a plain 2D picture first
      const p = vizPrefs(); p.on = false; saveVizPrefs(p); this.fail('The visualizer was turned off because this device could not keep up.');
      try { toast('The visualizer was too slow on this device, so it is now off. Turn it back on with the ✦ button.', true); window.dispatchEvent(new CustomEvent('wavwiz:viz')); } catch { /* no DOM */ }
    }
  }
  fail(msg) { this.failed = msg; this.stopLoop(); this.setError(msg); }
  setLight() { this.configure(); }

  stats() {
    const si = sharedInfo();
    return { engine: this.engine, mode: this.mode, webgl: !si.failed, webgl2: !si.failed && si.webgl2, hdr: si.hdr, instancing: si.instancing, renderer: si.renderer, losses: si.losses,
      quality: this.prefs.quality, tier: this.tier, governed: !!this.gov, govSteps: this.gov?.steps || 0, frameMs: Math.round(this.ftInt * 10) / 10, workMs: Math.round(this.ftWork * 10) / 10, sharedContext: true, contextGen: si.gen, contextLost: si.lost, dataArriving: feed.audible && performance.now() - feed.lastData < 1500, dataFrames: feed.frames, dataAgeMs: feed.lastData ? Math.round(performance.now() - feed.lastData) : null,
      stereo: !!feed.extra, sensitivity: this.features.sensitivity, autoGain: this.features.autoGain, gain: Math.round(this.features.gain * 10) / 10,
      preset: this.presetName || '', frames: this.frames, fps: this.fps, running: this.running, lastError: this.lastError || '', canvas: this.canvas ? `${this.canvas.width}x${this.canvas.height}` : null, light: isLight(this.tier),
      particles: [this.scene?.n, this.scene?.ns].find(x => typeof x === 'number') || null, autoCeiling: this.gov?.ceilingName || null };
  }
  destroy() {
    this.destroyed = true; this.stopLoop(); clearInterval(this._t); live.delete(this); feedUnsub(this);
    window.removeEventListener('wavwiz:theme', this._th); window.removeEventListener('wavwiz:vizsettings', this._th);
    try { this.io?.disconnect(); this.ro?.disconnect(); } catch { /* ignore */ }
    document.removeEventListener('visibilitychange', this._vc);
    this.freeTarget(); this.scene = null; this.fallback = null;
    this.canvas?.remove(); this.canvas = null; this.ctx = null;
  }
}
