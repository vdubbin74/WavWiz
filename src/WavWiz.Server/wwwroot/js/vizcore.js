// 0.0.7/0.0.8 visualizer core (pure, no DOM; unit-tested with node): the list of looks, per-look settings (Theme / Custom colors + energy sliders),
// palette resolution and the audio "energy" features every look reacts to (bass speed, kick shockwaves, bloom flash, sparkle, camera shake, calm idle).
import { magnitudes, bands } from './vizmath.js';

export const VIZ_LIST = [['particles', 'Particle burst'], ['river', 'Waveform river'], ['cone', 'Speaker cone'], ['wavwiz', 'Ring'],
  ['tunnel', 'Neon tunnel'], ['terrain', 'Terrain'], ['vu', 'VU meters'], ['geq', 'Graphic EQ']];
export const VIZ_BLURB = {
  particles: '3D warp starfield on the GPU: tens of thousands of stars rush past, kicks fire shockwave bursts.',
  river: 'Layered translucent waveforms flowing across the banner with a glowing position marker.',
  cone: 'A hi-fi woofer that flexes with the bass and throws shockwave ripples on beats.',
  wavwiz: 'A 3D spectrum ring with depth, shockwave rings and sparkle on the highs.',
  tunnel: 'Fly through glowing neon rings past thousands of light streaks; every kick launches a new ring toward you.',
  terrain: 'Solid, vibrant landscapes (filled hills and valleys) flowing toward a starry horizon.',
  vu: 'Two analog VU meters on the GPU: one glowing, bouncy needle each, peak LEDs and a punchy level bar.',
  geq: 'A classic graphic equalizer: glowing LED bars in your theme colors with falling peak caps.',
};
export const DEFAULT_ENGINE = 'particles';
export const vizName = k => (VIZ_LIST.find(([id]) => id === k) || VIZ_LIST[0])[1];
/** Old saved choices: 'milkdrop' (removed in 0.0.7) -> Particle burst; 'lightning' (replaced in 0.1.3) -> Graphic EQ; anything unknown -> Particle burst. */
export const normEngine = e => e === 'lightning' ? 'geq' : VIZ_LIST.some(([k]) => k === e) ? e : DEFAULT_ENGINE;

/**
 * 0.1.3: EVERY level setting is a percentage 0..100 (default 50, max 100). Each maps onto the value the picture runs with through
 * three anchors [at 0 %, at 50 %, at 100 %] (piecewise, 'log' = geometric between anchors). 50 % is retuned a bit livelier than 0.1.2's defaults.
 */
export const pmap = (pct, [lo, mid, hi, kind]) => {
  const p = Math.min(100, Math.max(0, Number.isFinite(+pct) ? +pct : 50)) / 100;
  const [a, b, t] = p <= 0.5 ? [lo, mid, p * 2] : [mid, hi, (p - 0.5) * 2];
  const v = kind === 'log' ? a * Math.pow(b / a, t) : a + (b - a) * t;
  return kind === 'int' ? Math.round(v) : v;
};
/** Inverse of pmap (used once to carry 0.1.2 values over): the percentage that gives this value, clamped to 0..100. */
export const pinv = (v, [lo, mid, hi, kind]) => {
  const n = Number(v); if (!Number.isFinite(n)) return 50;
  const f = (x, a, b) => kind === 'log' ? Math.log(x / a) / Math.log(b / a) : (x - a) / (b - a);
  const inLow = (lo <= mid) ? n <= mid : n >= mid;
  const p = inLow ? 0.5 * f(n, lo, mid) : 0.5 + 0.5 * f(n, mid, hi);
  return Math.round(Math.min(1, Math.max(0, p)) * 100);
};

export const DEFAULT_SETTINGS = Object.freeze({ colorMode: 'theme', primary: '#FF3C00', secondary: '#19C3B1', accent: '#FFFFFF', intensity: 50, speed: 50, density: 50, shake: 50 });
/** Shared per-look levels: [key, label, anchors, hint]. */
export const SHARED = [
  ['intensity', 'Intensity', [0.2, 1.15, 2], 'glow, flashes, shockwaves'],
  ['speed', 'Speed', [0.25, 1.05, 2]],
  ['density', 'Particle density', [0.25, 1.1, 2], 'more particles use more battery'],
  ['shake', 'Camera shake', [0, 0.6, 1.4], 'on heavy beats (0 % = off)'],
];
export const RANGES = Object.fromEntries(SHARED.map(([k, , a]) => [k, a]));

/**
 * Each look's own effects: [key, label, anchors, hint] for a 0..100 % level; [key, label, null, choices, default] for a style choice.
 * 0.1.3: Lightning was replaced by Graphic EQ (its saved settings are dropped).
 */
