import { h, fmtDur, fmtTime } from './util.js';
import { canControl } from './ui.js';
import { resizeCol, fitWidths, toFracs, loadFracs, saveFracs, MIN_COL } from './cols.js';

const HEAD = ['#', 'TITLE', 'ARTIST', 'ALBUM', 'GENRE', 'TIME'];

/** Bottom panel of the desktop layout: the play queue as a table (# TITLE ARTIST ALBUM GENRE TIME) with drag-to-resize columns; the playing row is highlighted. */
export function listTable(S, ctl) {
  let fracs = loadFracs(); let widths = [];
  const title = h('span', { class: 'grow ell' }, 'PLAYLIST'), meta = h('span', { class: 'small dim' }), btns = h('span', { class: 'row' });
  const colgroup = h('colgroup'), thead = h('tr'), tbody = h('tbody');
  const table = h('table', { class: 'qtable', 'aria-label': 'Play queue' }, colgroup, h('thead', null, thead), tbody);
  const wrap = h('div', { class: 'qwrap' }, table);
  // 0.1.1: collapse arrow (slides the panel down to its header strip); View state lives on the desk element, saved per device
  const colBtn = h('button', { class: 'plus listcol', 'aria-label': 'Collapse or expand the playlist', 'aria-expanded': 'true', title: 'Collapse / expand the playlist', onclick: () => ctl.toggleList?.() }, '˅');
  const setCollapsed = c => { colBtn.textContent = c ? '˄' : '˅'; colBtn.setAttribute('aria-expanded', String(!c)); };
  const root = h('section', { class: 'listpanel', 'aria-label': 'Playlist' }, h('div', { class: 'pane-h' }, title, meta, btns, h('span', { class: 'row listcolwrap' }, colBtn)), wrap);

  function applyWidths() { [...colgroup.children].forEach((c, i) => { c.style.width = widths[i] + 'px'; }); table.style.width = widths.reduce((a, b) => a + b, 0) + 'px'; }
  function layout() { const total = Math.max(320, wrap.clientWidth - 2); widths = fitWidths(total, fracs); applyWidths(); }
  function buildHead() {
    colgroup.replaceChildren(...HEAD.map(() => h('col'))); thead.replaceChildren();
    HEAD.forEach((t, i) => {
      const th = h('th', { class: i === 0 ? 'num' : i === 5 ? 'dur' : '' }, h('span', null, t));
      if (i < HEAD.length - 1) {
        const grip = h('span', { class: 'grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': `Resize the ${t} column`, tabindex: 0 });
        const start = ev => {
          ev.preventDefault(); const x0 = ev.clientX ?? ev.touches?.[0]?.clientX, base = widths.slice(); grip.classList.add('on');
          const move = e => { const x = e.clientX ?? e.touches?.[0]?.clientX; widths = resizeCol(base, i, x - x0); applyWidths(); };
          const up = () => { grip.classList.remove('on'); removeEventListener('pointermove', move); removeEventListener('pointerup', up); fracs = toFracs(widths); saveFracs(fracs); };
          addEventListener('pointermove', move); addEventListener('pointerup', up);
        };
        grip.addEventListener('pointerdown', start);
        grip.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); widths = resizeCol(widths, i, e.key === 'ArrowLeft' ? -12 : 12); applyWidths(); fracs = toFracs(widths); saveFracs(fracs); } });
        th.append(grip);
      }
      thead.append(th);
    });
    layout();
  }
  new ResizeObserver(() => { if (widths.length) layout(); }).observe(wrap);

  function draw() {
    const can = canControl(S), cur = S.now?.index ?? -1, playing = S.now?.state && S.now.state !== 'stopped';
    const total = S.queue.reduce((a, q) => a + (q.durationMs || 0), 0);
    meta.textContent = S.queue.length ? `${S.queue.length} track${S.queue.length === 1 ? '' : 's'} • ${fmtDur(total)}` : '';
    btns.replaceChildren(can && S.queue.length ? [h('button', { class: 'btn sm', onclick: () => ctl.saveQueue() }, 'Save as playlist'), h('button', { class: 'btn sm', onclick: () => ctl.act('/queue/clear') }, 'Clear')] : null);
    if (!S.queue.length) { tbody.replaceChildren(h('tr', { class: 'empty' }, h('td', { colspan: 6 }, 'The playlist is empty. Pick something in the library on the left (double-click a song, or use ⋯ > Add to queue).'))); return; }
    tbody.replaceChildren(...S.queue.map((q, i) => {
      const isCur = i === cur && playing;
      return h('tr', { class: isCur ? 'cur' : '', 'data-i': i, onclick: () => can && ctl.act('/stream/jump', { index: i }) },
        h('td', { class: 'num' }, isCur ? '▶' : i + 1), h('td', { class: 'ell', title: q.title }, q.title), h('td', { class: 'ell', title: q.artist || '' }, q.artist || ''), h('td', { class: 'ell', title: q.album || '' }, q.album || ''),
        h('td', { class: 'ell' }, q.genre || ''), h('td', { class: 'dur' }, q.durationMs ? fmtTime(q.durationMs) : '', can ? h('button', { class: 'rm', 'aria-label': `Remove ${q.title} from the queue`, title: 'Remove', onclick: ev => { ev.stopPropagation(); ctl.act(`/queue/${i}`, undefined, 'DELETE'); } }, '✕') : null));
    }));
    const row = tbody.querySelector('tr.cur'); if (row && !wrap.matches(':hover')) row.scrollIntoView({ block: 'nearest' });
  }
  buildHead();
  return { el: root, draw, widths: () => widths.slice(), relayout: layout, setCollapsed };
}
