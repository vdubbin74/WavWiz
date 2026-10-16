import './sliderstyle.js';   // 0.3.3 G11
import './pwa.js';   // 0.3.4 H1
import { h, api, toast, fmtDur, dialog, ApiError } from './util.js';
import { clearQueueFlow } from './queueclear.js';
import { applyTheme, loadTheme } from './theme.js';
import { openSettings } from './settings.js';
import { openCalibration } from './calibrate.js';
import { openEq } from './eq.js';
import { createNow } from './now.js';
import { editZone, devicesView, devicesPanel, expandLabel, expandIcon, paintExpandBtn } from './devices.js';
import { listTable } from './listtable.js';
import { icon, setIcon, setChev } from './icons.js';
import { attachReorder, canDragRows } from './qreorder.js';
import { loadLayout, saveLayout, setLocked } from './plcols.js';
import { listenFromMini, pinToggle, loadPins, pinInfo, MAX_PINS } from './shortcuts.js';
import { GLIDE, glide, pulse, pulseSel, reduced } from './motion.js';
import { brandMark } from './brand.js';
import { createMenuBar, createPhoneDrawerNav } from './menu.js';
import { loadPanels, savePanels, normPanels, shown, chevron, railClick, expand, effective, chevronGlyph, chevronDir, chevronLabel, keyAction, listStep, centerWidthFor, centerPopupWidth, popupWidth } from './panels.js';
import { installAutoJoin, deviceName, stopPhoneDevice, startPhoneAsDevice, defaultRoomName, unlockAudio } from './room.js';
import { retireRemote } from './remotemode.js';
import { installTvMode } from './tv.js';
import { adminChip, refreshAuth } from './elevate.js';
import { liveSocket } from './wsconn.js';
import { openAbout, maybeWhatsNew } from './about.js';
import { libraryView } from './library.js';
import { artPushed, setArtCv } from './art.js';
import { playlistsView } from './playlists.js';
import { cleanupView } from './cleanup.js';
import { diagnosticsView, roomPill, checklistDismissedLocal } from './diag.js';
import { canControl, thisDevice, isAdmin } from './ui.js';
import { isPlayerUa } from './phonejoin.js';
import { openScenesSchedules, showAlarm, sleepChip } from './scenesched.js';
import { startJukebox, jukeboxChip, openKiosk, askStopJukebox, jukeboxRunning } from './jukebox-kiosk.js';
import { radioFinderView } from './radiofinder.js';
import { radioTab } from './radiotab.js';
import { tagsView } from './tags.js';
import { ripView } from './rip.js';
import { remoteView } from './remote.js';
import { whenIdle, installSliderGuard } from './slider.js';
import { mountMini } from './mini.js';
import { newKindForKey, isTypingTarget } from './menusub.js';
import { showPendingUndo } from './backupflow.js';

applyTheme(loadTheme());          // the "Default" theme unless this device picked something else
installTvMode();                  // 0.2.0 item 1: TVs and ?lite get the lightweight, remote-friendly Now Playing

export const S = { auth: null, now: null, queue: [], zones: [], groups: [], radio: [], status: null, view: null, ws: null, localPos: 0, localAt: 0 };
const app = document.getElementById('app');
const VERSION_LABEL = () => `BETA ${S.auth?.appVersion ?? ''}`.trim();
const wide = () => !matchMedia('(max-width:900px)').matches;

// ---------------------------------------------------------------- boot
// 0.2.2 T9 / 0.2.5: a phone arriving with ?cal=CODE (the PC's calibration QR code) is sent to the mic-only page /calmic.html (see calredirect.js)
/** 0.3.7 L28: the Pair a player QR opens /?pair=123456 -> the code box is filled in (never signs in by itself; calibration links are unaffected). */
const PAIR_PREFILL = (() => { try { const q = new URLSearchParams(location.search); const p = q.get('pair') || ''; return !q.get('cal') && /^[0-9]{6}$/.test(p) ? p : ''; } catch { return ''; } })();
const CAL = (() => { try { const q = new URLSearchParams(location.search), cal = q.get('cal') || '', pair = q.get('pair') || ''; return { cal: /^[A-Za-z0-9]{6}$/.test(cal) ? cal : null, pair: /^[0-9]{6}$/.test(pair) ? pair : null }; } catch { return { cal: null, pair: null }; } })();
async function boot() {
  if (CAL.cal || window.__wwCalRedirect) { location.replace('/calmic.html?cal=' + (CAL.cal || '')); return; }   // 0.2.5: calibration links go to the mic-only page; never join here
  try { S.auth = await api('/auth/state'); } catch (e) { return fatal(e.message); }
  setArtCv(S.auth.artCv);   // 0.3.2 F10
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
    const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '6-digit code', id: 'code', value: PAIR_PREFILL });
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
  ['scenes', '🎬', 'Scenes & Schedules'], ['tags', '🏷', 'Tag & cover fix', false, true], ['rip', '💿', 'CD ripper', false, true], ['remote', '🔐', 'Away-from-home', false, true],
  ['cleanup', '🧹', 'Tidy up library', false, true], ['diag', '🩺', 'Diagnostics', false, true], ['about', 'ℹ', 'About & credits']];