export const FX = {
  particles: [['warp', 'Warp speed', [0.25, 1.15, 3], 'how fast the stars rush past'], ['trail', 'Trail length', [0, 0.55, 1], 'motion-blur streaks']],
  river: [['sweep', 'Color-shift sweep speed', [0, 1.1, 3], 'how fast the colors sweep left and right (0 % = still)'], ['layers', 'Ribbon layers', [0.5, 1.1, 2]]],
  cone: [['ripple', 'Ripple size', [0.3, 1.15, 2.5], 'how far beat ripples travel'], ['flex', 'Cone flex', [0.3, 1.15, 2.5], 'how far the cone moves with the bass']],
  wavwiz: [['spin', 'Rotation speed', [0, 1.1, 3]], ['thick', 'Ring thickness', [0.4, 1.1, 2.5]]],
  tunnel: [['fly', 'Fly-through speed', [0.2, 1.15, 3]], ['twist', 'Twist', [0, 0.35, 2], 'how much the tunnel bends'], ['rings', 'Ring count', [0.5, 1.1, 2]]],
  terrain: [['height', 'Peak height', [0.3, 1.3, 2.5]], ['scroll', 'Scroll speed', [0, 0.95, 3]], ['grid', 'Grid density', [0.5, 1.35, 2.5]], ['relief', 'Terrain relief', [0.4, 1.35, 2.5]], ['sun', 'Horizon glow', [0, 0.8, 2]]],
  vu: [['needle', 'Needle speed', [0.3, 1.2, 2.5], 'how quickly the needles respond'], ['bounce', 'Needle bounce', [1.3, 0.42, 0.16], 'more = more overshoot and bounce'],
    ['peakHold', 'Peak LED hold', [0.2, 1.2, 3], 'how long a peak LED stays lit'], ['bar', 'Level bar punch', [0.3, 1, 1.8], 'bigger hits and deeper lows'],
    ['style', 'Meter style', null, [['classic', 'Classic (warm backlight)'], ['dark', 'Dark studio'], ['neon', 'Neon (theme colors)']], 'classic']],
  geq: [['bands', 'Bars', [10, 31, 64, 'int'], 'how many frequency bars'], ['segments', 'LED segments', [0, 0.5, 1], '0 % = smooth solid bars'],
    ['caps', 'Peak caps', [0, 0.5, 1], 'how long the caps float before falling (0 % = off)'], ['reflect', 'Floor reflection', [0, 0.45, 1]]],
};
/** 0.1.2 defaults (raw values): a saved value equal to these was never touched, so it moves to the new 50 % default instead of being carried over. */
const OLD_DEFAULTS = { intensity: 1, speed: 1, density: 1, warp: 1, trail: 0.5, sweep: 1, layers: 1, ripple: 1, flex: 1, spin: 1, thick: 1, fly: 1, twist: 0.25, rings: 1,
  height: 1.2, scroll: 0.85, grid: 1.35, relief: 1.3, sun: 0.7, needle: 1, peakHold: 1 };
const fxDefaults = k => Object.fromEntries((FX[k] || []).map(d => [d[0], d[2] === null ? d[4] : 50]));
const pct = (v, d = 50) => { const n = Number(v); return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : d; };
export function cleanFx(engine, fx = {}) {
  const out = {};
  for (const [key, , map, choices, def] of FX[engine] || []) {
    if (map === null) { out[key] = choices.some(([v]) => v === fx?.[key]) ? fx[key] : def; continue; }
    out[key] = pct(fx?.[key]);
  }
  return out;
}
const hexOk = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

export function cleanSettings(s = {}, engine = null) {
  const d = DEFAULT_SETTINGS;
  const out = {
    colorMode: s.colorMode === 'custom' ? 'custom' : 'theme',
    primary: hexOk(s.primary) ? s.primary.toUpperCase() : d.primary, secondary: hexOk(s.secondary) ? s.secondary.toUpperCase() : d.secondary, accent: hexOk(s.accent) ? s.accent.toUpperCase() : d.accent,
    intensity: pct(s.intensity), speed: pct(s.speed), density: pct(s.density), shake: s.shake === false ? 0 : s.shake === true ? 50 : pct(s.shake),
  };
  if (engine && FX[engine]) out.fx = cleanFx(engine, s.fx);
  return out;
}
export const SETTINGS_KEY_V1 = 'wavwiz.viz.looks.v1';
export const SETTINGS_KEY = 'wavwiz.viz.looks.v2';
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** 0.1.3 one-time migration of 0.1.2 per-look settings (raw values) onto the 0..100 % scale. Colors and styles are kept. A level that still had
 * its 0.1.2 default resets to the new 50 % default (the livelier tuning); a level the user had changed is carried over to the percentage that gives
 * the same value (clamped). Camera shake on/off becomes 50 % / 0 %. VU "Needle damping" becomes "Needle bounce". Lightning settings are dropped. */
