import './sliderstyle.js';   // 0.3.3 G11
// WavWiz 0.3.2 F3: the mini player - replaces Remote mode. A small movable window with only the Now Playing controls: art, title / artist,
// seek, prev / play / next, mute, volume, pin (always on top, Player only), open the full app, close. Slim size (300x48) when the window is short.
// It never joins as a speaker (F2: opening or closing it never adds a second stream). In WavWiz Player it talks to its window over
// chrome.webview (drag, pin, full app, close, position); in a browser it is a popup window.
import { h, api } from './util.js';
import { applyTheme, loadTheme } from './theme.js';
import { icon, setIcon } from './icons.js';
import { itemArtUrl, setArtCv } from './art.js';
import { fmtTime } from './util.js';
import { shortcutsRow, sendToMain, writePending } from './shortcuts.js';
import { installHotkeys } from './hotkeys.js';
import { OPACITY_MIN, clampOpacity, loadOpacity, saveOpacity, fitText } from './minifit.js';

const host = window.chrome?.webview;
export const send = (cmd, extra = {}) => { try { host?.postMessage({ cmd, ...extra }); return !!host; } catch { return false; } };
/** 0.3.5 J17: solid under the pointer only when nobody is adjusting the transparency (pure). */
export const shownOpacity = (opacPct, { hover: hv = false, adjusting: adj = false } = {}) => (hv && !adj ? 100 : opacPct);

