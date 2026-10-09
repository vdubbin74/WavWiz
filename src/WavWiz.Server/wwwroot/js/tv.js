// 0.2.0 item 1: TV / lite mode. Smart-TV browsers (and any page opened with ?lite) get a lightweight Now Playing: cover, title and large
// transport controls, big text, thick focus rings and remote-control (D-pad) navigation. The library, devices and playlist panels stay out of
// the way (they are one press of the Menu button away), and the visualizer starts off (item 3).
import { isTvUa } from './phonejoin.js';

export function tvMode(search = (() => { try { return location.search; } catch { return ''; } })(), ua) {
  let q; try { q = new URLSearchParams(search); } catch { q = new URLSearchParams(); }
  if (q.get('tv') === '0' || q.get('lite') === '0') return false;
  return isTvUa(ua) || q.has('tv') || q.has('lite');
}

/** Pure: pick the next focus target from `from` in direction dir ('left'|'right'|'up'|'down'); rects are {x,y,w,h}. */
export function nextFocus(from, cands, dir) {
  const c = r => [r.x + r.w / 2, r.y + r.h / 2], [fx, fy] = c(from);
  let best = null, bestScore = Infinity;
  for (const r of cands) {
    if (r === from) continue;
    const [x, y] = c(r), dx = x - fx, dy = y - fy;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy, across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 1) continue;
    const score = along + across * 2.5;
    if (score < bestScore) { bestScore = score; best = r; }
  }
  return best;
}

export function installTvMode() {
  if (!tvMode()) return false;
  document.documentElement.classList.add('tv');
  const keys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  document.addEventListener('keydown', ev => {
    const dir = keys[ev.key]; if (!dir) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' && a.type === 'range' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA' || a.type === 'text' || a.type === 'search')) { if (dir === 'left' || dir === 'right') return; }   // sliders and text keep their arrows
    const scope = document.querySelector('dialog[open]') || document;
    const els = [...scope.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(e => e.offsetWidth || e.offsetHeight);
    if (!els.length) return;
    const rect = e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, e }; };
    const rs = els.map(rect), cur = a && els.includes(a) ? rs[els.indexOf(a)] : null;
    const to = cur ? nextFocus(cur, rs, dir) : rs[0];
    if (to) { ev.preventDefault(); to.e.focus(); to.e.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
  });
  // first focus on Play so the remote's OK starts the music (and unlocks the sound)
  setTimeout(() => { const p = document.querySelector('.nowcol [data-role=play], .nowcol button.play, .nowcol button'); if (p && !document.activeElement?.closest?.('.nowcol')) p.focus(); }, 1200);
  return true;
}
