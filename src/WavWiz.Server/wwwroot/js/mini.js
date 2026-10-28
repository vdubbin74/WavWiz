import './sliderstyle.js';   // 0.3.3 G11
import './marquee.js';   // 0.4.8 F62: shared now-playing marquee
// WavWiz 0.3.2 F3: the mini player - replaces Remote mode. A small movable window with only the Now Playing controls: art, title / artist,
// seek, prev / play / next, mute, volume, pin (always on top, Player only), open the full app, close. Slim size (300x48) when the window is short.
// It never joins as a speaker (F2: opening or closing it never adds a second stream). In WavWiz Player it talks to its window over
// chrome.webview (drag, pin, full app, close, position); in a browser it is a popup window.
import { h, api } from './util.js';
import * as Z from './zones40.js';
import { applyTheme, loadTheme } from './theme.js';
import { icon, setIcon } from './icons.js';
import { itemArtUrl, setArtCv } from './art.js';
import { fmtTime } from './util.js';
import { loadNpPrefs, waveBars, eqBars, NP_KEY, applyNpClasses, applyNpColor } from './npstyle.js';   // 0.4.9 F85b
import { npArtBox } from './npart.js';   // 0.5.0 F98: Album art axis in the mini players
import { shortcutsSide, sendToMain, writePending } from './shortcuts.js';
import { installHotkeys } from './hotkeys.js';
import { OPACITY_MIN, clampOpacity, loadOpacity, saveOpacity, fitText } from './minifit.js';

const host = window.chrome?.webview;
export const send = (cmd, extra = {}) => { try { host?.postMessage({ cmd, ...extra }); return !!host; } catch { return false; } };
/** 0.3.5 J17: solid under the pointer only when nobody is adjusting the transparency (pure). */
export const shownOpacity = (opacPct, { hover: hv = false, adjusting: adj = false } = {}) => (hv && !adj ? 100 : opacPct);

/** 0.4.1: pure - what a key does in the mini player (null = nothing). Space / Enter on a button or field keep their own meaning; arrows on the sliders keep theirs. */
export function keyAction(ev) {
  if (!ev || ev.ctrlKey || ev.altKey || ev.metaKey) return null;
  const tag = (ev.target?.tagName || '').toLowerCase(), type = ev.target?.type || '', typing = tag === 'textarea' || (tag === 'input' && type !== 'range'), onRange = tag === 'input' && type === 'range';
  if (typing) return null; const k = (ev.key || '').toLowerCase();
  if (k === ' ' || k === 'spacebar') return tag === 'button' || onRange ? null : 'playpause';
  if (k === 'arrowright' || k === 'n') return onRange && k === 'arrowright' ? null : 'next';
  if (k === 'arrowleft' || k === 'p') return onRange && k === 'arrowleft' ? null : 'prev';
  if (k === 'arrowup') return onRange ? null : 'volup';
  if (k === 'arrowdown') return onRange ? null : 'voldown';
  if (k === 'm') return 'mute'; if (k === 'escape' || k === 'w') return 'close';
  return null;
}

