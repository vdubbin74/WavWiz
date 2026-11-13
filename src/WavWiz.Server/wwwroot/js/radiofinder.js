// B6 radio finder (Radio Browser). RADIO-1 (Nov 9 2026): full-width search row - name + Genre + Country pickers (the themed F152
// wsel, filled from /radio/finder/tags + /countries, which the server already proxies), a friendly empty state before the first
// search, finder favorites only when there are some, podcast list without the always-open Add form (radiotab hosts a quiet toggle).
// RADIO-2: search results follow the Radio tiles/list toggle; right-click menu; drag to queue; no star/X buttons on result rows.
import { h, api, toast } from './util.js';
import { canControl } from './ui.js';
import { wsel } from './wwselect.js';
import { radioGridOn, finderStationTile, finderStationRow, radioPlayGuard, radioPlayTip } from './radiostation.js';
import { radioBlockedNow, RADIO_JB_TIP } from './zones40.js';
import { attachCtx } from './ctxmenu.js';

/** Pure: pin USA (US) at the top of a Radio Browser country list, after 'Any country' in the picker. */
export function pinCountries(cs, pinned = ['US', 'USA']) {
  const list = Array.isArray(cs) ? cs.slice() : [];
  const want = new Set(pinned.map(x => String(x).toUpperCase()));
  const pin = [], rest = [];
  for (const c of list) {
    const code = String(c?.code || '').toUpperCase(), name = String(c?.name || '').toUpperCase();
    if (want.has(code) || name === 'UNITED STATES' || name === 'USA' || name === 'UNITED STATES OF AMERICA') pin.push(c);
    else rest.push(c);
  }
  return [...pin, ...rest];
}

