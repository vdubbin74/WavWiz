import { h, fmtDur, fmtTime } from './util.js';
import { setChev, icon, setIcon } from './icons.js';
import { canControl, MIME, dragInfo, dropLabel } from './ui.js';
import { api, toast } from './util.js';
import { reorder, movesFor, undoMoves, dropIndex, edgeScroll, nextSelection } from './qdrag.js';
const QMIME = 'application/x-wavwiz-qrows';
import { pulse } from './motion.js';
import { PL_COLS, byId, loadLayout, saveLayout, toggleCol, resetLayout, setLocked, moveCol, widthsFor, resizeAt, fracsFromWidths, nextSort, sortedIndexes } from './plcols.js';

/** Bottom panel of the desktop layout: the play queue as a table. 0.3.6 K10: pick / resize / reorder columns, click a header to sort, lock the layout. */
export function listTable(S, ctl) {
  let narrow = false, L = loadLayout(false), widths = [], ids = [], sort = null;
  const title = h('span', { class: 'grow ell' }, 'PLAYLIST'), meta = h('span', { class: 'small dim plmeta' }), btns = h('span', { class: 'row plicons' });
  const colgroup = h('colgroup'), thead = h('tr'), tbody = h('tbody');
  const table = h('table', { class: 'qtable', 'aria-label': 'Play queue' }, colgroup, h('thead', null, thead), tbody);
  const wrap = h('div', { class: 'qwrap' }, table);
  // 0.1.1: collapse arrow (slides the panel down to its header strip); View state lives on the desk element, saved per device
  // 0.3.2 F15: up arrow = expand (grow upward), down arrow = collapse; each only while that move is possible
  const upBtn = h('button', { class: 'plus listup', 'aria-label': 'Expand the playlist upward', title: 'Expand the playlist', onclick: () => ctl.listStep?.('up') }); setChev(upBtn, 'u');
  const colBtn = h('button', { class: 'plus listcol', 'aria-label': 'Collapse the playlist', 'aria-expanded': 'true', title: 'Collapse the playlist', onclick: () => ctl.listStep ? ctl.listStep('down') : ctl.toggleList?.() }); setChev(colBtn, 'd');
  const setState = st => { const a = { up: st !== 'expanded', down: st !== 'collapsed' }; upBtn.hidden = !a.up; colBtn.hidden = !a.down; colBtn.setAttribute('aria-expanded', String(st !== 'collapsed')); };
  const setCollapsed = c => setState(c === true ? 'collapsed' : c === false ? 'open' : c);
  // 0.3.6 K10: the column picker (checklist icon + right-click on the header) and the lock live in the TITLE BAR with the other icons, identical on every playlist view
  const pickBtn = h('button', { type: 'button', class: 'plus plpick', 'data-act': 'colpick', 'aria-label': 'Choose columns', title: 'Choose columns', 'aria-haspopup': 'true', onclick: ev => { ev.stopPropagation(); openPicker(pickBtn.getBoundingClientRect().left, pickBtn.getBoundingClientRect().bottom + 4); } }, icon('checklist'));
  const lockBtn = h('button', { type: 'button', class: 'plus pllock', 'data-act': 'collock', 'aria-pressed': 'false', onclick: ev => { ev.stopPropagation(); L = setLocked(L, !L.locked); save(); paintLock(); buildHead(); } }, icon('unlock'));
  const paintLock = () => { lockBtn.classList.toggle('on', L.locked); lockBtn.setAttribute('aria-pressed', String(L.locked)); const t = L.locked ? 'Columns locked (click to unlock)' : 'Lock the column layout'; lockBtn.title = t; lockBtn.setAttribute('aria-label', t); setIcon(lockBtn.querySelector('.ic'), L.locked ? 'lock' : 'unlock'); };
  const iconRow = h('span', { class: 'row plbtns' }, btns, pickBtn, lockBtn);
  const head = h('div', { class: 'pane-h' }, title, meta, iconRow, h('span', { class: 'row listcolwrap' }, upBtn, colBtn));
  const root = h('section', { class: 'listpanel', 'aria-label': 'Playlist' }, head, wrap);
  /** 0.2.3 U2: hosts the "Up next" line (shown while the Playlist is minimized) in the title bar. */
  const setNextBlock = el => { head.insertBefore(el, meta); };
  /** Left edge of the right-hand header controls (count, icons, arrow), for keeping the Up next line clear of them. */
  const rightEdge = () => Math.min(...[meta, iconRow, upBtn, colBtn].map(e => e.getBoundingClientRect()).filter(r => r.width > 0).map(r => r.left));
  const leftEdge = () => { const r = document.createRange(); r.selectNodeContents(title); return r.getBoundingClientRect().right; };
  const save = () => saveLayout(L, narrow);
  const isNarrow = () => !!root.closest('.desk')?.classList.contains('libexpanded');   // the side (right-hand) playlist while the Library is expanded

  function applyWidths() { [...colgroup.children].forEach((c, i) => { c.style.width = widths[i] + 'px'; }); table.style.width = widths.reduce((a, b) => a + b, 0) + 'px'; }
  function layout() {
    const n = isNarrow(); if (n !== narrow) { narrow = n; L = loadLayout(narrow); paintLock(); buildHead(); return; }
    const total = Math.max(240, wrap.clientWidth); const r = widthsFor(L, total); ids = r.ids; widths = r.w; applyWidths();
  }
  const closePicker = () => { document.querySelector('.plpicker')?.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escKey, true); };
  const outside = ev => { if (!ev.target.closest?.('.plpicker') && !ev.target.closest?.('.plpick')) closePicker(); };
  const escKey = ev => { if (ev.key === 'Escape') closePicker(); };
  function openPicker(x, y) {
    closePicker();
    const box = h('div', { class: 'plpicker', role: 'menu', 'aria-label': 'Columns' }, h('div', { class: 'plp-h' }, 'COLUMNS', L.locked ? h('span', { class: 'plp-lock' }, 'locked') : null),
      ...PL_COLS.map(c => { const cb = h('input', { type: 'checkbox', 'data-col': c.id, checked: !L.hidden.includes(c.id), disabled: L.locked, onchange: () => { L = toggleCol(L, c.id); save(); buildHead(); draw(); cb.checked = !L.hidden.includes(c.id); } });
        return h('label', { class: 'plp-row' }, cb, c.pick); }),
      h('button', { type: 'button', class: 'btn sm plp-reset', 'data-act': 'colreset', disabled: L.locked, onclick: () => { L = resetLayout(L, narrow); save(); buildHead(); draw(); closePicker(); } }, 'Reset columns'),
      L.locked ? h('div', { class: 'plp-note' }, 'Unlock the layout to change columns.') : null);
    document.body.append(box);
    const r = box.getBoundingClientRect(); box.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px'; box.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
    setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escKey, true); }, 0);
    box.querySelector('input:not(:disabled)')?.focus();
  }
  function buildHead() {
    const lay = widthsFor(L, 1000); ids = lay.ids;
    colgroup.replaceChildren(...ids.map(() => h('col'))); thead.replaceChildren();
    ids.forEach((id, i) => {
      const c = byId(id), th = h('th', { 'data-col': id, class: (id === 'num' ? 'num' : id === 'time' ? 'dur' : '') + (sort?.id === id ? ' sorted' : '') + (L.locked ? '' : ' movable'), 'aria-sort': sort?.id === id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
        h('span', { class: 'thl' }, c.head), h('span', { class: 'sortar', 'aria-hidden': 'true' }, sort?.id === id ? (sort.dir === 'asc' ? '▲' : '▼') : ''));
      th.addEventListener('contextmenu', ev => { ev.preventDefault(); openPicker(ev.clientX, ev.clientY); });
      th.addEventListener('click', () => { if (th._drag) { th._drag = false; return; } sort = nextSort(sort, id); buildHead(); draw(); });
      if (!L.locked) th.addEventListener('pointerdown', ev => startReorder(ev, th, id));
      if (i < ids.length - 1) {
        const grip = h('span', { class: 'grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': `Resize the ${c.pick} column`, tabindex: L.locked ? -1 : 0 });
        if (!L.locked) {
          const start = ev => {
            ev.preventDefault(); ev.stopPropagation(); const x0 = ev.clientX ?? ev.touches?.[0]?.clientX, base = widths.slice(); grip.classList.add('on');
            const move = e => { const x = e.clientX ?? e.touches?.[0]?.clientX; widths = resizeAt(base, ids, i, x - x0); applyWidths(); };
            const up = () => { grip.classList.remove('on'); removeEventListener('pointermove', move); removeEventListener('pointerup', up); L = fracsFromWidths(L, ids, widths); save(); };
            addEventListener('pointermove', move); addEventListener('pointerup', up);
          };
          grip.addEventListener('pointerdown', start); grip.addEventListener('click', ev => ev.stopPropagation());
          grip.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); widths = resizeAt(widths, ids, i, e.key === 'ArrowLeft' ? -12 : 12); applyWidths(); L = fracsFromWidths(L, ids, widths); save(); } });
        } else grip.classList.add('off');
        th.append(grip);
      }
      thead.append(th);
    });
    layout(); draw();
  }
  /** Drag a header onto another to move the column (pointer events: works with mouse, pen and touch); a click without movement sorts. */
  function startReorder(ev, th, id) {
    if (ev.button > 0 || ev.target.closest('.grip')) return;
    const x0 = ev.clientX; let on = false, over = null;
    const move = e => {
      if (!on && Math.abs(e.clientX - x0) < 6) return; on = true; th._drag = true; document.body.classList.add('plcol-dragging'); th.classList.add('coldrag');
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('th[data-col]'); if (over && over !== t) over.classList.remove('coldrop'); over = t && t !== th && thead.contains(t) ? t : null; over?.classList.add('coldrop');
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); document.body.classList.remove('plcol-dragging'); th.classList.remove('coldrag'); over?.classList.remove('coldrop');
      if (on && over) { L = moveCol(L, id, over.dataset.col); save(); buildHead(); } setTimeout(() => { th._drag = false; }, 0); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
  new ResizeObserver(() => { if (ids.length) layout(); }).observe(wrap);

  function inlineSave() {
    const name = h('input', { type: 'text', maxlength: 80, placeholder: 'Playlist name', class: 'qsave-in', 'aria-label': 'New playlist name', onkeydown: ev => { if (ev.key === 'Enter') go(); if (ev.key === 'Escape') done(); } });
    const done = () => { btns.replaceChildren(); draw(); };
    const go = async () => { const n = name.value.trim(); if (!n) { name.focus(); return; } try { await api('/playlists', { method: 'POST', body: { name: n, fromQueue: true } }); toast(`Saved as “${n}”`); window.dispatchEvent(new CustomEvent('wavwiz:playlists')); done(); } catch (e) { toast(e.message, true); } };
    btns.replaceChildren(h('span', { class: 'qsave row' }, name, h('button', { class: 'btn sm primary', type: 'button', onclick: go }, 'Save'), h('button', { class: 'btn sm', type: 'button', onclick: done }, 'Cancel')));
    name.focus();
  }
  const cellFor = (id, q, i, isCur, can, last) => {
    const lc = last ? ' lastc' : '';
    switch (id) {
      case 'num': return h('td', { class: 'num' + lc }, can && !sort ? h('span', { class: 'qgrip', 'aria-hidden': 'true', title: 'Drag to reorder' }, '⋮⋮') : null, isCur ? '▶' : i + 1);
      case 'title': return h('td', { class: 'ell' + lc, title: q.title }, q.title);
      case 'artist': return h('td', { class: 'ell' + lc, title: q.artist || '' }, q.artist || '');
      case 'album': return h('td', { class: 'ell' + lc, title: q.album || '' }, q.album || '');
      case 'genre': return h('td', { class: 'ell' + lc }, q.genre || '');
      case 'year': return h('td', { class: 'ell' + lc }, q.year ? String(q.year) : '');
      case 'track': return h('td', { class: 'ell' + lc }, q.trackNo ? String(q.trackNo) : '');
      default: return h('td', { class: 'dur' + lc }, q.durationMs ? fmtTime(q.durationMs) : '');
    }
  };
  function draw() {
    const can = canControl(S), cur = S.now?.index ?? -1, playing = S.now?.state && S.now.state !== 'stopped';
    const total = S.queue.reduce((a, q) => a + (q.durationMs || 0), 0);
    meta.textContent = S.queue.length ? `${S.queue.length} track${S.queue.length === 1 ? '' : 's'} • ${fmtDur(total)}` : '';
    // 0.3.5 J9 #9 + 0.3.6 K1: Save as playlist / Clear are compact icon buttons (tooltips); the name field is inline in the header; kept across redraws while typing
    if (!btns.querySelector('.qsave')) btns.replaceChildren(can && S.queue.length ? [h('button', { class: 'plus', 'data-act': 'savequeue', 'aria-label': 'Save as playlist', title: 'Save as playlist', onclick: () => inlineSave() }, icon('save')), h('button', { class: 'plus', 'data-act': 'clearqueue', 'aria-label': 'Clear the playlist', title: 'Clear the playlist', onclick: () => ctl.act('/queue/clear') }, icon('trash'))] : null);
    if (!S.queue.length) { tbody.replaceChildren(h('tr', { class: 'empty' }, h('td', { colspan: Math.max(1, ids.length) }, 'The playlist is empty. Pick something in the library on the left (double-click a song, or use ⋯ > Add to queue).'))); return; }
    if (dragging) return;   // never redraw under a drag
    sel = sel.filter(i => i < S.queue.length);
    order = sortedIndexes(S.queue, sort);
    tbody.replaceChildren(...order.map(i => {
      const q = S.queue[i], isCur = i === cur && playing, dg = can && !sort;
      // 0.3.3 G12: grip + drag to reorder (Ctrl / Shift click selects several), plain click still plays that row. 0.3.6: no row reorder while a sort is showing.
      const tr = h('tr', { class: (isCur ? 'cur' : '') + (sel.includes(i) ? ' sel' : ''), 'data-i': i, draggable: dg ? 'true' : 'false', 'aria-selected': String(sel.includes(i)),
        onclick: ev => { if (ev.ctrlKey || ev.metaKey || ev.shiftKey) { sel = nextSelection(sel, i, { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey }, anchor); if (!ev.shiftKey) anchor = i; draw(); return; } sel = [i]; anchor = i; if (isCur) pulse(tr); can && ctl.act('/stream/jump', { index: i }); } });
      if (dg) tr.addEventListener('dragstart', ev => { if (!sel.includes(i)) { sel = [i]; anchor = i; } dragging = sel.slice(); ev.dataTransfer.setData(QMIME, JSON.stringify(dragging)); ev.dataTransfer.setData('text/plain', q.title); ev.dataTransfer.effectAllowed = 'move'; tbody.querySelectorAll('tr').forEach(r => r.classList.toggle('dragging', dragging.includes(+r.dataset.i))); });
      tr.addEventListener('dragend', () => { dragging = null; clearIns(); stopScroll(); tbody.querySelectorAll('tr.dragging').forEach(r => r.classList.remove('dragging')); setTimeout(draw, 0); });
      ids.forEach((id, k) => tr.append(cellFor(id, q, i, isCur, can, k === ids.length - 1)));
      if (can) tr.lastChild.append(h('button', { class: 'rm', 'aria-label': `Remove ${q.title} from the queue`, title: 'Remove', onclick: ev => { ev.stopPropagation(); ctl.act(`/queue/${i}`, undefined, 'DELETE'); } }, '✕'));
      return tr;
    }));
    const row = tbody.querySelector('tr.cur'); if (row && !wrap.matches(':hover')) row.scrollIntoView({ block: 'nearest' });
  }
  let order = [];
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
    insLine.dataset.label = ev.dataTransfer.types.includes(QMIME) ? `Move here: #${t + 1}` : dropLabel(dragInfo.count, t);   // 0.3.5 J11: the dragged count ("17 songs")
    scrollV = edgeScroll(ev.clientY, wr.top, wr.bottom); if (scrollV && !scrollT) scrollT = requestAnimationFrame(tick);
  });
  wrap.addEventListener('dragleave', ev => { if (!wrap.contains(ev.relatedTarget)) { clearIns(); stopScroll(); } });
  wrap.addEventListener('drop', async ev => {
    if (!accepts(ev)) return; ev.preventDefault(); stopScroll();
    const t = dropIndex(rowBoxes(), ev.clientY); clearIns();
    const rows = ev.dataTransfer.getData(QMIME), ref = ev.dataTransfer.getData(MIME);
    try {
      if (rows) await moveRows(JSON.parse(rows), t);
      else if (ref) { await api('/queue/add', { method: 'POST', body: { ...JSON.parse(ref), at: sort ? (t < order.length ? order[t] : S.queue.length) : t } }); toast('Added to the playlist'); ctl.refreshAll?.(); }
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
  paintLock(); buildHead();
  return { el: root, head, draw, widths: () => widths.slice(), relayout: layout, setCollapsed, setState, setNextBlock, leftEdge, rightEdge };
}
