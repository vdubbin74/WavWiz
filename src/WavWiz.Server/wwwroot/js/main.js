import { h, api, toast, fmtDur, dialog, ApiError } from './util.js';
import { applyTheme, loadTheme } from './theme.js';
import { openSettings } from './settings.js';
import { openCalibration } from './calibrate.js';
import { openEq } from './eq.js';
import { createNow } from './now.js';
import { devicesView, devicesPanel } from './devices.js';
import { listTable } from './listtable.js';
import { brandMark } from './brand.js';
import { createMenuBar, createPhoneDrawerNav } from './menu.js';
import { installPhoneAutoJoin } from './room.js';
import { liveSocket } from './wsconn.js';
import { themesView } from './themes.js';
import { visualizerView } from './vizpage.js';
import { openAbout, maybeWhatsNew } from './about.js';
import { libraryView } from './library.js';
import { playlistsView } from './playlists.js';
import { cleanupView } from './cleanup.js';
import { diagnosticsView, roomPill } from './diag.js';
import { roomView } from './room.js';
import { canControl } from './ui.js';
import { scenesView } from './scenes.js';
import { schedulesView } from './schedules.js';
import { radioFinderView } from './radiofinder.js';
import { tagsView } from './tags.js';
import { ripView } from './rip.js';
import { remoteView } from './remote.js';

applyTheme(loadTheme());          // the "Default" theme unless this device picked something else

export const S = { auth: null, now: null, queue: [], zones: [], groups: [], radio: [], status: null, view: null, ws: null, localPos: 0, localAt: 0 };
const app = document.getElementById('app');
const VERSION_LABEL = () => `BETA ${S.auth?.appVersion ?? ''}`.trim();
const wide = () => !matchMedia('(max-width:900px)').matches;

// ---------------------------------------------------------------- boot
async function boot() {
  try { S.auth = await api('/auth/state'); } catch (e) { return fatal(e.message); }
  document.title = `WavWiz BETA ${S.auth.appVersion}`;
  if (S.auth.setupRequired) return renderSetup();
  if (!S.auth.authenticated) return renderLogin();
  try { await startMain(); }
  catch (e) {     // 0.0.8: a failure while drawing the main page must never leave a blank window; offer the sign-in chooser again
    console.error(e);
    app.replaceChildren(topbar(), h('div', { class: 'card auth' }, h('h2', null, 'WavWiz could not open this page'), h('p', { class: 'err' }, e?.message || String(e)),
      h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Reload'), ' ',
      h('button', { class: 'btn', onclick: async () => { try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* signed out anyway */ } location.reload(); } }, 'Sign in again')));
  }
}

function topbar(extra, lead) {
  return h('header', { class: 'topbar' }, lead || null,
    brandMark(), h('span', { class: 'beta', title: 'This is a BETA version' }, VERSION_LABEL()),
    h('span', { class: 'grow' }), extra);
}

function fatal(msg) { app.replaceChildren(topbar(), h('div', { class: 'card auth' }, h('h2', null, 'WavWiz is not reachable'), h('p', { class: 'err' }, msg), h('button', { class: 'btn', onclick: () => location.reload() }, 'Try again'))); }

function renderSetup() {
  const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8, id: 'pw1' }), pw2 = h('input', { type: 'password', autocomplete: 'new-password', id: 'pw2' }), msg = h('p', { class: 'err', role: 'alert' });
  const form = h('form', { class: 'card auth', onsubmit: async ev => {
    ev.preventDefault(); msg.textContent = '';
    if (pw.value !== pw2.value) { msg.textContent = 'The two passwords are different.'; return; }
    try { await api('/auth/setup', { method: 'POST', body: { password: pw.value } }); location.reload(); } catch (e) { msg.textContent = e.message; }
  } },
    h('h2', null, 'Welcome to WavWiz'), h('p', { class: 'dim' }, 'Choose an administrator password for this WavWiz server (at least 8 characters). It never leaves your home network. Nothing was generated or shown by the installer.'),
    S.auth.thisMachine ? null : h('p', { class: 'err' }, 'First-time setup can only be done on the PC that runs the WavWiz server. Open this page on that PC.'),
    h('div', { class: 'field' }, h('label', { for: 'pw1' }, 'Password'), pw), h('div', { class: 'field' }, h('label', { for: 'pw2' }, 'Repeat password'), pw2), msg,
    h('button', { class: 'btn primary', disabled: !S.auth.thisMachine }, 'Create and continue'));
  app.replaceChildren(topbar(), form);
}

