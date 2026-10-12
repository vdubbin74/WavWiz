import { h, api, toast, fmtDur, dialog, ApiError } from './util.js';
import { applyTheme, loadTheme } from './theme.js';
import { openSettings } from './settings.js';
import { openCalibration } from './calibrate.js';
import { openEq } from './eq.js';
import { createNow } from './now.js';
import { devicesView, devicesPanel, arrowSize, arrowLabel, expandLabel, expandIcon, saveDevSize, loadDevSize } from './devices.js';
import { listTable } from './listtable.js';
import { icon, setIcon } from './icons.js';
import { brandMark } from './brand.js';
import { createMenuBar, createPhoneDrawerNav } from './menu.js';
import { installAutoJoin, deviceName } from './room.js';
import { installTvMode } from './tv.js';
import { adminChip, refreshAuth } from './elevate.js';
import { liveSocket } from './wsconn.js';
import { openAbout, maybeWhatsNew } from './about.js';
import { libraryView } from './library.js';
import { artPushed } from './art.js';
import { loadLibPrefs } from './libsort.js';
import { playlistsView } from './playlists.js';
import { cleanupView } from './cleanup.js';
import { diagnosticsView, roomPill, checklistDismissedLocal } from './diag.js';
import { canControl } from './ui.js';
import { scenesView } from './scenes.js';
import { schedulesView } from './schedules.js';
import { radioFinderView } from './radiofinder.js';
import { tagsView } from './tags.js';
import { ripView } from './rip.js';
import { remoteView } from './remote.js';

applyTheme(loadTheme());          // the "Default" theme unless this device picked something else
installTvMode();                  // 0.2.0 item 1: TVs and ?lite get the lightweight, remote-friendly Now Playing

export const S = { auth: null, now: null, queue: [], zones: [], groups: [], radio: [], status: null, view: null, ws: null, localPos: 0, localAt: 0 };
const app = document.getElementById('app');
const VERSION_LABEL = () => `BETA ${S.auth?.appVersion ?? ''}`.trim();
const wide = () => !matchMedia('(max-width:900px)').matches;

// ---------------------------------------------------------------- boot
// 0.2.2 T9 / 0.2.5: a phone arriving with ?cal=CODE (the PC's calibration QR code) is sent to the mic-only page /calmic.html (see calredirect.js)
const CAL = (() => { try { const q = new URLSearchParams(location.search), cal = q.get('cal') || '', pair = q.get('pair') || ''; return { cal: /^[A-Za-z0-9]{6}$/.test(cal) ? cal : null, pair: /^[0-9]{6}$/.test(pair) ? pair : null }; } catch { return { cal: null, pair: null }; } })();
async function boot() {
  if (CAL.cal || window.__wwCalRedirect) { location.replace('/calmic.html?cal=' + (CAL.cal || '')); return; }   // 0.2.5: calibration links go to the mic-only page; never join here
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
    const name = h('input', { type: 'text', maxlength: 40, placeholder: 'e.g. Sam\'s phone', id: 'devname', value: deviceName() });
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
  ['scenes', '🎬', 'Scenes'], ['schedules', '⏰', 'Schedules'], ['tags', '🏷', 'Tag & cover fix', false, true], ['rip', '💿', 'CD ripper', false, true], ['remote', '🔐', 'Away-from-home', false, true],
  ['cleanup', '🧹', 'Tidy up library', false, true], ['diag', '🩺', 'Diagnostics', false, true], ['about', 'ℹ', 'About & credits']];
// NAV kept for page titles; phone hamburger uses createPhoneDrawerNav. 0.2.0 item 2: the "This phone as a device" page is gone.
const PAGE_TITLES = { playlists: 'Playlists', radio: 'Internet radio', devices: 'Devices & zones', cleanup: 'Tidy up library', diag: 'Diagnostics', about: 'About WavWiz', scenes: 'Scenes', schedules: 'Schedules', finder: 'Radio finder', tags: 'Tag & cover fix', rip: 'CD ripper', remote: 'Away-from-home access' };
const views = {};
let desk, drawerEl, tabs, nowc, devv, devp, listt, libC, libpanel, statusbar, content, navButtons = [], pageDlg = null;