/** 0.3.6 K14 / K22: the mini player as a component. The page (mini.html, popup or Player window) mounts it full size; the main app mounts it with { embedded: true } in the right-hand column. */
export function mountMini(root, { embedded = false, run = null, home = null } = {}) {
  let shufB = null, repB = null;
  let now = null, level = 0, muted = false, pinned = false, dragging = false, timer = 0;
  try { pinned = localStorage.getItem('wavwiz.mini.pin') === '1'; } catch { /* ignore */ }

  const railArt = h('div', { class: 'mp-rart', 'aria-hidden': 'true' }), railBar = h('div', { class: 'mp-rbar', 'aria-hidden': 'true' }, h('i'));   // 0.3.6 K22: the small cover + short progress bar shown on the collapsed Devices bar
  const art = h('img', { class: 'mp-art noart', alt: '', draggable: 'false' });
  // 0.4.6: the themed placeholder shows until the cover has really loaded; a missing / failed cover never shows a broken-image icon
  art.addEventListener('load', () => art.classList.toggle('noart', !art.naturalWidth)); art.addEventListener('error', () => { art.classList.add('noart'); art.removeAttribute('src'); retryArt(); });
  // 0.4.9 F84: a 204 ("no cover yet": an online cover is still being looked up, or the cache is being rebuilt) used to leave the record placeholder
  // until the next song. Ask again a few times, and at once when the server says new art arrived.
  let artTry = 0, artT = 0;
  const reloadArt = () => { clearTimeout(artT); if (!lastArt || !art.classList.contains('noart')) return; art.src = lastArt + (lastArt.includes('?') ? '&' : '?') + 'r=' + (++artTry); };
  function retryArt() { clearTimeout(artT); if (lastArt && artTry < 4) artT = setTimeout(reloadArt, 3000 * (artTry + 1)); }
  window.addEventListener('wavwiz:art', () => { artTry = 0; setTimeout(reloadArt, 1500); });
  const artBox = npArtBox({ cls: 'mp-artbox', cover: art });   // F98: square ring / spinning disc / sleeve / cassette, per Settings
  const t = h('div', { class: 'mp-t' }, '—'), a = h('div', { class: 'mp-a' }, '');
  const pos = h('span', null, '0:00'), dur = h('span', null, '0:00');
  const seek = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Position', oninput: () => { dragging = true; }, onchange: async () => { dragging = false; if (now?.durationMs) await act('/stream/seek', { ms: Math.round(seek.value / 1000 * now.durationMs) }); } });
  const txt = h('div', { class: 'mp-txt' }, t, h('div', { class: 'zl-line' }, a, Z.zoneLink('zl-mini')), ...(embedded ? [h('div', { class: 'mp-seek' }, pos, seek, dur)] : []));   // F98: the standalone shows the Track bar pick (mp-npl) in this slot instead of the plain range
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
  const opBtn = b('mp-op mp-opbtn', 'opacity', 'Window transparency', () => setOpMode(!opMode)); const opLbl = h('span', { class: 'mp-oplbl' }, 'Transparency'); opBtn.append(opLbl);   // 0.4.1: icon + label, next to the volume
  const armOp = () => { clearTimeout(opT); opT = setTimeout(() => setOpMode(false), 6000); };
  function setOpac(v, save = true) { opac = clampOpacity(v); opSl.value = String(opac); opVal.textContent = opac + '%'; if (save) saveOpacity(opac); applyOpacity(); }
  function setOpMode(on) { opMode = on; opLbl.textContent = on ? 'Volume' : 'Transparency'; opBtn.title = on ? 'Back to volume' : 'Window transparency: how solid the mini player is'; volWrap.hidden = on; volPct.hidden = on; opRow.hidden = !on; opBtn.classList.toggle('on', on); opBtn.setAttribute('aria-pressed', String(on)); if (on) { opSl.value = String(opac); opVal.textContent = opac + '%'; armOp(); } else clearTimeout(opT); applyOpacity(); }
  let hover = false;
  function applyOpacity() { const v = shownOpacity(opac, { hover, adjusting: adjusting || opMode }); if (!send('opacity', { value: v / 100, save: opac / 100 })) root.style.opacity = String(v / 100); else root.style.opacity = ''; }
  const hoverEl = embedded ? root : document.documentElement;
  hoverEl.addEventListener('mouseenter', () => { hover = true; applyOpacity(); }); hoverEl.addEventListener('mouseleave', () => { hover = false; applyOpacity(); });
  window.addEventListener('blur', () => { if (!document.hasFocus()) { hover = false; applyOpacity(); } });
  window.addEventListener('storage', ev => { if (ev.key === 'wavwiz.mini.opacity') setOpac(loadOpacity(), false); });   // Settings > Appearance changed it
  (embedded ? root : document).addEventListener('contextmenu', ev => { ev.preventDefault(); if (!send('menu', { opacity: opac / 100, pinned })) setOpMode(true); });
  const ctl = h('div', { class: 'mp-ctl' }, h('div', { class: 'mp-tr' }, prev, play, next, mute));   // F85: the embedded player adds its mixer button here (below)
  // 0.4.8 F54: the condensed (embedded) player has no volume slider - the Master volume mixer button sits in its place; the standalone mini keeps it
  const mixB = embedded ? h('button', { type: 'button', class: 'mutebtn mixbtn mp-mix', 'data-act': 'mixer', 'aria-label': 'Master volume', title: 'Master volume (Alt+V)', onclick: ev => { ev.stopPropagation(); window.dispatchEvent(new CustomEvent('wavwiz:mixer')); } }, icon('mixer')) : null;
  // 0.4.9 F85: window transparency only means something in the standalone Player window; the embedded player has no window of its own, so the
  // "Transparency" chip is gone there. The mixer button joins the transport row and the freed row shows the active visualizer (small, preview quality).
  if (mixB) ctl.firstChild.append(mixB);
  // 0.4.9 F85b: the freed row shows the Now Playing layout picked in Settings, in its compact form (a full panel scaled into ~50 px is unreadable):
  // each layout's own seek / time element, in the theme colors - Classic: time pill + round-knob line, Center: waveform, Stack: LCD clock + LED blocks,
  // Horizon: glowing line from the cover edge. Clicking it seeks, like the panel.
  const npHost = h('div', { class: 'mp-npl', role: 'slider', 'aria-label': 'Position', tabindex: 0 });   // F98: both minis
  if (!embedded) txt.append(npHost);
  const volRow = embedded ? npHost : h('div', { class: 'mp-vol dvol' }, volWrap, volPct, opRow, opBtn);   // F140: standalone moves opBtn to the title bar (below)   // its own full-width row
  let paintNpl = () => {};
  if (npHost) {
    let style = '', parts = null, seed = null;
    const el = (cls, ...k) => h('div', { class: cls }, ...k);
    const build = () => {
      { const q = loadNpPrefs(); style = q.seek; npHost.dataset.seek = style; npHost.className = 'mp-npl npl-' + ({ line: 'classic', wave: 'center', led: 'stack', eq: 'center npl-eqs' }[style]) + ' npl-btn-' + q.buttons; if (!embedded) { applyNpClasses(root, q); applyNpColor(q); } } seed = null;   // F98: standalone wears pn-seek/btn/art + Color intensity itself (embedded inherits minicol + html)   // F95: compact form follows the Track bar pick
      const fill = el('npl-fill'), track = el('npl-track', fill, el('npl-knob')), el1 = h('span', { class: 'npl-el' }), el2 = h('span', { class: 'npl-du' });
      if (style === 'wave' || style === 'eq') { const base = el('npl-wave'), top = el('npl-wave on'), clip = el('npl-wclip', top); parts = { kind: 'wave', base, top, clip, el1, el2 }; npHost.replaceChildren(el1, el('npl-wbox', base, clip), el2); }
      else if (style === 'led') { const leds = el('npl-leds', ...Array.from({ length: 24 }, () => h('i'))); parts = { kind: 'led', leds, el1, el2 }; npHost.replaceChildren(el('npl-lcd', el1), leds, el('npl-lcd dim', el2)); }
      else { parts = { kind: 'line', fill, track, el1, el2 }; npHost.replaceChildren(el('npl-pill', h('i'), el1, h('span', { class: 'dim' }, ' / '), el2), track); }
      paintNpl(now);
    };
    paintNpl = n => { if (!parts) return; const d = n?.durationMs || 0, p = Math.min(d, n?.positionMs || 0), f = d ? p / d : 0;
      parts.el1.textContent = fmtTime(p); parts.el2.textContent = fmtTime(d); npHost.setAttribute('aria-valuenow', String(Math.round(f * 100)));
      if (parts.kind === 'line') { parts.fill.style.width = f * 100 + '%'; parts.track.style.setProperty('--f', f * 100 + '%'); }
      else if (parts.kind === 'led') { const on = Math.round(f * parts.leds.children.length); [...parts.leds.children].forEach((x, i) => x.classList.toggle('on', i < on)); }
      else { const sd = n?.item?.title || 'idle'; if (sd !== seed) { seed = sd; const bars = style === 'eq' ? eqBars(sd, 24) : waveBars(sd, 48); for (const w of [parts.base, parts.top]) w.replaceChildren(...bars.map(v => h('i', { style: `height:${Math.round(v * 100)}%` }))); } parts.clip.style.clipPath = `inset(0 ${100 - f * 100}% 0 0)`; } };
    npHost.addEventListener('click', ev => { const t = npHost.querySelector('.npl-track,.npl-wbox,.npl-leds'); if (!t || !now?.durationMs) return; const r = t.getBoundingClientRect(); const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)); act('/stream/seek', { ms: Math.round(f * now.durationMs) }); });
    window.addEventListener('wavwiz:npstyle', build); window.addEventListener('storage', ev => { if (ev.key === NP_KEY) build(); });
    build();
  }
  // 0.3.7 L10 / L11 / L23: the shortcuts row - Home far right, a separator, up to 3 pins leftward. The standalone window asks the main app window (it is brought to the front first).
  const toMain = target => { writePending(target); if (!send('full', { target })) { try { window.opener?.focus(); } catch { /* ignore */ } } sendToMain(target); };   // 0.3.8 L34: ONE click - bring the main window forward and carry the target with it
  const scRun = run || (id => toMain({ run: id })), scHome = home || (() => toMain({ home: true }));
  // 0.5.0 F130 (Amendment 3): the condensed (embedded) player uses the same ONE Shortcuts toggle -> vertical pin strip + Home as Now Playing; the standalone window keeps its row
  // 0.5.0 F138: the standalone window uses the same toggle + leftward horizontal strip, in its own NOW PLAYING title bar
  const sc = (() => { const sd = shortcutsSide({ run: scRun, home: scHome, cls: 'mp-scside', onChange: o => root?.classList.toggle('scopen', o) });
    return { el: h('div', { class: 'mp-sc mp-sctog' }, sd.toggle, sd.strip), destroy: sd.destroy }; })();
  // 0.3.8 L44: the same shortcuts inside the standalone window (Alt+M closes it, Alt+H opens the main window on Home)
  if (!embedded) installHotkeys(id => {
    if (id === 'playpause') play.click(); else if (id === 'next') next.click(); else if (id === 'prev') prev.click(); else if (id === 'mute') mute.click();
    else if (id === 'mini') { if (!send('close')) window.close(); } else if (id === 'home') toMain({ home: true }); else if (['eq', 'queue', 'settings'].includes(id)) toMain({ run: id });
  });
  // 0.4.1: keyboard in the mini player: Space play / pause, Right or N next, Left or P previous, Up / Down volume, M mute, Esc or W close
  const stepVol = d => { const v = Math.max(0, Math.min(100, Math.round(+vol.value + d))); vol.value = String(v); paintVol(v); clearTimeout(vol._t); vol._t = setTimeout(() => act('/zones/master', { set: v }), 120); };
  const onKey = ev => { const a = keyAction(ev); if (!a) return; ev.preventDefault();
    if (a === 'playpause') play.click(); else if (a === 'next') next.click(); else if (a === 'prev') prev.click(); else if (a === 'mute') mute.click(); else if (a === 'volup') stepVol(5); else if (a === 'voldown') stepVol(-5);
    else if (a === 'close' && !embedded) { if (!send('close')) window.close(); } };
  (embedded ? root : document).addEventListener('keydown', onKey);
  // 0.4.0: the same zone chip as the main app (in the shortcuts row, so the window keeps its size); this window follows the choice made in the app (shared localStorage)
  const mz = { groups: [], jb: null }; let mzN = 0;
  if (!embedded) Z.init(mz, { refreshNow: () => poll(), manage: () => toMain({ run: 'devices' }) });   // 0.4.5 F27: no zone chip on the shortcuts row; the zone name on the song line is the picker
  async function pollZones() { if (embedded || mzN++ % 3) return; try { const [g, jb] = await Promise.all([api('/groups'), api('/jukebox/zone').catch(() => null)]); mz.groups = g; mz.jb = jb; Z.sync(); } catch { /* keep the last list */ } }
  // 0.5.0 F139: shuffle / repeat toggles for both condensed and standalone
  { const tog = (ic, label, fn) => { const x = b('tog ' + ic, ic, label, fn); x.setAttribute('aria-pressed', 'false'); return x; };
    shufB = tog('shuffle', 'Shuffle', () => act('/stream/shuffle', { on: !now?.shuffle }));
    repB = tog('repeat', 'Repeat', () => act('/stream/repeat', { mode: { off: 'all', all: 'one', one: 'off' }[now?.repeat ?? 'off'] })); }
  if (embedded) {
    // 0.5.0 F136: the condensed (under-Queue) player wears the flat Now Playing card chrome: a NOW PLAYING title bar with the Shortcuts pin on the
    // right (F135e: the horizontal pin strip opens leftward ON that bar), then art | titles + labeled Artist / Album + seek, the full transport
    // (shuffle / prev / play / next / repeat) and mute / mixer / EQ / Sleep + "on <zone>". The standalone window keeps its own layout.
    const eqB = h('button', { type: 'button', class: 'mutebtn mp-eq', 'aria-label': 'Sound (EQ)', title: 'Sound (EQ)', onclick: () => scRun('eq') }, icon('eq'));
    const sleepB = h('button', { type: 'button', class: 'btn sm mp-sleep', title: 'Sleep timer', onclick: () => scRun('sleep') }, 'Sleep');
    const zl = txt.querySelector('.zlink'); const trow = ctl.firstChild; trow.replaceChildren(shufB, prev, play, next, repB);
    const extras = h('div', { class: 'mp-ex' }, mute, ...(mixB ? [mixB] : []), eqB, sleepB, ...(zl ? [zl] : []));
    ctl.append(extras);
    const hd = h('div', { class: 'mp-hd' }, h('span', { class: 'mp-hdt' }, 'Now playing'), sc.el);
    const body = h('div', { class: 'mp-body' }, artBox.el, txt, ctl);
    root.classList.add('mp-flat'); root.append(hd, body, volRow);
  } else { const hd = h('div', { class: 'mp-hd mp-sthd' }, h('span', { class: 'mp-hdt' }, 'Now playing'), opBtn, sc.el);   // F140: the Volume / Transparency selector sits in the title bar, left of the Shortcuts pin   // F138: title bar; pin / full / close stay top-right over it
    ctl.firstChild.replaceChildren(shufB, prev, play, next, repB, mute); ctl.classList.add('mp-ctlr');   // F139: full transport, docked right
    root.classList.add('mp-sttitle'); volRow.classList.add('mp-volx'); root.append(hd, artBox.el, txt, volRow, ctl, h('div', { class: 'mp-side' }, pin, full, close)); }   // F140: one slider (volume, or transparency while selected) left of the transport
  const rail = h('div', { class: 'minirail', title: 'Now playing' }, railArt, railBar);
  applyOpacity();
  if (!embedded) host?.addEventListener?.('message', ev => { const m = ev.data || {}; if (m.cmd === 'opacity' && Number.isFinite(+m.value)) setOpac(Math.round(+m.value * 100)); if (m.cmd === 'pin') { pinned = !!m.on; try { localStorage.setItem('wavwiz.mini.pin', pinned ? '1' : '0'); } catch { /* ignore */ } paintPin(); } });

  // drag by the art or empty space (never by a control)
  if (!embedded) root.addEventListener('mousedown', ev => { if (ev.button !== 0 || ev.target.closest('button,input,.mp-npl')) return; send('drag'); });
  const paintPin = () => { pin.classList.toggle('on', pinned); pin.setAttribute('aria-pressed', String(pinned)); };
  const paintMute = () => { mute.classList.toggle('on', muted); mute.setAttribute('aria-pressed', String(muted)); mute.title = muted ? 'Unmute everything' : 'Mute everything'; setIcon(mute, muted ? 'mute' : 'volume'); };
  // 0.4.2: in the Player window slim is the host's choice (?slim=1), never a guess from the viewport (a DPI mismatch used to make the 420 px window look < 360 px and hide the transparency button, volume and shortcuts); in a browser popup the window size still decides.
  const hostSlim = new URLSearchParams(location.search).get('slim') === '1';
  const slim = () => { if (embedded) return; root.classList.toggle('slim', host ? hostSlim : (window.innerHeight < 60 || window.innerWidth < 360)); reportSize(); };
  // 0.4.2: the page reports its content size (CSS px) so the Player window is exactly that big (x device scale) - no gap, nothing clipped
  let lastSz = '';
  function reportSize() { if (embedded) return; const b = root.getBoundingClientRect();
    // 0.4.9 F75: report what the content NEEDS at its design width (420 / slim 300), never the width the window happens to have now. F55's
    // min(420px, 100vw) + reporting the rendered width locked a window that opened too narrow (e.g. 420 device px at 200 % = 210 CSS px) at that width.
    const sl = root.classList.contains('slim'), dw = sl ? 300 : 420, pw = root.style.width, pm = root.style.maxWidth; root.style.maxWidth = 'none'; root.style.width = dw + 'px';
    const need = Math.max(dw, root.scrollWidth), needH = root.getBoundingClientRect().height; root.style.width = pw; root.style.maxWidth = pm;
    const o = { w: Math.ceil(need), h: Math.ceil(needH), dpr: window.devicePixelRatio || 1, slim: root.classList.contains('slim') }; try { window.__miniSize = o; } catch { /* ignore */ } const k = o.w + 'x' + o.h + '@' + o.dpr + o.slim; if (k === lastSz) return; lastSz = k; send('size', o); }
  window.addEventListener('resize', slim); slim();
  if (!embedded && typeof ResizeObserver !== 'undefined') new ResizeObserver(() => reportSize()).observe(root);
  async function act(path, body) { try { await api(path, { method: 'POST', body: body || {} }); } catch { /* view-only or offline */ } setTimeout(poll, 150); }
  let lastArt = '';
  async function poll() {
    try {
      await pollZones();
      const r = await api('/stream'); now = r.now;
      const it = now?.item; t.textContent = it?.title || 'Nothing playing'; { const f = fitText(root.classList.contains('slim') ? 38 : 58, t.textContent.length); root.style.setProperty('--mp-tfs', f.title + 'px'); root.style.setProperty('--mp-afs', f.artist + 'px'); t.title = t.textContent; } { // 0.5.0 F130: condensed player shows the same labeled Artist · Album line as the flat Now Playing panel (album omitted when missing)
        const lab = (l, v) => [h('span', { class: 'np-aal' }, l), h('span', { class: 'np-aav' }, v)];
        a.replaceChildren(...(it ? [...(it.artist ? lab('Artist', it.artist) : []), ...(it.artist && it.album ? [h('span', { class: 'np-aadot', 'aria-hidden': 'true' }, '·')] : []), ...(it.album ? lab('Album', it.album) : [])] : []));
        a.title = it ? [it.artist, it.album].filter(Boolean).join(' · ') : ''; }
      const u = it ? itemArtUrl(it, 96) : null; if (u !== lastArt) { lastArt = u; artTry = 0; clearTimeout(artT); art.classList.add('noart'); if (u) art.src = u; else art.removeAttribute('src'); railArt.style.backgroundImage = u ? `url("${u}")` : ''; }
      railBar.style.setProperty('--p', (now?.durationMs ? Math.min(1, (now.positionMs || 0) / now.durationMs) : 0) * 100 + '%');
      setIcon(play, now?.state === 'playing' ? 'pause' : 'play');
      if (shufB) { shufB.classList.toggle('on', !!now?.shuffle); shufB.setAttribute('aria-pressed', String(!!now?.shuffle)); }
      if (repB) { const r = now?.repeat || 'off'; repB.classList.toggle('on', r !== 'off'); repB.setAttribute('aria-pressed', String(r !== 'off')); setIcon(repB, r === 'one' ? 'repeatOne' : 'repeat'); }
      artBox.setPlaying(now?.state === 'playing'); artBox.setFrac(now?.durationMs ? (now.positionMs || 0) / now.durationMs : 0); root.classList.toggle('playing', now?.state === 'playing');
      paintNpl(now); pos.textContent = fmtTime(now?.positionMs || 0); dur.textContent = fmtTime(now?.durationMs || 0);
      if (!dragging && now?.durationMs) seek.value = String(Math.round((now.positionMs || 0) / now.durationMs * 1000));
      const zs = await api('/zones'); const on = zs.filter(z => z.enabled); level = on.length ? Math.max(...on.map(z => z.volume)) : 0; muted = zs.length > 0 && zs.every(z => z.muted);
      if (document.activeElement !== vol) { vol.value = String(Math.round(level)); paintVol(level); } paintMute();
    } catch { t.textContent = 'Not connected'; }
  }
  if (embedded) { root.classList.add('embedded'); paintPin(); poll(); timer = setInterval(poll, 1000); }
  else (async () => { try { const s = await api('/auth/state'); setArtCv(s.artCv); } catch { /* ignore */ } paintPin(); send('ready', { pinned, opacity: opac / 100 }); reportSize(); poll(); timer = setInterval(poll, 1000); })();
  return { root, rail, poll, destroy: () => { clearInterval(timer); sc.destroy(); }, setOpac, applyOpacity };

}

// the mini player PAGE
const pageRoot = typeof document !== 'undefined' ? document.getElementById('mini') : null;
if (pageRoot && document.body.classList.contains('minibody')) {
  applyTheme(loadTheme());
  window.addEventListener('storage', ev => { if (!ev.key || /theme/i.test(ev.key)) applyTheme(loadTheme()); });   // theme flows from the main window
  mountMini(pageRoot);
}
