import { h, api, toast, dialog } from './util.js';

export const canControl = S => S.auth && S.auth.role !== 'view';
/** 0.2.0 item 28: admin-only controls are shown READ-ONLY (disabled, with this hint) to everyone else - never hidden. */
export const isAdmin = S => S?.auth?.role === 'admin';
export const ADMIN_HINT = 'Only an administrator can change this. Use File > Sign in as admin.';
/** The browser speaker id of this page (0.2.0 key, or the 0.1.x one before it is migrated). */
export function webRoomId() { try { return localStorage.getItem('wavwiz.webRoom.id') || localStorage.getItem('unison.webRoom.id'); } catch { return null; } }
/** 0.2.0 item 9: "this device" = the speaker this page plays on: this browser's own web speaker, else a Player on the same PC that the
 * server marked as mine (the WavWiz Player window, or a browser on a PC that runs a Player). */
export function thisDevice(S, rid = webRoomId()) {
  const zs = S?.zones || [];
  return zs.find(z => rid && z.playerId === rid && z.connected) || zs.find(z => z.mine && z.connected) || zs.find(z => rid && z.playerId === rid) || zs.find(z => z.mine) || null;
}
/** Can this session change delay/output on zone z? Admins: any device. Everyone else: only their own (server enforces the same). */
export const canTune = (S, z) => isAdmin(S) || (canControl(S) && !!z?.mine);
/** Disable a control for non-admins and explain why (title + aria). Returns the element. */
export function adminOnly(S, el, ok = isAdmin(S)) { if (!ok) { el.disabled = true; el.title = ADMIN_HINT; el.setAttribute('aria-disabled', 'true'); el.classList.add('ro'); } return el; }

// ---- "refs": what a row stands for when you play it, queue it, drag it or add it to a playlist ----
export const refTracks = ids => ({ kind: 'tracks', ids });
export const refNode = node => ({ kind: 'node', node });
export const albumNode = (artist, album) => `album:${artist}\u001f${album}`;
const MIME = 'application/x-wavwiz-ref';

async function act(path, body, ok) { try { await api(path, { method: 'POST', body }); if (ok) toast(ok); return true; } catch (e) { toast(e.message, true); return false; } }
export const playNow = ref => act('/stream/play', ref);
/** 0.2.1 F13: album page Shuffle - shuffle on, then play the songs starting from a random one. */
export async function playShuffled(ids) { if (!ids?.length) return false; if (!(await act('/stream/shuffle', { on: true }))) return false; return act('/stream/play', { kind: 'tracks', ids, index: Math.floor(Math.random() * ids.length) }); }
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

/** 0.3.5 J9 #8: Add to playlist = a small dropdown next to the song row (no window); "New playlist…" is typed in place. */
let lastPt = { x: 0, y: 0 };
if (typeof document !== 'undefined') document.addEventListener('pointerdown', ev => { lastPt = { x: ev.clientX, y: ev.clientY }; }, true);
export async function pickPlaylist(S, ref, title = 'Add to playlist') {
  let lists = []; try { lists = await api('/playlists'); } catch (e) { return toast(e.message, true); }
  document.querySelector('.pldrop')?.remove();
  const close = () => { box.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); };
  const outside = ev => { if (!box.contains(ev.target)) close(); }, esc = ev => { if (ev.key === 'Escape') close(); };
  const add = async id => { try { const r = await api(`/playlists/${id}/items`, { method: 'POST', body: ref }); toast(`Added ${r.added} item(s)`); close(); window.dispatchEvent(new CustomEvent('wavwiz:playlists')); } catch (e) { toast(e.message, true); } };
  const nm = h('input', { type: 'text', placeholder: 'New playlist name', maxlength: 80, 'aria-label': 'New playlist name', onkeydown: ev => { if (ev.key === 'Enter') create(); } });
  const create = async () => { const name = nm.value.trim(); if (!name) { nm.focus(); return; } try { const p = await api('/playlists', { method: 'POST', body: { name } }); await add(p.id); } catch (e) { toast(e.message, true); } };
  const newRow = h('div', { class: 'pl-new', hidden: true }, nm, h('button', { class: 'btn sm primary', type: 'button', onclick: create }, 'Add'));
  const box = h('div', { class: 'pldrop mpanel', role: 'menu', 'aria-label': title },
    h('div', { class: 'pl-h small dim' }, title),
    ...lists.map(p => h('button', { type: 'button', role: 'menuitem', onclick: () => add(p.id) }, h('span', { class: 'grow ell' }, p.name), h('span', { class: 'small dim' }, String(p.count)))),
    h('button', { type: 'button', role: 'menuitem', class: 'pl-newbtn', onclick: () => { newRow.hidden = false; nm.focus(); } }, 'New playlist…'), newRow);
  document.body.append(box);
  const r = box.getBoundingClientRect(), z = Number(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;
  const vw = innerWidth / z, vh = innerHeight / z, x = lastPt.x / z, y = lastPt.y / z;
  box.style.left = Math.max(4, Math.min(x, vw - r.width - 4)) + 'px'; box.style.top = Math.max(4, Math.min(y, vh - r.height - 4)) + 'px';
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', esc, true); }, 0);
  return { el: box, close };
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
  return { upTo: n => { while (i <= n && i < rows.length) more(); } };   // 0.2.0 item 13: the letter strip renders ahead before jumping
}
export { MIME };
