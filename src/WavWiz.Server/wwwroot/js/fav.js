// 0.2.0 item 14: favorites (hearts) on songs and albums. Stored on the server so they follow you to every browser;
// hearting needs Control or Admin access (like playlists). One shared set; every heart button on the page updates together.
import { h, api, toast } from './util.js';
import { canControl } from './ui.js';

const favs = new Set(); let loading = null;
export const favKey = (kind, ref) => `${kind}:${ref}`;
export const albumRef = (artist, album) => `${artist}\u001f${album}`;
export const isFav = (kind, ref) => favs.has(favKey(kind, String(ref)));
export function loadFavs(force = false) {
  if (loading && !force) return loading;
  loading = api('/favorites').then(rows => { favs.clear(); for (const f of rows || []) favs.add(favKey(f.kind, f.ref)); paintAll(); return favs; }).catch(() => favs);
  return loading;
}
function paintAll() { for (const b of document.querySelectorAll('.heart[data-fav]')) paint(b); window.dispatchEvent(new CustomEvent('wavwiz:favs')); }
function paint(b) { const on = favs.has(b.dataset.fav); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '♥' : '♡'; b.title = on ? 'Remove from Favorites' : 'Add to Favorites'; }
export async function toggleFav(S, kind, ref) {
  if (!canControl(S)) { toast('Only Control or Admin access can change favorites.', true); return; }
  const k = favKey(kind, String(ref)), on = !favs.has(k);
  if (on) favs.add(k); else favs.delete(k); paintAll();
  try { await api('/favorites', { method: 'PUT', body: { kind, ref: String(ref), on } }); }
  catch (e) { if (on) favs.delete(k); else favs.add(k); paintAll(); toast(e.message, true); }
}
/** Heart button. Read-only (disabled with a hint) for View access - never hidden. */
export function heartBtn(S, kind, ref, label = '') {
  const b = h('button', { type: 'button', class: 'heart', 'data-fav': favKey(kind, String(ref)), 'aria-label': `Favorite ${label}`.trim(),
    onclick: ev => { ev.stopPropagation(); toggleFav(S, kind, ref); } });
  if (!canControl(S)) { b.disabled = true; b.title = 'Only Control or Admin access can change favorites.'; }
  paint(b); if (!canControl(S)) b.title = 'Only Control or Admin access can change favorites.';
  return b;
}
window.addEventListener('wavwiz:favorites', () => loadFavs(true));   // another browser changed a heart