// NAV kept for page titles; phone hamburger uses createPhoneDrawerNav. 0.2.0 item 2: the "This phone as a device" page is gone.
const PAGE_TITLES = { playlists: 'Playlists', radio: 'Internet radio', devices: 'Devices & zones', cleanup: 'Tidy up library', diag: 'Diagnostics', about: 'About WavWiz', scenes: 'Scenes & Schedules', finder: 'Radio finder', tags: 'Tag & cover fix', rip: 'CD ripper', remote: 'Away-from-home access' };
const views = {};
let desk, drawerEl, tabs, nowc, devv, devp, listt, libC, libpanel, statusbar, content, navButtons = [], pageDlg = null, minicol = null, miniInst = null;
/** 0.3.6 K14 / K22: the real mini player lives in the right-hand column while the Library or the Playlist is expanded (and is not running otherwise). */
function syncMini() {
  if (!desk || !minicol) return;
  const need = wide() && (desk.classList.contains('libexpanded') || (desk.classList.contains('listexpanded') && !desk.classList.contains('devexpanded')));
  if (need && !miniInst) { const host = minicol.querySelector('.embedded-host'); miniInst = mountMini(host, { embedded: true, run: runShortcut, home: goHome }); minicol.append(miniInst.rail); }
  else if (!need && miniInst) { miniInst.destroy(); miniInst = null; minicol.replaceChildren(h('div', { class: 'mp embedded-host' })); }
  desk.classList.toggle('minishown', need);
}