function renderLogin() {
  const mode = { v: 'pair' };
  const root = h('div', { class: 'card auth' });
  const draw = () => {
    const msg = h('p', { class: 'err', role: 'alert' });
    const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '6-digit code', id: 'code' });
    const name = h('input', { type: 'text', maxlength: 40, placeholder: 'e.g. Sam\'s phone', id: 'devname', value: /iPhone|Android/.test(navigator.userAgent) ? 'Phone' : 'Browser' });
    const pw = h('input', { type: 'password', autocomplete: 'current-password', id: 'pw' });
    root.replaceChildren(
      h('h2', null, 'Sign in'),
      h('div', { class: 'tabs', role: 'tablist' }, h('button', { class: mode.v === 'pair' ? 'on' : '', onclick: () => { mode.v = 'pair'; draw(); } }, 'Pair with code'), h('button', { class: mode.v === 'admin' ? 'on' : '', onclick: () => { mode.v = 'admin'; draw(); } }, 'Administrator')),
      mode.v === 'pair'
        ? h('form', { onsubmit: async ev => { ev.preventDefault(); try { await api('/auth/pair', { method: 'POST', body: { code: code.value, name: name.value } }); location.reload(); } catch (e) { msg.textContent = e.message; } } },
            h('p', { class: 'dim' }, 'On the PC that runs WavWiz open Settings > Players > Pair, and type the 6-digit code here.'),
            h('div', { class: 'field' }, h('label', { for: 'code' }, 'Code'), code), h('div', { class: 'field' }, h('label', { for: 'devname' }, 'This device\'s name'), name), msg, h('button', { class: 'btn primary' }, 'Pair'))
        : h('form', { onsubmit: async ev => { ev.preventDefault(); try { await api('/auth/login', { method: 'POST', body: { password: pw.value } }); location.reload(); } catch (e) { msg.textContent = e.message; } } },
            h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Administrator password'), pw), msg, h('button', { class: 'btn primary' }, 'Sign in')));
  };
  draw(); app.replaceChildren(topbar(), root);
}

// ---------------------------------------------------------------- main UI
const NAV = [
  ['now', '♪', 'Now Playing', true], ['library', '☰', 'Library'], ['playlists', '📑', 'Playlists'], ['queue', '≡', 'Queue'], ['devices', '◉', 'Devices & zones'], ['radio', '📻', 'Radio'],
  ['scenes', '🎬', 'Scenes'], ['schedules', '⏰', 'Schedules'], ['finder', '🔎', 'Radio finder'], ['tags', '🏷', 'Tag & cover fix', false, true], ['rip', '💿', 'CD ripper', false, true], ['remote', '🔐', 'Away-from-home', false, true],
  ['phone', '📱', 'This phone as a device', false, true], ['cleanup', '🧹', 'Tidy up library', false, true], ['diag', '🩺', 'Diagnostics', false, true], ['about', 'ℹ', 'About & credits']];
// NAV kept for page titles; phone hamburger uses createPhoneDrawerNav (PC menus no longer list "This phone as a device").
const PAGE_TITLES = { themes: 'Themes', visualizer: 'Visualizer', playlists: 'Playlists', radio: 'Internet radio', devices: 'Devices & zones', cleanup: 'Tidy up library', diag: 'Diagnostics', phone: 'This phone as a device', about: 'About WavWiz', scenes: 'Scenes', schedules: 'Schedules', finder: 'Radio finder', tags: 'Tag & cover fix', rip: 'CD ripper', remote: 'Away-from-home access' };
const views = {};
let desk, drawerEl, tabs, nowc, devv, devp, listt, libC, libpanel, statusbar, content, navButtons = [], pageDlg = null;

