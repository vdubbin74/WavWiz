// WavWiz 0.3.1 B13-B16: one preview grid for Settings > Appearance (Theme, Visualizer, EQ style, Now Playing, Display size).
// Click a card to select it (theme border + check); options sit below the grid. Live previews run only while their card is on screen.
import { h } from './util.js';

/** Cards per row and the card width cap for each Appearance grid (1200 px Settings window). */
export const GRID_COLS = Object.freeze({ theme: 5, viz: 4, eq: 3, np: 2, npseek: 4, npbtn: 4, npart: 4, display: 3 });
export const GRID_MAX = Object.freeze({ theme: 200, viz: 270, eq: 272, np: 272, npseek: 200, npbtn: 200, npart: 200, display: 272 });
export const CARD_RATIO = 16 / 10, CARD_MAX_H = 170, GRID_GAP = 12;

/** The grid element for kind (sets --pg-cols / --pg-max). */
export function gridEl(kind, label, cards = []) {
  return h('div', { class: 'pgrid pgrid-' + kind, role: 'radiogroup', 'aria-label': label, style: `--pg-cols:${GRID_COLS[kind]};--pg-max:${GRID_MAX[kind]}px` }, cards);
}
/** A selectable card: preview area (16:10) + name strip. */
export function pgCard({ id, name, sub = '', on = false, onSelect, preview, attrs = {} }) {
  const card = h('div', { class: 'pgcard' + (on ? ' on' : ''), role: 'radio', tabindex: 0, 'aria-checked': String(!!on), 'aria-label': name, 'data-id': id, ...attrs,
    onclick: () => onSelect?.(id), onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect?.(id); } } },
    h('div', { class: 'pg-prev', inert: '' }, preview || null),
    h('div', { class: 'pg-meta' }, h('b', { class: 'ell' }, name), sub ? h('span', { class: 'small dim ell' }, sub) : null),
    h('span', { class: 'pg-check', 'aria-hidden': 'true' }, '✓'));
  return card;
}
/** Mark the selected card in a grid. */
export function markGrid(grid, id) {
  for (const c of grid.querySelectorAll('.pgcard')) { const on = c.dataset.id === String(id); c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on)); }
}
/** Live previews pause off screen: show(el) when a card scrolls into view, hide(el) when it leaves (or the page goes away). Returns stop(). */
export function whileVisible(els, show, hide) {
  if (typeof IntersectionObserver === 'undefined') { els.forEach(show); return () => els.forEach(hide); }
  const vis = new Set();
  const io = new IntersectionObserver(entries => { for (const e of entries) { if (e.isIntersecting && !vis.has(e.target)) { vis.add(e.target); show(e.target); } else if (!e.isIntersecting && vis.has(e.target)) { vis.delete(e.target); hide(e.target); } } }, { threshold: 0.01 });
  els.forEach(el => io.observe(el));
  return () => { io.disconnect(); for (const el of vis) hide(el); vis.clear(); };
}
