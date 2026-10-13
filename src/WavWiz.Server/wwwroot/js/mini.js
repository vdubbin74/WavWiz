// WavWiz 0.3.2 F3: the mini player - replaces Remote mode. A small movable window with only the Now Playing controls: art, title / artist,
// seek, prev / play / next, mute, volume, pin (always on top, Player only), open the full app, close. Slim size (300x48) when the window is short.
// It never joins as a speaker (F2: opening or closing it never adds a second stream). In WavWiz Player it talks to its window over
// chrome.webview (drag, pin, full app, close, position); in a browser it is a popup window.
import { h, api } from './util.js';
import { applyTheme, loadTheme } from './theme.js';
import { icon, setIcon } from './icons.js';
import { itemArtUrl, setArtCv } from './art.js';
import { fmtTime } from './util.js';

applyTheme(loadTheme());
window.addEventListener('storage', ev => { if (!ev.key || /theme/i.test(ev.key)) applyTheme(loadTheme()); });   // theme flows from the main window
const host = window.chrome?.webview;
export const send = (cmd, extra = {}) => { try { host?.postMessage({ cmd, ...extra }); return !!host; } catch { return false; } };
const root = document.getElementById('mini');
let now = null, level = 0, muted = false, pinned = false, dragging = false;
try { pinned = localStorage.getItem('wavwiz.mini.pin') === '1'; } catch { /* ignore */ }

const art = h('img', { class: 'mp-art', alt: '', draggable: 'false' });
const t = h('div', { class: 'mp-t' }, '—'), a = h('div', { class: 'mp-a' }, '');
const pos = h('span', null, '0:00'), dur = h('span', null, '0:00');
const seek = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Position', oninput: () => { dragging = true; }, onchange: async () => { dragging = false; if (now?.durationMs) await act('/stream/seek', { ms: Math.round(seek.value / 1000 * now.durationMs) }); } });
const txt = h('div', { class: 'mp-txt' }, t, a, h('div', { class: 'mp-seek' }, pos, seek, dur));
const b = (cls, ic, label, fn) => { const x = h('button', { type: 'button', class: 'mp-b ' + cls, 'aria-label': label, title: label, onclick: fn }); x.append(icon(ic)); return x; };
const prev = b('prev', 'prev', 'Previous', () => act('/stream/prev'));
const play = b('play', 'play', 'Play or pause', () => act(now?.state === 'playing' ? '/stream/pause' : now?.state === 'paused' ? '/stream/resume' : '/stream/resume'));
const next = b('next', 'next', 'Next', () => act('/stream/next'));
const mute = h('button', { type: 'button', class: 'mutebtn mp-mute', 'aria-label': 'Mute', title: 'Mute everything', onclick: () => { muted = !muted; act('/zones/mute-all', { muted }); paintMute(); } }); mute.append(icon('volume'));
const vol = h('input', { type: 'range', min: 0, max: 100, value: 0, 'aria-label': 'Volume', oninput: () => { clearTimeout(vol._t); vol._t = setTimeout(() => act('/zones/master', { set: +vol.value }), 120); } });
const pin = b('mp-pin', 'pin', 'Keep on top', () => { pinned = !pinned; try { localStorage.setItem('wavwiz.mini.pin', pinned ? '1' : '0'); } catch { /* ignore */ } send('pin', { on: pinned }); paintPin(); });
const full = b('mp-full', 'expandOut', 'Open the full app', () => { if (!send('full')) { try { window.opener?.focus(); } catch { /* ignore */ } if (!window.opener) window.open('/', 'wavwiz-main'); } });
const close = h('button', { type: 'button', class: 'mp-x', 'aria-label': 'Close', title: 'Close', onclick: () => { if (!send('close')) window.close(); } }, '✕');
if (!host) { pin.disabled = true; pin.title = 'Keep on top works in the WavWiz Player window'; }
root.append(art, txt, h('div', { class: 'mp-tr' }, prev, play, next), h('div', { class: 'mp-vol' }, mute, vol), h('div', { class: 'mp-side' }, pin, full), close);

// drag by the art or empty space (never by a control)
root.addEventListener('mousedown', ev => { if (ev.button !== 0 || ev.target.closest('button,input')) return; send('drag'); });
const paintPin = () => { pin.classList.toggle('on', pinned); pin.setAttribute('aria-pressed', String(pinned)); };
const paintMute = () => { mute.classList.toggle('on', muted); mute.setAttribute('aria-pressed', String(muted)); mute.title = muted ? 'Unmute everything' : 'Mute everything'; setIcon(mute, muted ? 'mute' : 'volume'); };
const slim = () => root.classList.toggle('slim', window.innerHeight < 60 || window.innerWidth < 360);
window.addEventListener('resize', slim); slim();
async function act(path, body) { try { await api(path, { method: 'POST', body: body || {} }); } catch { /* view-only or offline */ } setTimeout(poll, 150); }
let lastArt = '';
async function poll() {
  try {
    const r = await api('/stream'); now = r.now;
    const it = now?.item; t.textContent = it?.title || 'Nothing playing'; a.textContent = it ? [it.artist, it.album].filter(Boolean).join(' · ') : '';
    const u = it ? itemArtUrl(it, 96) : null; if (u !== lastArt) { lastArt = u; if (u) art.src = u; else art.removeAttribute('src'); }
    setIcon(play, now?.state === 'playing' ? 'pause' : 'play');
    pos.textContent = fmtTime(now?.positionMs || 0); dur.textContent = fmtTime(now?.durationMs || 0);
    if (!dragging && now?.durationMs) seek.value = String(Math.round((now.positionMs || 0) / now.durationMs * 1000));
    const zs = await api('/zones'); const on = zs.filter(z => z.enabled); level = on.length ? Math.max(...on.map(z => z.volume)) : 0; muted = zs.length > 0 && zs.every(z => z.muted);
    if (document.activeElement !== vol) vol.value = String(Math.round(level)); paintMute();
  } catch { t.textContent = 'Not connected'; }
}
(async () => { try { const s = await api('/auth/state'); setArtCv(s.artCv); } catch { /* ignore */ } paintPin(); send('ready', { pinned }); poll(); setInterval(poll, 1000); })();
