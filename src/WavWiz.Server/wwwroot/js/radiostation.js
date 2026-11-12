// Shared Radio station tile/row chrome: context menu (ctxmenu), library-style drag to queue, no star/X buttons.
import { h, api, toast, ask } from './util.js';
import { cover, radioArt, remoteArt } from './art.js';
import { icon } from './icons.js';
import { canControl, dragInfo, playNext, addToQueue, MIME } from './ui.js';
import { dndMode, pointerDragSource } from './pdrag.js';
import { attachCtx } from './ctxmenu.js';
import { loadLibPrefs, tabView } from './libsort.js';

// 0.6.9 #5: the Library sets the Tiles / List pick it shows on its toolbar for the Radio source (side panel or Expanded, session picks included);
// without it (phone Radio page) the Expanded per-tab pref decides as before.
let viewPick = null;
export const setRadioView = v => { viewPick = v === 'grid' || v === 'list' ? v : null; };
export const radioGridOn = () => {
  if (viewPick) return viewPick === 'grid';
  const P = loadLibPrefs();
  try { return tabView(P, 'radio') === 'grid'; } catch { return P.defView !== 'list'; }
};
export const stationSub = r => {
  const genre = r.genre || r.tags || '';
  const br = r.bitrate ? `${r.bitrate} kbps` : '';
  const codec = r.codec || '';
  const mid = [genre, [codec, br].filter(Boolean).join(' · ')].filter(Boolean).join(' · ');
  return mid || (r.url || '').replace(/^https?:\/\//, '').slice(0, 40);
};
export const savedRef = r => ({ kind: 'radio', id: r.id });
/** Unsaved finder hit: queue by URL (ResolveItems kind=url). Play still saves via finder/save. */
export const finderRef = r => ({ kind: 'url', url: r.url || r.url_resolved, name: r.name || 'Station' });

export function favMark() {
  return h('span', { class: 'rad-favmark', title: 'Favorite', 'aria-hidden': 'true' }, icon('heartOn'));
}

export function stationArt(r, size, cls) {
  // Saved stations always use /art/radio/{id} (server fetches logo_url and caches it).
  // Raw logoUrl / favicon are off-origin Radio Browser URLs; CSP is img-src 'self' data:,
  // so those <img> requests fail and cover() draws the generated letter/wave fallback.
  // Finder hits (no id) use /art/remote/{faviconArt} — an opaque hash the server issued for that result.
  const src = r.id != null
    ? radioArt(r.id, size)
    : remoteArt(r.faviconArt, size);
  return cover(src, cls, '📻', { album: r.name || 'Station', artist: r.genre || r.tags || 'Radio' });
}

async function ensureSavedId(r) {
  if (r.id != null) return r.id;
  const { id } = await api('/radio/finder/save', { method: 'POST', body: r });
  return id;
}

export function stationMenuItems(r, { S, act, onChange, saved }) {
  const can = canControl(S);
  if (saved) {
    return [
      { id: 'play', ic: 'play', label: 'Play', disabled: !can, onclick: () => act('/stream/play', { kind: 'radio', id: r.id }) },
      { id: 'next', ic: 'queue', label: 'Play next', disabled: !can, onclick: () => playNext(savedRef(r)) },
      { id: 'add', ic: 'plus', label: 'Add to queue', disabled: !can, onclick: () => addToQueue(savedRef(r)) },
      { sep: true },
      { id: 'fav', label: r.favorite ? 'Remove from favorites' : 'Add to favorites', disabled: !can,
        onclick: () => act(`/radio/${r.id}`, { favorite: !r.favorite }, 'PUT').then(onChange) },
      { sep: true },
      { id: 'remove', ic: 'del', label: 'Remove', danger: true, disabled: !can,
        onclick: async () => {
          if (!(await ask('Remove station', `Remove “${r.name}” from My stations?`, { ok: 'Remove', danger: true }))) return;
          await act(`/radio/${r.id}`, undefined, 'DELETE'); onChange?.();
        } },
    ];
  }
  return [
    { id: 'play', ic: 'play', label: 'Play', disabled: !can, onclick: async () => {
      try {
        const id = await ensureSavedId(r);
        await act('/stream/play', { kind: 'radio', id });
        toast('Playing ' + (r.name || ''));
        onChange?.();
      } catch (e) { toast(e.message, true); }
    } },
    { id: 'add', ic: 'plus', label: 'Add to queue', disabled: !can, onclick: async () => {
      try {
        // Match play path: save first, then queue by radio id (no invented backend).
        const id = await ensureSavedId(r);
        await addToQueue({ kind: 'radio', id });
        onChange?.();
      } catch (e) { toast(e.message, true); }
    } },
    { id: 'save', ic: 'plus', label: 'Save to My Stations', disabled: !can, onclick: async () => {
      try { await api('/radio/finder/save', { method: 'POST', body: r }); toast('Saved to your stations'); onChange?.(); }
      catch (e) { toast(e.message, true); }
    } },
  ];
}

/** Library-style drag: same {lib,ref} payload queue drop targets already accept. */
export function wireStationDrag(el, ref, title, kind = 'Radio') {
  if (!ref) return;
  el.classList.add('ldrag');
  const mode = dndMode();
  const mkGhost = () => h('div', { class: 'dragghost' }, h('div', { class: 'dg-t' }, h('b', { class: 'ell' }, title), h('span', { class: 'small dim' }, kind)));
  pointerDragSource(el, () => ({ lib: true, ref, title }), {
    mode, ghost: mkGhost,
    onStart: () => { dragInfo.count = 1; dragInfo.title = title; dragInfo.kind = kind; dragInfo.ref = ref; },
    onEnd: () => { dragInfo.count = null; dragInfo.title = ''; dragInfo.kind = ''; dragInfo.ref = null; },
  });
  if (mode === 'pointer') return;
  el.draggable = true;
  el.addEventListener('dragstart', ev => {
    ev.dataTransfer.setData(MIME, JSON.stringify(ref));
    ev.dataTransfer.setData('text/plain', title);
    ev.dataTransfer.effectAllowed = 'copy';
    el.classList.add('dragging');
    dragInfo.count = 1; dragInfo.title = title; dragInfo.kind = kind; dragInfo.ref = ref;
    try {
      const g = mkGhost();
      document.body.append(g); ev.dataTransfer.setDragImage?.(g, 14, 14); setTimeout(() => g.remove(), 0);
    } catch { /* */ }
  });
  el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragInfo.count = null; dragInfo.title = ''; dragInfo.kind = ''; dragInfo.ref = null; });
}