async function startMain() {
  const connDot = h('span', { class: 'dot', id: 'conn' }), connTxt = h('span', { id: 'conntxt', class: 'small dim' }, 'Connecting…');
  const control = canControl(S);
  const ctl = { act, refreshAll, go, openSetup, openEq: () => openEq(S, refreshAll), checklistGo, pill: roomPill, saveQueue, toggleLib: f => toggleLib(f), toggleLibExpanded: f => toggleLibExpanded(f), toggleDev: f => toggleDev(f), toggleDevExpanded: f => toggleDevExpanded(f), setDevSize: (sz, hl) => setDevSize(sz, hl), toggleList: f => toggleList(f), libCollapsed: () => desk?.classList.contains('libcollapsed'), devCollapsed: () => desk?.classList.contains('devcollapsed') };
  nowc = createNow(S, ctl); devv = devicesView(S, ctl); devp = devicesPanel(S, ctl); listt = listTable(S, ctl);
  views.library = libraryView(S); views.playlists = playlistsView(S); views.cleanup = cleanupView(S); views.diag = diagnosticsView(S);
  views.queue = { el: h('div', { id: 'p-list' }), reload: drawQueue }; views.radio = { el: h('div', { id: 'p-radio' }), reload: drawRadio };
  views.scenes = scenesView(S); views.schedules = schedulesView(S); views.finder = radioFinderView(S, act); views.tags = tagsView(S); views.rip = ripView(S); views.remote = remoteView(S);
  views.devices = { el: devv.el, reload: () => devv.draw() }; views.about = { el: h('div', { id: 'p-about' }), reload: () => openAboutInto(views.about.el) };
  libC = libraryView(S, { compact: true });
  content = h('main', { class: 'view', id: 'view', tabindex: -1 });
  S.view = wide() ? 'library' : 'now';

  const hamburger = h('button', { class: 'iconbtn hamburger', 'aria-label': 'Menu', 'aria-expanded': 'false', onclick: () => toggleDrawer(true) }, '☰');
  const menubar = createMenuBar(S, { go, refreshAll, act, openSetup, toggleLib: f => toggleLib(f), toggleLibExpanded: f => toggleLibExpanded(f), toggleDev: f => toggleDev(f), toggleDevExpanded: f => toggleDevExpanded(f), setDevSize: (sz, hl) => setDevSize(sz, hl), toggleList: f => toggleList(f) });
  const inline = h('nav', { class: 'navwide', 'aria-label': 'Sections' }, [['playlists', 'Playlists'], ['radio', 'Radio'], ['scenes', 'Scenes'], ['devices', 'Devices & zones']].map(([k, t]) => h('button', { class: 'iconbtn', 'data-k': k, onclick: () => go(k) }, t)),
    control ? h('button', { class: 'iconbtn', onclick: () => openCalibration(S, refreshAll) }, '🎤 Calibrate') : null, h('button', { class: 'iconbtn', onclick: () => openEq(S, refreshAll) }, '🎚 Sound'), h('button', { class: 'iconbtn', onclick: () => openSettings(S, refreshAll, go) }, '⚙ Settings'));
  const bar = topbar([menubar, adminChip(S), h('span', { class: 'conn row', style: 'gap:6px' }, connDot, connTxt), inline], hamburger);
  // 0.2.0 item 31: a role change redraws in place (menus refill themselves); the speaker and the music keep going
  window.addEventListener('wavwiz:auth', () => { drawerEl?.remove(); drawerEl = buildDrawer(); document.body.append(drawerEl); refreshAll(); nowc.draw?.(); devv.draw(); devp.draw(); });

  const libC0 = localStorage.getItem('wavwiz.libcollapsed') === '1';
  const colBtn = h('button', { class: 'plus libcol', 'aria-label': arrowLabel('Library', libC0 ? 'collapsed' : 'standard'), 'aria-expanded': String(!libC0), title: 'Collapse / open the Library panel', onclick: () => toggleLib() }, libC0 ? '›' : '‹');
  // 0.2.0 item 16: Expand button top-right of the Library header (the collapse arrow moves one slot left); the same button or Esc returns.
  const expBtn = h('button', { class: 'plus libexp', 'aria-label': expandLabel('Library', false), 'aria-pressed': 'false', title: 'Expanded library (Esc returns)', onclick: () => toggleLibExpanded() }, icon(expandIcon('left', false)));
  const escHint = h('span', { class: 'eschint small dim', 'aria-hidden': 'true' }, 'Esc');
  libpanel = h('section', { class: 'libpanel', 'aria-label': 'Library' }, h('div', { class: 'pane-h' }, h('span', { class: 'libtitle' }, 'LIBRARY'), h('span', { class: 'grow' }), escHint, colBtn, expBtn), h('div', { class: 'libbody' }, libC.el));
  statusbar = h('footer', { class: 'statusbar', 'aria-label': 'Status' });
  const dsz = loadDevSize();
  desk = h('div', { class: 'desk' + (localStorage.getItem('wavwiz.libcollapsed') === '1' ? ' libcollapsed' : '') + (dsz === 'collapsed' ? ' devcollapsed' : dsz === 'expanded' ? ' devexpanded' : '') + (localStorage.getItem('wavwiz.listcollapsed') === '1' ? ' listcollapsed' : ''), id: 'desk', 'data-view': S.view }, libpanel, content, nowc.el, devp.el, listt.el, nowc.npbar);
  listt.setCollapsed?.(desk.classList.contains('listcollapsed'));
  wireNextBlock();
  tabs = h('nav', { class: 'tabbar', 'aria-label': 'Sections' }, [['now', '♪', 'Now'], ['library', '☰', 'Library'], ['devices', '◉', 'Devices']].map(([k, ic, t]) => h('button', { 'data-k': k, onclick: () => go(k) }, h('b', null, ic), t)));
  drawerEl = buildDrawer();
  app.replaceChildren(bar, desk, statusbar, nowc.mini, tabs); document.body.append(drawerEl);
  window.addEventListener('resize', () => { if (wide() && S.view === 'now') go('library'); });
  window.addEventListener('keydown', ev => { if (ev.key === 'Escape') { toggleDrawer(false); if (!document.querySelector('dialog[open],.sheet,.dlg')) { if (desk.classList.contains('libexpanded')) toggleLibExpanded(false); else if (desk.classList.contains('devexpanded')) toggleDevExpanded(false); } } });
  if (loadLibPrefs().expanded && wide()) toggleLibExpanded(true);
  connectWs(); go(S.view, true); libC.reload();
  await refreshAll();
  drawStatus(); maybeWhatsNew(S);
  // 0.2.5: the Player tray's "Calibrate speakers..." opens this page with #calibrate
  const hashCal = () => { if (location.hash === '#calibrate') { history.replaceState(null, '', location.pathname + location.search); if (canControl(S)) openCalibration(S, refreshAll); } };
  hashCal(); window.addEventListener('hashchange', hashCal);
  setInterval(() => nowc.tickPos(), 250);
  installAutoJoin(S, refreshAll);           // 0.2.0 item 1: every browser (not the Player window) joins as a speaker
  setTimeout(() => maybeAutoSetup(), 900);   // 0.2.0 item 24: first run opens Getting started by itself
}
/** Library arrow (0.2.2 T5, same rule as Devices): while Expanded it first returns to the normal layout; otherwise it collapses / opens. */
function toggleLib(force) {
  const exp = desk.classList.contains('libexpanded');
  if (force === undefined && exp) { toggleLibExpanded(false); return; }
  const c = force ?? !desk.classList.contains('libcollapsed');
  if (c && exp) toggleLibExpanded(false);
  desk.classList.toggle('libcollapsed', c); try { localStorage.setItem('wavwiz.libcollapsed', c ? '1' : '0'); } catch { /* ignore */ }
  paintLibArrow(); if (!c) libC.reload();
}
function paintLibArrow() {
  const c = desk.classList.contains('libcollapsed'), x = desk.classList.contains('libexpanded'), b = libpanel.querySelector('.libcol');
  b.textContent = c ? '›' : '‹'; b.setAttribute('aria-expanded', String(!c)); b.setAttribute('aria-label', arrowLabel('Library', c ? 'collapsed' : x ? 'expanded' : 'standard'));
}
/** 0.1.1: the bottom Playlist slides down to its header strip (Library > Playlist toggles it on desktop); saved per device. */
/** 0.2.3 U2: with the Playlist minimized, its title bar shows "Up next: Title · Artist" centered on the Now Playing column (the line
 *  shrinks, never running into PLAYLIST or the count / Save / Clear / arrow on the right). The Now Playing song stays on its own bar (U1). */