export function migrateLooksV2(st = store()) {
  try {
    if (!st || st.getItem(SETTINGS_KEY) != null) return false;
    let raw = {}; try { raw = JSON.parse(st.getItem(SETTINGS_KEY_V1) || '{}') || {}; } catch { raw = {}; }
    const toPct = (key, v, map) => { const n = Number(v); if (!Number.isFinite(n) || (key in OLD_DEFAULTS && Math.abs(n - OLD_DEFAULTS[key]) < 1e-6)) return 50; return pinv(n, map); };
    const out = {};
    for (const [k] of VIZ_LIST) {
      const v = raw[k]; if (!v || typeof v !== 'object') continue;
      const o = { colorMode: v.colorMode, primary: v.primary, secondary: v.secondary, accent: v.accent, shake: v.shake === false ? 0 : 50, fx: {} };
      for (const [key, , map] of SHARED) if (key !== 'shake') o[key] = toPct(key, v[key], map);
      for (const d of FX[k] || []) {
        const [key, , map] = d, fv = v.fx?.[key];
        if (map === null) { if (fv != null) o.fx[key] = fv; continue; }
        if (key === 'bounce') { const z = Number(v.fx?.damping); o.fx.bounce = !Number.isFinite(z) || Math.abs(z - 0.6) < 1e-6 ? 50 : pinv(z, map); continue; }
        if (fv != null) o.fx[key] = toPct(key, fv, map);
      }
      out[k] = cleanSettings(o, k);
    }
    st.setItem(SETTINGS_KEY, JSON.stringify(out)); return true;
  } catch { return false; }
}
export function loadAllSettings(st = store()) { migrateLooksV2(st); let raw = {}; try { raw = JSON.parse(st?.getItem(SETTINGS_KEY) || '{}') || {}; } catch { raw = {}; } const out = {}; for (const [k] of VIZ_LIST) out[k] = cleanSettings(raw[k], k); return out; }
export function loadSettings(engine, st = store()) { return loadAllSettings(st)[normEngine(engine)]; }
export function saveSettings(engine, s, st = store()) { const k = normEngine(engine), all = loadAllSettings(st); all[k] = cleanSettings(s, k); try { st?.setItem(SETTINGS_KEY, JSON.stringify(all)); } catch { /* private mode */ } return all[k]; }
export function resetSettings(engine, st = store()) { return saveSettings(engine, { ...DEFAULT_SETTINGS, fx: fxDefaults(normEngine(engine)) }, st); }

/**
 * Energy presets (0.1.1 moods). 0.1.3: the Mood buttons became one "Energy" level 0..100 %: 0 % = stillest, 25 % = 0.1.1/0.1.2 Calm,
 * 50 % (default) = between Calm and Balanced (a bit livelier than 0.1.2, still refined), 100 % = Energetic (full 0.0.8 energy).
 *  attack: band attack factor   rel: band release (ms)   sens: x sensitivity   onsetK: x onset threshold   lock: onset lock-out (ms)
 *  flash/surge/shake/beat: peak size   *Decay: per-16.7 ms keep factor (higher = slower decay)   beatMs: beat pulse decay   energy: loudness smoothing
 *  capHold/capFall: peak-cap hold (ms) and fall acceleration   wave: waveform smoothing   intensity/speed/density: x the look's sliders   glow: accent heat
 *  ease: how fast beat responses approach their peak (1 = at once)   fall: how fast the targets fall (0 = at once)
 */