async function startMain() {
  const connDot = h('span', { class: 'dot', id: 'conn' }), connTxt = h('span', { id: 'conntxt', class: 'small dim' }, 'Connecting…');
  const control = canControl(S);
  const ctl = { act, refreshAll, go, openEq: () => openEq(S, refreshAll), checklistGo, pill: roomPill, saveQueue, toggleLib: f => toggleLib(f), toggleDev: f => toggleDev(f), toggleList: f => toggleList(f), libCollapsed: () => desk?.classList.contains('libcollapsed'), devCollapsed: () => desk?.classList.contains('devcollapsed') };
  nowc = createNow(S, ctl); devv = devicesView(S, ctl); devp = devicesPanel(S, ctl); listt = listTable(S, ctl);
  views.library = libraryView(S); views.playlists = playlistsView(S); views.cleanup = cleanupView(S); views.diag = diagnosticsView(S);
  views.phone = { el: roomView(S, refreshAll), reload() {} }; views.queue = { el: h('div', { id: 'p-list' }), reload: drawQueue }; views.radio = { el: h('div', { id: 'p-radio' }), reload: drawRadio };
  views.scenes = scenesView(S); views.schedules = schedulesView(S); views.finder = radioFinderView(S, act); views.tags = tagsView(S); views.rip = ripView(S); views.remote = remoteView(S);
  views.themes = themesView(); views.visualizer = visualizerView();
  views.devices = { el: devv.el, reload: () => devv.draw() }; views.about = { el: h('div', { id: 'p-about' }), reload: () => openAboutInto(views.about.el) };
  libC = libraryView(S, { compact: true });
  content = h('main', { class: 'view', id: 'view', tabindex: -1 });
  S.view = wide() ? 'library' : 'now';

  const hamburger = h('button', { class: 'iconbtn hamburger', 'aria-label': 'Menu', 'aria-expanded': 'false', onclick: () => toggleDrawer(true) }, '☰');
  const menubar = createMenuBar(S, { go, refreshAll, act, toggleLib: f => toggleLib(f), toggleDev: f => toggleDev(f), toggleList: f => toggleList(f) });
  const inline = h('nav', { class: 'navwide', 'aria-label': 'Sections' }, [['playlists', 'Playlists'], ['radio', 'Radio'], ['finder', 'Finder'], ['scenes', 'Scenes'], ['devices', 'Devices & zones']].map(([k, t]) => h('button', { class: 'iconbtn', 'data-k': k, onclick: () => go(k) }, t)),
    control ? h('button', { class: 'iconbtn', onclick: () => openCalibration(S, refreshAll) }, '🎤 Calibrate') : null, h('button', { class: 'iconbtn', onclick: () => openEq(S, refreshAll) }, '🎚 Sound'), h('button', { class: 'iconbtn', onclick: () => openSettings(S, refreshAll, go) }, '⚙ Settings'));
  const bar = topbar([menubar, h('span', { class: 'conn row', style: 'gap:6px' }, connDot, connTxt), inline], hamburger);

  const libC0 = localStorage.getItem('wavwiz.libcollapsed') === '1';
  const colBtn = h('button', { class: 'plus', 'aria-label': 'Collapse or expand the library', 'aria-expanded': String(!libC0), title: 'Collapse / expand the library', onclick: () => toggleLib() }, libC0 ? '›' : '‹');
  libpanel = h('section', { class: 'libpanel', 'aria-label': 'Library' }, h('div', { class: 'pane-h' }, h('span', { class: 'libtitle' }, 'LIBRARY'), h('span', { class: 'grow' }), colBtn), h('div', { class: 'libbody' }, libC.el));
  statusbar = h('footer', { class: 'statusbar', 'aria-label': 'Status' });
  desk = h('div', { class: 'desk' + (localStorage.getItem('wavwiz.libcollapsed') === '1' ? ' libcollapsed' : '') + (localStorage.getItem('wavwiz.devcollapsed') === '1' ? ' devcollapsed' : '') + (localStorage.getItem('wavwiz.listcollapsed') === '1' ? ' listcollapsed' : ''), id: 'desk', 'data-view': S.view }, libpanel, content, nowc.el, devp.el, listt.el);
  devp.setCollapsed?.(desk.classList.contains('devcollapsed')); listt.setCollapsed?.(desk.classList.contains('listcollapsed'));
  tabs = h('nav', { class: 'tabbar', 'aria-label': 'Sections' }, [['now', '♪', 'Now'], ['library', '☰', 'Library'], ['devices', '◉', 'Devices']].map(([k, ic, t]) => h('button', { 'data-k': k, onclick: () => go(k) }, h('b', null, ic), t)));
  drawerEl = buildDrawer();
  app.replaceChildren(bar, desk, statusbar, nowc.mini, tabs); document.body.append(drawerEl);
  window.addEventListener('resize', () => { if (wide() && S.view === 'now') go('library'); });
  window.addEventListener('keydown', ev => { if (ev.key === 'Escape') toggleDrawer(false); });
  connectWs(); go(S.view, true); libC.reload();
  await refreshAll();
  drawStatus(); maybeWhatsNew(S);
  setInterval(() => nowc.tickPos(), 250);
  installPhoneAutoJoin(S, refreshAll);
}
function toggleLib(force) { const c = force ?? !desk.classList.contains('libcollapsed'); desk.classList.toggle('libcollapsed', c); try { localStorage.setItem('wavwiz.libcollapsed', c ? '1' : '0'); } catch { /* ignore */ } const b = libpanel.querySelector('.plus'); b.textContent = c ? '›' : '‹'; b.setAttribute('aria-expanded', String(!c)); if (!c) libC.reload(); }
/** 0.1.1: the bottom Playlist slides down to its header strip (Library > Playlist toggles it on desktop); saved per device. */
function toggleList(force) { const c = force ?? !desk.classList.contains('listcollapsed'); desk.classList.toggle('listcollapsed', c); try { localStorage.setItem('wavwiz.listcollapsed', c ? '1' : '0'); } catch { /* ignore */ } listt.setCollapsed?.(c); if (!c) setTimeout(() => listt.relayout?.(), 340); }
/** 0.0.8: the right-hand Devices & zones panel collapses to a thin strip with its arrow (mirrors the Library panel); saved per device. */
function toggleDev(force) { const c = force ?? !desk.classList.contains('devcollapsed'); desk.classList.toggle('devcollapsed', c); try { localStorage.setItem('wavwiz.devcollapsed', c ? '1' : '0'); } catch { /* ignore */ } devp.setCollapsed?.(c); if (!c) devp.draw(); }

