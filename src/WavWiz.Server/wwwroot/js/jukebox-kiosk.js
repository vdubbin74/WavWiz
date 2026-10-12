// WavWiz 0.3.0 §1 Jukebox (beta): Playback > Start Jukebox…, the host "Jukebox on" chip and the locked big screen (kiosk).
import { h, api, toast, dialog, ask, fmtTime } from './util.js';
import { isAdmin, canControl } from './ui.js';
import { loadTheme } from './theme.js';
import { blockedKey, isExitChord, guestApi, selCode, plural } from './jukebox-core.js';
import { renderResults } from './jukebox-view.js';
import { Viz } from './viz.js';

let kiosk = null;
export const kioskOpen = () => !!kiosk;

/** Playback > Start Jukebox… (admin only). A host PIN is required so the big screen can be left. */
export async function startJukebox(S) {
  if (!isAdmin(S)) return;
  let cfg; try { cfg = await api('/jukebox/config'); } catch (e) { toast(e.message, true); return; }
  const pin = h('input', { type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: cfg.hasPin ? 'Keep the current PIN' : '4–8 digits', 'aria-label': 'Host PIN' });
  const full = h('input', { type: 'checkbox', checked: true });
  const body = h('div', null,
    h('p', null, 'Guests scan a QR code to add songs. The screen locks; only the host PIN gets out.'),
    h('p', { class: 'small' }, `${plural(cfg.perGuest, 'song')} per guest · vote to skip ${cfg.voteSkip ? 'on' : 'off'} · ${cfg.style === 'retro' ? 'Retro CD' : 'Modern'} style. Change these in Settings > Jukebox.`),
    h('label', { class: 'fld' }, h('span', null, 'Host PIN'), pin),
    h('label', { class: 'row' }, full, h('span', null, 'Open the locked big screen on this PC')));
  const d = dialog('Start Jukebox', body, [
    ['Cancel', () => d.close()],
    ['Start Jukebox', async () => {
      const p = pin.value.trim();
      if (!cfg.hasPin && !/^\d{4,8}$/.test(p)) { toast('Pick a host PIN (4–8 digits) first.', true); pin.focus(); return; }
      try {
        if (p) { if (!/^\d{4,8}$/.test(p)) { toast('The PIN is 4–8 digits.', true); return; } await api('/jukebox/config', { method: 'PUT', body: { pin: p } }); }
        const t = loadTheme(); await api('/jukebox/start', { method: 'POST', body: { theme: { accent: t.accent, accent2: t.accent2, hl: t.hl, bg: t.bg, ink: t.ink } } });
        d.close(); if (full.checked) openKiosk(S);
      } catch (e) { toast(e.message, true); }
    }, 'primary'],
  ]);
}