let placeNext = () => {};
function wireNextBlock() {
  const nb = nowc.nextBlock; if (!nb || !listt.setNextBlock) return;
  listt.setNextBlock(nb);
  let raf = 0;
  const place = () => {
    raf = 0;
    desk.classList.toggle('npcollapsed', nowc.ctlPanel.classList.contains('collapsed'));
    const on = desk.classList.contains('listcollapsed') && !window.matchMedia('(max-width:900px)').matches;
    nb.hidden = !on;
    if (!on || !desk.isConnected) return;
    const col = nowc.ctlPanel.getBoundingClientRect(), hd = listt.head.getBoundingClientRect();
    if (!col.width) return;
    const c = col.left + col.width / 2, room = Math.min(c - (listt.leftEdge() + 16), listt.rightEdge() - 16 - c);
    nb.style.left = Math.round(c - hd.left) + 'px'; nb.style.maxWidth = Math.max(0, Math.round(room * 2)) + 'px';
    nb.classList.toggle('tight', room * 2 < 300); nb.hidden = room * 2 < 110;
  };
  const later = () => { if (!raf) raf = requestAnimationFrame(place); };
  placeNext = () => { later(); setTimeout(later, 360); };
  const ro = new ResizeObserver(later); ro.observe(nowc.ctlPanel); ro.observe(listt.head); ro.observe(desk);
  window.addEventListener('resize', later); window.addEventListener('wavwiz:npcollapsed', placeNext); window.addEventListener('wavwiz:upnext', later);
  new MutationObserver(ms => { if (ms.some(m => !nb.contains(m.target))) later(); }).observe(listt.head, { childList: true, subtree: true, characterData: true });
  later();
}
function toggleList(force) { const c = force ?? !desk.classList.contains('listcollapsed'); desk.classList.toggle('listcollapsed', c); try { localStorage.setItem('wavwiz.listcollapsed', c ? '1' : '0'); } catch { /* ignore */ } listt.setCollapsed?.(c); placeNext(); if (!c) setTimeout(() => listt.relayout?.(), 340); }
/** 0.2.0 item 27 / 0.2.1 F1: the Devices panel is Collapsed (46 px strip) / Standard / Expanded (card grid over the Now Playing column, with
 * the full-width Now Playing bar). Like the Library: the arrow (and Devices > Devices & zones) collapses / opens it; toggleDev(true/false)
 * forces collapsed / open. The separate Expand button (toggleDevExpanded) switches the wide view; Esc returns. */
