// Smart playlists: name + up to 5 rules (all must match), live song count, saved on the server. Play / Add to queue / Keep playing use the same rules.
import { h, api, toast, dialog, ask } from './util.js';

/** Pure: form values -> the rules the server expects (blank fields are left out). */
export function rulesFrom(v) {
  const n = x => { const t = String(x ?? '').trim(); return t === '' || !isFinite(Number(t)) ? null : Math.round(Number(t)); };
  const s = x => { const t = String(x ?? '').trim(); return t || null; };
  return { genre: s(v.genre), genreMatch: v.genreMatch === 'equals' ? 'equals' : 'contains', yearMin: n(v.yearMin), yearMax: n(v.yearMax), addedDays: n(v.addedDays), notPlayedDays: n(v.notPlayedDays), artist: s(v.artist) };
}
/** Pure: how many rules are in use (the year range counts once). */
export const ruleCount = r => [r.genre, r.yearMin ?? r.yearMax, r.addedDays, r.notPlayedDays, r.artist].filter(x => x != null).length;
/** Pure: a short plain summary, e.g. "Genre has rock • 1990-1999". */
export function ruleSummary(r = {}) {
  const p = [];
  if (r.genre) p.push(`Genre ${r.genreMatch === 'equals' ? 'is' : 'has'} ${r.genre}`);
  if (r.yearMin != null || r.yearMax != null) p.push(r.yearMin != null && r.yearMax != null ? `${r.yearMin}-${r.yearMax}` : r.yearMin != null ? `${r.yearMin} or later` : `up to ${r.yearMax}`);
  if (r.addedDays != null) p.push(`Added in the last ${r.addedDays} days`);
  if (r.notPlayedDays != null) p.push(`Not played in ${r.notPlayedDays} days`);
  if (r.artist) p.push(`Artist has ${r.artist}`);
  return p.join(' • ');
}

/** Opens the editor (sp = an existing smart playlist, or null for a new one). onSaved() after a save. */
export function openSmartEditor(sp, onSaved) {
  const r = sp?.rules || {};
  const inp = (k, attrs = {}) => h('input', { type: 'text', 'data-rule': k, value: r[k] ?? '', ...attrs, oninput: () => later() });
  const name = h('input', { type: 'text', maxlength: 80, value: sp?.name || '', placeholder: 'Name', 'aria-label': 'Smart playlist name' });
  const gm = h('select', { 'data-rule': 'genreMatch', 'aria-label': 'Genre match', onchange: () => later() }, h('option', { value: 'contains' }, 'has'), h('option', { value: 'equals' }, 'is')); gm.value = r.genreMatch === 'equals' ? 'equals' : 'contains';
  const f = { genre: inp('genre', { placeholder: 'e.g. Jazz' }), yearMin: inp('yearMin', { inputmode: 'numeric', placeholder: 'from', size: 5 }), yearMax: inp('yearMax', { inputmode: 'numeric', placeholder: 'to', size: 5 }),
    addedDays: inp('addedDays', { inputmode: 'numeric', placeholder: 'days', size: 5 }), notPlayedDays: inp('notPlayedDays', { inputmode: 'numeric', placeholder: 'days', size: 5 }), artist: inp('artist', { placeholder: 'part of a name' }) };
  const count = h('div', { class: 'smart-count', role: 'status', 'aria-live': 'polite' }, '…');
  const values = () => rulesFrom({ genre: f.genre.value, genreMatch: gm.value, yearMin: f.yearMin.value, yearMax: f.yearMax.value, addedDays: f.addedDays.value, notPlayedDays: f.notPlayedDays.value, artist: f.artist.value });
  let t = 0; const later = () => { clearTimeout(t); t = setTimeout(preview, 250); };
  async function preview() {
    const rules = values(); if (!ruleCount(rules)) { count.replaceChildren('Add at least one rule.'); return; }
    try { const p = await api('/smart/preview', { method: 'POST', body: { rules } });
      count.replaceChildren(h('b', null, `${p.count} song${p.count === 1 ? '' : 's'} match`), ' ', h('span', { class: 'qsrcpill', title: 'Smart playlists use your local library' }, 'Local only'),
        p.notPlayedSkipped ? h('div', { class: 'dim small' }, '"Not played" starts working once WavWiz has a play history.') : null,
        p.sample?.length ? h('div', { class: 'dim small ell' }, 'e.g. ' + p.sample.join(', ')) : null);
    } catch (e) { count.replaceChildren(h('span', { class: 'err' }, e.message)); }
  }
  const row = (label, ...kids) => h('label', { class: 'row smart-rule' }, h('span', { class: 'smart-lbl' }, label), ...kids);
  const body = h('div', { class: 'smart-edit' }, name, h('p', { class: 'dim small' }, 'Songs must match every rule you fill in (up to 5).'),
    row('Genre', gm, f.genre), row('Year', f.yearMin, '–', f.yearMax), row('Added in the last', f.addedDays, 'days'), row('Not played in', f.notPlayedDays, 'days'), row('Artist has', f.artist), count);
  dialog(sp ? 'Edit smart playlist' : 'New smart playlist', body, [
    { text: 'Save', cls: 'primary', onclick: async () => { try { await api(sp ? `/smart/${sp.id}` : '/smart', { method: sp ? 'PUT' : 'POST', body: { name: name.value, rules: values() } }); toast('Smart playlist saved'); window.dispatchEvent(new CustomEvent('wavwiz:playlists')); onSaved?.(); return true; } catch (e) { toast(e.message, true); return false; } } },
    { text: 'Cancel' }]);
  preview(); setTimeout(() => name.focus(), 0);
}

/** The Smart playlists card list for the Playlists page. */
export async function smartSection(can, onChange) {
  let list = []; try { list = await api('/smart') || []; } catch { return null; }
  const act = async (fn, ok) => { try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message, true); } };
  return h('div', { class: 'smart-sec' }, h('h3', null, 'Smart playlists'),
    can ? h('button', { class: 'btn', 'data-act': 'newsmart', onclick: () => openSmartEditor(null, onChange) }, 'New smart playlist…') : null,
    list.length ? list.map(sp => h('div', { class: 'card item', style: 'cursor:default' },
      h('div', { class: 't' }, h('div', { class: 't1 ell' }, h('span', { class: 'qsrcpill smart', title: 'Smart playlist (rules)' }, 'Smart'), sp.name), h('div', { class: 't2 ell' }, `${sp.count} song${sp.count === 1 ? '' : 's'} • ${ruleSummary(sp.rules)}`)),
      can ? [h('button', { class: 'btn primary', 'aria-label': 'Play ' + sp.name, onclick: () => act(() => api('/stream/play', { method: 'POST', body: { kind: 'smart', id: sp.id } })) }, '▶'),
        h('button', { class: 'btn', 'aria-label': 'Add ' + sp.name + ' to the queue', onclick: () => act(() => api('/queue/add', { method: 'POST', body: { kind: 'smart', id: sp.id } }), 'Added to the queue') }, '＋'),
        h('button', { class: 'btn', onclick: () => openSmartEditor(sp, onChange) }, 'Edit'),
        h('button', { class: 'btn danger', 'aria-label': 'Delete ' + sp.name, onclick: async () => { if (await ask(`Delete “${sp.name}”?`, 'The songs stay in your library.', { ok: 'Delete', danger: true })) act(async () => { await api('/smart/' + sp.id, { method: 'DELETE' }); onChange?.(); }); } }, '✕')] : null))
      : h('p', { class: 'dim small' }, 'No smart playlists yet. They fill themselves from rules like genre, year or recently added.'));
}