export const MOODS = Object.freeze({
  still: Object.freeze({ attack: 0.22, rel: 760, sens: 0.6, onsetK: 1.6, lock: 340, flash: 0.25, flashDecay: 0.95, surge: 0.25, surgeDecay: 0.975, shake: 0.1, shakeDecay: 0.86, beat: 0.45, beatMs: 520, energy: 0.035, capHold: 300, capFall: 0.0000007, wave: 0.22, intensity: 0.6, speed: 0.65, density: 0.7, glow: 0.4, soften: 0.24, ease: 0.25, fall: 0.75 }),
  calm: Object.freeze({ attack: 0.3, rel: 620, sens: 0.72, onsetK: 1.4, lock: 280, flash: 0.4, flashDecay: 0.935, surge: 0.4, surgeDecay: 0.968, shake: 0.2, shakeDecay: 0.86, beat: 0.6, beatMs: 420, energy: 0.045, capHold: 260, capFall: 0.0000009, wave: 0.28, intensity: 0.72, speed: 0.75, density: 0.75, glow: 0.45, soften: 0.18, ease: 0.35, fall: 0.7 }),
  balanced: Object.freeze({ attack: 0.5, rel: 420, sens: 0.86, onsetK: 1.18, lock: 200, flash: 0.68, flashDecay: 0.9, surge: 0.7, surgeDecay: 0.95, shake: 0.55, shakeDecay: 0.85, beat: 0.8, beatMs: 300, energy: 0.08, capHold: 180, capFall: 0.0000015, wave: 0.42, intensity: 0.86, speed: 0.88, density: 0.88, glow: 0.6, soften: 0.08, ease: 0.6, fall: 0.7 }),
  energetic: Object.freeze({ attack: 0.85, rel: 260, sens: 1, onsetK: 1, lock: 140, flash: 1, flashDecay: 0.86, surge: 1, surgeDecay: 0.93, shake: 1, shakeDecay: 0.84, beat: 1, beatMs: 200, energy: 0.12, capHold: 120, capFall: 0.0000022, wave: 0.6, intensity: 1, speed: 1, density: 1, glow: 0.75, soften: 0, ease: 1, fall: 0 }),
});
const lerpObj = (a, b, t) => Object.fromEntries(Object.keys(a).map(k => [k, a[k] + (b[k] - a[k]) * t]));
export const REFINED = Object.freeze(lerpObj(MOODS.calm, MOODS.balanced, 0.65));
const moodCache = new Map();
/** Energy preset for a level 0..100 (number) or a 0.1.1 mood name. */
export function moodAt(v) {
  if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(MOODS, v)) return MOODS[v];
  const p = pct(v) / 100; if (moodCache.has(p)) return moodCache.get(p);
  const m = Object.freeze(p <= 0.25 ? lerpObj(MOODS.still, MOODS.calm, p / 0.25) : p <= 0.5 ? lerpObj(MOODS.calm, REFINED, (p - 0.25) / 0.25) : lerpObj(REFINED, MOODS.energetic, (p - 0.5) / 0.5));
  if (moodCache.size > 128) moodCache.clear(); moodCache.set(p, m); return m;
}
export const MOOD_LIST = [['calm', 'Calm'], ['balanced', 'Balanced'], ['energetic', 'Energetic']];
export const DEFAULT_ENERGY = 50;
export const DEFAULT_MOOD = DEFAULT_ENERGY;
export const normMood = m => (typeof m === 'string' && Object.prototype.hasOwnProperty.call(MOODS, m) ? m : pct(m));

/** Device-wide reactivity, all 0..100 % (0.1.3): Energy (was Mood), Sensitivity (x0.25..x1..x3) and Auto-gain strength (0 % = off, 50 % = 0.1.2's on, 100 % = stronger). */
export const REACT_KEY_V1 = 'wavwiz.viz.react.v1';
export const REACT_KEY = 'wavwiz.viz.react.v2';
export const SENS_MAP = [0.25, 1, 3, 'log'];
export const AGC_MAP = [0, 1, 2];
export const DEFAULT_SENSITIVITY = 50;
export const DEFAULT_REACT = Object.freeze({ energy: 50, sensitivity: 50, autoGain: 50 });
/** 0.0.8/0.1.1 saved reactivity: Mood calm (the old default) -> 50 %, balanced -> 70 %, energetic -> 100 %; Sensitivity 0.8 (old default) -> 50 %, else the same value; auto-gain on/off -> 50 % / 0 %. */
export function migrateReact(r1 = {}) {
  const energy = r1.mood === 'energetic' ? 100 : r1.mood === 'balanced' ? 70 : 50;
  const s = Number(r1.sensitivity), sensitivity = r1.v !== 2 || !Number.isFinite(s) || Math.abs(s - 0.8) < 1e-6 ? 50 : pinv(s, SENS_MAP);
  return { energy, sensitivity, autoGain: r1.autoGain === false ? 0 : 50 };
}
export function loadReact(st = store()) {
  let r = null; try { r = JSON.parse(st?.getItem(REACT_KEY) || 'null'); } catch { r = null; }
  if (!r || typeof r !== 'object') { let r1 = null; try { r1 = JSON.parse(st?.getItem(REACT_KEY_V1) || 'null'); } catch { r1 = null; } return r1 ? migrateReact(r1) : { ...DEFAULT_REACT }; }
  return { energy: pct(r.energy), sensitivity: pct(r.sensitivity), autoGain: pct(r.autoGain) };
}
export function saveReact(r, st = store()) { const c = { energy: pct(r.energy), sensitivity: pct(r.sensitivity), autoGain: pct(r.autoGain) }; try { st?.setItem(REACT_KEY, JSON.stringify(c)); } catch { /* private mode */ } return c; }
/** What the analyzer runs with: raw sensitivity multiplier, auto-gain strength (0..2) and the Energy level. */
export const reactRaw = r => ({ sensitivity: pmap(r.sensitivity, SENS_MAP), autoGain: pmap(r.autoGain, AGC_MAP), energy: pct(r.energy) });

