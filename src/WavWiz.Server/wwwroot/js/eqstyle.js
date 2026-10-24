// 0.2.1 F12: Sound (EQ) looks + pure math shared by the dialog and the Settings > Appearance preview. No DOM at import time (node-tested).
// The DSP is unchanged: 10 bands (31 Hz - 16 kHz), ±12 dB in 0.5 dB steps, per speaker. Only the main EQ area's look differs per style.
export const EQ_STYLES = [
  ['led', 'LED bars', 'Glowing LED-segment bars with a draggable cap (default)'],
  ['faders', 'Studio faders', 'A hardware-style fader per band with a small live LED meter'],
  ['curve', 'Spectrum curve', 'Drag numbered nodes on the response line over the live-music fill'],
];
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
export const EQ_MIN = -12, EQ_MAX = 12, EQ_STEP = 0.5;
export const EQ_KEY = 'wavwiz.eqstyle.v1';
export const EQ_DEFAULT = Object.freeze({ style: 'led', glow: 50 });
export const EQ_EXAMPLE = Object.freeze([5, 4, 2, 0, -1, -1, 0, 2, 3, 3.5]);     // the gains the refs and the Appearance preview show

const pct = (v, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : d; };
export function normEqPrefs(p) {
  p = p && typeof p === 'object' ? p : {};
  return { style: EQ_STYLES.some(([id]) => id === p.style) ? p.style : EQ_DEFAULT.style, glow: pct(p.glow, EQ_DEFAULT.glow) };
}
export function loadEqPrefs(store = globalThis.localStorage) { try { return normEqPrefs(JSON.parse(store?.getItem(EQ_KEY) || 'null')); } catch { return normEqPrefs(null); } }
export function saveEqPrefs(p, store = globalThis.localStorage) {
  const n = normEqPrefs(p);
  try { store?.setItem(EQ_KEY, JSON.stringify(n)); } catch { /* private mode */ }
  try { globalThis.dispatchEvent?.(new Event('wavwiz:eqstyle')); } catch { /* node */ }
  return n;
}
/** Clamp to ±12 dB and snap to 0.5 dB. */
export const snapDb = v => { const n = Math.round((Number(v) || 0) / EQ_STEP) * EQ_STEP; return Math.min(EQ_MAX, Math.max(EQ_MIN, Object.is(n, -0) ? 0 : n)); };
/** Vertical mapping: +12 dB at the top (0), -12 dB at the bottom (1). */
export const dbToFrac = db => (EQ_MAX - Math.min(EQ_MAX, Math.max(EQ_MIN, db))) / (EQ_MAX - EQ_MIN);
export const fracToDb = f => snapDb(EQ_MAX - Math.min(1, Math.max(0, f)) * (EQ_MAX - EQ_MIN));
/** Keyboard / wheel step for a band: arrows 0.5 dB, Page keys 3 dB, Home/End to the ends. */
export function keyStep(key, db) {
  switch (key) {
    case 'ArrowUp': return snapDb(db + EQ_STEP);
    case 'ArrowDown': return snapDb(db - EQ_STEP);
    case 'PageUp': return snapDb(db + 3);
    case 'PageDown': return snapDb(db - 3);
    case 'Home': return EQ_MAX;
    case 'End': return EQ_MIN;
    default: return null;
  }
}
export const fmtDb = v => (v > 0 ? '+' : '') + (+v).toFixed(1);
/** x position 0..1 of a frequency on a log axis between lo and hi. */
export const logX = (hz, lo = 20, hi = 20000) => Math.min(1, Math.max(0, Math.log(hz / lo) / Math.log(hi / lo)));
/** Columns (LED / faders): band i's centre is (i + .5) / 10; frequencies between bands fall on the log line through those centres. */
export const colX = hz => { const t = Math.log2(hz / EQ_BANDS[0]) / Math.log2(EQ_BANDS[9] / EQ_BANDS[0]); return (0.5 + t * 9) / 10; };
/** A smooth stand-in response (log-domain interpolation through the band gains) for previews before the server's real curve arrives. */
export function approxResponse(gains, n = 120) {
  const hz = [], db = [];
  for (let i = 0; i < n; i++) {
    const f = 20 * Math.pow(1000, i / (n - 1)); let s = 0, w = 0;
    EQ_BANDS.forEach((b, k) => { const d = Math.log2(f / b), g = Math.exp(-d * d * 1.4); s += g * (gains[k] || 0); w += g; });
    hz.push(+f.toFixed(1)); db.push(+(w > 1e-6 ? s / Math.max(w, 1) : 0).toFixed(2));
  }
  return { hz, db };
}
/** Glow wording per style (C says "fill"). */
export const glowWords = style => style === 'curve' ? ['Spectrum glow', 'Brightness of the live-music fill'] : ['Spectrum glow', 'The faint live-music glow behind the bars'];

