// 0.5.0 F95: small CSS thumbnails for Settings > Appearance > Now Playing (Track bar / Buttons pickers). No app imports, so node tests can load it.
import { h } from './util.js';
import { iconSvg } from './icons.js';
import { waveBars, eqBars } from './npstyle.js';

/** 0.5.0 F95: tiny CSS thumbnails for the Track bar / Buttons pickers (same look rules as the panel, drawn small). */
export function npSeekMini(id) {
  const f = 0.42, bars = (n, fn) => fn('mini', n).map(v => h('i', { style: `height:${Math.round(v * 100)}%` }));
  const body = id === 'wave' ? [h('div', { class: 'pn-wbars' }, ...bars(40, waveBars)), h('div', { class: 'pn-wclip', style: `clip-path:inset(0 ${100 - f * 100}% 0 0)` }, h('div', { class: 'pn-wbars on' }, ...bars(40, waveBars)))]
    : id === 'eq' ? [h('div', { class: 'pn-eqbars' }, ...bars(14, eqBars)), h('div', { class: 'pn-wclip', style: `clip-path:inset(0 ${100 - f * 100}% 0 0)` }, h('div', { class: 'pn-eqbars on' }, ...bars(14, eqBars)))]
    : id === 'led' ? [h('div', { class: 'pn-ledfill', style: `width:${f * 100}%` })]
    : [h('div', { class: 'bar' }), h('div', { class: 'fill', style: `width:${f * 100}%` }), h('div', { class: 'knob', style: `left:${f * 100}%` })];
  return h('div', { class: 'npmini npmini-seek', 'data-seek': id }, h('div', { class: 'npm-s npm-s-' + id }, ...body), h('div', { class: 'npm-times' }, h('span', null, '1:24'), h('span', null, '-1:56')));
}
export function npBtnMini(id) {
  const b = (n, cls = '') => { const x = h('span', { class: 'npm-b ' + cls }); x.innerHTML = iconSvg(n); return x; };
  return h('div', { class: 'npmini npmini-btn npm-btn-' + id, 'data-buttons': id }, b('shuffle'), b('prev'), b('pause', 'play'), b('next'), b('repeat'));
}
/** 0.5.0 F96: tiny Album art thumbnails (square outline at ~42 %, spinning disc, sleeve with the vinyl peeking out). */
export function npArtMini(id) {
  const f = 0.42, cov = () => h('div', { class: 'npm-cov' }, h('span', null, '\u266a'));
  const ring = h('span', { class: 'npm-ring' }); ring.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><rect class="trk" x="2" y="2" width="96" height="96" rx="10" pathLength="100"/><rect class="val" x="2" y="2" width="96" height="96" rx="10" pathLength="100" style="stroke-dashoffset:${100 - f * 100}"/></svg>`;
  const cass = () => { const sp = (s, t) => h('span', { class: 'npm-sp npm-sp-' + s }, h('i', { class: 'npm-tape', style: `--t:${t}` }), h('i', { class: 'npm-hub npm-spin' }));
    return [h('div', { class: 'npm-cass' }, h('div', { class: 'npm-clab' }), h('div', { class: 'npm-cwell' }, sp('l', 1 - f), sp('r', f)))]; };   // 0.5.0 F97
  const body = id === 'cassette' ? cass() : id === 'disc' ? [h('div', { class: 'npm-cov npm-spin' }, h('span', null, '\u266a'), h('i'))]
    : id === 'sleeve' ? [h('div', { class: 'npm-vinyl', style: `--np-frac:${f}` }, h('i')), cov()]
    : [cov(), ring];
  return h('div', { class: 'npmini npmini-art npm-art-' + id, 'data-art': id }, h('div', { class: 'npm-a' }, ...body));
}