async function startMain() {
  installSliderGuard(document);     // 0.3.0 §9/§7.8: drag-safe sliders + wheel fine-tune everywhere
  const connDot = h('span', { class: 'dot', id: 'conn' }), connTxt = h('span', { id: 'conntxt', class: 'small dim' }, 'Connecting…');
  const control = canControl(S);
  const ctl = { act, refreshAll, go, openSetup, openEq: () => showEq(), runShortcut: id => runShortcut(id), goHome: () => goHome(), checklistGo, pill: roomPill, saveQueue, toggleLib: f => toggleLib(f), toggleLibExpanded: f => toggleLibExpanded(f), toggleDev: f => toggleDev(f), toggleDevExpanded: f => toggleDevExpanded(f), setDevSize: (sz, hl) => setDevSize(sz, hl), toggleList: f => toggleList(f), listStep: d => listStepUi(d), libCollapsed: () => desk?.classList.contains('libcollapsed'), devCollapsed: () => desk?.classList.contains('devcollapsed'), libSwap: v => libSwap(v) };
  nowc = createNow(S, ctl); devv = devicesView(S, ctl); devp = devicesPanel(S, ctl); listt = listTable(S, ctl);
  views.library = libraryView(S); views.playlists = playlistsView(S); views.cleanup = cleanupView(S); views.diag = diagnosticsView(S);
  views.queue = { el: h('div', { id: 'p-list' }), reload: drawQueue }; views.radio = radioTab(S, act);   // 0.3.5 J9: one Radio page (stations + finder)
  views.finder = radioFinderView(S, act); views.tags = tagsView(S); views.rip = ripView(S); views.remote = remoteView(S);
  views.devices = { el: devv.el, reload: () => devv.draw() }; views.about = { el: h('div', { id: 'p-about' }), reload: () => openAboutInto(views.about.el) };
  // 0.3.5 J9: the desktop Library panel hosts Playlists, Radio and (expanded) the tools as tabs
  libC = libraryView(S, { compact: true, extras: { playlists: playlistsView(S), radio: radioTab(S, act), rip: ripView(S), tags: tagsView(S), cleanup: cleanupView(S) } });
  content = h('main', { class: 'view', id: 'view', tabindex: -1 });
  S.view = wide() ? 'library' : 'now';

  const hamburger = h('button', { class: 'iconbtn hamburger', 'aria-label': 'Menu', 'aria-expanded': 'false', onclick: () => toggleDrawer(true) }, '☰');
  const menubar = createMenuBar(S, { go, refreshAll, act, openSetup, openMini, openQueue, openNew, jumpTo, openPlaylist, toggleLib: f => toggleLib(f), toggleLibExpanded: f => toggleLibExpanded(f), toggleDev: f => toggleDev(f), toggleDevExpanded: f => toggleDevExpanded(f), setDevSize: (sz, hl) => setDevSize(sz, hl), toggleList: f => toggleList(f) });
  const inline = h('nav', { class: 'navwide', 'aria-label': 'Sections' }, [['playlists', 'Playlists'], ['radio', 'Radio'], ['scenes', 'Scenes & Schedules'], ['devices', 'Devices & zones']].map(([k, t]) => h('button', { class: 'iconbtn', 'data-k': k, onclick: () => go(k) }, t)),
    control ? h('button', { class: 'iconbtn', onclick: () => openCalibration(S, refreshAll) }, '🎤 Calibrate') : null, h('button', { class: 'iconbtn', onclick: () => showEq() }, '🎚 Sound'), h('button', { class: 'iconbtn', onclick: () => openSettings(S, refreshAll, go) }, '⚙ Settings'));
  const bar = topbar([menubar, adminChip(S), h('span', { class: 'conn row', style: 'gap:6px' }, connDot, connTxt), inline], hamburger);
  // 0.2.0 item 31: a role change redraws in place (menus refill themselves); the speaker and the music keep going
  window.addEventListener('wavwiz:auth', () => { drawerEl?.remove(); drawerEl = buildDrawer(); document.body.append(drawerEl); refreshAll(); nowc.draw?.(); devv.draw(); devp.draw(); });

  // 0.3.0 §6: one panel state (rail · normal · expanded), one key, two controls per header kept apart: chevron on the outer edge, expand on the inner edge
  P6 = loadPanels();
  const colBtn = h('button', { class: 'plus libcol pchev', 'aria-label': chevronLabel(P6, 'lib'), 'aria-expanded': 'true', title: 'Fold / open the Library panel ( [ )', onclick: ev => { ev.stopPropagation(); setPanels(chevron(P6, 'lib'), 'lib'); } }); setChev(colBtn, 'l');
  const expBtn = h('button', { class: 'plus libexp pexp', 'aria-label': expandLabel('Library', false), 'aria-pressed': 'false', title: 'Expand', onclick: ev => { ev.stopPropagation(); setPanels(expand(P6, 'lib'), 'lib'); } }, icon(expandIcon('left', false)));
  const libRail = h('div', { class: 'prail', 'aria-hidden': 'true' }, h('span', { class: 'prail-ic' }, '♫'), h('span', { class: 'prail-t' }, 'LIBRARY'), h('span', { class: 'prail-n', title: 'Songs in the library' }));
  libpanel = h('section', { class: 'libpanel', 'aria-label': 'Library' }, libRail, h('div', { class: 'pane-h' }, colBtn, h('span', { class: 'libtitle' }, 'LIBRARY'), h('span', { class: 'grow' }), expBtn), h('div', { class: 'libbody' }, libC.el));
  libpanel.addEventListener('click', ev => { if (libpanel.classList.contains('israil') && !ev.target.closest('button:not(.libpanel)')) setPanels(railClick(P6, 'lib'), 'lib'); });
  libpanel.addEventListener('dragenter', () => { if (libpanel.classList.contains('israil')) setPanels(railClick(P6, 'lib'), 'lib'); });
  statusbar = h('footer', { class: 'statusbar', 'aria-label': 'Status' });
  minicol = h('section', { class: 'minicol', 'aria-label': 'Mini player' }, h('div', { class: 'mp embedded-host' }));
  desk = h('div', { class: 'desk' + (P6.list === 'collapsed' ? ' listcollapsed' : P6.list === 'expanded' ? ' listexpanded' : ''), id: 'desk', 'data-view': S.view }, libpanel, content, nowc.el, devp.el, listt.el, nowc.npbar, minicol);
  desk.addEventListener('transitionend', ev => { if (ev.target === desk && /grid-template/.test(ev.propertyName)) { nowc.viz?.resize?.(); placeNext(); } });   // §6: the viz resizes once the move has finished
  listt.setCollapsed?.(P6.list);
  wireNextBlock();
  tabs = h('nav', { class: 'tabbar', 'aria-label': 'Sections' }, [['now', '♪', 'Now'], ['library', '☰', 'Library'], ['devices', '◉', 'Devices']].map(([k, ic, t]) => h('button', { 'data-k': k, onclick: () => go(k) }, h('b', null, ic), t)));
  drawerEl = buildDrawer();
  app.replaceChildren(bar, desk, statusbar, nowc.mini, tabs); document.body.append(drawerEl);
  window.addEventListener('resize', () => { if (wide() && S.view === 'now') go('library'); applyPanels(); });
  window.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') toggleDrawer(false);
    const nk = !document.querySelector('dialog[open],.sheet,.dlg,.jb') && newKindForKey(ev, isTypingTarget(ev.target)); if (nk) { ev.preventDefault(); openNew(nk); return; }   // K17
    if (!wide() || document.querySelector('dialog[open],.sheet,.dlg,.jb')) return;
    const n = keyAction(P6, ev); if (n) { ev.preventDefault(); setPanels(n, ev.code === 'BracketRight' ? 'dev' : 'lib'); }
  });
  applyPanels(true);
  // 0.3.2 F8: every popup is as wide as the center panel (1140 px at 1920 wide); --centerw follows it on every layout change
  // 0.3.3 G1: measured from the live center column (getBoundingClientRect, converted back to CSS px under the Display size zoom) and used as
  // the popup max-width; re-measured on resize, on panel collapse / expand and on Display size changes - never a fixed 1140 px.
  // 0.3.5 J1: every popup and Settings has ONE fixed width = the center panel's standard width (both side panels open) on this screen.
  // It is worked out from the screen, not the window, so it never stretches or shrinks while the window is resized (only capped to fit).
  const centerW = () => { const z = Number(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1; const w = popupWidth(window.screen?.availWidth || 0, window.innerWidth, z); document.documentElement.style.setProperty('--centerw', w + 'px'); document.documentElement.style.setProperty('--popw', w + 'px'); };
  new ResizeObserver(centerW).observe(nowc.el); new ResizeObserver(centerW).observe(desk); window.addEventListener('resize', centerW); window.addEventListener('wavwiz:uiscale', centerW); desk.addEventListener('transitionend', centerW); centerW();
  // 0.3.7 L8: right-click a title bar (Library, Devices, Queue, the EQ) -> Pin / Unpin that destination as a shortcut
  document.addEventListener('contextmenu', ev => {
    const t = ev.target.closest?.('.libpanel .pane-h, .devpanel .pane-h, .listpanel .pane-h, .np-stage'); if (!t || ev.target.closest('input,textarea,.plpicker')) return;
    const id = t.closest('.libpanel') ? 'library' : t.closest('.devpanel') ? 'devices' : t.closest('.listpanel') ? 'queue' : 'eq';
    if (id === 'queue' && ev.target.closest('th')) return;
    ev.preventDefault(); document.querySelector('.scpop')?.remove();
    const on = loadPins().includes(id), lab = pinInfo(id).label;
    const pop = h('div', { class: 'scpop', role: 'menu' }, h('button', { type: 'button', class: 'btn sm', 'data-act': 'pin-title', onclick: () => { pop.remove(); const r = pinToggle(id); toast(r.full ? `All ${MAX_PINS} shortcut slots are taken - unpin one first.` : on ? `Unpinned: ${lab}` : `Pinned: ${lab}`, r.full); } }, on ? `Unpin “${lab}” from shortcuts` : `Pin “${lab}” to shortcuts`));
    document.body.append(pop); pop.style.left = Math.min(ev.clientX, innerWidth - 220) + 'px'; pop.style.top = Math.min(ev.clientY, innerHeight - 50) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function f(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', f, true); } }, true), 0);
  });
  listenFromMini(msg => { if (msg.home) goHome(); else if (msg.run) runShortcut(msg.run); });   // 0.3.7 L23: the standalone mini player's shortcuts
  connectWs(); go(S.view, true); libC.reload();
  await refreshAll();
  drawStatus(); maybeWhatsNew(S); showPendingUndo();
  api('/alarm').then(r => showAlarm(S, r.alarm)).catch(() => {}); api('/sleep').then(st => sleepChip(S, st)).catch(() => {});   // 0.3.0
  api('/jukebox').then(st => jukeboxChip(S, st)).catch(() => {});
  // 0.2.5: the Player tray's "Calibrate speakers..." opens this page with #calibrate
  const hashCal = () => {
    const hs = location.hash; if (!['#calibrate', '#jukebox', '#jukebox-stop'].includes(hs)) return;
    history.replaceState(null, '', location.pathname + location.search);
    if (hs === '#calibrate') { if (canControl(S)) openCalibration(S, refreshAll); }
    else if (hs === '#jukebox-stop' || (hs === '#jukebox' && jukeboxRunning())) askStopJukebox(S);   // 0.3.5 J15: tray Stop Jukebox...
    else startJukebox(S);                                                                           // 0.3.5 J15: tray Start Jukebox...
  };
  hashCal(); window.addEventListener('hashchange', hashCal);
  setInterval(() => nowc.tickPos(), 250);
  // 0.3.0 §2: remote mode (remembered per device) never joins as a speaker
  await retireRemote();      // 0.3.2 F3: Remote mode is gone - a remembered choice is cleared once and the speaker card comes back
  installAutoJoin(S, refreshAll);           // 0.2.0 item 1: every browser (not the Player window) joins as a speaker (F2: exactly one stream)
  setTimeout(() => maybeAutoSetup(), 900);   // 0.2.0 item 24: first run opens Getting started by itself
}
/** 0.3.0 §6: the menu / tray API keeps its names; everything goes through one state (P6) and one applyPanels(). */
function toggleLib(force) { if (force === true) return setPanels({ ...P6, lib: 'rail', exp: P6.exp === 'lib' ? null : P6.exp }, 'lib'); if (force === false) return setPanels(railClick(P6, 'lib'), 'lib'); setPanels(chevron(P6, 'lib'), 'lib'); }
function toggleLibExpanded(force) { if (force === true && P6.exp === 'lib') { pulse(libpanel); return; }   // K15: already open -> pulse it
  setPanels(expand(P6, 'lib', force ?? P6.exp !== 'lib'), 'lib'); }
function toggleDev(force) { if (force === true) return setPanels({ ...P6, dev: 'rail', exp: P6.exp === 'dev' ? null : P6.exp }, 'dev'); if (force === false) return setPanels(railClick(P6, 'dev'), 'dev'); setPanels(chevron(P6, 'dev'), 'dev'); }
function toggleDevExpanded(force) { if (force === true && P6.exp === 'dev') { pulse(devp.el); return; }   // K15
  setPanels(expand(P6, 'dev', force ?? P6.exp !== 'dev'), 'dev'); }
/** 0.3.5 J11 (option A): with the Library expanded the right column shows the playlist; "Devices ›" swaps the Devices panel in, "‹ Playlist" back. */
function libSwap(v) { if (!desk) return; desk.classList.toggle('libdev', !!v); devp.setSize(v ? 'standard' : (desk.classList.contains('devcollapsed') ? 'collapsed' : 'standard')); listt.relayout?.(); }
function setDevSize(sz, highlight = null) { devHl = highlight; setPanels(sz === 'expanded' ? expand(P6, 'dev', true) : sz === 'collapsed' ? { ...P6, dev: 'rail', exp: P6.exp === 'dev' ? null : P6.exp } : { ...P6, dev: 'normal', exp: P6.exp === 'dev' ? null : P6.exp }, 'dev'); }
let P6 = null, lastOpened = null, devHl = null, libWasExp = false;
function setPanels(n, opened = null) { P6 = savePanels(normPanels(n)); lastOpened = opened; applyPanels(); }
/** Paint the layout for this width (auto-rail is applied here only, never saved). */
function applyPanels(first = false) {
  if (!desk) return;
  const e = effective(P6, window.innerWidth, { opened: lastOpened }), ls = shown(e, 'lib'), ds = shown(e, 'dev');
  desk.classList.toggle('libcollapsed', ls === 'rail'); desk.classList.toggle('libexpanded', ls === 'expanded');
  desk.classList.toggle('devcollapsed', ds === 'rail'); desk.classList.toggle('devexpanded', ds === 'expanded');
  desk.classList.toggle('autorail', !!e.auto);
  libpanel.classList.toggle('israil', ls === 'rail'); libpanel.title = ls === 'rail' ? 'Open the Library panel ( [ )' : '';
  const b = libpanel.querySelector('.libcol'); setChev(b, chevronDir(e, 'lib')); b.setAttribute('aria-expanded', String(ls !== 'rail')); b.setAttribute('aria-label', chevronLabel(e, 'lib'));
  paintExpandBtn(libpanel.querySelector('.libexp'), 'Library', ls === 'expanded');   // 0.3.1 B4/B6
  if (ls !== 'expanded') desk.classList.remove('libdev');   // 0.3.5 J11
  devp.setSize(desk.classList.contains('libdev') ? 'standard' : ds === 'rail' ? 'collapsed' : ds === 'expanded' ? 'expanded' : 'standard', devHl); devHl = null;
  if ((ls === 'expanded') !== libWasExp || first) { libWasExp = ls === 'expanded'; libC.setExpanded(libWasExp); }
  if (ls !== 'rail' && !first) libC.reload();
  syncMini();
  if (first) setTimeout(() => nowc.viz?.resize?.(), 0);
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
function toggleList(force) { const c = force ?? !desk.classList.contains('listcollapsed'); setList(c ? 'collapsed' : 'open'); }
/** 0.3.2 F13: collapsed · open · expanded (rises over the EQ / visualizer at center-column width; Now Playing stays visible below). */
// 0.3.3 G5: expanding the Playlist slides Now Playing up with it to the top of the center column (covering the EQ / visualizer, which stop
// rendering while covered); collapsing reverses it. Both move with the Playlist's timing (FLIP: measure, switch, animate from the old spot).
export const LIST_ANIM = GLIDE;   // 0.3.6 K8: the one shared glide (motion.js)
function flipList(change) {
  const els = [nowc.el, listt.el].filter(Boolean), before = els.map(e => e.getBoundingClientRect().top);
  change();
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  els.forEach((e, i) => { const dy = before[i] - e.getBoundingClientRect().top; if (Math.abs(dy) < 1 || !e.animate) return; e.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: LIST_ANIM.ms, easing: LIST_ANIM.ease }); });
}
function setList(st) { const was = desk.classList.contains('listexpanded'); flipList(() => { desk.classList.toggle('listcollapsed', st === 'collapsed'); desk.classList.toggle('listexpanded', st === 'expanded'); });
  if (was !== (st === 'expanded')) window.dispatchEvent(new CustomEvent('wavwiz:listcover', { detail: { covered: st === 'expanded' } })); P6 = savePanels({ ...P6, list: st }); listt.setCollapsed?.(st); syncMini(); placeNext(); if (st !== 'collapsed') setTimeout(() => { listt.relayout?.(); nowc.viz?.resize?.(); }, 340); }
