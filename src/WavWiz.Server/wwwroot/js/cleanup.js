import { h, api, toast } from './util.js';

/** Library clean-up: songs with missing tags, and artist names that are the same person spelled differently. Files are NEVER changed - merges are reversible aliases. */
export function cleanupView(S) {
  const root = h('div'); const admin = S.auth.role === 'admin', control = S.auth.role !== 'view';
  async function draw() {
    let c; try { c = await api('/library/cleanup'); } catch (e) { root.replaceChildren(h('p', { class: 'err' }, e.status === 403 ? 'Clean-up needs Control or Admin access.' : e.message)); return; }
    const m = c.missingCounts, mc = [['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['genre', 'Genre'], ['year', 'Year'], ['trackNo', 'Track no.']];
    const groups = c.duplicateArtists.map(g => {
      const pick = { v: g.suggested };
      return h('div', { class: 'card' }, h('p', { class: 'small dim' }, 'These look like the same artist spelled differently:'),
        g.variants.map(v => h('label', { class: 'row', style: 'padding:3px 0' }, h('input', { type: 'radio', name: 'g-' + g.key, checked: v.name === g.suggested, disabled: !admin, onchange: () => { pick.v = v.name; } }), h('span', { class: 'grow' }, v.name), h('span', { class: 'dim small' }, `${v.tracks} songs${v.isAlias ? ' • already merged' : ''}`))),
        h('div', { class: 'row' }, h('span', { class: 'grow small dim' }, 'Pick the spelling to keep.'),
          h('button', { class: 'btn primary', disabled: !admin, title: admin ? '' : 'Only the administrator can merge names', onclick: async () => {
            try { for (const v of g.variants) if (v.name !== pick.v && !v.isAlias) await api('/library/aliases', { method: 'POST', body: { from: v.name, to: pick.v } }); toast('Merged. Your files were not changed.'); window.dispatchEvent(new CustomEvent('wavwiz:library')); draw(); } catch (e) { toast(e.message, true); } } }, 'Merge')));
    });
    root.replaceChildren(h('h2', null, 'Library clean-up'), h('p', { class: 'dim small' }, 'WavWiz only reads your music files. Merging names is a display setting you can undo below; the tags inside your files are never edited.'),
      c.unscanned ? h('div', { class: 'card warnc' }, `${c.unscanned} songs have not been re-read since the update yet; a rescan is running or needed (Settings > Library > Rescan).`) : null,
      h('div', { class: 'card' }, h('h3', null, 'Missing tags'), c.tracksWithProblems ? h('div', { class: 'row wrap' }, mc.filter(([k]) => m[k]).map(([k, t]) => h('span', { class: 'pill warn' }, `${t}: ${m[k]}`))) : h('p', { class: 'okc' }, 'Every song has the basic tags.'), h('p', { class: 'small dim' }, `${c.tracksWithProblems} song(s) are missing at least one of title, artist, album, genre or year.`)),
      c.missingSample.length ? h('details', { class: 'card' }, h('summary', null, `Show songs with missing tags (${Math.min(c.missingSample.length, c.tracksWithProblems)} of ${c.tracksWithProblems})`),
        h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Song', 'Missing', 'File'].map(x => h('th', null, x)))), h('tbody', null, c.missingSample.map(r => h('tr', null, h('td', null, `${r.title} — ${r.artist}`), h('td', null, r.missing.join(', ')), h('td', { class: 'mono small' }, r.path)))))) : null,
      h('h3', null, `Same artist, different spelling (${c.duplicateArtists.length})`), groups.length ? groups : h('p', { class: 'okc' }, 'No look-alike artist names found.'),
      !admin && groups.length ? h('p', { class: 'small dim' }, 'Only the administrator can merge names.') : null,
      c.aliases.length ? h('div', { class: 'card' }, h('h3', null, 'Merged names'), h('table', { class: 'tbl' }, h('tbody', null, c.aliases.map(a => h('tr', null, h('td', null, a.from), h('td', null, '→ ' + a.to), h('td', null, admin ? h('button', { class: 'btn', onclick: async () => { try { await api('/library/aliases/remove', { method: 'POST', body: { from: a.from } }); window.dispatchEvent(new CustomEvent('wavwiz:library')); draw(); } catch (e) { toast(e.message, true); } } }, 'Undo') : null)))))) : null);
  }
  draw(); return { el: root, reload: draw };
}
