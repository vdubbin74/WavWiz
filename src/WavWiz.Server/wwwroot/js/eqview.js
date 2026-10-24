// 0.2.1 F12: the main area of the Sound (EQ) dialog in three looks - LED bars (default), Studio faders, Spectrum curve - plus the faint live
// spectrum glow and the response-curve overlay. Used by the dialog (interactive) and by the Settings > Appearance preview (static example).
// Every band is a real slider for keyboard / screen readers: Up/Down 0.5 dB, PageUp/PageDown 3 dB, Home/End ±12 dB, Left/Right next band;
// drag up/down or scroll the wheel to set the gain. Only the look differs - all three drive the same 10-band DSP.
import { h } from './util.js';
import { EQ_BANDS, EQ_LABELS, dbToFrac, fracToDb, keyStep, fmtDb, logX, colX, snapDb, approxResponse, wheelGain } from './eqstyle.js';
import { iconSvg } from './icons.js';
import { magnitudes, smooth, eqBandLevels, eqBandsFromMags, EQ_HZ } from './vizmath.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const SEGS = 24, LEDS = 34;   // 0.3.6 K11: LEDS = segments of each live level bar
const TITLES = { led: ['10-BAND EQ', '±12 dB · 0.5 dB steps · drag a cap'], faders: ['GRAPHIC EQ', '10 bands · ±12 dB · 0.5 dB steps'], curve: ['SPECTRUM', '20 Hz to 20 kHz · ±12 dB · drag a node'] };
const hzText = i => (EQ_BANDS[i] >= 1000 ? EQ_LABELS[i] : EQ_LABELS[i] + ' Hz');
const valCls = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero');
/** 0.3.6 K11: LED bar colors per theme (CSS --led-lo / --led-mid / --led-hi, set in theme.js derive()); parsed once per look. */
const hexRgb = c => { c = String(c || '').trim(); const m = /^#([0-9a-f]{6})$/i.exec(c); if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; } const r = /rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c); return r ? [+r[1], +r[2], +r[3]] : [61, 220, 132]; };
const ledRamp = (lo, mid, hi, u) => { const [a, b, t] = u < 0.62 ? [lo, mid, u / 0.62] : [mid, hi, (u - 0.62) / 0.38]; return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; };

export function eqArea({ style = 'led', gains = new Array(10).fill(0), glow = 50, interactive = true, locked = false, onChange = () => {}, onSelect = () => {} } = {}) {
  let isLocked = !!locked;
  let g = gains.slice(), sel = -1, glowLvl = glow, untap = null, meter = new Float64Array(10), peaks = new Float64Array(10), peakAt = new Float64Array(10), ledKey = '', ramp = null;
  const leds = [], mkLed = i => { const c = h('canvas', { class: 'eqled', 'aria-hidden': 'true', 'data-led': i }); leds.push(c); return c; };
  const xOf = style === 'curve' ? hz => logX(hz) : hz => colX(hz);
  const live = h('span', { class: 'eqa-live', hidden: true }, h('i', { 'aria-hidden': 'true' }), 'Live music');
  // 0.2.3 U9: small padlock shown on the area while Lock EQ is on
  const lockMark = h('span', { class: 'eqa-lock', title: 'Lock EQ is on - uncheck it to change the EQ', hidden: true }); lockMark.innerHTML = iconSvg('lock');
  const head = h('div', { class: 'eqa-h' }, h('b', null, TITLES[style][0]), h('span', { class: 'small dim' }, TITLES[style][1]), h('span', { class: 'grow' }), live, lockMark);
  const grid = h('div', { class: 'eqa-grid', 'aria-hidden': 'true' }, [12, 6, 0, -6, -12].map(db => h('i', { class: db === 0 ? 'zero' : '', style: `top:${dbToFrac(db) * 100}%` })));
  const scale = h('div', { class: 'eqa-scale', 'aria-hidden': 'true' }, [12, 6, 0, -6, -12].map(db => h('span', { style: `top:${dbToFrac(db) * 100}%` }, db === 0 ? '0 dB' : (db > 0 ? '+' : '') + db)));
  const curve = svg('svg', { class: 'eqa-curve', viewBox: '0 0 1000 1000', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const path = svg('path', { 'vector-effect': 'non-scaling-stroke' }); curve.append(path);
  const tip = h('div', { class: 'eqa-tip', hidden: true, role: 'status', 'aria-live': 'polite' });
  const field = h('div', { class: 'eqa-field' }, grid);
  const bandEls = [];

  // --- the 10 bands -------------------------------------------------------------------------------------------------
  const sliderAttrs = i => ({ role: 'slider', tabindex: interactive ? 0 : -1, 'aria-label': `${hzText(i)} band`, 'aria-valuemin': -12, 'aria-valuemax': 12, 'data-band': i });
  if (style === 'curve') {
    const vgrid = h('div', { class: 'eqa-vgrid', 'aria-hidden': 'true' }, [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map(f => h('i', { style: `left:${logX(f) * 100}%` }, h('span', null, f >= 1000 ? f / 1000 + 'k' : String(f)))));
    field.append(vgrid, curve);
    EQ_BANDS.forEach((hz, i) => { const led = mkLed(i); led.style.left = logX(hz) * 100 + '%'; field.append(led); });
    EQ_BANDS.forEach((hz, i) => { const n = h('div', { class: 'eqn', ...sliderAttrs(i), style: `left:${logX(hz) * 100}%` }, String(i + 1)); bandEls.push(n); field.append(n); });
  } else {
    const cols = h('div', { class: 'eqa-cols' });
    EQ_BANDS.forEach((hz, i) => {
      const val = h('span', { class: 'eqb-val' }), hzl = h('span', { class: 'eqb-hz', title: hzText(i) }, EQ_LABELS[i], hz < 1000 ? h('span', { class: 'eqb-hzu' }, ' Hz') : null);   // 0.4.3 #3: the ' Hz' unit drops out when the graph is narrow
      let col;
      if (style === 'led') {
        const segs = h('div', { class: 'eqb-segs', 'aria-hidden': 'true' }, Array.from({ length: SEGS }, () => h('i')));
        col = h('div', { class: 'eqb', ...sliderAttrs(i) }, val, segs, mkLed(i), h('span', { class: 'eqb-cap', 'aria-hidden': 'true' }), hzl);
      } else {
        const ticks = h('div', { class: 'eqb-ticks', 'aria-hidden': 'true' }, Array.from({ length: 9 }, (_, k) => h('i', { style: `top:${k * 12.5}%` })));
        col = h('div', { class: 'eqb', ...sliderAttrs(i) }, val, ticks, h('span', { class: 'eqb-slot', 'aria-hidden': 'true' }), h('span', { class: 'eqb-fill', 'aria-hidden': 'true' }), mkLed(i), h('span', { class: 'eqb-knob', 'aria-hidden': 'true' }), hzl);
      }
      bandEls.push(col); cols.append(col);
    });
    field.append(cols, curve);
  }
  field.append(tip);
  const chips = style === 'curve' ? h('div', { class: 'eqchips' }, EQ_BANDS.map((_, i) => h('button', { type: 'button', class: 'eqchip', tabindex: interactive ? 0 : -1, 'data-band': i, onclick: () => { select(i); bandEls[i].focus(); } }, h('b', null, String(i + 1)), h('span', null, EQ_LABELS[i]), h('span', { class: 'v' })))) : null;
  const plot = h('div', { class: 'eqa-plot' }, scale, field);
  const el = h('div', { class: 'eqarea', 'data-eqstyle': style }, head, plot, chips);
  if (!interactive) el.setAttribute('inert', '');

  function paintBand(i) {
    const v = g[i], b = bandEls[i], y = dbToFrac(v) * 100, z = dbToFrac(0) * 100;
    b.setAttribute('aria-valuenow', String(v)); b.setAttribute('aria-valuetext', `${fmtDb(v)} dB at ${hzText(i)}`);
    b.classList.toggle('sel', i === sel);
    if (style === 'curve') {
      b.style.top = y + '%';
      const c = chips.children[i]; c.classList.toggle('on', i === sel); const vs = c.querySelector('.v'); vs.textContent = fmtDb(v); vs.className = 'v ' + valCls(v);
    } else {
      const val = b.querySelector('.eqb-val'); val.textContent = fmtDb(v); val.className = 'eqb-val ' + valCls(v);
      b.style.setProperty('--y', y + '%'); b.style.setProperty('--z', z + '%');
      if (style === 'led') {
        const segs = b.querySelector('.eqb-segs').children;
        for (let k = 0; k < SEGS; k++) { const top = 12 - k, bot = top - 1, lit = v > 0 ? bot >= 0 && top <= v + 0.25 : v < 0 ? top <= 0 && bot >= v - 0.25 : false; segs[k].className = lit ? (v > 0 ? 'lit up' : 'lit dn') : ''; }
      } else {
        const f = b.querySelector('.eqb-fill'); f.style.top = Math.min(y, z) + '%'; f.style.height = Math.abs(y - z) + '%';
      }
    }
  }
  function paintTip() {
    if (sel < 0) { tip.hidden = true; return; }
    tip.hidden = false; tip.textContent = `${hzText(sel)} · ${fmtDb(g[sel])} dB`;
    const x = style === 'curve' ? logX(EQ_BANDS[sel]) : (sel + 0.5) / 10;
    tip.style.left = `clamp(60px, ${x * 100}%, calc(100% - 60px))`; tip.style.top = dbToFrac(g[sel]) * 100 + '%';
  }
  function setGains(n) { g = n.map(snapDb); g.forEach((_, i) => paintBand(i)); paintTip(); }
  function set(i, db, fire = true) { db = snapDb(db); if (db === g[i]) return; g[i] = db; paintBand(i); paintTip(); if (fire) onChange(i, db); }
  function select(i) { const was = sel; sel = i; if (was >= 0) paintBand(was); if (i >= 0) paintBand(i); paintTip(); onSelect(i); }
  function setResponse(r) {
    if (!r?.hz?.length) r = approxResponse(g);
    // draw the EQ's shape: the server curve includes the automatic pre-gain (a flat level drop) - add it back so the line meets the bands
    const pg = Number(r.preGainDb) || 0;
    let d = ''; r.hz.forEach((hz, k) => { const x = xOf(hz); if (style !== 'curve' && (x < 0 || x > 1)) return; d += (d ? 'L' : 'M') + (Math.max(0, Math.min(1, x)) * 1000).toFixed(1) + ' ' + (dbToFrac(r.db[k] - pg) * 1000).toFixed(1); });
    path.setAttribute('d', d);
  }

  // --- interaction --------------------------------------------------------------------------------------------------
  if (interactive) bandEls.forEach((b, i) => {
    const at = ev => { const r = field.getBoundingClientRect(); return fracToDb((ev.clientY - r.top) / r.height); };
    b.addEventListener('pointerdown', ev => { if (isLocked) return; ev.preventDefault(); b.focus({ preventScroll: true }); select(i); b.setPointerCapture?.(ev.pointerId); b._drag = true; set(i, at(ev)); el.classList.add('dragging'); });
    b.addEventListener('pointermove', ev => { if (b._drag) set(i, at(ev)); });
    const end = () => { b._drag = false; el.classList.remove('dragging'); };
    b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
    // wheel fine-adjusts by default; with Lock EQ on it is left alone, so the page scrolls instead (U9)
    b.addEventListener('wheel', ev => { const v = wheelGain(isLocked, g[i], ev.deltaY); if (v == null) return; ev.preventDefault(); select(i); set(i, v); }, { passive: false });
    b.addEventListener('focus', () => select(i));
    b.addEventListener('blur', () => { if (sel === i && !b._drag) { sel = -1; paintBand(i); paintTip(); } });
    b.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); const n = bandEls[Math.max(0, Math.min(9, i + (ev.key === 'ArrowRight' ? 1 : -1)))]; n.focus(); return; }
      if (isLocked) return;
      const v = keyStep(ev.key, g[i]); if (v == null) return; ev.preventDefault(); set(i, v);
    });
  });

  // --- live LED bars (0.3.6 K11) ------------------------------------------------------------------------------------
  // Permanent vertical LED bars (34 segments) on every band slider. Each bar shows the REAL level of its own band (centered on the slider label),
  // with a peak-hold dot that falls slowly and a soft glow (the look's Glow setting). The spectrum glow behind the EQ is gone.
  function colors() {
    const cs = getComputedStyle(el), lo = cs.getPropertyValue('--led-lo'), mid = cs.getPropertyValue('--led-mid'), hi = cs.getPropertyValue('--led-hi'), key = lo + mid + hi;
    if (key !== ledKey || !ramp) { ledKey = key; const L = hexRgb(lo), M = hexRgb(mid), H = hexRgb(hi); ramp = Array.from({ length: LEDS }, (_, k) => ledRamp(L, M, H, k / (LEDS - 1))); }
    return ramp;
  }
  function drawGlow() { paintMeters(); }   // kept for the callers that redraw after a resize / glow change: it repaints the bars now
  function paintMeters() {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1), cols = colors(), glowK = glowLvl / 100;
    leds.forEach((c, i) => {
      const w = c.clientWidth, hh = c.clientHeight; if (!w || !hh) return;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); }
      const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, hh);
      const gap = Math.max(1, hh / 260), segH = (hh - (LEDS - 1) * gap) / LEDS, lit = Math.round(meter[i] * LEDS), pk = peaks[i] > 0.02 ? Math.min(LEDS - 1, Math.max(0, Math.round(peaks[i] * LEDS) - 1)) : -1, inset = Math.max(0, w * 0.12);
      for (let k = 0; k < LEDS; k++) {
        const y = hh - (k + 1) * segH - k * gap, on = k < lit; x.fillStyle = cols[k]; x.globalAlpha = on ? 1 : 0.16;
        if (on && glowK > 0) { x.shadowColor = cols[k]; x.shadowBlur = 7 * glowK; } else x.shadowBlur = 0;
        x.fillRect(inset, y, w - 2 * inset, Math.max(1, segH));
      }
      x.shadowBlur = 0;
      if (pk >= 0) { const y = hh - (pk + 1) * segH - pk * gap + segH / 2; x.globalAlpha = 1; x.fillStyle = '#fff'; if (glowK > 0) { x.shadowColor = '#fff'; x.shadowBlur = 8 * glowK; } x.beginPath(); x.arc(w / 2, y, Math.max(2.2, Math.min(w * 0.22, 4)), 0, Math.PI * 2); x.fill(); x.shadowBlur = 0; }
      x.globalAlpha = 1;
    });
  }
  const tmp10 = new Float64Array(10);
  function onFrame(win, audible, bandBytes) {
    live.hidden = !audible;
    if (win && bandBytes) smooth(meter, eqBandLevels(bandBytes, tmp10));                    // the server's real 8192-point octave bands
    else if (win) smooth(meter, eqBandsFromMags(magnitudes(win), tmp10));                    // older server: browser FFT, same band centers
    else smooth(meter, tmp10.fill(0));
    const now = performance.now();
    for (let i = 0; i < 10; i++) { if (meter[i] >= peaks[i]) { peaks[i] = meter[i]; peakAt[i] = now; } else if (now - peakAt[i] > 700) peaks[i] = Math.max(meter[i], peaks[i] - 0.012); }
    paintMeters();
  }
  /** A still example spectrum (Appearance preview, or before the first live frame). */
  function exampleSpectrum() { for (let i = 0; i < 10; i++) { meter[i] = Math.max(0.1, 0.8 - i * 0.06 + (i % 3) * 0.05); peaks[i] = Math.min(1, meter[i] + 0.1); } }
  function setGlow(v) { glowLvl = v; drawGlow(); }
  /** U9: Lock EQ - bands ignore wheel / drag / click / keys and look slightly dimmed with a small lock. */
  function setLocked(v) {
    isLocked = !!v; el.classList.toggle('locked', isLocked); lockMark.hidden = true; if (isLocked) el.title = 'EQ locked'; else el.removeAttribute('title');   // 0.3.2 F19: no dimming, no mark on the EQ itself
    bandEls.forEach(b => { if (isLocked) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled'); if (isLocked && b._drag) { b._drag = false; el.classList.remove('dragging'); } });
  }
  function startLive(tap) { if (untap || !tap) return; untap = tap(onFrame); }
  function stopLive() { untap?.(); untap = null; }   // 0.3.1 B15: off-screen previews stop listening
  function destroy() { untap?.(); untap = null; ro?.disconnect(); }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => paintMeters()) : null; ro?.observe(field);
  setGains(g); setResponse(null); if (interactive) setLocked(isLocked);
  if (!interactive) { exampleSpectrum(); paintMeters(); requestAnimationFrame(paintMeters); }
  return { el, setGains, setResponse, setGlow, setLocked, get locked() { return isLocked; }, select, startLive, stopLive, destroy, exampleSpectrum: () => { exampleSpectrum(); drawGlow(); paintMeters(); }, get gains() { return g.slice(); } };
}

/** 0.2.3 U9: the "Lock EQ" checkbox (padlock icon + label), used in the Sound (EQ) dialog header and on the Appearance > EQ preview. */
export function eqLockBox(checked, onToggle) {
  const i = h('input', { type: 'checkbox', checked: !!checked, 'data-eqlock': '1', onchange: ev => onToggle(ev.target.checked) });
  const ic = h('span', { class: 'eqlock-ic', 'aria-hidden': 'true' }); ic.innerHTML = iconSvg('lock');
  const el = h('label', { class: 'eqlockbox', title: 'Lock EQ: the sliders ignore the mouse wheel, dragging and clicks, so scrolling never changes the sound' }, i, ic, h('span', null, 'Lock EQ'));
  return { el, input: i, set: v => { i.checked = !!v; } };
}
