// WavWiz 0.3.5 J9: the Library Radio tab - My stations next to the finder (search, Save, favorites, podcasts with episodes folding out).
// F235: stations use the same tiles/list language as Artists / Albums (not bare radrow cards only).
import { h, api, toast } from './util.js';
import { cover, radioArt } from './art.js';
import { canControl } from './ui.js';
import { loadLibPrefs, tabView } from './libsort.js';
import { radioFinderView } from './radiofinder.js';

export function radioTab(S, act) {
  const mine = h('div', { class: 'radmine' }), finder = radioFinderView(S, act);
  const root = h('div', { class: 'radiotab2' }, h('section', { class: 'radcol' }, h('div', { class: 'sec' }, 'My stations ', h('span', { class: 'cnt' })), mine), h('section', { class: 'radcol' }, finder.el));
  const gridOn = () => {
    const P = loadLibPrefs();
    try { return tabView(P, 'radio') === 'grid'; } catch { return P.defView !== 'list'; }
  };
  const sub = r => [r.genre, r.bitrate ? r.bitrate + ' kbps' : null].filter(Boolean).join(' · ') || (r.url || '').replace(/^https?:\/\//, '').slice(0, 40);
  function stationTile(r, playing, can) {
    const on = playing === r.id;
    return h('li', { class: 'tile' + (on ? ' playing' : ''), 'data-station': String(r.id) },
      h('div', { class: 'tileart' }, cover(radioArt(r.id, 384), 'lg', '📻', { album: r.name, artist: r.genre || 'Radio' }),
        on ? h('span', { class: 'tilebadge' }, '▮▮▮ Playing') : null,
        can ? h('button', { type: 'button', class: 'tileplay', 'aria-label': 'Play ' + r.name, onclick: ev => { ev.stopPropagation(); act('/stream/play', { kind: 'radio', id: r.id }); } }, '▶') : null),
      h('div', { class: 't1 ell', title: r.name }, r.name),
      h('div', { class: 't2 ell' }, sub(r)),
      can ? h('div', { class: 'row', style: 'gap:4px;margin-top:4px' },
        h('button', { class: 'btn sm', 'aria-label': 'Favorite', onclick: () => act(`/radio/${r.id}`, { favorite: !r.favorite }, 'PUT').then(drawMine) }, r.favorite ? '★' : '☆'),
        h('button', { class: 'btn sm danger', 'aria-label': 'Delete ' + r.name, onclick: () => act(`/radio/${r.id}`, undefined, 'DELETE').then(drawMine) }, '✕')) : null);
  }
  function stationRow(r, playing, can) {
    const on = playing === r.id;
    return h('li', { class: 'item radrow' + (on ? ' playing' : ''), 'data-station': String(r.id) },
      h('button', { class: 'iconbtn', 'aria-label': 'Favorite', onclick: () => act(`/radio/${r.id}`, { favorite: !r.favorite }, 'PUT').then(drawMine) }, r.favorite ? '★' : '☆'),
      cover(radioArt(r.id, 96), 'sm', '📻', { album: r.name, artist: r.genre || 'Radio' }),
      h('div', { class: 't', style: 'min-width:0' }, h('div', { class: 't1 ell' }, r.name), h('div', { class: 't2 ell' }, sub(r))),
      on ? h('span', { class: 'tag on' }, 'PLAYING') : null,
      can ? [h('button', { class: 'btn primary', 'aria-label': 'Play ' + r.name, onclick: () => act('/stream/play', { kind: 'radio', id: r.id }) }, '▶'),
        h('button', { class: 'btn danger', 'aria-label': 'Delete ' + r.name, onclick: () => act(`/radio/${r.id}`, undefined, 'DELETE').then(drawMine) }, '✕')] : null);
  }
  async function drawMine() {
    let rows = S.radio || []; try { rows = S.radio = await api('/radio'); } catch { /* keep */ }
    const can = canControl(S), playing = S.now?.item?.kind === 'radio' ? S.now.item.refId : null;
    root.querySelector('.radcol .cnt').textContent = String(rows.length);
    const url = h('input', { type: 'url', placeholder: 'https://… stream address', class: 'grow', 'aria-label': 'Stream address' }), name = h('input', { type: 'text', placeholder: 'Station name', maxlength: 80, 'aria-label': 'Station name' });
    const grid = gridOn();
    const list = rows.length
      ? h('ul', { class: grid ? 'tilegrid tg-radio' : 'list' }, rows.map(r => grid ? stationTile(r, playing, can) : stationRow(r, playing, can)))
      : h('p', { class: 'dim' }, 'No stations yet. Find one on the right, or add a stream address below.');
    const add = can ? h('div', { class: 'card' }, h('div', { class: 'sec' }, 'Add a station'), h('div', { class: 'field' }, name), h('div', { class: 'row' }, url, h('button', { class: 'btn', onclick: async () => { try { await api('/radio', { method: 'POST', body: { name: name.value, url: url.value } }); drawMine(); } catch (e) { toast(e.message, true); } } }, 'Add'))) : '';
    mine.replaceChildren(list, add);
  }
  return { el: root, reload: () => { drawMine(); finder.reload(); } };
}