/** 0.3.6 K14 / K22: the mini player as a component. The page (mini.html, popup or Player window) mounts it full size; the main app mounts it with { embedded: true } in the right-hand column. */
export function mountMini(root, { embedded = false, run = null, home = null } = {}) {
  let now = null, level = 0, muted = false, pinned = false, dragging = false, timer = 0;
  try { pinned = localStorage.getItem('wavwiz.mini.pin') === '1'; } catch { /* ignore */ }

  const railArt = h('div', { class: 'mp-rart', 'aria-hidden': 'true' }), railBar = h('div', { class: 'mp-rbar', 'aria-hidden': 'true' }, h('i'));   // 0.3.6 K22: the small cover + short progress bar shown on the collapsed Devices bar
  const art = h('img', { class: 'mp-art', alt: '', draggable: 'false' });
  const t = h('div', { class: 'mp-t' }, '—'), a = h('div', { class: 'mp-a' }, '');
  const pos = h('span', null, '0:00'), dur = h('span', null, '0:00');
  const seek = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Position', oninput: () => { dragging = true; }, onchange: async () => { dragging = false; if (now?.durationMs) await act('/stream/seek', { ms: Math.round(seek.value / 1000 * now.durationMs) }); } });
  const txt = h('div', { class: 'mp-txt' }, t, a, h('div', { class: 'mp-seek' }, pos, seek, dur));
  const b = (cls, ic, label, fn) => { const x = h('button', { type: 'button', class: 'mp-b ' + cls, 'aria-label': label, title: label, onclick: fn }); x.append(icon(ic)); return x; };
  const prev = b('prev', 'prev', 'Previous', () => act('/stream/prev'));
  const play = b('play', 'play', 'Play or pause', () => act(now?.state === 'playing' ? '/stream/pause' : now?.state === 'paused' ? '/stream/resume' : '/stream/resume'));
  const next = b('next', 'next', 'Next', () => act('/stream/next'));
  // 0.3.3 G4a: master mute - icon only, the same round mute button as the device cards (mutes / unmutes every speaker)
  const mute = h('button', { type: 'button', class: 'mutebtn mp-mute', 'aria-label': 'Mute all speakers', title: 'Mute all speakers', onclick: () => { muted = !muted; act('/zones/mute-all', { muted }); paintMute(); } }); mute.append(icon('volume'));
  // 0.3.9 L57: the same volume bar as the Devices tab (.dvol > .vbar + .pct): wide themed track, big handle, visible percentage
  const volPct = h('span', { class: 'pct', 'aria-live': 'off' }, '0%');
  const vol = h('input', { type: 'range', min: 0, max: 100, value: 0, 'aria-label': 'Volume', title: 'Master volume', oninput: () => { paintVol(+vol.value); clearTimeout(vol._t); vol._t = setTimeout(() => act('/zones/master', { set: +vol.value }), 120); } });
  const volWrap = h('div', { class: 'vbar' }, vol);
  const paintVol = v => { volWrap.style.setProperty('--v', v + '%'); volPct.textContent = Math.round(v) + '%'; };
  paintVol(0);
  const pin = b('mp-pin', 'pin', 'Keep on top', () => { pinned = !pinned; try { localStorage.setItem('wavwiz.mini.pin', pinned ? '1' : '0'); } catch { /* ignore */ } send('pin', { on: pinned }); paintPin(); });
  const full = b('mp-full', 'expandOut', 'Open the full app', () => { if (!send('full')) { try { window.opener?.focus(); } catch { /* ignore */ } if (!window.opener) window.open('/', 'wavwiz-main'); } });
  const close = h('button', { type: 'button', class: 'mp-b mp-x', 'aria-label': 'Close', title: 'Close', onclick: () => { if (!send('close')) window.close(); } }, '✕');
  if (!host && !embedded) { pin.disabled = true; pin.title = 'Keep on top works in the WavWiz Player window'; }
  // 0.3.3 G4b: window transparency - 100 % (opaque) by default, 30 % minimum, solid while the pointer is over the window, remembered.
  // The Opacity button swaps the bottom slider between Volume and Opacity (back to Volume after 6 s without a change).
  // 0.3.5 J17: the transparency control is labeled ("Transparency 70 %"), it is also in the right-click menu (WavWiz Player: a real menu with
  // presets; browser: the same labeled slider) and in Settings > Appearance; the window keeps the chosen transparency while it is being adjusted
  // (it no longer turns solid under the pointer then, so the change is visible live), and every change is saved, 100 % too.
  let opac = loadOpacity(); let opMode = false, opT = 0, adjusting = false;
  const opVal = h('span', { class: 'mp-opv', 'aria-live': 'polite' }, opac + '%');
  const opSl = h('input', { type: 'range', class: 'mp-opsl', min: OPACITY_MIN, max: 100, value: opac, 'aria-label': 'Window transparency (opacity)', title: 'Transparency: how solid the mini player is',
    oninput: () => { adjusting = true; setOpac(+opSl.value); armOp(); }, onchange: () => { adjusting = false; armOp(); } });
  const opRow = h('label', { class: 'mp-oprow', hidden: true }, h('span', { class: 'mp-opl' }, 'Transparency'), opSl, opVal);
  const opBtn = b('mp-op', 'opacity', 'Window transparency', () => setOpMode(!opMode));
  const armOp = () => { clearTimeout(opT); opT = setTimeout(() => setOpMode(false), 6000); };
  function setOpac(v, save = true) { opac = clampOpacity(v); opSl.value = String(opac); opVal.textContent = opac + '%'; if (save) saveOpacity(opac); applyOpacity(); }
  function setOpMode(on) { opMode = on; volWrap.hidden = on; volPct.hidden = on; opRow.hidden = !on; opBtn.classList.toggle('on', on); opBtn.setAttribute('aria-pressed', String(on)); if (on) { opSl.value = String(opac); opVal.textContent = opac + '%'; armOp(); } else clearTimeout(opT); applyOpacity(); }
  let hover = false;
  function applyOpacity() { const v = shownOpacity(opac, { hover, adjusting: adjusting || opMode }); if (!send('opacity', { value: v / 100, save: opac / 100 })) root.style.opacity = String(v / 100); else root.style.opacity = ''; }
  const hoverEl = embedded ? root : document.documentElement;
  hoverEl.addEventListener('mouseenter', () => { hover = true; applyOpacity(); }); hoverEl.addEventListener('mouseleave', () => { hover = false; applyOpacity(); });
  window.addEventListener('blur', () => { if (!document.hasFocus()) { hover = false; applyOpacity(); } });
  window.addEventListener('storage', ev => { if (ev.key === 'wavwiz.mini.opacity') setOpac(loadOpacity(), false); });   // Settings > Appearance changed it
  (embedded ? root : document).addEventListener('contextmenu', ev => { ev.preventDefault(); if (!send('menu', { opacity: opac / 100, pinned })) setOpMode(true); });
  const ctl = h('div', { class: 'mp-ctl' }, h('div', { class: 'mp-tr' }, prev, play, next, mute));
  const volRow = h('div', { class: 'mp-vol dvol' }, volWrap, volPct, opRow);   // its own full-width row
  // 0.3.7 L10 / L11 / L23: the shortcuts row - Home far right, a separator, up to 3 pins leftward. The standalone window asks the main app window (it is brought to the front first).
  const toMain = target => { writePending(target); if (!send('full', { target })) { try { window.opener?.focus(); } catch { /* ignore */ } } sendToMain(target); };   // 0.3.8 L34: ONE click - bring the main window forward and carry the target with it
  const sc = shortcutsRow({ cls: 'mp-sc', run: run || (id => toMain({ run: id })), home: home || (() => toMain({ home: true })) });
  // 0.3.8 L44: the same shortcuts inside the standalone window (Alt+M closes it, Alt+H opens the main window on Home)
  if (!embedded) installHotkeys(id => {
    if (id === 'playpause') play.click(); else if (id === 'next') next.click(); else if (id === 'prev') prev.click(); else if (id === 'mute') mute.click();
    else if (id === 'mini') { if (!send('close')) window.close(); } else if (id === 'home') toMain({ home: true }); else if (['eq', 'queue', 'settings'].includes(id)) toMain({ run: id });
  });
  root.append(art, txt, ctl, h('div', { class: 'mp-side' }, ...(embedded ? [opBtn] : [pin, full, opBtn, close])), volRow, sc.el);
  const rail = h('div', { class: 'minirail', title: 'Now playing' }, railArt, railBar);
  applyOpacity();
  if (!embedded) host?.addEventListener?.('message', ev => { const m = ev.data || {}; if (m.cmd === 'opacity' && Number.isFinite(+m.value)) setOpac(Math.round(+m.value * 100)); if (m.cmd === 'pin') { pinned = !!m.on; try { localStorage.setItem('wavwiz.mini.pin', pinned ? '1' : '0'); } catch { /* ignore */ } paintPin(); } });

  // drag by the art or empty space (never by a control)
  if (!embedded) root.addEventListener('mousedown', ev => { if (ev.button !== 0 || ev.target.closest('button,input')) return; send('drag'); });
  const paintPin = () => { pin.classList.toggle('on', pinned); pin.setAttribute('aria-pressed', String(pinned)); };
  const paintMute = () => { mute.classList.toggle('on', muted); mute.setAttribute('aria-pressed', String(muted)); mute.title = muted ? 'Unmute everything' : 'Mute everything'; setIcon(mute, muted ? 'mute' : 'volume'); };
  const slim = () => { if (!embedded) root.classList.toggle('slim', window.innerHeight < 60 || window.innerWidth < 360); };
  window.addEventListener('resize', slim); slim();
  async function act(path, body) { try { await api(path, { method: 'POST', body: body || {} }); } catch { /* view-only or offline */ } setTimeout(poll, 150); }
  let lastArt = '';
  async function poll() {
    try {
      const r = await api('/stream'); now = r.now;
      const it = now?.item; t.textContent = it?.title || 'Nothing playing'; { const f = fitText(root.classList.contains('slim') ? 38 : 58, t.textContent.length); root.style.setProperty('--mp-tfs', f.title + 'px'); root.style.setProperty('--mp-afs', f.artist + 'px'); t.title = t.textContent; } a.textContent = it ? [it.artist, it.album].filter(Boolean).join(' · ') : '';
      const u = it ? itemArtUrl(it, 96) : null; if (u !== lastArt) { lastArt = u; if (u) art.src = u; else art.removeAttribute('src'); railArt.style.backgroundImage = u ? `url("${u}")` : ''; }
      railBar.style.setProperty('--p', (now?.durationMs ? Math.min(1, (now.positionMs || 0) / now.durationMs) : 0) * 100 + '%');
      setIcon(play, now?.state === 'playing' ? 'pause' : 'play');
      pos.textContent = fmtTime(now?.positionMs || 0); dur.textContent = fmtTime(now?.durationMs || 0);
      if (!dragging && now?.durationMs) seek.value = String(Math.round((now.positionMs || 0) / now.durationMs * 1000));
      const zs = await api('/zones'); const on = zs.filter(z => z.enabled); level = on.length ? Math.max(...on.map(z => z.volume)) : 0; muted = zs.length > 0 && zs.every(z => z.muted);
      if (document.activeElement !== vol) { vol.value = String(Math.round(level)); paintVol(level); } paintMute();
    } catch { t.textContent = 'Not connected'; }
  }
  if (embedded) { root.classList.add('embedded'); paintPin(); poll(); timer = setInterval(poll, 1000); }
  else (async () => { try { const s = await api('/auth/state'); setArtCv(s.artCv); } catch { /* ignore */ } paintPin(); send('ready', { pinned, opacity: opac / 100 }); poll(); timer = setInterval(poll, 1000); })();
  return { root, rail, poll, destroy: () => { clearInterval(timer); sc.destroy(); }, setOpac, applyOpacity };

}

// the mini player PAGE
const pageRoot = typeof document !== 'undefined' ? document.getElementById('mini') : null;
if (pageRoot && document.body.classList.contains('minibody')) {
  applyTheme(loadTheme());
  window.addEventListener('storage', ev => { if (!ev.key || /theme/i.test(ev.key)) applyTheme(loadTheme()); });   // theme flows from the main window
  mountMini(pageRoot);
}