/** Desktop: everything that is not Now Playing / Library opens as a page on top of the layout. Phone: the 0.0.2 views. */
function openPage(k) {
  const v = views[k]; if (!v) return;
  if (pageDlg) { pageDlg.close(); pageDlg = null; }
  const body = h('div', { class: 'pagebody' }, v.el);
  pageDlg = dialog(PAGE_TITLES[k] || k, body, [{ text: 'Close' }], { cls: 'page', onClose: () => { pageDlg = null; S.page = null; v.hide?.(); } }); S.page = k;
  v.reload?.();
}
async function openAboutInto(el) { const { aboutBody } = await import('./about.js'); el.replaceChildren(aboutBody(S)); }

function buildDrawer() {
  navButtons = [];
  const nav = createPhoneDrawerNav(S, { go, refreshAll, act }, { onClose: () => toggleDrawer(false), versionLabel: VERSION_LABEL() });
  return h('div', { class: 'drawer', id: 'drawer', role: 'dialog', 'aria-label': 'Menu' }, h('div', { class: 'scrim', onclick: () => toggleDrawer(false) }), nav);
}
function toggleDrawer(open) { drawerEl.classList.toggle('open', open); document.querySelector('.hamburger')?.setAttribute('aria-expanded', String(open)); if (open) drawerEl.querySelector('nav button')?.focus(); }

