// WavWiz 0.3.0 §1 Jukebox (beta): Playback > Start Jukebox…, the host "Jukebox on" chip and the locked big screen (kiosk).
import { h, api, toast, dialog, ask } from './util.js';
import { isAdmin, canControl } from './ui.js';
import { loadTheme } from './theme.js';
import { blockedKey, isExitChord, guestApi, plural, albumName, selNo, upNextLine } from './jukebox-core.js';
import { RETRO_SVG } from './jukebox-retro.js';
import { renderResults } from './jukebox-view.js';
import { Viz } from './viz.js';

let kiosk = null;
/** m:ss like the approved renders (1:46 / 4:12). */
const mss = ms => { const t = Math.max(0, Math.floor((ms || 0) / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
export const kioskOpen = () => !!kiosk;

/** Playback > Start Jukebox… (admin only). A host PIN is required so the big screen can be left. */
export async function startJukebox(S) {
  if (!isAdmin(S)) { toast('Only an administrator can start Jukebox. Sign in as admin first.', true); return; }   // 0.3.3 G13
  let cfg; try { cfg = await api('/jukebox/config'); } catch (e) { toast(e.message, true); return; }
  const pin = h('input', { type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: cfg.hasPin ? 'Keep the current PIN' : '4–8 digits', 'aria-label': 'Host PIN' });
  const full = h('input', { type: 'checkbox', checked: true });
  const body = h('div', null,
    h('p', null, 'Guests scan a QR code to add songs. The screen locks; only the host PIN gets out.'),
    h('p', { class: 'small' }, `${plural(cfg.perGuest, 'song')} per guest · vote to skip ${cfg.voteSkip ? 'on' : 'off'} · ${cfg.style === 'retro' ? 'Retro CD' : 'Modern'} style. Change these in Settings > Jukebox.`),
    h('label', { class: 'fld' }, h('span', null, 'Host PIN'), pin),
    h('label', { class: 'row' }, full, h('span', null, 'Open the locked big screen on this PC')));
  const d = dialog('Start Jukebox', body, [
    // 0.3.3 G13: dialog() takes { text, onclick, cls, keep } - the old [label, fn, cls] arrays rendered blank, dead buttons
    { text: 'Cancel' },
    { text: 'Start Jukebox', cls: 'primary', keep: true, onclick: async () => {
      const p = pin.value.trim();
      if (!cfg.hasPin && !/^\d{4,8}$/.test(p)) { toast('Pick a host PIN (4–8 digits) first.', true); pin.focus(); return; }
      try {
        if (p) { if (!/^\d{4,8}$/.test(p)) { toast('The PIN is 4–8 digits.', true); return; } await api('/jukebox/config', { method: 'PUT', body: { pin: p } }); }
        const t = loadTheme(); await api('/jukebox/start', { method: 'POST', body: { theme: { accent: t.accent, accent2: t.accent2, hl: t.hl, bg: t.bg, ink: t.ink } } });
        d.close(); if (full.checked) openKiosk(S);
      } catch (e) { toast(e.message, true); }
    } },
  ]);
}

/** Host top bar chip: "Jukebox on" + quick controls + Stop. */
export function jukeboxChip(S, st) {
  jbRunning = !!st?.running;
  try { window.chrome?.webview?.postMessage({ cmd: 'jukebox', running: jbRunning }); } catch { /* not the Player */ }   // 0.3.5 J15: tray Start / Stop
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
    { text: 'Stop Jukebox', cls: 'danger', keep: true, onclick: async () => { if (!(await ask('Stop Jukebox', 'Guests can no longer add songs. The music keeps playing.', { ok: 'Stop', danger: true }))) return; try { await stopWithPin(S); d.close(); toast('Jukebox stopped.'); } catch (e) { toast(e.message, true); } } },
    { text: 'Close' },
  ]);
}
let jbRunning = false;
export const jukeboxRunning = () => jbRunning;
/** 0.3.5 J15: tray "Stop Jukebox..." - the usual confirm, then stop (admin; others are told to sign in). */
export async function askStopJukebox(S) {
  if (!isAdmin(S)) { toast('Only an administrator can stop Jukebox from here. Use the host PIN on the big screen, or sign in as admin.', true); return; }
  if (!(await ask('Stop Jukebox', 'Guests can no longer add songs. The music keeps playing.', { ok: 'Stop', danger: true }))) return;
  try { await stopWithPin(S); toast('Jukebox stopped.'); } catch (e) { toast(e.message, true); }
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
  let code = null, board = null, viz = null, iv = 0, pinOpen = false, picks = [], picksAt = 0, joinUrl = '';
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
  const logo = h('button', { class: 'jb-logo', type: 'button', 'aria-label': 'Host: hold to exit' }, h('b', null, h('span', { class: 'wm-wav' }, 'Wav'), h('span', { class: 'wm-wiz' }, 'Wiz')), h('br'), 'Hold for host');
  let lp = 0; logo.addEventListener('pointerdown', () => { lp = setTimeout(askExit, 1200); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => logo.addEventListener(t, () => clearTimeout(lp)));
  async function openSearch() {
    if (!code) return;
    const call = guestApi(code);
    const inp = h('input', { class: 'jb-in', type: 'search', placeholder: 'Search songs, artists, albums', 'aria-label': 'Search', autocomplete: 'off' });
    const out = h('div', { class: 'jb-sout' });
    const songRow = (s, i = 0) => { const b = h('button', { class: 'btn primary jb-add', type: 'button', onclick: async () => { b.disabled = true; try { await call('/add', { guest: 'kiosk-screen', name: 'Big screen', trackId: s.id }); b.textContent = '✓ In'; b.classList.add('in'); refresh(); } catch (e) { b.disabled = false; toast(e.message, true); } } }, 'Add');
      return h('div', { class: 'jb-row' }, board?.style === 'retro' ? h('span', { class: 'jbr-code' }, 'C' + (i + 1)) : null, h('div', { class: 'jb-t' }, h('b', null, s.title), h('small', null, s.artist)), b); };
    const list = (title, songs) => out.replaceChildren(h('button', { class: 'btn', type: 'button', onclick: run }, '‹ Back'), h('h2', { class: 'jb-gh' }, title), ...songs.map(songRow));
    async function run() { const q = inp.value.trim(); if (!q) { out.replaceChildren(); return; } try { const r = await call('/search?q=' + encodeURIComponent(q)); if (q !== inp.value.trim()) return; out.replaceChildren(renderResults(r, { songRow, onArtist: async a => list(a.name, await call('/artist?name=' + encodeURIComponent(a.name))), onAlbum: async a => list(albumName(a), await call(`/album?artist=${encodeURIComponent(a.artist)}&album=${encodeURIComponent(albumName(a))}`)) })); } catch (e) { toast(e.message, true); } }
    inp.addEventListener('input', () => { clearTimeout(inp._t); inp._t = setTimeout(run, 250); });
    const wrap = h('div', { class: 'jb-dlg', onclick: e => { if (e.target === wrap) wrap.remove(); } }, h('div', { class: 'jb-search-pane', role: 'dialog', 'aria-label': 'Search & add' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, 'Search & add'), h('button', { class: 'btn', type: 'button', onclick: () => wrap.remove() }, 'Close')), inp, out));
    root.append(wrap); inp.focus();
  }
  const qrSrc = () => '/api/v1/jukebox/qr.svg?t=' + encodeURIComponent(code || '');
  const thumb = id => (id ? h('img', { class: 'jb-th', src: `/api/v1/art/track/${id}?size=128`, alt: '', loading: 'lazy' }) : h('span', { class: 'jb-th' }));

  // ---- Modern (bug fixes only): cover, now playing, progress, requester, Search & add | Up next with art, QR ----
  const mod = h('div', { class: 'jbm' });
  const cover = h('img', { class: 'jb-cover', alt: '' });
  const left = h('div', { class: 'jb-left' }), right = h('div', { class: 'jb-right' }), chips = h('div', { class: 'jb-chips' });
  mod.append(left, right);
  function drawModern(b) {
    if (b.now?.trackId) { const u = `/api/v1/art/track/${b.now.trackId}?size=512`; if (cover.getAttribute('src') !== u) cover.src = u; } else cover.removeAttribute('src');
    const pos = b.now ? b.now.positionMs : 0, dur = b.now?.durationMs || 0, pct = dur ? Math.min(100, pos / dur * 100) : 0;
    left.replaceChildren(h('div', { class: 'jb-disc' }, cover), h('span', { class: 'jb-kick' }, 'NOW PLAYING'),
      h('h1', { class: 'jb-title' }, b.now?.title || 'Add the first song'), h('div', { class: 'jb-artist' }, b.now?.artist || ''),
      h('div', { class: 'jb-prog', style: `--p:${pct}%` }, h('i'), h('b')),
      h('div', { class: 'row jb-times' }, h('small', { class: 'jb-dim' }, mss(pos)), h('span', { class: 'grow' }), h('small', { class: 'jb-dim' }, mss(dur))),
      b.now?.by ? h('div', { class: 'jb-by' }, `Requested by ${b.now.by}`) : null,
      h('button', { class: 'btn primary jb-big', type: 'button', onclick: openSearch }, h('span', { class: 'jb-sico', 'aria-hidden': 'true' }), 'Search & add'));
    right.replaceChildren(
      h('div', { class: 'jb-next' }, h('h2', null, h('span', null, 'UP NEXT'), h('span', { class: 'jb-nmeta' }, upNextLine(b.next))),
        ...(b.next.length ? b.next.slice(0, 5).map((x, i) => h('div', { class: 'jb-nrow' }, h('span', { class: 'n' }, String(i + 1)), thumb(x.trackId), h('div', { class: 'jb-t' }, h('b', null, x.title), h('small', null, x.artist, x.by ? h('span', { class: 'by' }, ' · ' + x.by) : null))))
          : [h('p', { class: 'jb-dim' }, 'Nothing queued yet. Scan the code to add a song.')])),
      h('div', { class: 'jb-join' }, h('div', { class: 'jb-jtxt' }, h('b', null, 'Scan to add a song'), h('code', { class: 'jb-url' }, joinUrl), h('small', { class: 'jb-dim' }, 'No app, no login')), h('img', { class: 'jb-qr', src: qrSrc(), alt: 'QR code to join the Jukebox' })));
  }

  // ---- 0.3.4 H4 Retro CD: rebuilt to the approved render (980 x 551 design stage, scaled to the screen) ----
  const ret = h('div', { class: 'jbr' });
  ret.innerHTML = RETRO_SVG + `<div class="jbr-disc"><img alt=""><i class="jbr-sheen"></i><i class="jbr-hub"></i><i class="jbr-spindle"></i></div>
    <span class="jbr-badge l"></span><span class="jbr-badge r"></span>
    <div class="jbr-plac"><span class="jbr-kick">NOW&nbsp;&nbsp;PLAYING</span><span class="jbr-vfd"></span><div class="jbr-line"><b class="jbr-title"></b><span class="jbr-artist"></span></div><span class="jbr-by"></span></div>
    <div class="jbr-rack"><span class="jbr-h a">UP NEXT</span><span class="jbr-h b">MORE TO PICK</span><div class="jbr-col a"></div><div class="jbr-col b"></div></div>
    <div class="jbr-qr"><span>Scan to pick<br>a song</span><img alt="QR code to join the Jukebox"><small></small></div>
    <button type="button" class="jbr-select" aria-label="Search and add a song"><span>SELECT</span></button><span class="jbr-sel-l">Search &amp; add</span>`;
  ret.querySelector('.jbr-select').addEventListener('click', openSearch);
  const q = sel => ret.querySelector(sel);
  const strip = (cls, codeTxt, kids) => h('div', { class: 'jbr-strip ' + cls }, h('span', { class: 'jbr-code' }, codeTxt), h('span', { class: 'jbr-st' }, kids));
  async function loadPicks() { if (!code || Date.now() - picksAt < 45000) return; picksAt = Date.now(); try { picks = await guestApi(code)('/picks?n=5'); } catch { /* keep the old ones */ } }
  function drawRetro(b) {
    const n = b.now, img = q('.jbr-disc img');
    if (n?.trackId) { const u = `/api/v1/art/track/${n.trackId}?size=512`; if (img.getAttribute('src') !== u) img.src = u; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
    q('.jbr-badge.l').textContent = `${plural(b.perGuest, 'pick')} per guest`;
    q('.jbr-badge.r').textContent = b.locked ? 'Requests paused' : `Vote to skip: ${b.voteSkip ? 'on' : 'off'}`;
    q('.jbr-title').textContent = n?.title || 'Add the first song'; q('.jbr-artist').textContent = n?.artist || '';
    q('.jbr-vfd').textContent = n ? `SEL ${selNo(n.trackId)} ${mss(n.positionMs)}/${mss(n.durationMs || 0)}` : 'SEL --- -:--/-:--';
    q('.jbr-by').textContent = n?.by ? `Requested by ${n.by}` : '';
    q('.jbr-col.a').replaceChildren(...[0, 1, 2, 3, 4].map(i => { const x = b.next[i]; return strip(x ? '' : 'empty', 'A' + (i + 1), x ? [h('span', { class: 'jbr-tt' }, x.title), x.by ? h('span', { class: 'jbr-who' }, ' · ' + x.by) : null] : ''); }));
    const more = picks.filter(p => !b.next.some(x => x.trackId === p.id)).slice(0, 5);
    q('.jbr-col.b').replaceChildren(...[0, 1, 2, 3, 4].map(i => { const p = more[i]; return strip('dim', 'B' + (i + 1), p ? `${p.title} · ${p.artist}` : ''); }));
    const qi = q('.jbr-qr img'); if (qi.getAttribute('src') !== qrSrc()) qi.src = qrSrc(); q('.jbr-qr small').textContent = joinUrl;
  }
  function fit() { const k = Math.min(innerWidth / 980, innerHeight / 551); root.style.setProperty('--k', String(k)); }
  function draw() {
    const b = board; if (!b) return;
    const isRetro = b.style === 'retro';
    root.classList.toggle('retro', isRetro); root.classList.toggle('modern', !isRetro); root.classList.toggle('paused', b.now?.state !== 'playing');
    root.style.setProperty('--beat', String((b.beat ?? 50) / 100));
    chips.replaceChildren(h('span', { class: 'jb-chip' }, `${plural(b.perGuest, 'song')} per guest`), h('span', { class: 'jb-chip' }, `Vote to skip: ${b.voteSkip ? 'on' : 'off'}`), b.locked ? h('span', { class: 'jb-chip' }, 'Requests paused') : null);
    if (isRetro) { loadPicks().then(() => board === b && drawRetro(b)); drawRetro(b); } else drawModern(b);
  }
  async function refresh() { try { const [st, b] = await Promise.all([api('/jukebox'), api('/jukebox/board')]); if (!st.running) { closeKiosk(); return; } code = st.code; board = b; draw(); } catch { /* keep the last picture */ } }
  root.append(bg, mod, ret, logo, chips);
  document.body.append(root); document.body.classList.add('jb-kiosk');
  fit(); addEventListener('resize', fit);
  api('/jukebox/join').then(j => { joinUrl = j.url.replace(/^https?:\/\//, '').replace(/\?.*$/, ''); draw(); }).catch(() => {});
  document.addEventListener('keydown', block, true); document.addEventListener('contextmenu', noMenu, true);
  try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {}); } catch { /* not allowed */ }
  try { navigator.keyboard?.lock?.(['Escape', 'Tab', 'AltLeft', 'MetaLeft', 'F11'])?.catch?.(() => {}); } catch { /* not supported */ }
  try { viz = new Viz(bg, { preview: false }); requestAnimationFrame(() => viz?.start?.()); } catch { viz = null; }
  window.dispatchEvent(new CustomEvent('wavwiz:kiosk', { detail: true }));
  refresh(); iv = setInterval(refresh, 1000);
  kiosk = { root, refresh, close: () => { clearInterval(iv); removeEventListener('resize', fit); viz?.destroy?.(); document.removeEventListener('keydown', block, true); document.removeEventListener('contextmenu', noMenu, true); root.remove(); document.body.classList.remove('jb-kiosk'); try { navigator.keyboard?.unlock?.(); } catch { /* ignore */ } if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); window.dispatchEvent(new CustomEvent('wavwiz:kiosk', { detail: false })); } };
}
export function closeKiosk() { const k = kiosk; kiosk = null; k?.close(); }
