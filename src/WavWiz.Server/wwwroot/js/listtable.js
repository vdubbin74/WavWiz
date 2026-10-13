import { h, fmtDur, fmtTime } from './util.js';
import { canControl, MIME } from './ui.js';
import { api, toast } from './util.js';
import { reorder, movesFor, undoMoves, dropIndex, edgeScroll, nextSelection } from './qdrag.js';
const QMIME = 'application/x-wavwiz-qrows';
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
  // 0.3.2 F15: up arrow = expand (grow upward), down arrow = collapse; each only while that move is possible
  const upBtn = h('button', { class: 'plus listup', 'aria-label': 'Expand the playlist upward', title: 'Expand the playlist', onclick: () => ctl.listStep?.('up') }, '˄');
  const colBtn = h('button', { class: 'plus listcol', 'aria-label': 'Collapse the playlist', 'aria-expanded': 'true', title: 'Collapse the playlist', onclick: () => ctl.listStep ? ctl.listStep('down') : ctl.toggleList?.() }, '˅');
  const setState = st => { const a = { up: st !== 'expanded', down: st !== 'collapsed' }; upBtn.hidden = !a.up; colBtn.hidden = !a.down; colBtn.setAttribute('aria-expanded', String(st !== 'collapsed')); };
  const setCollapsed = c => setState(c === true ? 'collapsed' : c === false ? 'open' : c);
  const head = h('div', { class: 'pane-h' }, title, meta, btns, h('span', { class: 'row listcolwrap' }, upBtn, colBtn));
  const root = h('section', { class: 'listpanel', 'aria-label': 'Playlist' }, head, wrap);
  /** 0.2.3 U2: hosts the "Up next" line (shown while the Playlist is minimized) in the title bar. */
  const setNextBlock = el => { head.insertBefore(el, meta); };
  /** Left edge of the right-hand header controls (count, Save, Clear, arrow), for keeping the Up next line clear of them. */
  const rightEdge = () => Math.min(...[meta, btns, upBtn, colBtn].map(e => e.getBoundingClientRect()).filter(r => r.width > 0).map(r => r.left));
  const leftEdge = () => { const r = document.createRange(); r.selectNodeContents(title); return r.getBoundingClientRect().right; };

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
    if (dragging) return;   // never redraw under a drag
    sel = sel.filter(i => i < S.queue.length);
    tbody.replaceChildren(...S.queue.map((q, i) => {
      const isCur = i === cur && playing;
      // 0.3.3 G12: grip + drag to reorder (Ctrl / Shift click selects several), plain click still plays that row
      const tr = h('tr', { class: (isCur ? 'cur' : '') + (sel.includes(i) ? ' sel' : ''), 'data-i': i, draggable: can ? 'true' : 'false', 'aria-selected': String(sel.includes(i)),
        onclick: ev => { if (ev.ctrlKey || ev.metaKey || ev.shiftKey) { sel = nextSelection(sel, i, { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey }, anchor); if (!ev.shiftKey) anchor = i; draw(); return; } sel = [i]; anchor = i; can && ctl.act('/stream/jump', { index: i }); } });
      if (can) tr.addEventListener('dragstart', ev => { if (!sel.includes(i)) { sel = [i]; anchor = i; } dragging = sel.slice(); ev.dataTransfer.setData(QMIME, JSON.stringify(dragging)); ev.dataTransfer.setData('text/plain', q.title); ev.dataTransfer.effectAllowed = 'move'; tbody.querySelectorAll('tr').forEach(r => r.classList.toggle('dragging', dragging.includes(+r.dataset.i))); });
      tr.addEventListener('dragend', () => { dragging = null; clearIns(); stopScroll(); tbody.querySelectorAll('tr.dragging').forEach(r => r.classList.remove('dragging')); setTimeout(draw, 0); });
      tr.append(
        h('td', { class: 'num' }, can ? h('span', { class: 'qgrip', 'aria-hidden': 'true', title: 'Drag to reorder' }, '⋮⋮') : null, isCur ? '▶' : i + 1), h('td', { class: 'ell', title: q.title }, q.title), h('td', { class: 'ell', title: q.artist || '' }, q.artist || ''), h('td', { class: 'ell', title: q.album || '' }, q.album || ''),
        h('td', { class: 'ell' }, q.genre || ''), h('td', { class: 'dur' }, q.durationMs ? fmtTime(q.durationMs) : '', can ? h('button', { class: 'rm', 'aria-label': `Remove ${q.title} from the queue`, title: 'Remove', onclick: ev => { ev.stopPropagation(); ctl.act(`/queue/${i}`, undefined, 'DELETE'); } }, '✕') : null));
      return tr;
    }));
    const row = tbody.querySelector('tr.cur'); if (row && !wrap.matches(':hover')) row.scrollIntoView({ block: 'nearest' });
  }
  // ---- 0.3.3 G12: drop handling (reorder rows, or songs / albums / folders from the Library at the line), auto-scroll, Ctrl+Z undo ----
  let sel = [], anchor = null, dragging = null, undo = null, scrollT = 0, scrollV = 0; const insLine = h('div', { class: 'qins', hidden: true });
  wrap.append(insLine);
  const rowBoxes = () => [...tbody.querySelectorAll('tr[data-i]')].map(r => r.getBoundingClientRect());
  const clearIns = () => { insLine.hidden = true; };
  const stopScroll = () => { cancelAnimationFrame(scrollT); scrollT = 0; scrollV = 0; };
  const tick = () => { if (!scrollV) { scrollT = 0; return; } wrap.scrollTop += scrollV; scrollT = requestAnimationFrame(tick); };
  const accepts = ev => canControl(S) && (ev.dataTransfer?.types?.includes(QMIME) || ev.dataTransfer?.types?.includes(MIME));
  wrap.addEventListener('dragover', ev => {
    if (!accepts(ev)) return; ev.preventDefault(); ev.dataTransfer.dropEffect = ev.dataTransfer.types.includes(QMIME) ? 'move' : 'copy';
    const boxes = rowBoxes(), t = dropIndex(boxes, ev.clientY), wr = wrap.getBoundingClientRect();
    const y = boxes.length ? (t < boxes.length ? boxes[t].top : boxes[boxes.length - 1].bottom) : wr.top + 24;
    insLine.hidden = false; insLine.style.top = (y - wr.top + wrap.scrollTop - 1) + 'px'; insLine.dataset.at = String(t);
    scrollV = edgeScroll(ev.clientY, wr.top, wr.bottom); if (scrollV && !scrollT) scrollT = requestAnimationFrame(tick);
  });
  wrap.addEventListener('dragleave', ev => { if (!wrap.contains(ev.relatedTarget)) { clearIns(); stopScroll(); } });
  wrap.addEventListener('drop', async ev => {
    if (!accepts(ev)) return; ev.preventDefault(); stopScroll();
    const t = dropIndex(rowBoxes(), ev.clientY); clearIns();
    const rows = ev.dataTransfer.getData(QMIME), ref = ev.dataTransfer.getData(MIME);
    try {
      if (rows) await moveRows(JSON.parse(rows), t);
      else if (ref) { await api('/queue/add', { method: 'POST', body: { ...JSON.parse(ref), at: t } }); toast('Added to the playlist'); ctl.refreshAll?.(); }
    } catch (e) { toast(e.message, true); ctl.refreshAll?.(); }
  });
  /** Reorder: the selected rows go to insertion point t as one block; remembered for Ctrl+Z. */
  async function moveRows(selIdx, t) {
    const n = S.queue.length, order = reorder(n, selIdx, t), ids = [...Array(n).keys()], mv = movesFor(ids, order);
    if (!mv.length) return;
    for (const m of mv) await api('/queue/move', { method: 'POST', body: m });
    undo = order; const p = order.indexOf(selIdx.slice().sort((a, b) => a - b)[0]); sel = selIdx.map((_, k) => p + k); anchor = p;
    ctl.refreshAll?.();
  }
  async function doUndo() { const back = undoMoves(undo); undo = null; try { for (const m of back) await api('/queue/move', { method: 'POST', body: m }); toast('Reorder undone'); } catch (e) { toast(e.message, true); } ctl.refreshAll?.(); }
  if (typeof document !== 'undefined') document.addEventListener('keydown', ev => { if (undo && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z' && !document.querySelector('dialog[open]') && !ev.target.closest?.('input,textarea,select,[contenteditable]')) { ev.preventDefault(); doUndo(); } });   // Ctrl+Z undoes the last reorder
  buildHead();
  return { el: root, head, draw, widths: () => widths.slice(), relayout: layout, setCollapsed, setState, setNextBlock, leftEdge, rightEdge };
}