// 0.2.3 U9: "Lock EQ". The mouse wheel fine-adjusts a band by default; locked, the bands ignore the wheel (the page scrolls instead), drag,
// click and keys. Remembered per device (this browser). The Appearance > EQ preview always opens locked (U10) and does not change this.
export const EQ_LOCK_KEY = 'wavwiz.eqlock.v1';
export function loadEqLock(store = globalThis.localStorage) { try { return store?.getItem(EQ_LOCK_KEY) === '1'; } catch { return false; } }
export function saveEqLock(on, store = globalThis.localStorage) { try { store?.setItem(EQ_LOCK_KEY, on ? '1' : '0'); } catch { /* private mode */ } try { globalThis.dispatchEvent?.(new CustomEvent('wavwiz:eqlock', { detail: !!on })); } catch { /* node tests */ } return !!on; }
/** Mouse wheel over a band: the new gain (one 0.5 dB step per notch, up = louder), or null = leave the event alone so the page scrolls. */
export function wheelGain(locked, db, deltaY) { if (locked || !deltaY) return null; return snapDb(db + (deltaY < 0 ? EQ_STEP : -EQ_STEP)); }
/** 0.2.3 U10: the speaker the Appearance > EQ preview mirrors - this device's own speaker when it is one, else the active (or first)
 *  connected output, like the Sound (EQ) dialog. null = no speaker connected (the preview then shows example values). */
export function eqTarget(zones = [], mine = null) {
  const outs = (zones || []).flatMap(z => (z.outputs || []).map(o => ({ ...o, zone: z.name, zoneId: z.id }))).filter(o => o.connected || o.active);
  return (mine && outs.find(o => o.zoneId === mine.id)) || outs.find(o => o.active) || outs[0] || null;
}
/** 0.4.3 #5: the default speaker the Home EQ adjusts: the first speaker (in zone order) of the Controlling zone that has a live output. Null when there is
 * no Controlling zone or none of its speakers is online (callers fall back to eqTarget). Pure, unit-tested. */
export function controllingTarget(zones = [], groups = [], cur = null) {
  if (!cur || cur.kind !== 'zone') return null; const g = (groups || []).find(x => x.id === cur.id); if (!g) return null;
  for (const z of (zones || []).filter(x => (g.deviceIds || []).includes(x.id))) {   // the order the Devices panel lists them
    const outs = (z.outputs || []).filter(o => o.connected || o.active); const o = outs.find(x => x.active) || outs[0];
    if (o) return { ...o, zone: z.name, zoneId: z.id };
  }
  return null;
}
/** 0.4.3 #5: short picker text: the speaker name, plus the output name only when that speaker has several outputs. */
export const pickerLabel = (o, all = []) => (all.filter(x => x.zoneId === o.zoneId).length > 1 ? `${o.zone} · ${o.name}` : o.zone);
/** U10: edits made on the Appearance page are kept in this speaker's own preset (never over a built-in or a shared preset). */
export const ownEqName = speaker => `${String(speaker || 'This speaker').trim().slice(0, 30)} EQ`;
/** U10: the one-line summary under the preview: preset, pre-gain, loudness (and Bypass / EQ off when set). */
export function eqSummary({ presetName, preGainDb = 0, loudness = false, bypass = false, enabled = true } = {}) {
  const bits = [`Preset: ${presetName || 'Flat'}`, `Pre-gain ${preGainDb ? fmtDb(preGainDb) + ' dB' : '0 dB'}`, `Loudness ${loudness ? 'on' : 'off'}`];
  if (bypass) bits.push('Bypass on'); if (!enabled) bits.push('EQ off');
  return bits.join(' · ');
}
