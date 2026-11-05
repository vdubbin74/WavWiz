// Recently played (local, always on) + Last.fm (opt-in; keys and session stay on the server).
import { h, api, toast } from './util.js';

export const PRIVACY = 'Only if you turn Last.fm on; credentials stay on your server.';

/** Pure: "3 min ago" style label. */
export function ago(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Pure: the label for one history row. */
export const playLine = r => [r.title || 'Unknown', r.artist].filter(Boolean).join(' — ');

export function historyCard(S) {
  const list = h('div', { class: 'histlist' });
  const sel = h('select', { 'aria-label': 'Filter by zone', onchange: () => load() },
    h('option', { value: '' }, 'All zones'), ...(S.zones || []).map(z => h('option', { value: z.id }, z.name)));
  async function load() {
    list.replaceChildren(h('p', { class: 'dim small' }, 'Loading…'));
    try {
      const rows = await api('/history?limit=100' + (sel.value ? '&zoneId=' + encodeURIComponent(sel.value) : ''));
      list.replaceChildren(...(rows.length ? rows.map(r => h('div', { class: 'histrow' },
        h('span', { class: 'grow' }, playLine(r)), h('span', { class: 'dim small' }, r.zone || ''), r.lastfm ? h('span', { class: 'qsrcpill', title: 'Sent to Last.fm' }, 'Last.fm') : null,
        h('span', { class: 'dim small' }, ago(r.startedAt)))) : [h('p', { class: 'dim small' }, 'Nothing played yet.')]));
    } catch (e) { list.replaceChildren(h('p', { class: 'err small' }, e.message)); }
  }
  load();
  return h('div', { class: 'card', id: 'sec-history' }, h('h3', null, 'Recently played'),
    h('p', { class: 'dim small' }, 'A song counts after half of it plays (or 4 minutes). The last 500 plays are kept on this server.'),
    h('div', { class: 'row' }, sel, h('button', { class: 'btn', onclick: load }, 'Refresh')), list);
}

export function lastFmCard(admin) {
  const body = h('div');
  const card = h('div', { class: 'card', id: 'sec-lastfm' }, h('h3', null, 'Last.fm'), h('p', { class: 'dim small' }, PRIVACY), body);
  if (!admin) { body.append(h('p', { class: 'dim small' }, 'Only an administrator can set up Last.fm.')); return card; }
  const run = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); draw(); } catch (e) { toast(e.message, true); } };
  async function draw() {
    let st; try { st = await api('/lastfm'); } catch (e) { body.replaceChildren(h('p', { class: 'err small' }, e.message)); return; }
    const key = h('input', { type: 'text', placeholder: 'API key', class: 'grow', 'aria-label': 'Last.fm API key' });
    const sec = h('input', { type: 'password', placeholder: 'Shared secret', class: 'grow', 'aria-label': 'Last.fm shared secret' });
    const on = h('input', { type: 'checkbox', checked: !!st.enabled, disabled: !st.connected, onchange: () => run(() => api('/lastfm', { method: 'PUT', body: { enabled: on.checked } })) });
    body.replaceChildren(
      h('p', { class: 'small' }, st.connected ? `Connected as ${st.user || 'your account'}.` : st.hasKey ? 'Keys saved. Connect your account next.' : 'Off. Add your own Last.fm API key and secret (from last.fm/api/account/create) to start.'),
      h('div', { class: 'row' }, key, sec, h('button', { class: 'btn', onclick: () => run(() => api('/lastfm', { method: 'PUT', body: { apiKey: key.value, secret: sec.value } }), 'Saved.') }, st.hasKey ? 'Replace keys' : 'Save keys')),
      st.hasKey && !st.connected ? h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn primary', onclick: () => run(async () => { const r = await api('/lastfm/connect', { method: 'POST' }); window.open(r.url, '_blank', 'noopener'); }, 'Allow WavWiz on Last.fm, then press Finish.') }, 'Connect…'),
        st.pending ? h('button', { class: 'btn', onclick: () => run(() => api('/lastfm/finish', { method: 'POST' }), 'Last.fm connected.') }, 'Finish') : null) : null,
      st.connected ? h('div', { class: 'row', style: 'margin-top:8px' }, h('label', { class: 'row' }, on, 'Send my plays to Last.fm'),
        h('button', { class: 'btn danger', onclick: () => run(() => api('/lastfm/disconnect', { method: 'POST' }), 'Disconnected.') }, 'Disconnect')) : null);
  }
  draw();
  return card;
}
