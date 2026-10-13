// WavWiz 0.3.5 J9: the Library Radio tab - My stations next to the finder (search, Save, favorites, podcasts with episodes folding out).
// Replaces the Internet radio popup and its Radio finder tab (next-j9-lib-expanded-radio.png). The narrow Library panel stacks the two.
import { h, api, toast } from './util.js';
import { canControl } from './ui.js';
import { radioFinderView } from './radiofinder.js';

export function radioTab(S, act) {
  const mine = h('div', { class: 'radmine' }), finder = radioFinderView(S, act);
  const root = h('div', { class: 'radiotab2' }, h('section', { class: 'radcol' }, h('div', { class: 'sec' }, 'My stations ', h('span', { class: 'cnt' })), mine), h('section', { class: 'radcol' }, finder.el));
  async function drawMine() {
    let rows = S.radio || []; try { rows = S.radio = await api('/radio'); } catch { /* keep */ }
    const can = canControl(S), playing = S.now?.item?.kind === 'radio' ? S.now.item.refId : null;
    root.querySelector('.radcol .cnt').textContent = String(rows.length);
    const url = h('input', { type: 'url', placeholder: 'https://… stream address', class: 'grow', 'aria-label': 'Stream address' }), name = h('input', { type: 'text', placeholder: 'Station name', maxlength: 80, 'aria-label': 'Station name' });
    mine.replaceChildren(...rows.map(r => h('div', { class: 'card row radrow' + (playing === r.id ? ' playing' : ''), 'data-station': String(r.id) },
      h('button', { class: 'iconbtn', 'aria-label': 'Favorite', onclick: () => act(`/radio/${r.id}`, { favorite: !r.favorite }, 'PUT').then(drawMine) }, r.favorite ? '★' : '☆'),
      h('div', { class: 'grow', style: 'min-width:0' }, h('b', { class: 'ell', style: 'display:block' }, r.name), h('div', { class: 'dim small ell' }, r.genre ?? r.url.replace(/^https?:\/\//, '').slice(0, 40))),
      playing === r.id ? h('span', { class: 'tag on' }, 'PLAYING') : null,
      can ? [h('button', { class: 'btn primary', 'aria-label': 'Play ' + r.name, onclick: () => act('/stream/play', { kind: 'radio', id: r.id }) }, '▶'), h('button', { class: 'btn danger', 'aria-label': 'Delete ' + r.name, onclick: () => act(`/radio/${r.id}`, undefined, 'DELETE').then(drawMine) }, '✕')] : null)),
      rows.length ? '' : h('p', { class: 'dim' }, 'No stations yet. Find one on the right, or add a stream address below.'),
      can ? h('div', { class: 'card' }, h('div', { class: 'sec' }, 'Add a station'), h('div', { class: 'field' }, name), h('div', { class: 'row' }, url, h('button', { class: 'btn', onclick: async () => { try { await api('/radio', { method: 'POST', body: { name: name.value, url: url.value } }); drawMine(); } catch (e) { toast(e.message, true); } } }, 'Add'))) : '');
  }
  return { el: root, reload: () => { drawMine(); finder.reload(); } };
}