/** Host top bar chip: "Jukebox on" + quick controls + Stop. */
export function jukeboxChip(S, st) {
  let c = document.getElementById('jbchip');
  if (!st?.running) { c?.remove(); if (kiosk) closeKiosk(); return; }
  if (!c) { c = h('button', { id: 'jbchip', class: 'chip jbchip', type: 'button', onclick: () => hostControls(S) }); (document.querySelector('.topbar .grow') || document.body).after(c); }
  c.textContent = st.locked ? '♫ Jukebox on · locked' : '♫ Jukebox on';
}
async function hostControls(S) {
  let b; try { b = await api('/jukebox/board'); } catch (e) { toast(e.message, true); return; }
  const ctl = canControl(S);
  const rows = b.next.map(x => h('div', { class: 'row jbhost' }, h('span', { class: 'grow' }, x.title, x.by ? h('small', { class: 'jb-by' }, ' · ' + x.by) : null),
    h('button', { class: 'btn', disabled: !ctl, onclick: async () => { await api('/queue/move', { method: 'POST', body: { from: x.index, to: b.next[0].index } }).catch(e => toast(e.message, true)); d.close(); hostControls(S); } }, 'Pin next'),
    h('button', { class: 'btn', disabled: !ctl, onclick: async () => { await api(`/queue/${x.index}`, { method: 'DELETE' }).catch(e => toast(e.message, true)); d.close(); hostControls(S); } }, 'Remove'),
    x.guest ? h('button', { class: 'btn danger', disabled: !ctl, onclick: async () => { if (await ask('Ban this guest', `Stop requests from ${x.by || 'this guest'}?`, { ok: 'Ban', danger: true })) { await api('/jukebox/ban', { method: 'POST', body: { guest: x.guest } }).catch(e => toast(e.message, true)); toast('Banned.'); } } }, 'Ban') : null));
  const d = dialog('Jukebox', h('div', null,
    h('div', { class: 'row' },
      h('button', { class: 'btn', disabled: !ctl, onclick: async () => { await api('/jukebox/lock', { method: 'POST', body: { locked: !b.locked } }); d.close(); } }, b.locked ? 'Unlock queue' : 'Lock queue'),
      h('button', { class: 'btn', onclick: () => { d.close(); openKiosk(S); } }, 'Open big screen')),
    h('h3', null, 'Up next'), rows.length ? rows : h('p', { class: 'small' }, 'Nothing queued yet.')), [
    ['Stop Jukebox', async () => { if (!(await ask('Stop Jukebox', 'Guests can no longer add songs. The music keeps playing.', { ok: 'Stop', danger: true }))) return; try { await stopWithPin(S); d.close(); } catch (e) { toast(e.message, true); } }, 'danger'],
    ['Close', () => d.close()],
  ]);
}
async function stopWithPin(S, pin) { await api('/jukebox/stop', { method: 'POST', body: { pin: pin || '' } }); }

/** The PIN pad. Resolves the PIN typed, or null on Cancel. */
function pinPad(host) {
  return new Promise(res => {
    let v = '';
    const dots = h('div', { class: 'jb-dots', 'aria-live': 'polite' });
    const paint = () => dots.replaceChildren(...[0, 1, 2, 3].map(i => h('i', { class: i < v.length ? 'on' : '' })));
    const done = r => { wrap.remove(); res(r); };
    const key = k => h('button', { class: 'btn', type: 'button', onclick: () => { if (v.length < 8) v += k; paint(); if (v.length >= 4) ok.disabled = false; } }, k);
    const ok = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => done(v) }, 'OK');
    const pad = h('div', { class: 'jb-pin', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Enter host PIN to exit Jukebox' }, h('b', null, 'Enter host PIN to exit Jukebox'), dots,
      h('div', { class: 'jb-keys' }, ...'123456789'.split('').map(key), h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, 'Cancel'), key('0'), h('button', { class: 'btn', type: 'button', 'aria-label': 'Delete', onclick: () => { v = v.slice(0, -1); paint(); ok.disabled = v.length < 4; } }, '⌫')),
      h('div', { class: 'row', style: 'justify-content:center;margin-top:10px' }, ok));
    pad._key = e => { if (/^\d$/.test(e.key)) { if (v.length < 8) v += e.key; paint(); ok.disabled = v.length < 4; } else if (e.key === 'Backspace') { v = v.slice(0, -1); paint(); ok.disabled = v.length < 4; } else if (e.key === 'Enter' && v.length >= 4) done(v); };
    const wrap = h('div', { class: 'jb-dlg' }, pad); paint(); host.append(wrap); wrap._pad = pad;
  });
}

