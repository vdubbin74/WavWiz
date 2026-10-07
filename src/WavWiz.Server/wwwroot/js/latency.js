import { h } from './util.js';

/**
 * 0.0.8: per-device delay control. A slider (0-1000 ms in 5 ms steps) kept in sync with the ms box (0-2000 ms, 1 ms steps)
 * and -/+ buttons for 1 ms fine-tuning. Changes apply live while you drag (debounced) and once more when you let go.
 * onChange(ms, final) - final is true on release / typed value / button press.
 */
export const LAT_MAX_SLIDER = 1000, LAT_STEP = 5, LAT_MAX = 2000;
export const clampMs = v => Math.max(0, Math.min(LAT_MAX, Math.round(Number.isFinite(+v) ? +v : 0)));

export function latencyControl({ value = 0, onChange = () => {}, label = 'Delay', liveMs = 220 } = {}) {
  let cur = clampMs(value), t = 0;
  const slider = h('input', { type: 'range', class: 'latslider', min: 0, max: LAT_MAX_SLIDER, step: LAT_STEP, value: Math.min(cur, LAT_MAX_SLIDER), 'aria-label': label + ' slider (milliseconds)' });
  const box = h('input', { type: 'number', class: 'latbox', min: 0, max: LAT_MAX, step: 1, value: cur, 'aria-label': label + ' in milliseconds' });
  const sync = (from) => { if (from !== 'slider') slider.value = String(Math.min(cur, LAT_MAX_SLIDER)); if (from !== 'box') box.value = String(cur); };
  const emit = final => { clearTimeout(t); if (final) onChange(cur, true); else t = setTimeout(() => onChange(cur, false), liveMs); };
  const set = (v, from, final) => { cur = clampMs(v); sync(from); emit(final); };
  slider.addEventListener('input', () => set(slider.value, 'slider', false));
  slider.addEventListener('change', () => set(slider.value, 'slider', true));
  box.addEventListener('input', () => { if (box.value !== '') set(box.value, 'box', false); });
  box.addEventListener('change', () => set(box.value, null, true));
  const nudge = d => h('button', { class: 'btn latnudge', type: 'button', 'aria-label': (d < 0 ? 'Decrease' : 'Increase') + ' delay by 1 ms', title: (d < 0 ? '-' : '+') + '1 ms', onclick: () => set(cur + d, null, true) }, d < 0 ? '−' : '+');
  const el = h('div', { class: 'latctl' }, h('span', { class: 'latlabel' }, label), nudge(-1), slider, nudge(1), box, h('span', { class: 'small dim' }, 'ms'));
  return { el, slider, box, get value() { return cur; }, set: v => { cur = clampMs(v); sync(null); } };
}