function listStepUi(dir) { setList(listStep(P6, dir).list); }
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
  const nav = createPhoneDrawerNav(S, { go, refreshAll, act, openSetup, openMini, openQueue, openNew, jumpTo, openPlaylist }, { onClose: () => toggleDrawer(false), versionLabel: VERSION_LABEL() });
  return h('div', { class: 'drawer', id: 'drawer', role: 'dialog', 'aria-label': 'Menu' }, h('div', { class: 'scrim', onclick: () => toggleDrawer(false) }), nav);
}
function toggleDrawer(open) { drawerEl.classList.toggle('open', open); document.querySelector('.hamburger')?.setAttribute('aria-expanded', String(open)); if (open) drawerEl.querySelector('nav button')?.focus(); }

/** 0.3.6 K22: Queue always opens the playlist expanded; when it already is, it pulses (K15). */
export function openQueue() {
  if (!wide()) return go('queue');
  if (pageDlg) { pageDlg.close(); pageDlg = null; }
  if (P6.exp === 'dev') setPanels({ ...P6, exp: null }, 'dev');   // 0.3.7 L17: an expanded Devices view hides the queue - fold it back first, then bring the queue forward
  if (P6.list === 'expanded') { pulse(listt.el); return; }
  setList('expanded');
}
/** 0.3.6 K17: File > New (and Ctrl+Shift+Z / S / A / H) jumps to that editor in the expanded Devices view. */
export function openNew(kind) {
  if (!isAdmin(S)) { toast('Only an administrator can create this.', true); return; }
  if (!wide()) { if (kind === 'zone') return editZone(S, null, refreshAll); return openScenesSchedules(S, refreshAll, kind === 'alarm' ? { at: 'alarm' } : {}); }
  const was = P6.exp === 'dev'; if (!was) toggleDevExpanded(true);
  const run = () => {
    if (kind === 'zone') { document.querySelector('.devpanel .zadd-new')?.click(); pulseSel('.devpanel .zones-h'); }
    else { const c = document.querySelector('.devpanel .ssc-col'); c?._open?.(kind); setTimeout(() => pulseSel(document.querySelector('.devpanel .ss-inline') || c), 60); }
  };
  if (was) run(); else setTimeout(run, GLIDE.ms + 140);
}
/** 0.3.6 K18: a device / zone / scene picked from the Devices menu: open the expanded Devices view, scroll to it and pulse it. */
export function jumpTo(kind, id) {
  if (!wide()) return go(kind === 'scene' ? 'scenes' : 'devices');
  const was = P6.exp === 'dev'; if (!was) toggleDevExpanded(true);
  const sel = kind === 'zone' ? `[data-group-id="${id}"]` : kind === 'scene' ? `[data-scene="${id}"]` : `[data-zone-id="${id}"]`;
  const run = () => { const el = [...document.querySelectorAll('.devpanel ' + sel)].find(e => e.getClientRects().length) || document.querySelector('.devpanel ' + sel); if (el) pulse(el); };
  if (was) run(); else setTimeout(run, GLIDE.ms + 140);
}
export function openPlaylist(id) { toggleLibExpanded(true); setTimeout(() => { libC.showTab('playlists'); }, P6.exp === 'lib' ? 0 : GLIDE.ms); void id; }
/** 0.3.7: THE one way to show the EQ. Every entry point (Menu > Sound / EQ, the menu's EQ submenu, the Now Playing EQ button on every size,
 *  tray / shortcuts) lands here: collapse anything expanded over Now Playing, bring the single center EQ to the front on the shared glide, pulse it.
 *  The old Sound popup is never opened from here (it survives only as the per-speaker inline editor in an open speaker card). */
