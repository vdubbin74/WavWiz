import { h, api, toast, dialog } from './util.js';
import { canControl } from './ui.js';

export function radioFinderView(S, act) {
  const root = h('div');
  const q = h('input', { type: 'search', placeholder: 'Station name', class: 'grow' });
  const tag = h('input', { type: 'text', placeholder: 'Genre / tag', style: 'width:140px' });
  const country = h('input', { type: 'text', placeholder: 'Country code (US)', maxlength: 2, style: 'width:110px' });
  const results = h('div'); const favs = h('div'); const pods = h('div');

  async function search() {
    results.replaceChildren(h('p', { class: 'dim' }, 'Searching…'));
    try {
      const rows = await api(`/radio/finder/search?name=${encodeURIComponent(q.value)}&tag=${encodeURIComponent(tag.value)}&country=${encodeURIComponent(country.value)}`);
      paintStations(results, rows);
    } catch (e) { results.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }

  function paintStations(el, rows) {
    const can = canControl(S);
    if (!rows?.length) { el.replaceChildren(h('p', { class: 'dim' }, 'No stations found.')); return; }
    el.replaceChildren(...rows.map(r => h('div', { class: 'card row wrap' },
      h('div', { class: 'grow', style: 'min-width:0' },
        h('b', { class: 'ell', style: 'display:block' }, r.name || 'Station'),
        h('div', { class: 'dim small ell' }, [r.country, r.tags, r.codec, r.bitrate ? r.bitrate + ' kbps' : ''].filter(Boolean).join(' • '))),
      can ? h('button', { class: 'btn primary', onclick: () => play(r) }, '▶') : null,
      can ? h('button', { class: 'btn', onclick: () => save(r) }, 'Save') : null,
      can ? h('button', { class: 'btn', onclick: () => fav(r) }, '★') : null)));
  }

  async function play(r) {
    try {
      const { id } = await api('/radio/finder/save', { method: 'POST', body: r });
      await act('/stream/play', { kind: 'radio', id });
      toast('Playing ' + (r.name || ''));
    } catch (e) { toast(e.message, true); }
  }
  async function save(r) {
    try { await api('/radio/finder/save', { method: 'POST', body: r }); toast('Saved to your stations'); }
    catch (e) { toast(e.message, true); }
  }
  async function fav(r) {
    try { await api('/radio/finder/favorites', { method: 'POST', body: r }); toast('Favorited'); loadFavs(); }
    catch (e) { toast(e.message, true); }
  }

  async function loadFavs() {
    try {
      const rows = await api('/radio/finder/favorites');
      const kids = [h('h3', null, 'Finder favorites')];
      if (!rows.length) kids.push(h('p', { class: 'dim small' }, 'None yet.'));
      else for (const r of rows) kids.push(h('div', { class: 'row card' },
        h('div', { class: 'grow ell' }, r.name),
        h('button', { class: 'btn primary', onclick: () => play(r) }, '▶'),
        h('button', { class: 'btn danger', onclick: async () => { await api(`/radio/finder/favorites/${encodeURIComponent(r.stationuuid)}`, { method: 'DELETE' }); loadFavs(); } }, '✕')));
      favs.replaceChildren(...kids);
    } catch (e) { favs.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }

  async function loadPods() {
    try {
      const rows = await api('/podcasts');
      const url = h('input', { type: 'url', placeholder: 'Podcast RSS URL', class: 'grow' });
      const kids = [h('h3', null, 'Podcasts (RSS)')];
      for (const p of rows) {
        kids.push(h('div', { class: 'card' }, h('div', { class: 'row' },
          h('b', { class: 'grow' }, p.title),
          h('button', { class: 'btn', onclick: () => episodes(p) }, 'Episodes'),
          h('button', { class: 'btn danger', onclick: async () => { await api(`/podcasts/${p.id}`, { method: 'DELETE' }); loadPods(); } }, '✕'))));
      }
      if (canControl(S)) {
        kids.push(h('div', { class: 'row' }, url, h('button', { class: 'btn', onclick: async () => {
          try { await api('/podcasts', { method: 'POST', body: { url: url.value } }); loadPods(); }
          catch (e) { toast(e.message, true); }
        } }, 'Add feed')));
      }
      pods.replaceChildren(...kids);
    } catch (e) { pods.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }

  async function episodes(p) {
    let eps = [];
    try { eps = await api(`/podcasts/${p.id}/episodes`); } catch (e) { return toast(e.message, true); }
    const body = eps.length
      ? h('div', { class: 'list' }, ...eps.map(e => h('div', { class: 'item', onclick: async () => {
          try {
            const { id } = await api('/radio', { method: 'POST', body: { name: e.title, url: e.url, genre: 'podcast' } });
            await act('/stream/play', { kind: 'radio', id });
            toast('Playing episode');
          } catch (err) { toast(err.message, true); }
        } }, h('div', { class: 't' }, h('div', { class: 't1 ell' }, e.title), h('div', { class: 't2 ell' }, e.pubDate || e.url)))))
      : h('p', { class: 'dim' }, 'No episodes with audio enclosures.');
    dialog(p.title, body, [{ text: 'Close' }]);
  }

  function draw() {
    root.replaceChildren(
      h('h2', { style: 'margin:0 0 8px' }, 'Radio finder'),
      h('p', { class: 'dim small' }, 'Search community radio stations (Radio Browser). Spotify, Apple Music, Pandora and iHeart custom stations are not available. Direct stream URLs and podcast RSS work.'),
      h('div', { class: 'row wrap' }, q, tag, country, h('button', { class: 'btn primary', onclick: search }, 'Search')),
      results, favs, pods);
    loadFavs(); loadPods();
  }
  draw();
  return { el: root, reload: draw };
}
