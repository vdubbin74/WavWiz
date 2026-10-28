// 0.5.0 F98: the Album art shell (Settings > Appearance > Now Playing > Album art) as a small reusable piece, so the condensed + standalone mini
// players and the compact Now Playing strips show the same square ring / spinning disc / sliding sleeve / cassette as the panel.
// Markup matches the panel (.pn-art > .pn-disc, .pn-cass, .pn-cover, .pn-ring) so the shared .pn-art-<id> rules in app.css apply; the box
// carries its own pn-art-<id> + .playing + --np-frac, so it works outside .np-ctlpanel too.
import { h } from './util.js';
import { loadNpPrefs, normNpPrefs, NP_KEY } from './npstyle.js';

const ARTS = ['square', 'disc', 'sleeve', 'cassette'];
/** pure: the class list for an art box (one pn-art-<id>, plus playing). */
export const npArtBoxClass = (art, playing = false, extra = '') => ['npa-box', 'pn-art-' + (ARTS.includes(art) ? art : 'square'), playing ? 'playing' : '', extra].filter(Boolean).join(' ');

export function npArtBox({ cls = '', cover = null, live = true } = {}) {
  const spool = s => h('span', { class: 'pc-sp pc-' + s }, h('i', { class: 'pc-tape' }), h('i', { class: 'pc-hub' }));
  const cass = h('div', { class: 'pn-cass', 'aria-hidden': 'true' }, h('i', { class: 'pc-lbl' }),
    ...['tl', 'tr', 'bl', 'br', 'bc'].map(c => h('i', { class: 'pc-scr pc-' + c })), h('div', { class: 'pc-well' }, h('i', { class: 'pc-bridge' }), spool('l'), spool('r')), h('div', { class: 'pc-notch' }, h('i'), h('i'), h('i')));
  const disc = h('div', { class: 'pn-disc', 'aria-hidden': 'true' }, h('i'));
  const coverBox = h('div', { class: 'pn-cover' });
  const ring = h('span', { class: 'pn-ring', 'aria-hidden': 'true' });
  ring.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><rect class="trk" x="1.5" y="1.5" width="97" height="97" rx="9" pathLength="100"/><rect class="val" x="1.5" y="1.5" width="97" height="97" rx="9" pathLength="100"/></svg>';
  const val = ring.querySelector('.val');
  const art = h('div', { class: 'pn-art' }, disc, cass, coverBox, ring);
  const el = h('div', { class: npArtBoxClass('square', false, cls) }, art);
  let a = 'square', playing = false;
  const paint = () => { el.className = npArtBoxClass(a, playing, cls); el.dataset.art = a; };
  const setArt = p => { a = normNpPrefs(typeof p === 'string' ? { art: p } : p).art; paint(); };
  const setCover = node => { if (!node) return; coverBox.replaceChildren(node); const src = node.querySelector?.('img')?.src || node.src || ''; art.style.setProperty('--np-cover', src ? `url("${src}")` : 'none'); };   // F104: Jacket label crop
  const setPlaying = on => { if (!!on !== playing) { playing = !!on; paint(); } };
  const setFrac = f => { f = Math.min(1, Math.max(0, +f || 0)); el.style.setProperty('--np-frac', f.toFixed(4)); val?.setAttribute('style', 'stroke-dashoffset:' + (100 - f * 100)); };
  if (cover) setCover(cover);
  setArt(loadNpPrefs());
  if (live && typeof window !== 'undefined') { window.addEventListener('wavwiz:npstyle', () => setArt(loadNpPrefs())); window.addEventListener('storage', ev => { if (ev.key === NP_KEY) setArt(loadNpPrefs()); }); }
  return { el, art, setArt, setCover, setPlaying, setFrac, get value() { return a; } };
}