function toggleDev(force) {
  if (force === true) return setDevSize('collapsed');
  if (force === false) return setDevSize(devp.size === 'collapsed' ? 'standard' : devp.size);
  setDevSize(arrowSize(devp.size));
}
function toggleDevExpanded(force) {
  const on = force ?? devp.size !== 'expanded';
  setDevSize(on ? 'expanded' : (devp.size === 'expanded' ? 'standard' : devp.size));
}
function setDevSize(sz, highlight = null) {
  if (sz !== 'collapsed' && desk.classList.contains('libexpanded')) toggleLibExpanded(false);
  desk.classList.toggle('devcollapsed', sz === 'collapsed'); desk.classList.toggle('devexpanded', sz === 'expanded');
  saveDevSize(sz); devp.setSize(sz, highlight); setTimeout(() => nowc.viz?.resize?.(), 340);
}
/** 0.2.0 item 16: the Expanded library covers the Library + Now Playing columns and the Playlist row; Devices folds to its 46 px strip and
 * Now Playing becomes the full-width mini bar. Saved per browser; the same button or Esc returns. */
function toggleLibExpanded(force) {
  const on = force ?? !desk.classList.contains('libexpanded');
  if (on && desk.classList.contains('devexpanded')) setDevSize('standard');
  if (on && desk.classList.contains('libcollapsed')) toggleLib(false);
  desk.classList.toggle('libexpanded', on);
  const b = libpanel.querySelector('.libexp'); setIcon(b, expandIcon('left', on)); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', expandLabel('Library', on)); paintLibArrow();
  libC.setExpanded(on); setTimeout(() => nowc.viz?.resize?.(), 340);
}

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
  const nav = createPhoneDrawerNav(S, { go, refreshAll, act, openSetup }, { onClose: () => toggleDrawer(false), versionLabel: VERSION_LABEL() });
  return h('div', { class: 'drawer', id: 'drawer', role: 'dialog', 'aria-label': 'Menu' }, h('div', { class: 'scrim', onclick: () => toggleDrawer(false) }), nav);
}
function toggleDrawer(open) { drawerEl.classList.toggle('open', open); document.querySelector('.hamburger')?.setAttribute('aria-expanded', String(open)); if (open) drawerEl.querySelector('nav button')?.focus(); }