export function wireStationChrome(el, r, { S, act, onChange, saved }) {
  const can = canControl(S);
  const ref = saved ? savedRef(r) : (r.url ? finderRef(r) : null);
  if (can && ref) wireStationDrag(el, ref, r.name || 'Station');
  attachCtx(el, () => stationMenuItems(r, { S, act, onChange, saved }), r.name || 'Station');
}

export function savedStationTile(r, playing, { S, act, onChange }) {
  const can = canControl(S), on = playing === r.id;
  const el = h('li', { class: 'tile' + (on ? ' playing' : '') + (r.favorite ? ' rad-fav' : ''), 'data-station': String(r.id) },
    h('div', { class: 'tileart' }, stationArt(r, 384, 'lg'),
      on ? h('span', { class: 'tilebadge' }, '▮▮▮ Playing') : null,
      r.favorite ? favMark() : null,
      can ? h('button', { type: 'button', class: 'tileplay', 'aria-label': 'Play ' + r.name, onclick: ev => { ev.stopPropagation(); act('/stream/play', { kind: 'radio', id: r.id }); } }, '▶') : null),
    h('div', { class: 't1 ell', title: r.name }, r.name),
    h('div', { class: 't2 ell' }, stationSub(r)));
  wireStationChrome(el, r, { S, act, onChange, saved: true });
  return el;
}

export function savedStationRow(r, playing, { S, act, onChange }) {
  const can = canControl(S), on = playing === r.id;
  const el = h('li', { class: 'item radrow' + (on ? ' playing' : '') + (r.favorite ? ' rad-fav' : ''), 'data-station': String(r.id) },
    stationArt(r, 96, 'sm'),
    h('div', { class: 't', style: 'min-width:0' },
      h('div', { class: 't1 ell' }, r.name, r.favorite ? favMark() : null),
      h('div', { class: 't2 ell' }, stationSub(r))),
    on ? h('span', { class: 'tag on' }, 'PLAYING') : null,
    can ? h('button', { class: 'btn primary', 'aria-label': 'Play ' + r.name, onclick: ev => { ev.stopPropagation(); act('/stream/play', { kind: 'radio', id: r.id }); } }, '▶') : null);
  wireStationChrome(el, r, { S, act, onChange, saved: true });
  return el;
}

export function finderStationTile(r, { S, act, onChange, savedIds }) {
  const can = canControl(S);
  const saved = !!(r.url && savedIds?.has(r.url));
  const el = h('li', { class: 'tile' + (saved ? ' rad-saved' : ''), 'data-station-uuid': r.stationuuid || '' },
    h('div', { class: 'tileart' }, stationArt(r, 384, 'lg'),
      saved ? h('span', { class: 'tilebadge' }, 'Saved') : null,
      can ? h('button', { type: 'button', class: 'tileplay', 'aria-label': 'Play ' + (r.name || ''), onclick: ev => {
        ev.stopPropagation();
        stationMenuItems(r, { S, act, onChange, saved: false }).find(i => i.id === 'play')?.onclick?.();
      } }, '▶') : null),
    h('div', { class: 't1 ell', title: r.name }, r.name || 'Station'),
    h('div', { class: 't2 ell' }, stationSub(r)));
  wireStationChrome(el, r, { S, act, onChange, saved: false });
  return el;
}

export function finderStationRow(r, { S, act, onChange, savedIds }) {
  const can = canControl(S);
  const saved = !!(r.url && savedIds?.has(r.url));
  const el = h('div', { class: 'card row wrap radfind-row' + (saved ? ' rad-saved' : ''), 'data-station-uuid': r.stationuuid || '' },
    stationArt(r, 96, 'sm'),
    h('div', { class: 'grow', style: 'min-width:0' },
      h('b', { class: 'ell', style: 'display:block' }, r.name || 'Station', saved ? h('span', { class: 'small dim' }, ' · Saved') : null),
      h('div', { class: 'dim small ell' }, stationSub(r))),
    can ? h('button', { class: 'btn primary', onclick: ev => {
      ev.stopPropagation();
      stationMenuItems(r, { S, act, onChange, saved: false }).find(i => i.id === 'play')?.onclick?.();
    } }, '▶') : null);
  wireStationChrome(el, r, { S, act, onChange, saved: false });
  return el;
}
