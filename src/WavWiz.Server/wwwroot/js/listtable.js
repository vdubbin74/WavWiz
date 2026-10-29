import { h, fmtDur, fmtTime } from './util.js';
import * as Z from './zones40.js';
import { setChev, icon, setIcon } from './icons.js';
import { canControl, MIME, dragInfo, dropLabel } from './ui.js';
import { api, toast, ask, dialog, undoToast } from './util.js';
import { clearQueueFlow } from './queueclear.js';
import { reorder, movesFor, undoMoves, dropIndex, edgeScroll, nextSelection } from './qdrag.js';
const QMIME = 'application/x-wavwiz-qrows';
import { pulse } from './motion.js';
import { pointerDropTarget, dndMode, usesPointer } from './pdrag.js';
import { canDragRows, APPLY_SORT_Q } from './qreorder.js';
import { attachQueueMenu } from './queuemenu.js';
import { PL_COLS, byId, loadLayout, saveLayout, toggleCol, resetLayout, setLocked, moveCol, widthsFor, resizeAt, numMinFor, fracsFromWidths, nextSort, sortedIndexes, applySort, sortAllowed, SORT_LOCK_HINT, CLEAR_LOCK_HINT, sortChipText } from './plcols.js';

/** Bottom panel of the desktop layout: the play queue as a table. 0.3.6 K10: pick / resize / reorder columns, click a header to sort, lock the layout. */
export function listTable(S, ctl) {
  // 0.4.1: the zone picker above the queue: view / edit ANY zone's queue without changing the zone that is playing. view = a zone key ("g:5", "jukebox") or null (= the zone this player controls).
  let view = null, vdata = { queue: [], now: null }, vAt = 0, vBusy = false;
  const V = { get queue() { return view ? (vKey === view ? vdata.queue : []) : S.queue; }, get now() { return view ? (vKey === view ? vdata.now : null) : S.now; } };
  const viewChoice = () => (view ? Z.choicesNow().find(c => c.key === view) || null : null);
  const viewZid = () => { const c = viewChoice(); return c ? (Z.zoneIdFor(c) || 'default') : null; };
  const zq = p => { const z = viewZid(); return z ? p + (p.includes('?') ? '&' : '?') + 'zoneId=' + encodeURIComponent(z) : p; };
  const qapi = (p, o) => api(zq(p), o);
  const qact = async (p, body, method = 'POST') => { try { await qapi(p, { method, body }); } catch (e) { toast(e.message, true); } if (view) loadView(true); };
  // 0.4.5 F28: the Queue panel is keyed on the EDITING zone (view), never on the Controlling one. A forced load (the picker changed) is never dropped
  // because an older load is still running, and a reply that belongs to a zone we are no longer showing is thrown away (it used to overwrite the rows).
  let vSeq = 0, vKey = null;
  async function loadView(force = false) {
    if (!view || (!force && (vBusy || Date.now() - vAt < 1200))) return; vBusy = true; const seq = ++vSeq, key = view;
    try { const r = await qapi('/stream'); if (seq !== vSeq || key !== view) return; vdata = { queue: r.queue?.items || [], now: r.now }; vKey = key; vAt = Date.now(); if (typeof draw === 'function') draw(); }
    catch { if (seq === vSeq && key === view) { view = null; paintPick(); } }   // the zone is gone: back to this player's zone
    finally { if (seq === vSeq) vBusy = false; }
  }
  /** 0.4.5 F28: switch the zone being edited (null = the Controlling zone). Clears the old zone's rows at once so they never show under the new title. */
  function setView(key) { const cur = Z.current()?.key; view = !key || key === cur ? null : key; vdata = { queue: [], now: null }; vKey = null; vAt = 0; paintPick(); paintQz(); if (view) loadView(true); if (typeof draw === 'function') draw(); }
  const editingKey = () => view || Z.current()?.key || null;
  const SX = new Proxy(S, { get: (t, k) => (view && k === 'queue' ? vdata.queue : view && k === 'now' ? vdata.now : t[k]) });
  const ctlX = { ...ctl, act: (p, b, m) => (view ? qact(p, b, m) : ctl.act(p, b, m)) };
  let nextIdx = -1, shownNext = -1, narrow = false, L = loadLayout(false), widths = [], ids = [], sort = null;
  const qzone = h('span', { class: 'qzone' }), qlbl = h('span', { class: 'qlbl' }, 'QUEUE'), title = h('span', { class: 'grow ell qtitle' }, qlbl, qzone), meta = h('span', { class: 'small dim plmeta' }), btns = h('span', { class: 'row plicons' });
  const colgroup = h('colgroup'), thead = h('tr'), tbody = h('tbody');
  const table = h('table', { class: 'qtable', 'aria-label': 'Play queue' }, colgroup, h('thead', null, thead), tbody);
  const wrap = h('div', { class: 'qwrap' }, table);
  // 0.1.1: collapse arrow (slides the panel down to its header strip); View state lives on the desk element, saved per device
  // 0.3.2 F15: up arrow = expand (grow upward), down arrow = collapse; each only while that move is possible
  const upBtn = h('button', { class: 'plus listup', 'aria-label': 'Expand the queue upward', title: 'Expand the queue', onclick: () => ctl.listStep?.('up') }); setChev(upBtn, 'u');
  const colBtn = h('button', { class: 'plus listcol', 'aria-label': 'Collapse the queue', 'aria-expanded': 'true', title: 'Collapse the queue', onclick: () => ctl.listStep ? ctl.listStep('down') : ctl.toggleList?.() }); setChev(colBtn, 'd');
  const setState = st => { const a = { up: st !== 'expanded', down: st !== 'collapsed' }; upBtn.title = st === 'collapsed' ? 'Show the queue' : 'Expand the queue'; upBtn.setAttribute('aria-label', st === 'collapsed' ? 'Show the queue' : 'Expand the queue upward'); upBtn.hidden = !a.up; colBtn.hidden = !a.down; colBtn.setAttribute('aria-expanded', String(st !== 'collapsed')); };
  // 0.4.6 F46: a collapse / expand (or a resize) ends any drag in progress, and for a moment afterwards rows / headers ignore presses - the panel is
  // sliding under the pointer, so a second click of a double-click (or a click-drag that began on the arrow) used to land on a row or a column header.
  let pdrag = null;   // F113 pointer row-reorder session
  let toggledAt = 0; const settling = () => performance.now() - toggledAt < 600;
  const cancelDrag = () => { dragging = null; pdrag?.cancel(); clearIns?.(); stopScroll?.(); tbody?.querySelectorAll('tr.dragging').forEach(r => r.classList.remove('dragging')); };
  const setCollapsed = c => { toggledAt = performance.now(); cancelDrag(); setState(c === true ? 'collapsed' : c === false ? 'open' : c); };
  if (typeof window !== 'undefined') window.addEventListener('resize', () => { if (dragging || pdrag) cancelDrag(); });
  // 0.3.6 K10: the column picker (checklist icon + right-click on the header) and the lock live in the TITLE BAR with the other icons, identical on every playlist view
  const pickBtn = h('button', { type: 'button', class: 'plus plpick', 'data-act': 'colpick', 'aria-label': 'Choose columns', title: 'Choose columns', 'aria-haspopup': 'true', onclick: ev => { ev.stopPropagation(); openPicker(pickBtn.getBoundingClientRect().left, pickBtn.getBoundingClientRect().bottom + 4); } }, icon('checklist'));
  const lockBtn = h('button', { type: 'button', class: 'plus pllock', 'data-act': 'collock', 'aria-pressed': 'false', onclick: ev => { ev.stopPropagation(); L = setLocked(L, !L.locked); save(); paintLock(); buildHead(); draw(); } }, icon('unlock'));
  const paintLock = () => { lockBtn.classList.toggle('on', L.locked); lockBtn.setAttribute('aria-pressed', String(L.locked)); const t = L.locked ? 'Columns locked (click to unlock)' : 'Lock the column layout'; lockBtn.title = t; lockBtn.setAttribute('aria-label', t); setIcon(lockBtn.querySelector('.ic'), L.locked ? 'lock' : 'unlock'); };
  // 0.3.7 L30: "Sorted by Artist ▲ ✕" chip on the title bar; the ✕ gives back the queue's own order (disabled while the queue is locked)
  const sortChip = h('span', { class: 'sortchip', hidden: true, role: 'status' });
  // 0.4.0: "QUEUE · KITCHEN" names the zone whose queue this is (only once there is more than one zone to choose from)
  // the picker ("Editing: <zone>") and "Copy queue to zone…" (0.4.4 F11: always copy)
  // 0.4.4 F10: one "Editing: <zone>" picker (no "(controlling)" wording; CONTROLLING stays on Now Playing / bottom bar only)
  const editLbl = h('span', { class: 'qediting small', 'aria-hidden': 'true' }, 'Editing:');
  // 0.4.8 F60: "Queue: [zone ▾]" - the picker sits in the title right after the label; the zone name is shown only here (no "· ZONE" suffix, no "Editing:")
  const pickSel = h('select', { class: 'qzpick', 'aria-label': 'Queue to show and edit', title: 'Show and edit any zone\'s queue without changing the zone that is playing', onchange: () => setView(pickSel.value) });
  // 0.5.0 F137: "Copy queue to zone" is a title-bar icon (with the save/trash/columns/lock icons) that opens a zone selector popover
  const sendBtn = h('button', { type: 'button', class: 'plus qsendic', 'data-act': 'sendqueue', hidden: true, 'aria-label': 'Copy queue to zone', title: 'Copy queue to zone (source stays as it is)', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: ev => { ev.stopPropagation(); if (document.querySelector('.qsendpop')) return closeSend(); const r = sendBtn.getBoundingClientRect(); openSend(r.left, r.bottom + 4); } }, icon('queue'));
  void editLbl; title.append(pickSel);
  const iconRow = h('span', { class: 'row plbtns' }, btns, sendBtn, pickBtn, lockBtn);
  function paintPick() {
    const cs = Z.choicesNow(), cur = Z.current(), many = cs.length > 1; sendBtn.hidden = !many; if (!many) closeSend(); pickSel.hidden = !many; title.classList.toggle('haspick', many); qlbl.textContent = many ? 'Queue:' : 'QUEUE'; if (!many) { view = null; try { root.classList.remove('qviewing'); } catch { /* before the panel exists */ } return; }
    if (view && !cs.some(c => c.key === view)) view = null;
    pickSel.replaceChildren(...cs.map(c => h('option', { value: c.key }, c.name + (cur && c.key === cur.key ? ' (playing)' : ''))));
    queueMicrotask(() => { const n = pickSel.selectedOptions[0]?.textContent; title.title = 'Queue: ' + (n || ''); pickSel.title = (n ? n + ' - ' : '') + 'Show and edit any zone\'s queue without changing the zone that is playing'; });
    pickSel.value = view || cur?.key || '';
    root.classList.toggle('qviewing', !!view);
  }
  const sendOut = ev => { if (!ev.target.closest?.('.qsendpop') && !ev.target.closest?.('.qsendic')) closeSend(); };
  const sendEsc = ev => { if (ev.key === 'Escape') { closeSend(); sendBtn.focus(); } };
  function closeSend() { document.querySelector('.qsendpop')?.remove(); sendBtn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', sendOut, true); document.removeEventListener('keydown', sendEsc, true); }
  function openSend(x, y) {
    closeSend(); closePicker();
    const cs = Z.choicesNow(), from = editingKey(), others = cs.filter(c => c.key !== from); if (!others.length) return toast('There is no other zone to send it to.', true);
    // 0.4.4 F11: always COPY — source queue and playback stay untouched
    const go = h('input', { type: 'checkbox', 'data-act': 'sendplay' });
    const copyTo = async c => { closeSend(); try { await api(zq('/queue/send'), { method: 'POST', body: { to: c.key, mode: 'copy', play: go.checked } }); toast(`Queue copied to ${c.name}`); ctl.refreshAll?.(); if (view) loadView(true); } catch (e) { toast(e.message, e.status !== 409); } };
    const box = h('div', { class: 'plpicker qsendpop', role: 'menu', 'aria-label': 'Copy queue to zone' }, h('div', { class: 'plp-h' }, 'COPY QUEUE TO'),
      ...others.map(c => h('button', { type: 'button', class: 'plp-sort qsendz', role: 'menuitem', 'data-zone': c.key, title: `Copy this queue to ${c.name}`, onclick: () => copyTo(c) }, c.name)),
      h('label', { class: 'plp-row qsendplay' }, go, 'Start playing it there'),
      h('div', { class: 'plp-note' }, 'Copies the songs. This queue and its playback stay as they are.'));
    box.addEventListener('keydown', ev => { if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return; const it = [...box.querySelectorAll('.qsendz, input')], i = it.indexOf(document.activeElement); ev.preventDefault(); it[(i + (ev.key === 'ArrowDown' ? 1 : it.length - 1)) % it.length]?.focus(); });
    document.body.append(box); sendBtn.setAttribute('aria-expanded', 'true');
    const r = box.getBoundingClientRect(); box.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px'; box.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
    setTimeout(() => { document.addEventListener('pointerdown', sendOut, true); document.addEventListener('keydown', sendEsc, true); }, 0);
    box.querySelector('.qsendz')?.focus();
  }
  window.addEventListener('wavwiz:zonesync', paintPick);
  // 0.4.5 F27: picking a zone from "on <zone> ▾" in Now Playing also makes it the Editing zone here (like the 0.4.4 F14 box title)
  window.addEventListener('wavwiz:editzone', () => setView(null));
  const paintQz = () => { const many = Z.choicesNow().length > 1, c = view ? viewChoice() : Z.current(); qzone.textContent = c && many ? (view ? Z.queueSuffixFor(c) : Z.queueSuffixNow()) : ''; if (!title.classList.contains('haspick')) title.title = ('Queue' + qzone.textContent).trim(); /* 0.4.8 F50: full label as a tooltip when a long zone name ellipsizes */ try { root.setAttribute('data-editing', editingKey() || ''); } catch { /* before the panel exists */ } };
  window.addEventListener('wavwiz:zonesync', paintQz); paintQz(); paintPick();
  const head = h('div', { class: 'pane-h' }, title, meta, sortChip, iconRow, h('span', { class: 'row listcolwrap' }, upBtn, colBtn));
  const root = h('section', { class: 'listpanel', 'aria-label': 'Queue' }, head, wrap);
  /** 0.2.3 U2: hosts the "Up next" line (shown while the Playlist is minimized) in the title bar. */
  const setNextBlock = el => { head.insertBefore(el, meta); };
  /** Left edge of the right-hand header controls (count, icons, arrow), for keeping the Up next line clear of them. */
  const rightEdge = () => Math.min(...[head.querySelector('.tpin'), meta, sortChip, iconRow, upBtn, colBtn].filter(Boolean).map(e => e.getBoundingClientRect()).filter(r => r.width > 0).map(r => r.left));
  const leftEdge = () => { const pk = title.querySelector('select,.qzpick'); if (pk && pk.getBoundingClientRect().width) return Math.max(pk.getBoundingClientRect().right, title.getBoundingClientRect().right);   // F137b: a zone picker in the title ends at its own box (a text range over a <select> under-measures and let Up next sit on it)
    const r = document.createRange(); r.selectNodeContents(title); return Math.min(r.getBoundingClientRect().right, title.getBoundingClientRect().right); };   // F50: clipped text ends at the box
  const save = () => saveLayout(L, narrow);
  const isNarrow = () => !!root.closest('.desk')?.classList.contains('libexpanded');   // the side (right-hand) playlist while the Library is expanded

  let numMin = 64;   // # column floor, grows with the queue's digit count (bulk add of 1000+ rows)
  function applyWidths() { [...colgroup.children].forEach((c, i) => { c.style.width = widths[i] + 'px'; }); table.style.width = widths.reduce((a, b) => a + b, 0) + 'px'; }
  function layout() {
    const n = isNarrow(); if (n !== narrow) { narrow = n; L = loadLayout(narrow); paintLock(); buildHead(); return; }
    const total = Math.max(240, wrap.clientWidth); numMin = numMinFor(V.queue.length); table.style.setProperty('--qnum-n', numMin + 'px'); const r = widthsFor(L, total, numMin); ids = r.ids; widths = r.w; applyWidths();
  }
  const closePicker = () => { document.querySelector('.plpicker')?.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escKey, true); };
  const outside = ev => { if (!ev.target.closest?.('.plpicker') && !ev.target.closest?.('.plpick')) closePicker(); };
  const escKey = ev => { if (ev.key === 'Escape') closePicker(); };
  function openPicker(x, y) {
    closePicker();
    const box = h('div', { class: 'plpicker', role: 'menu', 'aria-label': 'Columns' }, h('div', { class: 'plp-h' }, 'COLUMNS', L.locked ? h('span', { class: 'plp-lock' }, 'locked') : null),
      ...PL_COLS.map(c => { const cb = h('input', { type: 'checkbox', 'data-col': c.id, checked: !L.hidden.includes(c.id), disabled: L.locked, onchange: () => { L = toggleCol(L, c.id); save(); buildHead(); draw(); cb.checked = !L.hidden.includes(c.id); } });
        return h('label', { class: 'plp-row' }, cb, c.pick); }),
      h('div', { class: 'plp-h plp-sorth' }, 'SORT BY', L.locked ? h('span', { class: 'plp-lock' }, 'locked') : null),
      ...[['', 'Queue order'], ...PL_COLS.filter(c => c.id !== 'num').map(c => [c.id, c.pick])].map(([id, lab]) => h('button', { type: 'button', class: 'plp-sort' + ((sort?.id || '') === id ? ' on' : ''), 'data-sort': id, disabled: L.locked, title: L.locked ? SORT_LOCK_HINT : '', onclick: () => { if (!sortAllowed(L)) return; sort = id ? (sort?.id === id && sort.dir === 'asc' ? { id, dir: 'desc' } : { id, dir: 'asc' }) : null; buildHead(); draw(); closePicker(); } }, lab)),
      h('button', { type: 'button', class: 'btn sm plp-reset', 'data-act': 'colreset', disabled: L.locked, onclick: () => { L = resetLayout(L, narrow); save(); buildHead(); draw(); closePicker(); } }, 'Reset columns'),
      L.locked ? h('div', { class: 'plp-note' }, 'Unlock the queue to change columns and sorting.') : null);
    document.body.append(box);
    const r = box.getBoundingClientRect(); box.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px'; box.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
    setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escKey, true); }, 0);
    box.querySelector('input:not(:disabled)')?.focus();
  }
  function paintSortChip() {
    sortChip.hidden = !sort; if (!sort) { sortChip.replaceChildren(); return; }
    const x = h('button', { type: 'button', class: 'sortchip-x', 'data-act': 'sortclear', 'aria-label': 'Clear the sort (back to the queue order)', title: L.locked ? SORT_LOCK_HINT : 'Back to the queue order', disabled: L.locked || undefined, onclick: () => { if (L.locked) return; sort = null; buildHead(); draw(); } }, '✕');
    sortChip.replaceChildren(h('span', { class: 'sortchip-t' }, sortChipText(byId(sort.id)?.pick || sort.id, sort.dir)), x);
  }
  function buildHead() {
    paintSortChip();
    const lay = widthsFor(L, 1000); ids = lay.ids;
    colgroup.replaceChildren(...ids.map(() => h('col'))); thead.replaceChildren();
    ids.forEach((id, i) => {
      const c = byId(id), th = h('th', { 'data-col': id, class: (id === 'num' ? 'num' : id === 'time' ? 'dur' : '') + (sort?.id === id ? ' sorted' : '') + (L.locked ? ' sortlocked' : ' movable'), 'aria-sort': sort?.id === id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
        h('span', { class: 'thl' }, c.head), h('span', { class: 'sortar', 'aria-hidden': 'true' }, sort?.id === id ? (sort.dir === 'asc' ? '▲' : '▼') : ''));
      if (L.locked) { th.setAttribute('aria-disabled', 'true'); th.title = SORT_LOCK_HINT; }
      th.addEventListener('contextmenu', ev => { ev.preventDefault(); openPicker(ev.clientX, ev.clientY); });
      th.addEventListener('click', () => { if (th._drag) { th._drag = false; return; } if (settling()) return; if (!sortAllowed(L)) { toast(SORT_LOCK_HINT); return; } sort = applySort(L, sort, id); buildHead(); draw(); });
      if (!L.locked) th.addEventListener('pointerdown', ev => startReorder(ev, th, id));
      if (i < ids.length - 1) {
        const grip = h('span', { class: 'grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': `Resize the ${c.pick} column`, tabindex: L.locked ? -1 : 0 });
        if (!L.locked) {
          const start = ev => {
            ev.preventDefault(); ev.stopPropagation(); const x0 = ev.clientX ?? ev.touches?.[0]?.clientX, base = widths.slice(); grip.classList.add('on');
            const move = e => { const x = e.clientX ?? e.touches?.[0]?.clientX; widths = resizeAt(base, ids, i, x - x0, numMin); applyWidths(); };
            const up = () => { grip.classList.remove('on'); removeEventListener('pointermove', move); removeEventListener('pointerup', up); L = fracsFromWidths(L, ids, widths); save(); };
            addEventListener('pointermove', move); addEventListener('pointerup', up);
          };
          grip.addEventListener('pointerdown', start); grip.addEventListener('click', ev => ev.stopPropagation());
          grip.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); widths = resizeAt(widths, ids, i, e.key === 'ArrowLeft' ? -12 : 12, numMin); applyWidths(); L = fracsFromWidths(L, ids, widths); save(); } });
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
    const name = h('input', { type: 'text', maxlength: 80, placeholder: 'New playlist name', class: 'qsave-in', 'aria-label': 'New playlist name', onkeydown: ev => { if (ev.key === 'Enter') go(); if (ev.key === 'Escape') done(); } });
    const done = () => { btns.replaceChildren(); draw(); };
    const go = async () => { const n = name.value.trim(); if (!n) { name.focus(); return; } try { await api(zq('/playlists'), { method: 'POST', body: { name: n, fromQueue: true } }); toast(`Saved as “${n}”`); window.dispatchEvent(new CustomEvent('wavwiz:playlists')); done(); } catch (e) { toast(e.message, true); } };
    btns.replaceChildren(h('span', { class: 'qsave row' }, name, h('button', { class: 'btn sm primary', type: 'button', onclick: go }, 'Save'), h('button', { class: 'btn sm', type: 'button', onclick: done }, 'Cancel')));
    name.focus();
  }
  const clearQueue = async () => { if (!view) return clearQueueFlow(S, ctl); const n = V.queue.length; if (n && await ask(`Clear ${n} track${n === 1 ? '' : 's'}?`, `This empties ${viewChoice()?.name || 'that zone'}'s queue.`, { ok: 'Clear', danger: true })) { const snap = V.queue.slice(); await qact('/queue/clear'); undoToast(`Cleared ${n} track${n === 1 ? '' : 's'}`, async () => {   // 0.4.2: Undo also works on another zone's queue (adds go to that zone)
      const items = snap.filter(q => q.refId != null && (q.kind === 'track' || q.kind === 'radio'));
      for (let i = 0; i < items.length;) { const q = items[i]; if (q.kind === 'radio') { await qapi('/queue/add', { method: 'POST', body: { kind: 'radio', id: q.refId } }); i++; continue; } let j = i; while (j < items.length && items[j].kind === 'track' && j - i < 500) j++; await qapi('/queue/add', { method: 'POST', body: { kind: 'tracks', ids: items.slice(i, j).map(x => x.refId) } }); i = j; }
      toast(`Restored ${n} track${n === 1 ? '' : 's'}`); loadView(true); }); } };
  const cellFor = (id, q, i, isCur, can, last) => {
    const lc = last ? ' lastc' : '';
    switch (id) {
      case 'num': return h('td', { class: 'num' + lc }, can && !L.locked ? h('span', { class: 'qgrip', 'aria-hidden': 'true', title: 'Drag to reorder' }, '⋮⋮') : null, isCur ? '▶' : i + 1);
      case 'title': return h('td', { class: 'ell' + lc, title: q.title }, i === nextIdx ? h('span', { class: 'qnextpill', title: 'Plays next' }, 'UP NEXT') : null, q.title);   // 0.4.8 F50
      case 'artist': return h('td', { class: 'ell' + lc, title: q.artist || '' }, q.artist || '');
      case 'album': return h('td', { class: 'ell' + lc, title: q.album || '' }, q.album || '');
      case 'genre': return h('td', { class: 'ell' + lc }, q.genre || '');
      case 'year': return h('td', { class: 'ell' + lc }, q.year ? String(q.year) : '');
      case 'track': return h('td', { class: 'ell' + lc }, q.trackNo ? String(q.trackNo) : '');
      default: return h('td', { class: 'dur' + lc }, q.durationMs ? fmtTime(q.durationMs) : '');
    }
  };
  function draw() {
    if (view) loadView();
    const can = canControl(S), cur = V.now?.index ?? -1, playing = V.now?.state && S.now.state !== 'stopped';
    const total = V.queue.reduce((a, q) => a + (q.durationMs || 0), 0);
    meta.textContent = V.queue.length ? `${V.queue.length} track${V.queue.length === 1 ? '' : 's'} • ${fmtDur(total)}` : '';
    // 0.3.5 J9 #9 + 0.3.6 K1: Save as playlist / Clear are compact icon buttons (tooltips); the name field is inline in the header; kept across redraws while typing
    if (!btns.querySelector('.qsave')) btns.replaceChildren(can && V.queue.length ? [h('button', { class: 'plus', 'data-act': 'savequeue', 'aria-label': 'Save queue as a playlist', title: 'Save queue as a playlist', onclick: () => inlineSave() }, icon('save')), h('button', { class: 'plus', 'data-act': 'clearqueue', 'aria-label': 'Clear the queue', title: L.locked ? CLEAR_LOCK_HINT : 'Clear the queue', disabled: L.locked || undefined, onclick: () => { if (!L.locked) clearQueue(); } }, icon('trash'))] : null);
    if (!V.queue.length) { tbody.replaceChildren(h('tr', { class: 'empty' }, h('td', { colspan: Math.max(1, ids.length) }, 'The queue is empty. Pick something in the library on the left (double-click a song, or use ⋯ > Add to queue).'))); return; }
    if (dragging) return;   // never redraw under a drag
    if (pdrag) return;   // F113: nor under a pointer row-reorder session
    if (ids.length && numMinFor(V.queue.length) !== numMin) layout();   // digit count changed (e.g. 999 -> 1616 rows): re-fit so # never clips
    sel = sel.filter(i => i < V.queue.length);
    order = sortedIndexes(V.queue, sort);
    nextIdx = queueNextIndex(V.now, V.queue);   // 0.5.0 F89: same next as playback (shuffle pick / Repeat wrap), not the list neighbour
    tbody.replaceChildren(...order.map(i => {
      const q = V.queue[i], pmode = dndMode() === 'pointer', isCur = i === cur && playing, dg = canDragRows({ can, locked: L.locked });   // 0.3.7 L29: a sort showing no longer blocks the drag (it asks), the lock does
      // 0.3.3 G12: grip + drag to reorder (Ctrl / Shift click selects several), plain click still plays that row. 0.3.6: no row reorder while a sort is showing.
      const tr = h('tr', { class: (isCur ? 'cur' : '') + (sel.includes(i) ? ' sel' : ''), 'data-i': i, draggable: dg && !pmode ? 'true' : 'false', 'aria-selected': String(sel.includes(i)),
        onclick: ev => { if (settling()) return; if (ev.ctrlKey || ev.metaKey || ev.shiftKey) { sel = nextSelection(sel, i, { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey }, anchor); if (!ev.shiftKey) anchor = i; draw(); return; } sel = [i]; anchor = i; if (isCur) pulse(tr); can && qact('/stream/jump', { index: i }); } });
      if (dg) tr.addEventListener('dragstart', ev => { if (settling() || ev.target.closest?.('button,[data-nodrag]') !== null && ev.target !== tr) { ev.preventDefault(); return; } if (!sel.includes(i)) { sel = [i]; anchor = i; } dragging = sel.slice(); ev.dataTransfer.setData(QMIME, JSON.stringify(dragging)); ev.dataTransfer.setData('text/plain', q.title); ev.dataTransfer.effectAllowed = 'move'; tbody.querySelectorAll('tr').forEach(r => r.classList.toggle('dragging', dragging.includes(+r.dataset.i))); });
      tr.addEventListener('dragend', () => { dragging = null; clearIns(); stopScroll(); tbody.querySelectorAll('tr.dragging').forEach(r => r.classList.remove('dragging')); setTimeout(draw, 0); });
      ids.forEach((id, k) => tr.append(cellFor(id, q, i, isCur, can, k === ids.length - 1)));
      if (can) tr.lastChild.append(h('button', { class: 'rm', 'aria-label': `Remove ${q.title} from the queue`, title: 'Remove', onclick: ev => { ev.stopPropagation(); qact(`/queue/${i}`, undefined, 'DELETE'); } }, '✕'));
      if (can) attachQueueMenu(tr, SX, ctlX, i, () => L.locked);   // 0.3.8 L48
      return tr;
    }));
    // 0.4.8 F50: in the standard / full-screen Queue the next track's row (UP NEXT pill) is scrolled into view when it changes
    if (nextIdx >= 0 && nextIdx !== shownNext && !root.closest('.desk')?.classList.contains('listcollapsed')) { shownNext = nextIdx; tbody.querySelector(`tr[data-i="${nextIdx}"]`)?.scrollIntoView({ block: 'nearest' }); }
    const row = tbody.querySelector('tr.cur'); if (row && !wrap.matches(':hover')) row.scrollIntoView({ block: 'nearest' });
  }
  let order = [];
// ---- 0.3.3 G12: drop handling (reorder rows, or songs / albums / folders from the Library at the line), auto-scroll, Ctrl+Z undo ----
  let sel = [], anchor = null, dragging = null, undo = null, scrollT = 0, scrollV = 0; const insLine = h('div', { class: 'qins', hidden: true });
  wrap.append(insLine);
  // 0.5.0 F113: pointer-path row reorder. dndMode()==='pointer' (Player UA / ?dnd=pointer) = the only row-reorder path (rows are not draggable);
  // hybrid/native keep HTML5 for the mouse and use this for touch / pen (usesPointer). ~5 px before it starts so a plain click still plays / jumps.
  // Own session flag (pdrag) like F46's `dragging`: collapse / expand / resize cancels it, the settling window ignores presses, no move unless it moved.
  tbody.addEventListener('pointerdown', ev => {
    if (pdrag || dragging || ev.button > 0 || !ev.isPrimary || settling() || !usesPointer(dndMode(), ev.pointerType)) return;
    const tr = ev.target.closest?.('tr[data-i]'); if (!tr || !tbody.contains(tr) || ev.target.closest('button,input,a,[data-nodrag]')) return;
    if (!canControl(S) || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    if (ev.pointerType !== 'mouse' && !ev.target.closest('.qgrip')) return;   // touch / pen start on the grip so a finger still scrolls the list
    const i = +tr.dataset.i, x0 = ev.clientX, y0 = ev.clientY, pid = ev.pointerId; let y = y0, moved = false, t = 0, done = false;
    if (ev.pointerType !== 'mouse') ev.preventDefault();
    const place = () => { const boxes = rowBoxes(), wr = wrap.getBoundingClientRect(); t = dropIndex(boxes, y); const yy = boxes.length ? (t < boxes.length ? boxes[t].top : boxes[boxes.length - 1].bottom) : wr.top + 24;
      insLine.hidden = false; insLine.style.top = (yy - wr.top + wrap.scrollTop - 1) + 'px'; insLine.dataset.at = String(t); insLine.dataset.label = `Move here: #${t + 1}`;
      scrollV = edgeScroll(y, wr.top, wr.bottom); if (scrollV && !scrollT) scrollT = requestAnimationFrame(tick); };
    const end = () => { if (done) return; done = true; removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', cancel, true);
      clearIns(); stopScroll(); document.body.classList.remove('qrow-dragging'); tbody.querySelectorAll('tr.dragging').forEach(r => r.classList.remove('dragging')); pdrag = null; };
    const cancel = () => { const was = moved; end(); if (was) setTimeout(draw, 0); };
    const move = e => { if (e.pointerId !== pid) return; y = e.clientY;
      if (!moved) { if (Math.hypot(e.clientX - x0, y - y0) < 5) return;
        if (!canDragRows({ can: true, locked: L.locked })) { toast(SORT_LOCK_HINT.replace('Sorting is', 'Reordering is')); end(); return; }
        moved = true; pdrag.rows = sel.includes(i) ? sel.slice() : [i]; if (!sel.includes(i)) { sel = [i]; anchor = i; }
        document.body.classList.add('qrow-dragging'); getSelection?.()?.removeAllRanges?.(); tbody.querySelectorAll('tr').forEach(r => r.classList.toggle('dragging', pdrag.rows.includes(+r.dataset.i))); }
      e.preventDefault(); place(); };
    const up = async e => { if (e.pointerId !== pid) return; const was = moved, rows = pdrag?.rows; end(); if (!was || !rows) return;
      // swallow the click that follows a real drag so it doesn't also jump / play the row
      const eat = c => { c.stopPropagation(); c.preventDefault(); }; addEventListener('click', eat, { capture: true, once: true }); setTimeout(() => removeEventListener('click', eat, true), 0);
      try { if (!canDragRows({ can: true, locked: L.locked })) { toast(SORT_LOCK_HINT.replace('Sorting is', 'Reordering is')); return; } if (sort) await applySortAsOrder(); else await moveRows(rows, t); }
      catch (err) { toast(err.message, true); ctl.refreshAll?.(); } finally { setTimeout(draw, 0); } };
    pdrag = { rows: null, cancel };
    addEventListener('pointermove', move, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', cancel, true);
  });
  const rowBoxes = () => [...tbody.querySelectorAll('tr[data-i]')].map(r => r.getBoundingClientRect());
  const clearIns = () => { insLine.hidden = true; };
  const stopScroll = () => { cancelAnimationFrame(scrollT); scrollT = 0; scrollV = 0; };
  const tick = () => { if (!scrollV) { scrollT = 0; return; } wrap.scrollTop += scrollV; scrollT = requestAnimationFrame(tick); };
  // 0.4.4 F8: also accept while dragInfo.ref is set (WebKit/TV often omit custom MIME from types during dragover)
  const libDragging = () => !!dragInfo.ref;
  const accepts = ev => canControl(S) && (ev.dataTransfer?.types?.includes(QMIME) || ev.dataTransfer?.types?.includes(MIME) || libDragging() || !!dragging);
  wrap.addEventListener('dragover', ev => {
    if (!accepts(ev)) return; ev.preventDefault(); ev.dataTransfer.dropEffect = (ev.dataTransfer.types.includes(QMIME) || dragging) ? 'move' : 'copy';
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
    const rows = ev.dataTransfer.getData(QMIME), ref = ev.dataTransfer.getData(MIME) || (dragInfo.ref ? JSON.stringify(dragInfo.ref) : '');
    try {
      if (rows && !dragging) return;   // F46: a row drop only counts inside a live drag session that started in this table
      if (rows) { if (!canDragRows({ can: true, locked: L.locked })) { toast(SORT_LOCK_HINT.replace('Sorting is', 'Reordering is')); return; } if (sort) await applySortAsOrder(); else await moveRows(JSON.parse(rows), t); }
      else if (ref) { const body = { ...JSON.parse(ref), at: sort ? (t < order.length ? order[t] : V.queue.length) : t }; const r = await qapi('/queue/add', { method: 'POST', body }); const n = r?.added ?? 0; toast(n ? `Added to the queue` : 'Nothing to add'); if (n) ctl.refreshAll?.(); }
    } catch (e) { toast(e.message, true); ctl.refreshAll?.(); }
  });
  // 0.4.5 F8: the same drops through the pointer path (pdrag.js) - the queue body inserts at the line, the header strip adds at the end
  const libDrop = async (refObj, at) => { if (!canControl(S)) return; try { const r = await qapi('/queue/add', { method: 'POST', body: { ...refObj, at } }); const n = r?.added ?? 0; toast(n ? 'Added to the queue' : 'Nothing to add'); if (n) ctl.refreshAll?.(); } catch (e) { toast(e.message, true); ctl.refreshAll?.(); } };
  pointerDropTarget(wrap, { accept: p => !!p?.lib && canControl(S),
    over: (p, x, y) => { const boxes = rowBoxes(), t = dropIndex(boxes, y), wr = wrap.getBoundingClientRect(); const yy = boxes.length ? (t < boxes.length ? boxes[t].top : boxes[boxes.length - 1].bottom) : wr.top + 24;
      insLine.hidden = false; insLine.style.top = (yy - wr.top + wrap.scrollTop - 1) + 'px'; insLine.dataset.at = String(t); insLine.dataset.label = dropLabel(dragInfo.count, t);
      scrollV = edgeScroll(y, wr.top, wr.bottom); if (scrollV && !scrollT) scrollT = requestAnimationFrame(tick); },
    leave: () => { clearIns(); stopScroll(); },
    drop: (p, x, y) => { stopScroll(); const t = dropIndex(rowBoxes(), y); clearIns(); return libDrop(p.ref, sort ? (t < order.length ? order[t] : V.queue.length) : t); } });
  pointerDropTarget(head, { accept: p => !!p?.lib && canControl(S),
    over: () => { head.classList.add('qdrop'); head.dataset.droplabel = dropLabel(dragInfo.count, V.queue.length); },
    leave: () => head.classList.remove('qdrop'),
    drop: p => { head.classList.remove('qdrop'); return libDrop(p.ref, V.queue.length); } });
  // 0.4.4 F8 (side panel): with the Queue collapsed only its header strip shows - a Library drag dropped there adds to the END of the queue
  // (it used to be ignored, so dragging from the side-panel Library "did nothing"). Queue-row reorders are not accepted here.
  const headAccepts = ev => canControl(S) && !dragging && !ev.dataTransfer?.types?.includes(QMIME) && (ev.dataTransfer?.types?.includes(MIME) || libDragging());
  head.addEventListener('dragover', ev => { if (!headAccepts(ev)) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; head.classList.add('qdrop'); head.dataset.droplabel = dropLabel(dragInfo.count, V.queue.length); });
  head.addEventListener('dragleave', ev => { if (!head.contains(ev.relatedTarget)) head.classList.remove('qdrop'); });
  head.addEventListener('drop', async ev => {
    head.classList.remove('qdrop'); if (!headAccepts(ev)) return; ev.preventDefault(); ev.stopPropagation();
    const ref = ev.dataTransfer.getData(MIME) || (dragInfo.ref ? JSON.stringify(dragInfo.ref) : ''); if (!ref) return;
    try { const r = await qapi('/queue/add', { method: 'POST', body: { ...JSON.parse(ref), at: V.queue.length } }); const n = r?.added ?? 0; toast(n ? 'Added to the queue' : 'Nothing to add'); if (n) ctl.refreshAll?.(); }
    catch (e) { toast(e.message, true); ctl.refreshAll?.(); }
  });
  /** 0.3.7 L29: while a sort is showing a drag cannot place a row (the view is not the queue order) - offer to make the sort the real order. */
  async function applySortAsOrder() {
    if (!await ask(APPLY_SORT_Q, 'The queue is rearranged to match what you see now. You can undo it with Ctrl+Z.', { ok: 'Apply sort' })) return;
    const n = V.queue.length, ord = sortedIndexes(V.queue, sort), mv = movesFor([...Array(n).keys()], ord);
    for (const m of mv) await qapi('/queue/move', { method: 'POST', body: m });
    undo = ord; sort = null; buildHead(); toast('Sort applied as the queue order'); ctl.refreshAll?.();
  }
  /** Reorder: the selected rows go to insertion point t as one block; remembered for Ctrl+Z. */
  async function moveRows(selIdx, t) {
    const n = V.queue.length, order = reorder(n, selIdx, t), ids = [...Array(n).keys()], mv = movesFor(ids, order);
    if (!mv.length) return;
    for (const m of mv) await qapi('/queue/move', { method: 'POST', body: m });
    undo = order; const p = order.indexOf(selIdx.slice().sort((a, b) => a - b)[0]); sel = selIdx.map((_, k) => p + k); anchor = p;
    ctl.refreshAll?.();
  }
  async function doUndo() { const back = undoMoves(undo); undo = null; try { for (const m of back) await qapi('/queue/move', { method: 'POST', body: m }); toast('Reorder undone'); } catch (e) { toast(e.message, true); } ctl.refreshAll?.(); }
  if (typeof document !== 'undefined') document.addEventListener('keydown', ev => { if (undo && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z' && !document.querySelector('dialog[open]') && !ev.target.closest?.('input,textarea,select,[contenteditable]')) { ev.preventDefault(); doUndo(); } });   // Ctrl+Z undoes the last reorder
  paintLock(); buildHead();
  return { el: root, head, draw, widths: () => widths.slice(), relayout: layout, setCollapsed, setState, setNextBlock, leftEdge, rightEdge };
}

/** 0.5.0 F89: queue index that will really play next. Uses the server's nextIndex (shuffle pick, Repeat All wrap, Repeat One) like the title-bar strip; list neighbour only for an older server without nextIndex. */
export function queueNextIndex(now, queue) {
  const n = queue?.length || 0, cur = now?.index ?? -1;
  if (now && 'nextIndex' in now) { const i = now.nextIndex; return Number.isInteger(i) && i >= 0 && i < n ? i : -1; }
  return cur >= 0 && cur + 1 < n ? cur + 1 : -1;
}