/** 0.3.7 L4: every menu / pin / shortcut target runs through here: pages close, expanded views fold back, the target comes to the front in its home spot (pulse if already there). */
export function runShortcut(id) {
  switch (id) {
    case 'eq': return showEq();
    case 'queue': return openQueue();
    case 'library': return wide() ? (toggleLibExpanded(true), undefined) : go('library');
    case 'devices': return go('devices');
    case 'scenes': return go('scenes');
    case 'alarms': return go('alarms');
    case 'sleep': return go('sleep');
    case 'settings': return openSettings(S, refreshAll, go);
    default: return undefined;
  }
}
/** 0.3.7 L5: Home = the default Home Screen: Library left, EQ centre, Devices right, Queue bottom centre, Now Playing at the narrow bar. Same glide as everything else. */
export function goHome() {
  if (!wide()) { go('now'); return; }
  if (pageDlg) { pageDlg.close(); pageDlg = null; }
  document.querySelectorAll('dialog[open]').forEach(d => { if (d.classList.contains('page') || d.classList.contains('eqdialog')) d.close(); });
  setList('open'); setPanels({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' }, null);
  nowc.toggleCtl?.(true); nowc.showCenter?.('eq');
  try { window.focus(); } catch { /* ignore */ }
  setTimeout(() => pulse(desk), reduced() ? 0 : GLIDE.ms);
}
export function showEq() {
  if (!wide()) { if (S.view !== 'now') go('now'); }
  else {
    if (pageDlg) { pageDlg.close(); pageDlg = null; }
    if (P6.exp === 'lib') toggleLibExpanded(false); else if (P6.exp === 'dev') toggleDevExpanded(false);
    if (P6.list === 'expanded') setList('open');
  }
  nowc.showCenter?.('eq');
  const front = () => { const st = nowc.stage; if (st) { st.dataset.eqfront = String(Date.now()); pulse(st); } };
  if (wide() && !reduced()) setTimeout(front, GLIDE.ms); else front();
}
export function go(k, force) {
  if (k?.startsWith?.('settings:')) return openSettings(S, refreshAll, go, k.slice(9));
  if (k === 'zones' || k === 'rooms') k = 'devices';
  if (k === 'calibrate') return canControl(S) ? openCalibration(S, refreshAll) : undefined;
  if (k === 'jukebox') return startJukebox(S);   // 0.3.0 §1 (beta)
  // 0.3.5 J9: Diagnostics, Away-from-home access and About are Settings sections (phone and desktop)
  if (k === 'diag' || k === 'remote' || k === 'about') return openSettings(S, refreshAll, go, k);
  if (k === 'sleep') return nowc.openSleep?.();       // 0.3.5 J8: Now Playing > Sleep
  // 0.2.1 F8: Theme and Visualizer live on Settings > Appearance (one home)
  if (k === 'themes' || k === 'visualizer') return openSettings(S, refreshAll, go, k === 'themes' ? 'theme' : 'viz');
  if (k === 'finder') k = 'radio';
  if (wide()) {                               // desktop layout: Now Playing, Library, Devices & Playlist are always on screen
    if (k === 'now') return;
    if (k === 'library') { if (!force) toggleLib(false);   // 0.3.2: at start the saved panel state (rail / expanded Devices) is kept; only a real Library request opens it
      libC.reload(); if (!force) libC.el.querySelector('input[type=search]')?.focus(); return; }
    if (k === 'devices') { if (pageDlg) { pageDlg.close(); pageDlg = null; } toggleDevExpanded(true); return; }   // 0.2.2 T8: same as Menu > Devices & zones
    // 0.3.5 J8: Scenes, schedules & alarms open the expanded Devices view (Scenes & Schedules column); the old window is the phone sheet only
    if (k === 'scenes' || k === 'schedules' || k === 'alarms') { toggleDevExpanded(true); setTimeout(() => { const c = document.querySelector('.devpanel .ssc-col'); c?.scrollIntoView?.({ block: 'nearest' }); c?.classList.add('flash'); setTimeout(() => c?.classList.remove('flash'), 900); }, 380); return; }
    // 0.3.5 J9: Playlists / Radio are Library tabs; the tools are tabs of the expanded Library
    if (k === 'playlists') { toggleLib(false); libC.showTab('playlists'); return; }
    if (k === 'radio') { if (!desk.classList.contains('libexpanded')) toggleLibExpanded(true); libC.showTab('radio'); return; }
    if (k === 'rip' || k === 'tags' || k === 'cleanup') { if (!desk.classList.contains('libexpanded')) toggleLibExpanded(true); libC.showTab(k); return; }
    if (k === 'eq') return showEq();     // Playback > Sound / EQ = the center EQ panel (0.3.7: one function for every EQ entry point)
    if (k === 'queue') return openQueue();
    return openPage(k);
  }
  if (k === 'scenes' || k === 'schedules' || k === 'alarms') return openScenesSchedules(S, refreshAll);   // phone sheet
  if (k === 'eq') return showEq();
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
/** 0.3.2 F3: the mini player (replaces Remote mode). In a browser it is a small popup window; WavWiz Player has its own (tray > Mini player).
 *  It never joins as a speaker, so opening or closing it never changes the streams (F2). */
export function openMini() {
  try { window.chrome?.webview?.postMessage({ cmd: 'mini' }); if (window.chrome?.webview) return; } catch { /* not the Player */ }
  window.open('/mini.html', 'wavwiz-mini', 'popup,width=420,height=108');
}

export async function refreshAll() { await Promise.allSettled([refreshNow(), refreshZones(), refreshStatus(), refreshRadio()]); nowc?.drawChecklist(); }
async function refreshNow() { try { const r = await api('/stream'); S.now = r.now; S.queue = r.queue.items; S.localPos = r.now.positionMs; S.localAt = performance.now(); whenIdle(() => { nowc.draw(); listt.draw(); }, 'now'); drawStatus(); if (S.view === 'queue') drawQueue(); } catch (e) { handleErr(e); } }
async function refreshZones() { try { const [z, g] = await Promise.all([api('/zones'), api('/groups').catch(() => S.groups)]); const idsChanged = (S.zones || []).map(x => x.id).join() !== z.map(x => x.id).join(); S.zones = z; S.groups = g; if (idsChanged) { devv.draw(); devp.draw(); } else whenIdle(() => { devv.draw(); devp.draw(); }, 'zones');   // 0.3.0 §9: never re-render under a dragged slider (a removed device still redraws at once)
  nowc.drawStrip(); drawStatus(); } catch (e) { handleErr(e); } }
async function refreshStatus() { try { S.status = await api('/status'); } catch (e) { handleErr(e); } try { const c = await api('/checklist'); S.setupLeft = c.dismissed || checklistDismissedLocal() ? 0 : c.remaining; } catch { S.setupLeft = 0; } drawStatus(); }
async function refreshRadio() { try { S.radio = await api('/radio'); } catch (e) { handleErr(e); } }
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
      else if (m.type === 'schedules' || m.type === 'scenes') window.dispatchEvent(new CustomEvent('wavwiz:schedules'));
      else if (m.type === 'sleep') { sleepChip(S, m.data); window.dispatchEvent(new CustomEvent('wavwiz:sleep', { detail: m.data })); }
      else if (m.type === 'alarm') showAlarm(S, m.data);
      else if (m.type === 'jukebox') jukeboxChip(S, m.data);   // 0.3.0 §1   // 0.3.0: alarm banner / full-screen takeover on phones
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
  // 0.3.6 K3: the count badges on the collapsed Library / Devices bars
  const lb = document.querySelector('.libpanel .prail-n'), db = document.querySelector('.devpanel .prail-n');
  if (lb) lb.textContent = tracks != null ? String(tracks) : ''; if (db) db.textContent = `${online}/${S.zones.length}`;
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
let qReorder = null;
function drawQueue() {
  const root = views.queue.el; const can = canControl(S);
  const total = S.queue.reduce((a, q) => a + (q.durationMs || 0), 0), cur = S.now?.index ?? -1;
  const lay = loadLayout(true), locked = !!lay.locked, dragOk = canDragRows({ can, locked });   // 0.3.7 L29: the same lock as the desktop table (per layout)
  const rows = S.queue.map((q, i) => {
    const playing = i === cur && S.now?.state !== 'stopped';
    return h('div', { class: 'item' + (playing ? ' cur' : ''), 'data-i': i, onclick: () => can && act('/stream/jump', { index: i }) },
      dragOk ? h('span', { class: 'qgrip', role: 'button', 'aria-label': `Drag ${q.title} to reorder`, title: 'Drag to reorder', onclick: ev => ev.stopPropagation() }, '⋮⋮') : null,
      h('span', { class: 'num' }, playing ? '▶' : i + 1), h('div', { class: 't' }, h('div', { class: 't1 ell' }, q.title), h('div', { class: 't2 ell' }, [q.artist, q.album].filter(Boolean).join(' • '))), h('span', { class: 'dur' }, q.durationMs ? fmtDur(q.durationMs) : ''),
      can && !locked ? h('button', { class: 'more', 'aria-label': 'Move up', disabled: i === 0, onclick: ev => { ev.stopPropagation(); act('/queue/move', { from: i, to: i - 1 }); } }, '▲') : null,
      can && !locked ? h('button', { class: 'more', 'aria-label': 'Move down', disabled: i === S.queue.length - 1, onclick: ev => { ev.stopPropagation(); act('/queue/move', { from: i, to: i + 1 }); } }, '▼') : null,
      can ? h('button', { class: 'more', 'aria-label': 'Remove', onclick: ev => { ev.stopPropagation(); act(`/queue/${i}`, undefined, 'DELETE'); } }, '✕') : null);
  });
  const lockBtn = h('button', { class: 'btn' + (locked ? ' on' : ''), 'data-act': 'phonelock', 'aria-pressed': String(locked), title: locked ? 'Queue locked - click to unlock' : 'Lock the queue (no reordering or sorting)', onclick: () => { saveLayout(setLocked(loadLayout(true), !locked), true); drawQueue(); } }, locked ? 'Locked' : 'Lock');
  root.replaceChildren(h('div', { class: 'row wrap' }, h('h2', { class: 'grow', style: 'margin:0' }, 'Queue'), h('span', { class: 'dim small' }, `${S.queue.length} tracks${total ? ' • ' + fmtDur(total) : ''} • editable from any device`),
    can && S.queue.length ? [h('button', { class: 'btn', onclick: saveQueue }, 'Save queue as a playlist'), h('button', { class: 'btn', onclick: () => clearQueueFlow(S, { act, refreshAll }) }, 'Clear'), lockBtn] : null),
    S.queue.length ? h('div', { class: 'list qlist' }, rows) : h('p', { class: 'dim' }, 'The queue is empty. Open the Library and tap a song, or use ⋯ > Add to queue.'));
  qReorder?.destroy(); qReorder = null;
  const list = root.querySelector('.qlist');
  if (list) qReorder = attachReorder(list, { can: () => canControl(S), locked: () => !!loadLayout(true).locked, onMove: async mv => { await act('/queue/move', mv); } });
}
function saveQueue() {   // 0.3.5 J9 #9: inline name field (phone Queue page)
  const root = views.queue.el; root.querySelector('.qsave')?.remove();
  const name = h('input', { type: 'text', maxlength: 80, placeholder: 'Playlist name', 'aria-label': 'New playlist name' });
  const box = h('div', { class: 'qsave row inlineform' }, name, h('button', { class: 'btn primary', onclick: async () => { try { await api('/playlists', { method: 'POST', body: { name: name.value, fromQueue: true } }); toast('Saved'); box.remove(); window.dispatchEvent(new CustomEvent('wavwiz:playlists')); } catch (e) { toast(e.message, true); } } }, 'Save'), h('button', { class: 'btn', onclick: () => box.remove() }, 'Cancel'));
  root.firstChild?.after(box); name.focus();
}

boot();
