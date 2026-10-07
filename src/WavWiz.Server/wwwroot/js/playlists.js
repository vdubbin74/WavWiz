import { h, api, toast, dialog, fmtTime, fmtDur } from './util.js';
import { cover, trackArt, isLive } from './art.js';
import { canControl, dropTarget, sheet, playNow, addToQueue, MIME } from './ui.js';

const PLMIME = 'application/x-wavwiz-plitem';

/** Saved playlists: create, play, rename, delete, add by drag/menu, and reorder / remove songs (drag on desktop, arrows on phone). */
export function playlistsView(S) {
  const root = h('div'); let openId = null;
  const act = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); return null; } };

  async function drawList() {
    openId = null; let lists = []; try { lists = await api('/playlists'); } catch (e) { root.replaceChildren(h('p', { class: 'err' }, e.message)); return; }
    const nm = h('input', { type: 'text', placeholder: 'New playlist name', maxlength: 80, 'aria-label': 'New playlist name' });
    const create = async fromQueue => { const name = nm.value.trim(); if (!name) return toast('Type a name first.', true); if (await act(() => api('/playlists', { method: 'POST', body: { name, fromQueue } }), 'Playlist created')) { nm.value = ''; drawList(); } };
    root.replaceChildren(h('h2', null, 'Playlists'), h('p', { class: 'dim small' }, canControl(S) ? 'Drag songs, albums or artists from the Library onto a playlist (or use the ⋯ menu / long-press on a phone).' : 'Your access is view-only.'),
      canControl(S) ? h('div', { class: 'card' }, h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, nm), h('button', { class: 'btn primary', onclick: () => create(false) }, 'Create empty'), h('button', { class: 'btn', onclick: () => create(true) }, 'Save the queue'))) : null,
      lists.length ? lists.map(p => {
        const card = h('div', { class: 'card item', style: 'cursor:default' }, h('div', { class: 't', style: 'cursor:pointer', onclick: () => drawOne(p.id) }, h('div', { class: 't1 ell' }, '♫ ' + p.name), h('div', { class: 't2' }, `${p.count} item${p.count === 1 ? '' : 's'}`)),
          canControl(S) ? [h('button', { class: 'btn primary', onclick: () => act(() => api('/stream/play', { method: 'POST', body: { kind: 'playlist', id: p.id } })) }, '▶'), h('button', { class: 'btn', onclick: () => act(() => api('/queue/add', { method: 'POST', body: { kind: 'playlist', id: p.id } }), 'Added to the queue') }, '＋')] : null,
          h('button', { class: 'btn', 'aria-label': 'Open ' + p.name, onclick: () => drawOne(p.id) }, 'Open'));
        if (canControl(S)) dropTarget(card, ref => act(() => api(`/playlists/${p.id}/items`, { method: 'POST', body: ref }), `Added to ${p.name}`).then(drawList));
        return card;
      }) : h('p', { class: 'dim' }, 'No playlists yet.'));
  }

  async function drawOne(id, focusIndex) {
    openId = id; let p; try { p = await api('/playlists/' + id); } catch (e) { toast(e.message, true); return drawList(); }
    let items = p.items.map(x => ({ kind: x.kind, refId: x.refId, title: x.title, artist: x.artist, album: x.album, durationMs: x.durationMs }));
    const save = async () => { await act(() => api(`/playlists/${id}/items`, { method: 'PUT', body: { items: items.map(x => ({ kind: x.kind, refId: x.refId })) } })); await drawOne(id); };
    const move = (from, to) => { if (to < 0 || to >= items.length || from === to) return; const [x] = items.splice(from, 1); items.splice(to, 0, x); save(); };
    const total = items.reduce((a, x) => a + (x.durationMs || 0), 0);
    const nm = h('input', { type: 'text', value: p.name, maxlength: 80, 'aria-label': 'Playlist name' });
    const ul = h('ul', { class: 'list', 'aria-label': 'Songs in ' + p.name });
    items.forEach((x, i) => {
      const el = h('li', { class: 'item', draggable: canControl(S) ? 'true' : null, onclick: () => canControl(S) && act(() => api('/stream/play', { method: 'POST', body: { kind: 'playlist', id, index: i } })) },
        h('span', { class: 'num', title: 'Drag to reorder' }, canControl(S) ? '☰' : i + 1), cover(x.kind === 'track' ? trackArt(x.refId, 96) : null, 'sm', x.kind === 'radio' ? '📻' : '♪'),
        h('div', { class: 't' }, h('div', { class: 't1 ell' }, x.title), h('div', { class: 't2 ell' }, [x.artist, x.album].filter(Boolean).join(' • '))), h('span', { class: 'dur hide-s' }, isLive(x) ? 'LIVE' : fmtTime(x.durationMs)),
        canControl(S) ? [h('button', { class: 'more', 'aria-label': 'Move up', disabled: i === 0, onclick: ev => { ev.stopPropagation(); move(i, i - 1); } }, '▲'), h('button', { class: 'more', 'aria-label': 'Move down', disabled: i === items.length - 1, onclick: ev => { ev.stopPropagation(); move(i, i + 1); } }, '▼'),
          h('button', { class: 'more', 'aria-label': 'Remove from playlist', onclick: async ev => { ev.stopPropagation(); await act(() => api(`/playlists/${id}/items/${i}`, { method: 'DELETE' })); drawOne(id); } }, '✕')] : null);
      if (canControl(S)) {
        el.addEventListener('dragstart', ev => { ev.dataTransfer.setData(PLMIME, String(i)); ev.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
        el.addEventListener('dragend', () => el.classList.remove('dragging'));
        el.addEventListener('dragover', ev => { if (ev.dataTransfer.types.includes(PLMIME) || ev.dataTransfer.types.includes(MIME)) { ev.preventDefault(); el.classList.add('dragover'); } });
        el.addEventListener('dragleave', () => el.classList.remove('dragover'));
        el.addEventListener('drop', async ev => {
          el.classList.remove('dragover'); const from = ev.dataTransfer.getData(PLMIME), lib = ev.dataTransfer.getData(MIME);
          if (from !== '') { ev.preventDefault(); move(+from, i); }
          else if (lib) { ev.preventDefault(); await act(() => api(`/playlists/${id}/items`, { method: 'POST', body: { ...JSON.parse(lib), position: i } }), 'Added'); drawOne(id); }
        });
      }
      ul.append(el);
    });
    const tail = h('div', { class: 'card', style: 'text-align:center;color:var(--dim)' }, canControl(S) ? 'Drop songs here to add them to the end' : 'End of playlist');
    if (canControl(S)) dropTarget(tail, async ref => { await act(() => api(`/playlists/${id}/items`, { method: 'POST', body: ref }), 'Added'); drawOne(id); });
    root.replaceChildren(h('div', { class: 'crumbs' }, h('button', { class: 'btn', onclick: drawList }, '‹ Playlists')),
      h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, nm), canControl(S) ? [h('button', { class: 'btn', onclick: () => act(() => api('/playlists/' + id, { method: 'PUT', body: { name: nm.value } }), 'Renamed').then(() => drawOne(id)) }, 'Rename'), h('button', { class: 'btn primary', onclick: () => act(() => api('/stream/play', { method: 'POST', body: { kind: 'playlist', id } })) }, '▶ Play'),
        h('button', { class: 'btn danger', onclick: async () => { if (confirm(`Delete the playlist “${p.name}”? The songs stay in your library.`)) { await act(() => api('/playlists/' + id, { method: 'DELETE' }), 'Deleted'); drawList(); } } }, 'Delete')] : null),
      h('p', { class: 'dim small' }, `${items.length} items${total ? ' • ' + fmtDur(total) : ''}`), items.length ? ul : h('p', { class: 'dim' }, 'Empty. Add songs from the Library.'), tail);
  }
  window.addEventListener('wavwiz:playlists', () => { openId ? drawOne(openId) : drawList(); });
  drawList();
  return { el: root, reload: () => (openId ? drawOne(openId) : drawList()) };
}