export function go(k, force) {
  if (k?.startsWith?.('settings:')) return openSettings(S, refreshAll, go, k.slice(9));
  if (k === 'zones' || k === 'rooms') k = 'devices';
  if (wide()) {                               // desktop layout: Now Playing, Library, Devices & Playlist are always on screen; the rest opens as a page
    if (k === 'now') return;
    if (k === 'library') { toggleLib(false); libC.reload(); if (!force) libC.el.querySelector('input[type=search]')?.focus(); return; }
    if (k === 'queue') { listt.el.classList.add('flash'); setTimeout(() => listt.el.classList.remove('flash'), 900); return; }
    return openPage(k);
  }
  if (S.view !== k) views[S.view]?.hide?.();
  S.view = k; desk.dataset.view = k;
  if (k !== 'now') { const v = views[k]; content.replaceChildren(v.el); v.reload?.(); }
  else if (!content.firstChild) content.replaceChildren(views.library.el);
  tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  navButtons.forEach(b => b.classList.toggle('on', b.dataset.k === k));
  document.querySelectorAll('.navwide [data-k]').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  if (k === 'now') { nowc.drawChecklist(); }
  window.scrollTo(0, 0);
}
const checklistGo = a => go(a);

export async function refreshAll() { await Promise.allSettled([refreshNow(), refreshZones(), refreshStatus(), refreshRadio()]); nowc?.drawChecklist(); }
async function refreshNow() { try { const r = await api('/stream'); S.now = r.now; S.queue = r.queue.items; S.localPos = r.now.positionMs; S.localAt = performance.now(); nowc.draw(); listt.draw(); drawStatus(); if (S.view === 'queue') drawQueue(); } catch (e) { handleErr(e); } }
async function refreshZones() { try { const [z, g] = await Promise.all([api('/zones'), api('/groups').catch(() => S.groups)]); S.zones = z; S.groups = g; devv.draw(); devp.draw(); nowc.drawStrip(); drawStatus(); } catch (e) { handleErr(e); } }
async function refreshStatus() { try { S.status = await api('/status'); } catch (e) { handleErr(e); } try { const c = await api('/checklist'); S.setupLeft = c.dismissed || localStorage.getItem('unison.checklist.dismissed') === '1' ? 0 : c.remaining; } catch { S.setupLeft = 0; } drawStatus(); }
async function refreshRadio() { try { S.radio = await api('/radio'); if (S.view === 'radio') drawRadio(); } catch (e) { handleErr(e); } }
function handleErr(e) { if (e instanceof ApiError && e.status === 401) location.reload(); else if (e.status !== 0) toast(e.message, true); }
async function act(path, body, method = 'POST') { try { await api(path, { method, body }); } catch (e) { toast(e.message, true); } }