export function openKiosk(S) {
  if (kiosk) return;
  const root = h('div', { class: 'jb', role: 'application', 'aria-label': 'WavWiz Jukebox' });
  const bg = h('div', { class: 'jb-bg', 'aria-hidden': 'true' });
  let code = null, board = null, viz = null, iv = 0, pinOpen = false;
  const block = e => {
    const pad = root.querySelector('.jb-dlg')?._pad;
    if (isExitChord(e)) { e.preventDefault(); askExit(); return; }
    if (pad) { pad._key(e); if (e.key === 'Escape') e.preventDefault(); return; }
    if (blockedKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  const noMenu = e => e.preventDefault();
  async function askExit() {
    if (pinOpen) return; pinOpen = true;
    const pin = await pinPad(root); pinOpen = false; if (pin == null) return;
    try { await api('/jukebox/unlock', { method: 'POST', body: { pin } }); closeKiosk(); }
    catch { toast('That PIN isn’t right.', true); }
  }
  const logo = h('button', { class: 'jb-logo', type: 'button', 'aria-label': 'Host: hold to exit' }, h('b', null, 'WavWiz'), h('br'), 'Hold for host');
  let lp = 0; logo.addEventListener('pointerdown', () => { lp = setTimeout(askExit, 1200); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => logo.addEventListener(t, () => clearTimeout(lp)));
  async function openSearch() {
    if (!code) return;
    const call = guestApi(code);
    const inp = h('input', { class: 'jb-in', type: 'search', placeholder: 'Search songs, artists, albums', 'aria-label': 'Search' });
    const out = h('div');
    const songRow = s => { const b = h('button', { class: 'btn primary jb-add', onclick: async () => { b.disabled = true; try { await call('/add', { guest: 'kiosk-screen', name: 'Big screen', trackId: s.id }); b.textContent = '✓ In'; b.classList.add('in'); } catch (e) { b.disabled = false; toast(e.message, true); } } }, 'Add'); return h('div', { class: 'jb-row' }, h('div', { class: 'jb-t' }, h('b', null, s.title), h('small', null, s.artist)), b); };
    const list = (title, songs) => out.replaceChildren(h('button', { class: 'btn', onclick: run }, '‹ Back'), h('h2', { class: 'jb-gh' }, title), ...songs.map(songRow));
    async function run() { const q = inp.value.trim(); if (!q) { out.replaceChildren(); return; } try { const r = await call('/search?q=' + encodeURIComponent(q)); out.replaceChildren(renderResults(r, { songRow, onArtist: async a => list(a.name, await call('/artist?name=' + encodeURIComponent(a.name))), onAlbum: async a => list(a.album, await call(`/album?artist=${encodeURIComponent(a.artist)}&album=${encodeURIComponent(a.album)}`)) })); } catch (e) { toast(e.message, true); } }
    inp.addEventListener('input', () => { clearTimeout(inp._t); inp._t = setTimeout(run, 250); });
    const wrap = h('div', { class: 'jb-dlg', onclick: e => { if (e.target === wrap) wrap.remove(); } }, h('div', { class: 'jb-search-pane', role: 'dialog', 'aria-label': 'Search & add' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, 'Search & add'), h('button', { class: 'btn', onclick: () => wrap.remove() }, 'Close')), inp, out));
    root.append(wrap); inp.focus();
  }
  const cover = h('img', { class: 'jb-cover', alt: '' });
  const left = h('div', { class: 'jb-left' }), right = h('div', { class: 'jb-right' }), chips = h('div', { class: 'jb-chips' });
  const tubes = h('div', { class: 'jb-tubes', 'aria-hidden': 'true' }, ...Array.from({ length: 8 }, () => h('i')));
  function draw() {
    const b = board; if (!b) return;
    root.classList.toggle('retro', b.style === 'retro'); root.classList.toggle('paused', b.now?.state !== 'playing');
    root.style.setProperty('--beat', String((b.beat ?? 50) / 100));
    if (b.now?.trackId) cover.src = `/api/v1/art/track/${b.now.trackId}?size=512`; else cover.removeAttribute('src');
    const pos = b.now ? b.now.positionMs : 0, dur = b.now?.durationMs || 0;
    chips.replaceChildren(h('span', { class: 'jb-chip' }, `${plural(b.perGuest, 'song')} per guest`), h('span', { class: 'jb-chip' }, `Vote to skip: ${b.voteSkip ? 'on' : 'off'}`), b.locked ? h('span', { class: 'jb-chip' }, 'Requests paused') : null);
    left.replaceChildren(h('div', { class: 'jb-disc' }, cover), h('span', { class: 'jb-kick' }, 'NOW PLAYING'),
      h('h1', { class: 'jb-title' }, b.now?.title || 'Add the first song'), h('div', { class: 'jb-artist' }, b.now?.artist || ''),
      h('div', { class: 'jb-prog' }, h('i', { style: `width:${dur ? Math.min(100, pos / dur * 100) : 0}%` })),
      h('div', { class: 'row' }, h('small', { class: 'jb-dim' }, fmtTime(pos)), h('span', { class: 'grow' }), h('span', { class: 'jb-led' }, b.next.length ? selCode(0) : '--'), h('small', { class: 'jb-dim' }, fmtTime(dur))),
      b.now?.by ? h('div', { class: 'jb-by' }, `Requested by ${b.now.by}`) : null,
      h('button', { class: 'btn primary jb-big', type: 'button', onclick: openSearch }, '⌕ Search & add'));
    right.replaceChildren(
      h('div', { class: 'jb-next' }, h('h2', null, h('span', null, 'UP NEXT'), h('span', null, plural(b.next.length, 'song'))),
        ...(b.next.length ? b.next.slice(0, 6).map((x, i) => h('div', { class: 'jb-nrow' }, h('span', { class: 'n' }, b.style === 'retro' ? selCode(i) : String(i + 1)), h('div', { class: 'jb-t' }, h('b', null, x.title), h('small', null, x.artist, x.by ? h('span', { class: 'by' }, ' · ' + x.by) : null))))
          : [h('p', { class: 'jb-dim' }, 'Nothing queued yet. Scan the code to add a song.')])),
      h('div', { class: 'jb-join' }, h('div', null, h('b', null, 'Scan to add a song'), h('br'), h('code', { class: 'jb-url' }, ''), h('br'), h('small', { class: 'jb-dim' }, 'No app, no login')), h('img', { class: 'jb-qr', src: '/api/v1/jukebox/qr.svg?t=' + encodeURIComponent(code || ''), alt: 'QR code to join the Jukebox' })));
    api('/jukebox/join').then(j => { const u = right.querySelector('.jb-url'); if (u) u.textContent = j.url.replace(/^https?:\/\//, '').replace(/\?.*$/, ''); }).catch(() => {});
  }
  let beat = 0; const pulse = () => { beat = (beat + 1) % 2; tubes.querySelectorAll('i').forEach((t, i) => t.style.setProperty('--pulse', String((i + beat) % 2))); };
  async function refresh() { try { const [st, b] = await Promise.all([api('/jukebox'), api('/jukebox/board')]); if (!st.running) { closeKiosk(); return; } code = st.code; board = b; draw(); } catch { /* keep the last picture */ } }
  root.append(bg, tubes, logo, chips, left, right);
  document.body.append(root); document.body.classList.add('jb-kiosk');
  document.addEventListener('keydown', block, true); document.addEventListener('contextmenu', noMenu, true);
  try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {}); } catch { /* not allowed */ }
  try { navigator.keyboard?.lock?.(['Escape', 'Tab', 'AltLeft', 'MetaLeft', 'F11'])?.catch?.(() => {}); } catch { /* not supported */ }
  try { viz = new Viz(bg, { preview: false }); requestAnimationFrame(() => viz?.start?.()); } catch { viz = null; }
  window.dispatchEvent(new CustomEvent('wavwiz:kiosk', { detail: true }));
  refresh(); iv = setInterval(() => { refresh(); if (board?.style === 'retro' && board?.now?.state === 'playing') pulse(); }, 1000);
  kiosk = { root, close: () => { clearInterval(iv); viz?.destroy?.(); document.removeEventListener('keydown', block, true); document.removeEventListener('contextmenu', noMenu, true); root.remove(); document.body.classList.remove('jb-kiosk'); try { navigator.keyboard?.unlock?.(); } catch { /* ignore */ } if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); window.dispatchEvent(new CustomEvent('wavwiz:kiosk', { detail: false })); } };
}
export function closeKiosk() { const k = kiosk; kiosk = null; k?.close(); }