export function radioFinderView(S, act, { onSaved } = {}) {
  const root = h('div');
  const q = h('input', { type: 'search', placeholder: 'Station name', class: 'grow', 'aria-label': 'Station name', onkeydown: ev => { if (ev.key === 'Enter') search(); } });
  const tag = wsel({ 'aria-label': 'Genre', class: 'radpick', onchange: () => { if (searched) search(); } }, h('option', { value: '' }, 'Any genre'));
  const country = wsel({ 'aria-label': 'Country', class: 'radpick', onchange: () => { if (searched) search(); } }, h('option', { value: '' }, 'Any country'));
  const results = h('div', { class: 'radresults', 'aria-live': 'polite' }); const favs = h('div'); const pods = h('div');
  let searched = false, listsLoaded = false, lastRows = [], savedUrls = new Set();

  function setSavedUrls(set) { savedUrls = set || new Set(); if (searched && lastRows.length) paintStations(results, lastRows); }

  async function loadLists() {
    if (listsLoaded) return; listsLoaded = true;
    try {
      const tags = await api('/radio/finder/tags?limit=80');
      tag.replaceChildren(h('option', { value: '' }, 'Any genre'), ...(tags || []).map(t => h('option', { value: t.name }, t.name)));
    } catch { listsLoaded = false; }
    try {
      const cs = await api('/radio/finder/countries');
      country.replaceChildren(h('option', { value: '' }, 'Any country'), ...pinCountries(cs).map(c => h('option', { value: c.code }, c.name || c.code)));
    } catch { listsLoaded = false; }
  }

  function emptyState() {
    return h('div', { class: 'radempty' },
      h('span', { class: 'radempty-ic', 'aria-hidden': 'true' }, '📻'),
      h('b', null, 'Find something to listen to'),
      h('span', { class: 'small' }, 'Search by name, or pick a genre or country and press Search. Leave it all blank for the most popular stations.'));
  }

  async function search() {
    searched = true;
    results.replaceChildren(h('p', { class: 'dim' }, 'Searching…'));
    try {
      const rows = await api(`/radio/finder/search?name=${encodeURIComponent(q.value)}&tag=${encodeURIComponent(tag.value)}&country=${encodeURIComponent(country.value)}`);
      lastRows = rows || [];
      paintStations(results, lastRows);
    } catch (e) { results.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }

  function paintStations(el, rows) {
    if (!rows?.length) { el.replaceChildren(h('p', { class: 'dim' }, 'No stations found.')); return; }
    const opts = { S, act, onChange: () => { onSaved?.(); loadFavs(); }, savedIds: savedUrls };
    const grid = radioGridOn();
    if (grid) {
      el.replaceChildren(h('ul', { class: 'tilegrid tg-radio radfind-grid' }, rows.map(r => finderStationTile(r, opts))));
    } else {
      el.replaceChildren(h('div', { class: 'radfind-list' }, ...rows.map(r => finderStationRow(r, opts))));
    }
  }

  async function loadFavs() {
    try {
      const rows = await api('/radio/finder/favorites');
      const kids = rows.length ? [h('div', { class: 'sec' }, 'Finder favorites')] : [];
      for (const r of rows) {
        const row = h('div', { class: 'row card' },
          h('div', { class: 'grow ell' }, r.name),
          canControl(S) ? h('button', { class: 'btn primary', title: radioPlayTip(r.name), onclick: radioPlayGuard(async () => {   // 0.6.9 #27
            try {
              const { id } = await api('/radio/finder/save', { method: 'POST', body: r });
              await act('/stream/play', { kind: 'radio', id });
              toast('Playing ' + (r.name || ''));
              onSaved?.();
            } catch (e) { toast(e.message, true); }
          }) }, '▶') : null);
        attachCtx(row, () => [
          { id: 'play', ic: 'play', label: 'Play', disabled: !canControl(S) || radioBlockedNow(), hint: radioBlockedNow() ? RADIO_JB_TIP : null, onclick: async () => {
            try { const { id } = await api('/radio/finder/save', { method: 'POST', body: r }); await act('/stream/play', { kind: 'radio', id }); onSaved?.(); }
            catch (e) { toast(e.message, true); }
          } },
          { id: 'unfav', ic: 'del', label: 'Remove from finder favorites', danger: true, disabled: !canControl(S),
            onclick: async () => { await api(`/radio/finder/favorites/${encodeURIComponent(r.stationuuid)}`, { method: 'DELETE' }); loadFavs(); } },
        ], r.name);
        kids.push(row);
      }
      favs.replaceChildren(...kids);
    } catch (e) { favs.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }

  async function loadPods() {
    try {
      const rows = await api('/podcasts');
      const kids = rows.length ? [h('div', { class: 'sec' }, 'Podcasts (RSS)')] : [];
      for (const p of rows) {
        const eps = h('div', { class: 'podeps', hidden: true });
        const btn = h('button', { class: 'btn', 'aria-expanded': 'false', onclick: () => episodes(p, eps, btn, card) }, 'Episodes');
        const card = h('div', { class: 'card podrow', 'data-pod': String(p.id) }, h('div', { class: 'row' },
          h('b', { class: 'grow' }, p.title),
          btn,
          h('button', { class: 'btn ww-close', 'aria-label': 'Remove podcast ' + p.title, onclick: async () => { await api(`/podcasts/${p.id}`, { method: 'DELETE' }); loadPods(); } }, '✕')), eps);
        kids.push(card);
      }
      pods.replaceChildren(...kids);
    } catch (e) { pods.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }

  async function episodes(p, host, btn, card) {
    if (!host.hidden) { host.hidden = true; btn.textContent = 'Episodes'; btn.setAttribute('aria-expanded', 'false'); card.classList.remove('open'); return; }
    let eps = [];
    try { eps = await api(`/podcasts/${p.id}/episodes`); } catch (e) { return toast(e.message, true); }
    host.replaceChildren(...(eps.length ? eps.map(e => h('div', { class: 'item podep', onclick: async () => {
        if (!canControl(S)) return toast('Your access is view-only.');
        if (radioBlockedNow()) return toast(RADIO_JB_TIP, true);   // 0.6.9 #27: an episode is a stream too
        try {
          const { id } = await api('/radio', { method: 'POST', body: { name: e.title, url: e.url, genre: 'podcast' } });
          await act('/stream/play', { kind: 'radio', id });
          toast('Playing episode');
          onSaved?.();
        } catch (err) { toast(err.message, true); }
      } }, h('span', { class: 'podplay', 'aria-hidden': 'true' }, '▶'), h('div', { class: 't' }, h('div', { class: 't1 ell' }, e.title)), h('span', { class: 'small dim' }, e.pubDate ? new Date(e.pubDate).toLocaleDateString() : '')))
      : [h('p', { class: 'dim' }, 'No episodes with audio enclosures.')]));
    host.hidden = false; btn.textContent = 'Hide episodes'; btn.setAttribute('aria-expanded', 'true'); card.classList.add('open');
  }

  function draw() {
    root.replaceChildren(
      h('div', { class: 'sec' }, 'Find stations'),
      h('p', { class: 'dim small' }, 'Search community radio stations (Radio Browser). Direct stream URLs and podcast RSS work too.'),
      h('div', { class: 'radsearch' }, q, tag, country, h('button', { class: 'btn primary', onclick: search }, 'Search')),
      results, favs, pods);
    if (!searched) results.replaceChildren(emptyState());
    else if (lastRows.length) paintStations(results, lastRows);
    loadLists(); loadFavs(); loadPods();
  }
  draw();
  return { el: root, reload: draw, reloadPods: loadPods, setSavedUrls };
}