/** 0.1.3 post-processing, device-wide, 0..100 % each (default 50 %, 0 % = off). Every effect respects the Quality setting. */
export const POST_KEY = 'wavwiz.viz.post.v1';
export const POST = [['bloom', 'Soft bloom', [0, 0.55, 1.6], 'glow around bright light'], ['streaks', 'Light streaks', [0, 0.4, 1.3], 'horizontal flares off bright spots (High/Ultra)'],
  ['fringe', 'Color fringing on big hits', [0, 0.5, 1.6], 'subtle red/blue edge split on kicks'], ['depth', 'Depth blur', [0, 0.55, 1.2], 'Terrain and Ring: soft focus on the far distance (High/Ultra)']];
export function loadPost(st = store()) { let r = {}; try { r = JSON.parse(st?.getItem(POST_KEY) || '{}') || {}; } catch { r = {}; } return Object.fromEntries(POST.map(([k]) => [k, pct(r[k])])); }
export function savePost(p, st = store()) { const c = Object.fromEntries(POST.map(([k]) => [k, pct(p?.[k])])); try { st?.setItem(POST_KEY, JSON.stringify(c)); } catch { /* private mode */ } return c; }
export const postRaw = p => Object.fromEntries(POST.map(([k, , m]) => [k, pmap(p[k], m)]));

/**
 * 0.1.3 Quality: Auto / Low / High / Ultra. dpr = backing-store pixel ratio cap, fps = frame cap (0 = display rate), particles = x GPU particle counts,
 * trails = x trail length, bloom = blur levels, streaks/depth = those post effects allowed, hdr = half-float render targets allowed.
 * 'min' and 'tiny' are not offered: the Auto frame-time governor steps a struggling phone down to them.
 */
export const QUALITY_LIST = [['auto', 'Auto (recommended)'], ['low', 'Low (phones, battery)'], ['high', 'High'], ['ultra', 'Ultra (strong PCs)']];
export const QUALITY = Object.freeze({
  tiny: Object.freeze({ tier: 'tiny', dpr: 0.75, fps: 30, particles: 0.05, trails: 0.7, bloom: 1, streaks: false, depth: false, hdr: false }),
  min: Object.freeze({ tier: 'min', dpr: 0.85, fps: 30, particles: 0.16, trails: 0.8, bloom: 1, streaks: false, depth: false, hdr: false }),
  low: Object.freeze({ tier: 'low', dpr: 1.25, fps: 60, particles: 0.32, trails: 0.9, bloom: 1, streaks: false, depth: false, hdr: false }),
  high: Object.freeze({ tier: 'high', dpr: 2, fps: 60, particles: 1, trails: 1, bloom: 2, streaks: true, depth: true, hdr: true }),
  ultra: Object.freeze({ tier: 'ultra', dpr: 3, fps: 0, particles: 2.6, trails: 1.25, bloom: 3, streaks: true, depth: true, hdr: true }),
});
export const TIERS = ['tiny', 'min', 'low', 'high', 'ultra'];
/** Low and the two reduced steps the governor can take below it. */
export const isLight = t => t === 'low' || t === 'min' || t === 'tiny';
export const normQuality = q => ['auto', 'low', 'high', 'ultra'].includes(q) ? q : 'auto';
/** 0.1.2 "Detail" setting -> Quality: Automatic -> Auto, Light -> Low, Full detail -> High. */
export const qualityFromLight = l => l === 'on' ? 'low' : l === 'off' ? 'high' : 'auto';
/** Auto's starting tier from what the device says about itself (pure; the browser facts are passed in). Phones and small/low-power devices -> Low;
 * software renderers -> Low; strong desktop GPUs -> Ultra; other desktops -> High. */
export function autoTier({ coarse = false, minSide = 1080, cores = 8, memory = 8, phoneUa = false, renderer = '' } = {}) {
  const r = String(renderer).toLowerCase();
  if (phoneUa || (coarse && minSide < 900) || cores <= 2 || (memory && memory <= 2)) return 'low';
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(r)) return 'low';
  if (cores <= 4 && memory && memory <= 4) return 'low';
  if (/rtx|radeon rx ?[5-9]\d{3}|rx ?[6-9]\d{3}|arc\(tm\) ?[ab]7|arc ?[ab]7|radeon pro w|quadro rtx|apple m\d (pro|max|ultra)/.test(r)) return 'ultra';
  return 'high';
}
/**
 * Frame-time governor for Auto: steps the quality DOWN when frames miss their budget (so a phone never stutters) and back UP only after a long calm
 * stretch, never above the ceiling Auto picked. push(intervalMs, workMs) per drawn frame; returns the tier to use now.
 */
