// WavWiz 0.3.5 J9: the Library Radio tab - My stations next to the finder (search, Save, favorites, podcasts with episodes folding out).
// F235: stations use the same tiles/list language as Artists / Albums (not bare radrow cards only).
// RADIO-1 (Nov 9 2026): one column - My stations first (Library tiles/list), then quiet "+ Add station" / "+ Add podcast"
// toggles (forms stay collapsed until asked), then the full-width finder (search + genre + country) below.
// RADIO-2: Find stations follows the same tiles/list toggle; right-click / long-press menu (no star/X buttons); drag to queue.
import { h, api, toast } from './util.js';
import { canControl } from './ui.js';
import { radioFinderView } from './radiofinder.js';
import { radioGridOn, savedStationTile, savedStationRow } from './radiostation.js';

export function radioTab(S, act) {
  const mine = h('div', { class: 'radmine' }), finder = radioFinderView(S, act, { onSaved: () => drawMine() });
  const adds = h('div', { class: 'radadd' });
  const root = h('div', { class: 'radiotab2' },
    h('section', { class: 'radcol radsaved', 'aria-label': 'My stations' }, h('div', { class: 'sec' }, 'My stations ', h('span', { class: 'cnt' })), mine, adds),
    h('section', { class: 'radcol radfind' }, finder.el));

  let openKey = null; let filter = '';   // 0.6.9 #4: the Library search box filters My stations by name / genre
  function drawAdds() {
    if (!canControl(S)) { adds.replaceChildren(); return; }
    const forms = {
      station: () => {
        const name = h('input', { type: 'text', placeholder: 'Station name', maxlength: 80, 'aria-label': 'Station name' });
        const url = h('input', { type: 'url', placeholder: 'https://… stream address', class: 'grow', 'aria-label': 'Stream address' });
        const go = async () => { try { await api('/radio', { method: 'POST', body: { name: name.value, url: url.value } }); openKey = null; drawMine(); } catch (e) { toast(e.message, true); } };
        url.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });
        return h('div', { class: 'card radform', id: 'radform-station' }, h('div', { class: 'sec' }, 'Add a station'),
          h('div', { class: 'field' }, name), h('div', { class: 'row wrap' }, url, h('button', { class: 'btn primary', onclick: go }, 'Add')));
      },
      podcast: () => {
        const url = h('input', { type: 'url', placeholder: 'Podcast RSS URL', class: 'grow', 'aria-label': 'Podcast RSS URL' });
        const go = async () => { try { await api('/podcasts', { method: 'POST', body: { url: url.value } }); openKey = null; drawAdds(); finder.reloadPods(); } catch (e) { toast(e.message, true); } };
        url.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });
        return h('div', { class: 'card radform', id: 'radform-podcast' }, h('div', { class: 'sec' }, 'Add a podcast'),
          h('div', { class: 'row wrap' }, url, h('button', { class: 'btn primary', onclick: go }, 'Add feed')));
      },
    };
    const toggle = (k, label) => h('button', { type: 'button', class: 'btn sm quiet', 'data-radadd': k, 'aria-expanded': String(openKey === k), 'aria-controls': 'radform-' + k,
      onclick: () => { openKey = openKey === k ? null : k; drawAdds(); adds.querySelector('.radform input')?.focus({ preventScroll: true }); } }, (openKey === k ? '− ' : '+ ') + label);
    adds.replaceChildren(h('div', { class: 'radadd-btns' }, toggle('station', 'Add station'), toggle('podcast', 'Add podcast')), openKey ? forms[openKey]() : '');
  }

  async function drawMine() {
    let rows = S.radio || []; try { rows = S.radio = await api('/radio'); } catch { /* keep */ }
    const all = rows.length, q = filter.toLowerCase();
    if (q) rows = rows.filter(r => `${r.name || ''} ${r.genre || ''} ${r.tags || ''}`.toLowerCase().includes(q));
    const playing = S.now?.item?.kind === 'radio' ? S.now.item.refId : null;
    root.querySelector('.radcol .cnt').textContent = q ? `${rows.length} of ${all}` : String(rows.length);
    const grid = radioGridOn();
    const opts = { S, act, onChange: drawMine };
    const list = rows.length
      ? h('ul', { class: grid ? 'tilegrid tg-radio' : 'list' }, rows.map(r => grid ? savedStationTile(r, playing, opts) : savedStationRow(r, playing, opts)))
      : h('p', { class: 'dim radnone' }, q && all ? `No saved station matches “${filter}”.` : 'No saved stations yet. Find one below, or add a stream address.');
    mine.replaceChildren(list);
    drawAdds();
    finder.setSavedUrls?.(new Set(rows.map(r => r.url).filter(Boolean)));
  }
  return { el: root, reload: () => { drawMine(); finder.reload(); }, setFilter: q => { filter = String(q || '').trim(); } };
}