let wsTries = 0;
/** 0.0.7: ticket-authenticated, self-healing UI event socket (keepalive + watchdog + backoff; see wsconn.js). */
function connectWs() {
  const dot = document.getElementById('conn'), txt = document.getElementById('conntxt');
  const setConn = (ok, label) => { S.connected = ok; if (dot) dot.className = 'dot ' + (ok ? 'ok' : 'bad'); if (txt) txt.textContent = label; drawStatus(); };
  let downTimer = null;
  S.live = liveSocket('/ws', {
    onOpen: () => { clearTimeout(downTimer); setConn(true, 'Connected'); if (wsTries++) refreshAll(); },
    // short blips (a phone waking up) reconnect silently; only show the red state when it lasts longer than 3 s
    onClose: () => { clearTimeout(downTimer); downTimer = setTimeout(() => { if (!S.live?.socket() || S.live.socket().readyState !== 1) setConn(false, 'Reconnecting…'); }, 3000); },
    onUnauthorized: () => location.reload(),
    onMessage: ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'now' || m.type === 'queue') refreshNow(); else if (m.type === 'zones') { refreshZones(); refreshStatus(); }
      else if (m.type === 'library') { refreshStatus(); window.dispatchEvent(new CustomEvent('wavwiz:library')); nowc.drawChecklist(); }
      else if (m.type === 'tick') { if (S.now?.state === 'playing') refreshNow(); if (S.view === 'devices' || wide() || S.view === 'now') refreshZones(); }
      else if (m.type === 'notice') toast(m.data.message, true);
    },
  });
}

// ---------------------------------------------------------------- status bar (desktop)
function drawStatus() {
  if (!statusbar) return;
  const online = S.zones.filter(z => z.connected).length, playing = S.now?.state === 'playing';
  const on = S.zones.filter(z => z.enabled && z.connected), act_ = (S.groups || []).find(g => g.active);
  const bad = S.zones.filter(z => z.connected && ['dropped', 'reconnecting', 'buffering'].includes(z.room?.state));
  const tracks = S.status?.library?.tracks;
  statusbar.replaceChildren(
    h('span', { class: 'sb' }, h('span', { class: 'dot ' + (S.connected === false ? 'bad' : 'ok') }), S.connected === false ? 'Reconnecting…' : 'Connected'),
    h('span', { class: 'sb' }, `${online} of ${S.zones.length} device${S.zones.length === 1 ? '' : 's'} online`),
    h('span', { class: 'sb' }, playing ? `Playing on ${act_ ? 'zone “' + act_.name + '”' : on.length + ' device' + (on.length === 1 ? '' : 's')}` : (S.now?.state === 'paused' ? 'Paused' : 'Stopped')),
    bad.length ? h('span', { class: 'sb warn', title: bad.map(z => `${z.name}: ${z.room.text}`).join('\n') }, '⚠ ' + bad.map(z => `${z.name} ${z.room.state}`).join(', ')) : null,
    h('span', { class: 'grow' }), tracks != null ? h('span', { class: 'sb' }, `${tracks} song${tracks === 1 ? '' : 's'} in the library`) : null,
    S.setupLeft ? h('button', { class: 'sb link', onclick: () => openSetup() }, `Getting started: ${S.setupLeft} to go`) : null,
    h('button', { class: 'sb link', onclick: () => go('about'), title: 'About, credits and licenses' }, `WavWiz BETA ${S.auth?.appVersion ?? ''}`));
}
async function openSetup() { const { checklistCard } = await import('./diag.js'); const c = await checklistCard(S, a => { go(a); }, true); if (c) dialog('Getting started', c, [{ text: 'Close' }]); }