export class FrameGovernor {
  constructor(ceiling = 'high', { floor = 'tiny', windowMs = 1500, upAfterMs = 12000, cooldownMs = 3000 } = {}) {
    this.ceiling = TIERS.indexOf(ceiling) < 0 ? TIERS.indexOf('high') : TIERS.indexOf(ceiling); this.floor = Math.max(0, TIERS.indexOf(floor)); this.level = this.ceiling;
    this.windowMs = windowMs; this.upAfterMs = upAfterMs; this.cooldownMs = cooldownMs; this.reset();
  }
  reset() { this.acc = 0; this.n = 0; this.miss = 0; this.work = 0; this.calm = 0; this.cool = 0; this.steps = 0; }
  get tier() { return TIERS[this.level]; }
  budget() { const f = QUALITY[this.tier].fps || 60; return 1000 / f; }
  push(intervalMs, workMs = 0) {
    const b = this.budget(); if (!(intervalMs > 0)) return this.tier;
    this.acc += intervalMs; this.n++; this.work += workMs; this.cool = Math.max(0, this.cool - intervalMs);
    if (intervalMs > b * 1.5 + 2) this.miss++;
    if (this.acc >= this.windowMs) {
      const missRate = this.miss / this.n, avgWork = this.work / this.n, bad = missRate > 0.2 || avgWork > b * 0.8;
      if (bad && this.cool === 0 && this.level > this.floor) { this.level--; this.cool = this.cooldownMs; this.calm = 0; this.steps++; }
      else if (!bad && missRate < 0.02 && avgWork < b * 0.35) { this.calm += this.acc; if (this.calm >= this.upAfterMs && this.level < this.ceiling) { this.level++; this.calm = 0; this.cool = this.cooldownMs; } }
      else this.calm = 0;
      this.acc = 0; this.n = 0; this.miss = 0; this.work = 0;
    }
    return this.tier;
  }
}

/** The settings a look actually runs with (raw values): its saved percentages mapped through their anchors, scaled by the Energy level.
 * The sliders on the Visualizer page show the saved percentages. `mood` is the Energy level (0..100) or a 0.1.1 mood name. */
export function effectiveSettings(engine, mood = loadReact().energy, st = store()) {
  const k = normEngine(engine), s = loadSettings(k, st), m = moodAt(mood), fx = {};
  for (const d of FX[k] || []) fx[d[0]] = d[2] === null ? s.fx[d[0]] : pmap(s.fx[d[0]], d[2]);
  return { colorMode: s.colorMode, primary: s.primary, secondary: s.secondary, accent: s.accent,
    intensity: pmap(s.intensity, RANGES.intensity) * m.intensity, speed: pmap(s.speed, RANGES.speed) * m.speed, density: pmap(s.density, RANGES.density) * m.density,
    shake: pmap(s.shake, RANGES.shake) * Math.min(1, m.shake * 1.6), fx, mood: normMood(mood) };
}

