// WavWiz 0.3.0 §1 Jukebox (beta): Playback > Start Jukebox…, the host "Jukebox on" chip and the locked big screen (kiosk).
import { h, api, toast, dialog, ask } from './util.js';
import { isAdmin, canControl } from './ui.js';
import { loadTheme } from './theme.js';
import { blockedKey, isExitChord, guestApi, plural, albumName, selNo, upNextLine } from './jukebox-core.js';
import { RETRO_SVG } from './jukebox-retro.js';
import { renderResults } from './jukebox-view.js';
import { Viz } from './viz.js';
import { speakerPicker, initialPick } from './jbspeakers.js';   // 0.4.9 F76

let kiosk = null;
/** m:ss like the approved renders (1:46 / 4:12). */
const mss = ms => { const t = Math.max(0, Math.floor((ms || 0) / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
/** 0.4.0: the Jukebox's own queue (its own zone once speakers are picked, else the house queue) - the host's Skip / Remove must not touch the zone being controlled in the app. */
const JBQ = p => p + (p.includes('?') ? '&' : '?') + 'zoneId=' + (jbOwn ? 'jukebox' : 'default');
let jbOwn = false; api('/jukebox/zone').then(z => { jbOwn = !!z.own; }).catch(() => {});
export const kioskOpen = () => !!kiosk;

/** Playback > Start Jukebox… (admin only). A host PIN is required so the big screen can be left. */
export async function startJukebox(S) {
  if (!isAdmin(S)) { toast('Only an administrator can start Jukebox. Sign in as admin first.', true); return; }   // 0.3.3 G13
  let cfg; try { cfg = await api('/jukebox/config'); } catch (e) { toast(e.message, true); return; }
  const pin = h('input', { type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: cfg.hasPin ? 'Keep the current PIN' : '4–8 digits', 'aria-label': 'Host PIN' });
  const full = h('input', { type: 'checkbox', checked: true });
  // 0.4.9 F76: which speakers the Jukebox plays on - prefilled with the default speakers, changeable here, optionally saved as the default
  let zones = S.zones || [], jbz = S.jb; try { [zones, jbz] = await Promise.all([api('/zones'), api('/jukebox/zone')]); } catch { /* keep what we have */ }
  const spk = speakerPicker(zones, initialPick(cfg.defaultSpeakers, jbz?.deviceIds, zones), () => { warn.hidden = true; }, { label: 'Speakers for the Jukebox' });
  const saveDef = h('input', { type: 'checkbox', checked: cfg.defaultSpeakers == null, 'data-act': 'jb-savedef' });
  const warn = h('p', { class: 'err jbwarn76', role: 'alert', hidden: true }, 'Pick at least one speaker for the Jukebox to play on.');
  const body = h('div', null,
    h('p', null, 'Guests scan a QR code to add songs. The screen locks; only the host PIN gets out.'),
    h('p', { class: 'small' }, `${plural(cfg.perGuest, 'song')} per guest · vote to skip ${cfg.voteSkip ? 'on' : 'off'} · ${cfg.style === 'retro' ? 'Retro CD' : 'Modern'} style. Change these in Settings > Jukebox.`),
    h('div', { class: 'fld jbstart76' }, h('span', null, 'Speakers'), spk, h('label', { class: 'row small' }, saveDef, h('span', null, 'Save as default'))), warn,
    h('label', { class: 'fld' }, h('span', null, 'Host PIN'), pin),
    h('label', { class: 'row' }, full, h('span', null, 'Open the locked big screen on this PC')));
  const d = dialog('Start Jukebox', body, [
    // 0.3.3 G13: dialog() takes { text, onclick, cls, keep } - the old [label, fn, cls] arrays rendered blank, dead buttons
    { text: 'Cancel' },
    { text: 'Start Jukebox', cls: 'primary', keep: true, onclick: async () => {
      const p = pin.value.trim();
      if (!cfg.hasPin && !/^\d{4,8}$/.test(p)) { toast('Pick a host PIN (4–8 digits) first.', true); pin.focus(); return; }
      const ids = spk.value(); if (!ids.length) { warn.hidden = false; spk.querySelector('input')?.focus(); return; }
      try {
        if (saveDef.checked) await api('/jukebox/config', { method: 'PUT', body: { defaultSpeakers: ids } });
        if (p) { if (!/^\d{4,8}$/.test(p)) { toast('The PIN is 4–8 digits.', true); return; } await api('/jukebox/config', { method: 'PUT', body: { pin: p } }); }
        const t = loadTheme(); await api('/jukebox/start', { method: 'POST', body: { deviceIds: ids, theme: { accent: t.accent, accent2: t.accent2, hl: t.hl, bg: t.bg, ink: t.ink } } });
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
  if (!st?.running) { c?.remove(); if (kiosk) closeKiosk(); paintReturn(S); return; }
  if (!c) { c = h('button', { id: 'jbchip', class: 'chip jbchip', type: 'button', onclick: () => hostControls(S) }); (document.querySelector('.topbar .grow') || document.body).after(c); }
  c.textContent = st.locked ? '♫ Jukebox on · locked' : '♫ Jukebox on'; paintReturn(S);
}
/** 0.3.5 J9 #13: Jukebox host controls are a small panel that drops down from the "Jukebox on" chip (no window). Ban guest and Stop Jukebox keep their confirms. */
async function hostControls(S) {
  const old = document.querySelector('.jbpanel'); if (old) { old._close(); return; }
  const chip = document.getElementById('jbchip'); const ctl = canControl(S);
  const panel = h('div', { class: 'jbpanel mpanel', role: 'group', 'aria-label': 'Jukebox' });
  const out = ev => { if (!panel.contains(ev.target) && !chip?.contains(ev.target) && !ev.target.closest?.('dialog')) close(); }, esc = ev => { if (ev.key === 'Escape' && !document.querySelector('dialog[open]')) close(); };
  function close() { panel.remove(); document.removeEventListener('pointerdown', out, true); document.removeEventListener('keydown', esc, true); }
  panel._close = close;
  async function draw() {
    let b; try { b = await api('/jukebox/board'); } catch (e) { toast(e.message, true); close(); return; }
    const act = async (fn) => { try { await fn(); } catch (e) { toast(e.message, true); } draw(); };
    const rows = b.next.map(x => h('div', { class: 'row jbhost' }, h('span', { class: 'grow ell' }, x.title, x.by ? h('small', { class: 'jb-by' }, ' · ' + x.by) : null, x.filler ? h('small', { class: 'dim' }, ' · filler') : null),
      h('button', { class: 'btn sm', disabled: !ctl, onclick: () => act(() => api(JBQ('/queue/move'), { method: 'POST', body: { from: x.index, to: b.next[0].index } })) }, 'Pin next'),
      h('button', { class: 'btn sm', disabled: !ctl, onclick: () => act(() => api(JBQ(`/queue/${x.index}`), { method: 'DELETE' })) }, 'Remove'),
      x.guest ? h('button', { class: 'btn sm danger', disabled: !ctl, onclick: async () => { if (await ask('Ban this guest', `Stop requests from ${x.by || 'this guest'}?`, { ok: 'Ban', danger: true })) act(async () => { await api('/jukebox/ban', { method: 'POST', body: { guest: x.guest } }); toast('Banned.'); }); } }, 'Ban guest') : null));
    panel.replaceChildren(
      h('div', { class: 'row' }, h('b', { class: 'grow' }, 'Jukebox'), h('button', { type: 'button', class: 'btn sm ghost', 'aria-label': 'Close', onclick: close }, '✕')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm', disabled: !ctl, onclick: () => act(() => api('/jukebox/lock', { method: 'POST', body: { locked: !b.locked } })) }, b.locked ? 'Unlock queue' : 'Lock queue'),
        h('button', { class: 'btn sm', onclick: () => { close(); openKiosk(S); } }, 'Open big screen'), h('span', { class: 'grow' }),
        h('button', { class: 'btn sm danger', onclick: async () => { if (!(await ask('Stop Jukebox', 'Guests can no longer add songs. The music keeps playing.', { ok: 'Stop', danger: true }))) return; try { await stopWithPin(S); close(); toast('Jukebox stopped.'); } catch (e) { toast(e.message, true); } } }, 'Stop Jukebox')),
      h('div', { class: 'dlbl' }, 'UP NEXT'), rows.length ? h('div', { class: 'jbrows' }, rows) : h('p', { class: 'small dim' }, 'Nothing queued yet.'));
  }
  document.body.append(panel);
  const r = chip?.getBoundingClientRect?.(), z = Number(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;
  panel.style.top = ((r ? r.bottom : 50) / z + 6) + 'px'; panel.style.left = Math.max(8, Math.min((r ? r.left : 100) / z, innerWidth / z - 440)) + 'px';
  await draw();
  setTimeout(() => { document.addEventListener('pointerdown', out, true); document.addEventListener('keydown', esc, true); }, 0);
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

/** 0.4.9 F76: after the PIN - "Switch to app" (the Jukebox keeps running) or "Exit Jukebox" (stops it). Resolves 'app' | 'stop' | null (Cancel). */
function exitChoice(host) {
  return new Promise(res => {
    const done = r => { wrap.remove(); res(r); };
    const pad = h('div', { class: 'jb-pin jb-exit76', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Leave the Jukebox screen' }, h('b', null, 'Leave the Jukebox screen'),
      h('p', { class: 'small' }, 'Switch to the app and the Jukebox keeps running: guests can still add songs and the music plays on.'),
      h('div', { class: 'jb-exit76-b' },
        h('button', { class: 'btn primary', type: 'button', 'data-act': 'jb-switch', onclick: () => done('app') }, 'Switch to app'),
        h('button', { class: 'btn danger', type: 'button', 'data-act': 'jb-exit', onclick: () => done('stop') }, 'Exit Jukebox'),
        h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, 'Cancel')));
    pad._key = e => { if (e.key === 'Escape') done(null); };
    const wrap = h('div', { class: 'jb-dlg' }, pad); host.append(wrap); wrap._pad = pad; pad.querySelector('button')?.focus();
  });
}
/** 0.4.9 F76: while the Jukebox runs and its screen is closed, an accent "Return to Jukebox" button in the header (admins; no PIN - already in the app). */
let retS = null;
export function paintReturn(S = retS) {
  retS = S || retS; let b = document.getElementById('jbreturn');
  const show = jbRunning && !kiosk && retS && isAdmin(retS);
  if (!show) { b?.remove(); return; }
  if (!b) { b = h('button', { id: 'jbreturn', class: 'btn primary jbreturn76', type: 'button', title: 'Back to the Jukebox screen (it is still running)', onclick: () => openKiosk(retS) }, '♫ Return to Jukebox'); const chip = document.getElementById('jbchip'); (chip || document.querySelector('.topbar .grow') || document.body).after(b); }
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
    try { await api('/jukebox/unlock', { method: 'POST', body: { pin } }); } catch { toast('That PIN isn’t right.', true); return; }
    // 0.4.9 F76: two ways out - back to the app with the Jukebox still running (queue, guest adds, playback go on), or stop it
    const how = await exitChoice(root); if (!how) return;
    if (how === 'stop') { try { await stopWithPin(S, pin); toast('Jukebox stopped.'); } catch (e) { toast(e.message, true); return; } }
    closeKiosk(); if (how === 'app') toast('The Jukebox keeps running. Use Return to Jukebox to go back.');
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
  // 0.3.5 J14: both styles are fixed 16:9 stages scaled to the screen. The page zoom (Display size) is taken out first, so a TV or PC at any
  // size, resolution or pixel ratio gets a stage that fills it (Retro 980 x 551, Modern 1920 x 1080).
  function fit() { const f = root.clientWidth > 0 ? stageFit(root.clientWidth, root.clientHeight) : stageFit(innerWidth, innerHeight, Number(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1);   // the stage's own CSS px: right whatever the zoom support
    root.style.setProperty('--k', String(f.retro)); root.style.setProperty('--k2', String(f.modern)); root.style.setProperty('--kd', String(Math.max(1, f.modern))); }
  function draw() {
    const b = board; if (!b) return;
    const isRetro = b.style === 'retro';
    root.classList.toggle('retro', isRetro); root.classList.toggle('modern', !isRetro); root.classList.toggle('paused', b.now?.state !== 'playing');
    root.style.setProperty('--beat', String((b.beat ?? 50) / 100));
    chips.replaceChildren(h('span', { class: 'jb-chip' }, `${plural(b.perGuest, 'song')} per guest`), h('span', { class: 'jb-chip' }, `Vote to skip: ${b.voteSkip ? 'on' : 'off'}`), b.locked ? h('span', { class: 'jb-chip' }, 'Requests paused') : null);
    if (isRetro) { loadPicks().then(() => board === b && drawRetro(b)); drawRetro(b); } else drawModern(b);
  }
  async function refresh() { try { const [st, b] = await Promise.all([api('/jukebox'), api('/jukebox/board')]); if (!st.running) { closeKiosk(); return; } code = st.code; board = b; draw(); } catch { /* keep the last picture */ } }
  const stage = h('div', { class: 'jb-stage' }, mod, logo, chips);   // 0.3.5 J14
  root.append(bg, stage, ret);
  document.body.append(root); document.body.classList.add('jb-kiosk');
  fit(); addEventListener('resize', fit);
  api('/jukebox/join').then(j => { joinUrl = j.url.replace(/^https?:\/\//, '').replace(/\?.*$/, ''); draw(); }).catch(() => {});
  document.addEventListener('keydown', block, true); document.addEventListener('contextmenu', noMenu, true);
  try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {}); } catch { /* not allowed */ }
  try { navigator.keyboard?.lock?.(['Escape', 'Tab', 'AltLeft', 'MetaLeft', 'F11'])?.catch?.(() => {}); } catch { /* not supported */ }
  try { viz = new Viz(bg, { preview: false }); requestAnimationFrame(() => viz?.start?.()); } catch { viz = null; }
  window.dispatchEvent(new CustomEvent('wavwiz:kiosk', { detail: true })); retS = S;
  refresh(); iv = setInterval(refresh, 1000);
  kiosk = { root, refresh, close: () => { clearInterval(iv); removeEventListener('resize', fit); viz?.destroy?.(); document.removeEventListener('keydown', block, true); document.removeEventListener('contextmenu', noMenu, true); root.remove(); document.body.classList.remove('jb-kiosk'); try { navigator.keyboard?.unlock?.(); } catch { /* ignore */ } if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); window.dispatchEvent(new CustomEvent('wavwiz:kiosk', { detail: false })); } };
  paintReturn(S);   // F76: after kiosk is set, so the header's Return to Jukebox goes away
}
/** 0.3.5 J14: scale factors for the two stages from the window size in device px and the page zoom (pure). */
export function stageFit(w, hgt, z = 1) { const W = w / (z || 1), H = hgt / (z || 1); return { retro: Math.min(W / 980, H / 551), modern: Math.min(W / 1920, H / 1080) }; }
export function closeKiosk() { const k = kiosk; kiosk = null; k?.close(); paintReturn(); }
