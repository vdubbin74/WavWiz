import { h, api, toast, dialog } from './util.js';

export const canControl = S => S.auth && S.auth.role !== 'view';

// ---- "refs": what a row stands for when you play it, queue it, drag it or add it to a playlist ----
export const refTracks = ids => ({ kind: 'tracks', ids });
export const refNode = node => ({ kind: 'node', node });
export const albumNode = (artist, album) => `album:${artist}\u001f${album}`;
const MIME = 'application/x-wavwiz-ref';

async function act(path, body, ok) { try { await api(path, { method: 'POST', body }); if (ok) toast(ok); return true; } catch (e) { toast(e.message, true); return false; } }
export const playNow = ref => act('/stream/play', ref);
export const playNext = ref => act('/queue/add', { ...ref, next: true }, 'Will play next');
export const addToQueue = ref => act('/queue/add', ref, 'Added to the queue');

/** Bottom sheet (phone) / centered menu (desktop). */
export function sheet(title, actions) {
  const close = () => { el.remove(); document.removeEventListener('keydown', esc); };
  const esc = ev => { if (ev.key === 'Escape') close(); };
  const el = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
    h('div', { class: 'scrim', onclick: close }),
    h('div', { class: 'panel' }, h('h4', null, title), actions.filter(Boolean).map(a => h('button', { class: 'act' + (a.danger ? ' err' : ''), onclick: async () => { close(); await a.onclick(); } }, a.text))));
  document.addEventListener('keydown', esc); document.body.append(el); el.querySelector('button.act')?.focus(); return close;
}

export async function pickPlaylist(S, ref, title = 'Add to playlist') {
  let lists = []; try { lists = await api('/playlists'); } catch (e) { return toast(e.message, true); }
  const nm = h('input', { type: 'text', placeholder: 'New playlist name', maxlength: 80 });
  const add = async id => { try { const r = await api(`/playlists/${id}/items`, { method: 'POST', body: ref }); toast(`Added ${r.added} item(s)`); d.close(); window.dispatchEvent(new CustomEvent('wavwiz:playlists')); } catch (e) { toast(e.message, true); } };
  const create = async () => {
    const name = nm.value.trim(); if (!name) return toast('Type a name for the new playlist.', true);
    try { const p = await api('/playlists', { method: 'POST', body: { name } }); await add(p.id); } catch (e) { toast(e.message, true); }
  };
  const d = dialog(title, [lists.length ? h('ul', { class: 'list' }, lists.map(p => h('li', { class: 'item', onclick: () => add(p.id) }, h('div', { class: 't' }, h('div', { class: 't1' }, p.name), h('div', { class: 't2' }, `${p.count} items`))))) : h('p', { class: 'dim' }, 'No playlists yet - create the first one:'),
    h('div', { class: 'row', style: 'margin-top:10px' }, nm, h('button', { class: 'btn primary', onclick: create }, 'Create + add'))], [{ text: 'Cancel' }]);
}

/** Makes a row work everywhere: click = open/play (caller), "..." = menu, right-click = menu, long-press on touch = menu, drag (desktop) = add to a playlist/queue. */
export function attachItem(S, el, ref, title, { menu = [], more = true } = {}) {
  const openMenu = () => {
    if (!canControl(S)) return toast('Your access is view-only, so you can browse but not play.', false);
    sheet(title, [{ text: '▶  Play now', onclick: () => playNow(ref) }, { text: '⏭  Play next', onclick: () => playNext(ref) }, { text: '＋  Add to queue', onclick: () => addToQueue(ref) }, { text: '♫  Add to playlist…', onclick: () => pickPlaylist(S, ref) }, ...menu]);
  };
  if (more) el.append(h('button', { class: 'more', 'aria-label': 'More actions for ' + title, onclick: ev => { ev.stopPropagation(); openMenu(); } }, '⋯'));
  el.addEventListener('contextmenu', ev => { ev.preventDefault(); openMenu(); });
  longPress(el, openMenu);
  if (canControl(S)) { el.draggable = true; el.addEventListener('dragstart', ev => { ev.dataTransfer.setData(MIME, JSON.stringify(ref)); ev.dataTransfer.setData('text/plain', title); ev.dataTransfer.effectAllowed = 'copy'; el.classList.add('dragging'); }); el.addEventListener('dragend', () => el.classList.remove('dragging')); }
  return el;
}

export function longPress(el, fn, ms = 520) {
  let t = null, sx = 0, sy = 0, fired = false;
  const cancel = () => { clearTimeout(t); t = null; };
  el.addEventListener('touchstart', ev => { fired = false; const p = ev.touches[0]; sx = p.clientX; sy = p.clientY; t = setTimeout(() => { fired = true; try { navigator.vibrate?.(15); } catch { /* optional */ } fn(); }, ms); }, { passive: true });
  el.addEventListener('touchmove', ev => { const p = ev.touches[0]; if (Math.abs(p.clientX - sx) > 9 || Math.abs(p.clientY - sy) > 9) cancel(); }, { passive: true });
  el.addEventListener('touchend', ev => { cancel(); if (fired) { ev.preventDefault(); } });
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('click', ev => { if (fired) { ev.stopImmediatePropagation(); ev.preventDefault(); fired = false; } }, true);
}

export function dropTarget(el, onRef, accept = ev => ev.dataTransfer?.types?.includes(MIME)) {
  el.addEventListener('dragover', ev => { if (accept(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; el.classList.add('dragover'); } });
  el.addEventListener('dragleave', () => el.classList.remove('dragover'));
  el.addEventListener('drop', ev => { el.classList.remove('dragover'); const raw = ev.dataTransfer.getData(MIME); if (!raw) return; ev.preventDefault(); try { onRef(JSON.parse(raw), ev); } catch { /* bad payload */ } });
}

/** Renders rows in chunks so a 5,000-album library does not freeze a phone. */
export function chunked(container, rows, make, chunk = 120) {
  let i = 0; const sentinel = h('div', { style: 'height:1px' });
  const more = () => { const end = Math.min(rows.length, i + chunk); const frag = document.createDocumentFragment(); for (; i < end; i++) frag.append(make(rows[i], i)); container.insertBefore(frag, sentinel); if (i >= rows.length) { io.disconnect(); sentinel.remove(); } };
  const io = new IntersectionObserver(es => { if (es[0].isIntersecting) more(); }, { rootMargin: '600px' });
  container.append(sentinel); more(); if (i < rows.length) io.observe(sentinel);
}
export { MIME };