export function go(k, force) {
  if (k?.startsWith?.('settings:')) return openSettings(S, refreshAll, go, k.slice(9));
  if (k === 'zones' || k === 'rooms') k = 'devices';
  // 0.2.1 F8: Theme and Visualizer live on Settings > Appearance (one home); Radio finder is a tab inside Internet radio
  if (k === 'themes' || k === 'visualizer') return openSettings(S, refreshAll, go, k === 'themes' ? 'theme' : 'viz');
  if (k === 'finder') { radioTab = 'finder'; k = 'radio'; } else if (k === 'radio') radioTab = 'mine';
  if (wide()) {                               // desktop layout: Now Playing, Library, Devices & Playlist are always on screen; the rest opens as a page
    if (k === 'now') return;
    if (k === 'library') { toggleLib(false); libC.reload(); if (!force) libC.el.querySelector('input[type=search]')?.focus(); return; }
    if (k === 'devices') { if (pageDlg) { pageDlg.close(); pageDlg = null; } toggleDevExpanded(true); return; }   // 0.2.2 T8: same as Menu > Devices & zones
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
async function refreshStatus() { try { S.status = await api('/status'); } catch (e) { handleErr(e); } try { const c = await api('/checklist'); S.setupLeft = c.dismissed || checklistDismissedLocal() ? 0 : c.remaining; } catch { S.setupLeft = 0; } drawStatus(); }
async function refreshRadio() { try { S.radio = await api('/radio'); if ((S.view === 'radio' || S.page === 'radio') && radioTab === 'mine') drawRadio(); } catch (e) { handleErr(e); } }
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
      else if (m.type === 'favorites') window.dispatchEvent(new CustomEvent('wavwiz:favorites'));   // 0.2.0 item 14
      else if (m.type === 'library') { refreshStatus(); window.dispatchEvent(new CustomEvent('wavwiz:library')); nowc.drawChecklist(); }
      else if (m.type === 'tick') { if (S.now?.state === 'playing') refreshNow(); if (S.view === 'devices' || wide() || S.view === 'now') refreshZones(); }
      else if (m.type === 'notice') toast(m.data.message, true);
      else if (m.type === 'calphone') window.dispatchEvent(new CustomEvent('wavwiz:calphone', { detail: m.data }));   // 0.2.2 T9
      else if (m.type === 'calrun' || m.type === 'miclevel' || m.type === 'calmics') window.dispatchEvent(new CustomEvent('wavwiz:' + m.type, { detail: m.data }));   // 0.2.5 PC-mic run, live mic level, calibration-mic list
      else if (m.type === 'art') { artPushed(m.data); window.dispatchEvent(new CustomEvent('wavwiz:art', { detail: m.data })); }   // 0.2.2 T4b
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
    // 0.2.2 T10: the top-right indicator is the one home of "Connected"; the status bar speaks up only when the connection drops
    S.connected === false ? h('span', { class: 'sb sbconn', role: 'status' }, h('span', { class: 'dot bad' }), 'Reconnecting…') : null,
    h('span', { class: 'sb' }, `${online} of ${S.zones.length} device${S.zones.length === 1 ? '' : 's'} online`),
    h('span', { class: 'sb' }, playing ? `Playing on ${act_ ? 'zone “' + act_.name + '”' : on.length + ' device' + (on.length === 1 ? '' : 's')}` : (S.now?.state === 'paused' ? 'Paused' : 'Stopped')),
    bad.length ? h('span', { class: 'sb warn', title: bad.map(z => `${z.name}: ${z.room.text}`).join('\n') }, '⚠ ' + bad.map(z => `${z.name} ${z.room.state}`).join(', ')) : null,
    h('span', { class: 'grow' }), tracks != null ? h('span', { class: 'sb' }, `${tracks} song${tracks === 1 ? '' : 's'} in the library`) : null,
    S.setupLeft ? h('button', { class: 'sb link', onclick: () => openSetup() }, `Getting started: ${S.setupLeft} to go`) : null,
    h('button', { class: 'sb link', onclick: () => go('about'), title: 'About, credits and licenses' }, `WavWiz BETA ${S.auth?.appVersion ?? ''}`));
}
/** 0.2.0 items 11 + 24: the one Getting started dialog (Help > Getting started, the status-bar link, and first run). */
let setupDlg = null;
async function openSetup() {
  if (setupDlg) return;
  const { gettingStartedBody } = await import('./diag.js');
  const ref = { close: () => setupDlg?.close() };
  const body = await gettingStartedBody(S, a => go(a), ref);
  setupDlg = dialog('Getting started', body, [{ text: 'Close' }], { cls: 'gsdlg', onClose: () => { setupDlg = null; refreshStatus(); } });
}
async function maybeAutoSetup(tries = 0) {
  if (S.page || document.querySelector('dialog[open]')) { if (tries < 60) setTimeout(() => maybeAutoSetup(tries + 1), 2000); return; }   // never on top of What's new or another dialog: wait for it
  const { shouldAutoOpenSetup } = await import('./diag.js');
  let c = null; try { c = await api('/checklist'); } catch { return; }
  let shown = false; try { shown = localStorage.getItem('wavwiz.gettingStarted.shown') === '1'; } catch { /* ignore */ }
  if (!shouldAutoOpenSetup(c, checklistDismissedLocal(), shown)) return;
  try { localStorage.setItem('wavwiz.gettingStarted.shown', '1'); } catch { /* ignore */ }
  openSetup();
}

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
// 0.2.1 F8: Internet radio has two tabs - My stations and Radio finder (the finder is no longer its own page or menu item)
let radioTab = 'mine';
function drawRadio() {
  const root = views.radio.el;
  const tabsEl = h('div', { class: 'tabs radiotabs', role: 'tablist', 'aria-label': 'Internet radio' }, [['mine', 'My stations'], ['finder', 'Radio finder']].map(([k, t]) =>
    h('button', { role: 'tab', class: radioTab === k ? 'on' : '', 'aria-selected': String(radioTab === k), 'data-rtab': k, onclick: () => { if (radioTab !== k) { radioTab = k; drawRadio(); } } }, t)));
  const host = h('div', { class: 'radiotab' });
  root.replaceChildren(h('h2', { style: 'margin:0 0 10px' }, '📻 Internet radio'), tabsEl, host);
  if (radioTab === 'finder') { host.append(views.finder.el); views.finder.reload?.(); return; }
  drawStations(host);
}
function drawStations(root) {
  const can = canControl(S);
  const url = h('input', { type: 'url', placeholder: 'https://… stream address', class: 'grow' }), name = h('input', { type: 'text', placeholder: 'Station name', maxlength: 80 });
  root.replaceChildren(
    ...S.radio.map(r => h('div', { class: 'row card' }, h('button', { class: 'iconbtn', 'aria-label': 'Favorite', onclick: () => act(`/radio/${r.id}`, { favorite: !r.favorite }, 'PUT').then(refreshRadio) }, r.favorite ? '★' : '☆'),
      h('div', { class: 'grow', style: 'min-width:0' }, h('b', { class: 'ell', style: 'display:block' }, r.name), h('div', { class: 'dim small ell' }, r.genre ?? r.url.replace(/^https?:\/\//, '').slice(0, 40))),
      can ? [h('button', { class: 'btn primary', 'aria-label': 'Play', onclick: () => act('/stream/play', { kind: 'radio', id: r.id }) }, '▶'), h('button', { class: 'btn danger', 'aria-label': 'Delete', onclick: () => act(`/radio/${r.id}`, undefined, 'DELETE').then(refreshRadio) }, '✕')] : null)),
    S.radio.length ? null : h('p', { class: 'dim' }, 'No stations yet. Add one below, or find one on the Radio finder tab.'),
    can ? h('div', { class: 'card' }, h('h3', null, 'Add a station'), h('div', { class: 'field' }, name), h('div', { class: 'row' }, url, h('button', { class: 'btn', onclick: async () => { try { await api('/radio', { method: 'POST', body: { name: name.value, url: url.value } }); refreshRadio(); } catch (e) { toast(e.message, true); } } }, 'Add')),
      h('p', { class: 'dim small' }, 'Use the stream address (an .mp3/.aac/.m3u8 link or a .pls/.m3u playlist). Plain http:// streams are fine on your home network.')) : null);
}

boot();