export const hexRgb = hex => { const n = parseInt(String(hex).slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const lighten = (c, t) => c.map(v => v + (1 - v) * t);
/** Colors as 0..1 RGB: theme mode uses --accent / --accent2 and a hot near-white accent; custom mode uses the three pickers. */
export function palette(settings, theme = {}) {
  const s = cleanSettings(settings), m = moodAt(settings?.mood ?? 'energetic');
  // 0.1.1: calmer moods soften the colors a little (toward their own luminance, slightly darker) and cool the near-white glow accent
  const soft = c => { const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; return c.map(v => (v + (l - v) * m.soften) * (1 - m.soften * 0.35)); };
  if (s.colorMode === 'custom') return { p: soft(hexRgb(s.primary)), s: soft(hexRgb(s.secondary)), a: soft(hexRgb(s.accent)) };
  const p = hexRgb(hexOk(theme.accent) ? theme.accent : DEFAULT_SETTINGS.primary), q = hexRgb(hexOk(theme.accent2) ? theme.accent2 : DEFAULT_SETTINGS.secondary);
  return { p: soft(p), s: soft(q), a: soft(lighten(p, m.glow)) };
}

/** Auto-gain: a loudness envelope with a fast rise and a slow (≈4 s) fall; the gain brings the envelope to a common level so a quiet acoustic track
 * moves the picture as much as a loud master. Sensitivity multiplies on top. Returns the linear gain (1 when auto-gain is off, times sensitivity). */
export class AutoGain {
  constructor() { this.env = 0; }
  /** on: true/false (0.0.8) or a strength 0..2 (0.1.3: 0 = off, 1 = the 0.1.2 auto-gain, 2 = stronger leveling and a hotter target). */
  push(level, dtMs, on = true, sensitivity = 1) {
    const up = Math.min(1, dtMs / 160), down = Math.min(1, dtMs / 5000);
    this.env += (level - this.env) * (level > this.env ? up : down);
    const k = on === true ? 1 : on === false ? 0 : Math.min(2, Math.max(0, Number(on) || 0));
    if (k <= 0.001) return 1.4 * sensitivity;
    const agc = Math.min(24, Math.max(0.8, 0.22 * (1 + Math.max(0, k - 1) * 0.6) / Math.max(this.env, 0.006)));
    const g = k < 1 ? Math.pow(1.4, 1 - k) * Math.pow(agc, k) : agc;
    return g * sensitivity;
  }
}

/** Onset detector on spectral flux (how much the band energy just rose) against an adaptive mean + k·deviation, with a short lock-out.
 * Catches kicks/snares in dense mixes far better than a plain "bass above average" test, and sensitivity lowers k. */
export class Onset {
  constructor(lockMs = 140) { this.mean = 0; this.dev = 0.02; this.lock = 0; this.lockMs = lockMs; this.pulse = 0; }
  push(flux, dtMs, sensitivity = 1, gate = 0, kMul = 1) {
    this.lock = Math.max(0, this.lock - dtMs);
    const k = kMul * 1.35 / Math.sqrt(Math.max(0.25, sensitivity)), thr = this.mean + k * this.dev + 0.015;
    const hit = flux > thr && flux > gate && this.lock === 0;
    if (hit) { this.lock = this.lockMs; this.pulse = 1; }
    const a = Math.min(1, dtMs / 700); this.mean += (flux - this.mean) * a; this.dev += (Math.abs(flux - this.mean) - this.dev) * a;
    this.pulse *= Math.exp(-dtMs / 220);
    return hit;
  }
}

const dbOf = v => 20 * Math.log10(Math.max(1e-5, v));

/**
 * Audio features for one frame from the 1024-sample waveform (or null = nothing audible). Everything is time-based (dtMs), so 30 fps phones and
 * 120 Hz screens move the same. Values: bass/mid/high/level 0..1 (after auto-gain), kick/snare (true on the frame of an onset), beat (pulse 0..1),
 * flash (bloom, decays fast), surge (speed boost), shake (camera shake), energy (smoothed loudness), idle (calm state), bands (64 log bands, fast attack /
 * slow release), peaks (64 peak caps: jump at once, hold, then fall slowly), wave (256 points -1..1), lr (stereo dBFS rms/peak, from the server when sent).
 * 0.0.8: auto-gain + sensitivity + spectral-flux onsets for much stronger motion.
 */
export class Features {
  constructor() {
    this.mags = new Float64Array(512); this.raw = new Float64Array(64); this.prevRaw = new Float64Array(64); this.bands = new Float64Array(64); this.wave = new Float32Array(256);
    this.peaks = new Float64Array(64); this.peakV = new Float64Array(64); this.peakHold = new Float64Array(64);
    this.agc = new AutoGain(); this.kickOn = new Onset(150); this.snareOn = new Onset(110); this.sensitivity = 1; this.autoGain = true; this.mood = DEFAULT_MOOD;
    this.lr = { rmsL: -80, rmsR: -80, pkL: -80, pkR: -80, stereo: false }; this.reset();
  }
  reset() { this.bass = 0; this.mid = 0; this.high = 0; this.level = 0; this.rawLevel = 0; this.energy = 0; this.flash = 0; this.surge = 0; this.shake = 0; this.beat = 0; this.kick = false; this.snare = false; this.idle = true; this.idleFor = 1e9; this.kicks = 0; this.t = 0; this.gain = 1; }
  /** extra (optional): 4 bytes after the waveform from /ws/viz = dBFS rms L, rms R, peak L, peak R as (dB + 72) * 255 / 72. */
  push(wave, dtMs = 16.7, extra = null) {
    const M = moodAt(this.mood);
    const dt = Math.min(100, Math.max(1, dtMs)), k = dt / 16.7, sens = this.sensitivity * M.sens; this.t += dt; this.kick = false; this.snare = false;
    this.kickOn.lockMs = M.lock + 10; this.snareOn.lockMs = M.lock - 30;
    if (wave && wave.length >= 1024) {
      let s2 = 0; for (let i = 0; i < 1024; i++) { const v = ((wave[i] ?? 128) - 128) / 128; s2 += v * v; } this.rawLevel = Math.sqrt(s2 / 1024);
      this.gain = this.agc.push(this.rawLevel, dt, this.autoGain, sens);
      magnitudes(wave, this.mags); bands(this.mags, 64, this.raw, 20 * Math.log10(this.gain), 58);
      // fast attack, slower release (time-based)
      const rel = 1 - Math.exp(-dt / M.rel);
      for (let i = 0; i < 64; i++) { const p = this.bands[i], n = this.raw[i]; this.bands[i] = n > p ? p + (n - p) * Math.min(1, M.attack * k) : p + (n - p) * rel; }
      const avg = (a, b) => { let s = 0, m = 0; for (let i = a; i < b; i++) { s += this.bands[i]; m = Math.max(m, this.bands[i]); } return 0.45 * s / (b - a) + 0.55 * m; };     // avg + max: a narrow kick still drives big motion
      this.bass = avg(0, 7); this.mid = avg(16, 34); this.high = avg(40, 62); this.level = Math.min(1, this.rawLevel * this.gain * 1.6);
      for (let i = 0; i < 256; i++) { const v = Math.max(-1, Math.min(1, ((wave[i * 4] ?? 128) - 128) / 128 * Math.min(6, this.gain))); this.wave[i] += (v - this.wave[i]) * Math.min(1, M.wave * k); }
      let fk = 0, fs = 0; for (let i = 0; i < 8; i++) fk += Math.max(0, this.raw[i] - this.prevRaw[i]); for (let i = 18; i < 42; i++) fs += Math.max(0, this.raw[i] - this.prevRaw[i]);
      fk /= 8; fs /= 24; this.prevRaw.set(this.raw);
      this.kick = this.kickOn.push(fk, dt, sens, 0.035, M.onsetK) && this.bass > 0.12;
      this.snare = !this.kick && this.snareOn.push(fs, dt, sens, 0.03, M.onsetK) && this.mid > 0.1;
      if (extra && extra.length >= 4) { const d = b => b * 72 / 255 - 72; this.lr = { rmsL: d(extra[0]), rmsR: d(extra[1]), pkL: d(extra[2]), pkR: d(extra[3]), stereo: true }; }
      else { const db = dbOf(this.rawLevel); this.lr = { rmsL: db, rmsR: db, pkL: db + 3, pkR: db + 3, stereo: false }; }
    } else {
      const f = Math.pow(0.9, k);
      for (let i = 0; i < 64; i++) this.bands[i] *= f;
      for (let i = 0; i < 256; i++) this.wave[i] *= Math.pow(0.85, k);
      this.kickOn.push(0, dt); this.snareOn.push(0, dt); this.prevRaw.fill(0);
      this.bass *= f; this.mid *= f; this.high *= f; this.level = 0; this.rawLevel = 0;
      this.lr = { rmsL: -80, rmsR: -80, pkL: -80, pkR: -80, stereo: false };
    }
    // peak caps: jump instantly, hold ~120 ms, then fall with growing speed (slow at first)
    for (let i = 0; i < 64; i++) {
      if (this.bands[i] >= this.peaks[i]) { this.peaks[i] = this.bands[i]; this.peakV[i] = 0; this.peakHold[i] = M.capHold; }
      else if ((this.peakHold[i] -= dt) <= 0) { this.peakV[i] += M.capFall * dt; this.peaks[i] = Math.max(this.bands[i], this.peaks[i] - this.peakV[i] * dt); }
    }
    const loud = this.rawLevel > 0.006 || this.bass > 0.08;
    this.idleFor = loud ? 0 : this.idleFor + dt; this.idle = this.idleFor > 600;
    this.energy += ((this.idle ? 0 : Math.min(1, this.level * 1.2 + this.bass * 0.6)) - this.energy) * Math.min(1, M.energy * k);
    // 0.1.1: beat responses ease in (approach the target over a few frames instead of jumping) and are scaled by the Mood
    if (this.kick) { this.kicks++; this.beatT = M.beat; this.flashT = Math.min(1.4, 0.7 + this.bass * 0.9) * M.flash; this.surgeT = M.surge; if (this.bass > 0.3) this.shakeT = Math.min(1, 0.35 + this.bass * 1.2) * M.shake; }
    else if (this.snare) { this.flashT = Math.max(this.flashT || 0, 0.5 * M.flash); this.beatT = Math.max(this.beatT || 0, 0.6 * M.beat); }
    const ease = M.ease >= 0.999 ? 1 : Math.min(1, M.ease * k);
    const up = (cur, tgt) => (tgt > cur ? cur + (tgt - cur) * ease : cur);
    this.flash = up(this.flash, this.flashT || 0); this.surge = up(this.surge, this.surgeT || 0); this.shake = up(this.shake, this.shakeT || 0); this.beat = up(this.beat, this.beatT || 0);
    const fall = Math.pow(M.fall, k); this.flashT = (this.flashT || 0) * fall; this.surgeT = (this.surgeT || 0) * fall; this.shakeT = (this.shakeT || 0) * fall; this.beatT = (this.beatT || 0) * fall;
    this.flash *= Math.pow(M.flashDecay, k); this.surge *= Math.pow(M.surgeDecay, k); this.shake *= Math.pow(M.shakeDecay, k); this.beat *= Math.exp(-dt / M.beatMs);
    return this;
  }
}

/** Small deterministic PRNG (tests and stable layouts). */
export function rng(seed = 1) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/** Perspective projection used by every 3D look: camera at z = -focal looking at +z; returns screen scale for depth z (z > -focal). */
export const persp = (z, focal = 1) => focal / Math.max(0.02, focal + z);

/** How many particles a look draws: base count x density x (light mode 0.8), never below 300 so a phone never shows "a few dim dots". */
export function particleCount(base, density, light) { return Math.max(300, Math.round(base * density * (light ? 0.8 : 1))); }