// ---------------------------------------------------------------- Queue
function drawQueue() {
  const root = views.queue.el; const can = canControl(S);
  const total = S.queue.reduce((a, q) => a + (q.durationMs || 0), 0), cur = S.now?.index ?? -1;
  const rows = S.queue.map((q, i) => {
    const playing = i === cur && S.now?.state !== 'stopped';
    return h('div', { class: 'item' + (playing ? ' cur' : ''), onclick: () => can && act('/stream/jump', { index: i }) },
      h('span', { class: 'num' }, playing ? '▶' : i + 1), h('div', { class: 't' }, h('div', { class: 't1 ell' }, q.title), h('div', { class: 't2 ell' }, [q.artist, q.album].filter(Boolean).join(' • '))), h('span', { class: 'dur' }, q.durationMs ? fmtDur(q.durationMs) : ''),
      can ? h('button', { class: 'more', 'aria-label': 'Move up', disabled: i === 0, onclick: ev => { ev.stopPropagation(); act('/queue/move', { from: i, to: i - 1 }); } }, '▲') : null,
      can ? h('button', { class: 'more', 'aria-label': 'Move down', disabled: i === S.queue.length - 1, onclick: ev => { ev.stopPropagation(); act('/queue/move', { from: i, to: i + 1 }); } }, '▼') : null,
      can ? h('button', { class: 'more', 'aria-label': 'Remove', onclick: ev => { ev.stopPropagation(); act(`/queue/${i}`, undefined, 'DELETE'); } }, '✕') : null);
  });
  root.replaceChildren(h('div', { class: 'row wrap' }, h('h2', { class: 'grow', style: 'margin:0' }, 'Queue'), h('span', { class: 'dim small' }, `${S.queue.length} tracks${total ? ' • ' + fmtDur(total) : ''} • editable from any device`),
    can && S.queue.length ? [h('button', { class: 'btn', onclick: saveQueue }, 'Save as playlist'), h('button', { class: 'btn', onclick: () => act('/queue/clear') }, 'Clear')] : null),
    S.queue.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'dim' }, 'The queue is empty. Open the Library and tap a song, or use ⋯ > Add to queue.'));
}
function saveQueue() {
  const name = h('input', { type: 'text', maxlength: 80, placeholder: 'Playlist name' });
  dialog('Save queue as playlist', h('div', { class: 'field' }, h('label', null, 'Name'), name), [{ text: 'Save', cls: 'primary', onclick: async () => { try { await api('/playlists', { method: 'POST', body: { name: name.value, fromQueue: true } }); toast('Saved'); window.dispatchEvent(new CustomEvent('wavwiz:playlists')); } catch (e) { toast(e.message, true); return false; } } }, { text: 'Cancel' }]);
}

// ---------------------------------------------------------------- Radio
function drawRadio() {
  const root = views.radio.el, can = canControl(S);
  const url = h('input', { type: 'url', placeholder: 'https://… stream address', class: 'grow' }), name = h('input', { type: 'text', placeholder: 'Station name', maxlength: 80 });
  root.replaceChildren(h('div', { class: 'row wrap' }, h('h2', { class: 'grow', style: 'margin:0' }, '📻 Internet radio'), h('button', { class: 'btn', onclick: () => go('finder') }, '🔎 Find stations')),
    ...S.radio.map(r => h('div', { class: 'row card' }, h('button', { class: 'iconbtn', 'aria-label': 'Favorite', onclick: () => act(`/radio/${r.id}`, { favorite: !r.favorite }, 'PUT').then(refreshRadio) }, r.favorite ? '★' : '☆'),
      h('div', { class: 'grow', style: 'min-width:0' }, h('b', { class: 'ell', style: 'display:block' }, r.name), h('div', { class: 'dim small ell' }, r.genre ?? r.url.replace(/^https?:\/\//, '').slice(0, 40))),
      can ? [h('button', { class: 'btn primary', 'aria-label': 'Play', onclick: () => act('/stream/play', { kind: 'radio', id: r.id }) }, '▶'), h('button', { class: 'btn danger', 'aria-label': 'Delete', onclick: () => act(`/radio/${r.id}`, undefined, 'DELETE').then(refreshRadio) }, '✕')] : null)),
    S.radio.length ? null : h('p', { class: 'dim' }, 'No stations yet. Add one below.'),
    can ? h('div', { class: 'card' }, h('h3', null, 'Add a station'), h('div', { class: 'field' }, name), h('div', { class: 'row' }, url, h('button', { class: 'btn', onclick: async () => { try { await api('/radio', { method: 'POST', body: { name: name.value, url: url.value } }); refreshRadio(); } catch (e) { toast(e.message, true); } } }, 'Add')),
      h('p', { class: 'dim small' }, 'Use the stream address (an .mp3/.aac/.m3u8 link or a .pls/.m3u playlist). Plain http:// streams are fine on your home network.')) : null);
}

boot();
