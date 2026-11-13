import { wsel } from './wwselect.js';
import { keepControl, openRecentQueues } from './queuetools.js';
let pKeep = null;
import { viewForMode } from './viewmode.js';
import './marquee.js';   // 0.4.8 F62: shared now-playing marquee (main app + phone)
import { libCountLabel } from './libcount.js';   // 0.4.4 F7
import './sliderstyle.js';   // 0.3.3 G11
import './pwa.js';
import { installOrientationGuard } from './orientlock.js';   // F262-fix: phone is portrait-only
installOrientationGuard();
import './a2hs.js';   // 0.4.1 E   // 0.3.4 H1
import { h, api, toast, fmtDur, dialog, ApiError } from './util.js';
import { clearQueueFlow } from './queueclear.js';
import { applyTheme, loadTheme } from './theme.js';
import { openSettings } from './settings.js';
import { isRealPhone } from './viz.js';
import { openCalibration } from './calibrate.js';
import { openEq } from './eq.js';
import { createNow } from './now.js';
import { openPhoneSound } from './phonesound.js';   // F250-P7: composed phone Sound modal
import { openSpeakerSettings, editZone, devicesView, devicesPanel, expandLabel, expandIcon, paintExpandBtn, masterLevel, allMuted } from './devices.js';
import { listTable, srcPill, queueNextIndex } from './listtable.js';
import { icon, setIcon, setChev } from './icons.js';
import { attachReorder, canDragRows } from './qreorder.js';
import { loadLayout, saveLayout, setLocked, CLEAR_LOCK_HINT } from './plcols.js';
import { installMiniTargets, pinToggle, loadPins, pinInfo, MAX_PINS } from './shortcuts.js';
import { GLIDE, glide, holdFor, holdPage, pulse, pulseSel, reduced } from './motion.js';
import { brandMark } from './brand.js';
import { installTitlebar, titlebarLogo } from './titlebar.js';   // 0.6.8-#16
import { loadNpPrefs, npVars, applyNpColor, applyNpClasses } from './npstyle.js';
import { createMenuBar, createPhoneDrawerNav, drawerOutsideClick } from './menu.js';
import { setRipAllowed, ripAllowed } from './library.js';
import { loadPanels, savePanels, normPanels, shown, chevron, railClick, expand, effective, chevronGlyph, chevronDir, chevronLabel, keyAction, listStep, isTight, devTabText, loadLayout as loadLayoutMode, centerWidthFor, centerPopupWidth, popupWidth } from './panels.js';
import { installAutoJoin, deviceName, stopPhoneDevice, startPhoneAsDevice, defaultRoomName, unlockAudio } from './room.js';
import { retireRemote } from './remotemode.js';
import { installTvMode } from './tv.js';
import { adminChip, refreshAuth } from './elevate.js';
import { liveSocket } from './wsconn.js';
import { openAbout, maybeWhatsNew } from './about.js';
import { libraryView } from './library.js';
import { artPushed, setArtCv, artCv, reconcileSmoothPosition, npCover } from './art.js';
import { playlistsView } from './playlists.js';
import { cleanupView } from './cleanup.js';
import { diagnosticsView, roomPill, checklistDismissedLocal } from './diag.js';
import { canControl, thisDevice, isAdmin } from './ui.js';
import { isPlayerUa, isHandset } from './phonejoin.js';
import { openScenesSchedules, showAlarm, sleepChip } from './scenesched.js';
import { startJukebox, jukeboxChip, openKiosk, askStopJukebox, jukeboxRunning, DISPLAY as JB_DISPLAY } from './jukebox-kiosk.js';
import { radioFinderView } from './radiofinder.js';
import { radioTab } from './radiotab.js';
import { tagsView } from './tags.js';
import { ripView } from './rip.js';
import { remoteView } from './remote.js';
import { whenIdle, installSliderGuard } from './slider.js';
import { mountMini } from './mini.js';
import * as Z from './zones40.js';
import { isDevDragging, setCardOrder, cardOrderChangedAt } from './devorder.js';
import { newKindForKey, isTypingTarget } from './menusub.js';
import { installHotkeys } from './hotkeys.js';
import { toggleAppFull, installAppFull } from './fullscreen.js';   // 0.5.0 F120
import { openMixer } from './mixer.js';   // 0.4.8 F49
import { attachQueueMenu } from './queuemenu.js';
import { installMedia } from './media.js';
import { showPendingUndo } from './backupflow.js';
import { liveSong } from './livemeta.js';   // 0.7.0 radio now-playing
import { startPairRequests, playerApprovalScreen } from './pairreq.js';   // 0.6.9 #15

applyTheme(loadTheme());          // the "Default" theme unless this device picked something else
document.documentElement.classList.toggle('handset', isRealPhone());   // 0.7.0 (t1892): phone-only header sizes follow the device, never a narrow PC window
installTvMode();                  // 0.2.0 item 1: TVs and ?lite get the lightweight, remote-friendly Now Playing

export const S = { auth: null, now: null, queue: [], zones: [], groups: [], radio: [], status: null, view: null, ws: null, localPos: 0, localAt: 0 };
const app = document.getElementById('app');
const VERSION_LABEL = () => `BETA ${S.auth?.appVersion ?? ''}`.trim();
/** 0.4.6: every version label on the page has data-wwv="<template with {v}>" and is painted from ONE value - the running server's build version
 *  (S.auth.appVersion, Directory.Build.props). It is refreshed from the WebSocket hello on every (re)connect, so a page that outlived a server
 *  upgrade / restart never keeps showing the old number in some views. */
export function paintVersion(root = document) { const v = S.auth?.appVersion ?? ''; for (const e of root.querySelectorAll('[data-wwv]')) e.textContent = e.dataset.wwv.replace('{v}', v).trim(); if (/^WavWiz BETA/.test(document.title)) document.title = `WavWiz BETA ${v}`; }
const wide = () => !matchMedia('(max-width:900px)').matches;

// ---------------------------------------------------------------- boot
// 0.2.2 T9 / 0.2.5: a phone arriving with ?cal=CODE (the PC's calibration QR code) is sent to the mic-only page /calmic.html (see calredirect.js)
/** 0.3.7 L28: the Pair a player QR opens /?pair=123456 -> the code box is filled in (never signs in by itself; calibration links are unaffected). */
const PAIR_PREFILL = (() => { try { const q = new URLSearchParams(location.search); const p = q.get('pair') || ''; return !q.get('cal') && /^[0-9]{6}$/.test(p) ? p : ''; } catch { return ''; } })();
const CAL = (() => { try { const q = new URLSearchParams(location.search), cal = q.get('cal') || '', pair = q.get('pair') || ''; return { cal: /^[A-Za-z0-9]{6}$/.test(cal) ? cal : null, pair: /^[0-9]{6}$/.test(pair) ? pair : null }; } catch { return { cal: null, pair: null }; } })();
async function boot() {
  if (CAL.cal || window.__wwCalRedirect) { location.replace('/calmic.html?cal=' + (CAL.cal || '')); return; }   // 0.2.5: calibration links go to the mic-only page; never join here
  try { S.auth = await api('/auth/state'); } catch (e) { return fatal(e.message); }
  setRipAllowed(S.auth);   // 0.4.8 F57: the CD ripper is a PC-only tool (never on the phone / remote clients)
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
    titlebarLogo(() => brandMark()), h('span', { class: 'beta', title: 'This is a BETA version', 'data-wwv': 'BETA {v}' }, VERSION_LABEL()),
    h('span', { class: 'grow' }), extra);
}

function fatal(msg) { app.replaceChildren(topbar(), h('div', { class: 'card auth' }, h('h2', null, 'WavWiz is not reachable'), h('p', { class: 'err' }, msg), h('button', { class: 'btn', onclick: () => location.reload() }, 'Try again'))); }

function renderSetup() {
  const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8, id: 'pw1' }), pw2 = h('input', { type: 'password', autocomplete: 'new-password', id: 'pw2' }), msg = h('p', { class: 'err', role: 'alert' });
  // F166: headless (Linux/Docker) server: 15-min LAN window, then the code from claim.txt
  const cl = S.auth.headless ? S.auth.claim : null;
  const code = cl ? h('input', { type: 'text', autocomplete: 'off', id: 'claim', spellcheck: 'false', placeholder: 'from claim.txt' }) : null;
  const canSetup = S.auth.thisMachine || !!cl;
  let left = cl?.windowSecondsLeft || 0;
  const banner = cl ? h('p', { class: 'small', role: 'status' }) : null;
  const paintBanner = () => {
    if (!banner) return;
    banner.textContent = left > 0
      ? `Claim window open: ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left. Any browser on your home network can finish setup now; after that the claim code is needed.`
      : `Setup window closed. Enter the claim code from ${cl.file} on the server (it is also in the server log).`;
    if (codeField) codeField.hidden = left > 0;
  };
  const codeField = code ? h('div', { class: 'field' }, h('label', { for: 'claim' }, 'Claim code'), code) : null;
  if (cl && left > 0) { const t = setInterval(() => { if (!banner.isConnected) { clearInterval(t); return; } left = Math.max(0, left - 1); paintBanner(); if (!left) clearInterval(t); }, 1000); }
  const form = h('form', { class: 'card auth', onsubmit: async ev => {
    ev.preventDefault(); msg.textContent = '';
    if (pw.value !== pw2.value) { msg.textContent = 'The two passwords are different.'; return; }
    try { await api('/auth/setup', { method: 'POST', body: { password: pw.value, claimCode: code?.value || undefined } }); location.reload(); } catch (e) { msg.textContent = e.message; }
  } },
    h('h2', null, 'Welcome to WavWiz'), h('p', { class: 'dim' }, 'Choose an administrator password for this WavWiz server (at least 8 characters). It never leaves your home network. Nothing was generated or shown by the installer.'),
    banner,
    canSetup ? null : h('p', { class: 'err' }, 'First-time setup can only be done on the PC that runs the WavWiz server. Open this page on that PC.'),
    codeField,
    h('div', { class: 'field' }, h('label', { for: 'pw1' }, 'Password'), pw), h('div', { class: 'field' }, h('label', { for: 'pw2' }, 'Repeat password'), pw2), msg,
    h('button', { class: 'btn primary', disabled: !canSetup }, 'Create and continue'));
  paintBanner();
  app.replaceChildren(topbar(), form);
}

function renderLogin(start) {
  // 0.6.9 #15: the WavWiz Player window never opens on the sign-in tabs - it asks the administrator for approval and waits
  if (!start && isPlayerUa()) { const w = playerApprovalScreen({ name: deviceName(), other: m => renderLogin(m) }); app.replaceChildren(topbar(), w.el); return; }
  const mode = { v: start === 'admin' ? 'admin' : 'pair' };
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
let pairReqs = null;   // 0.6.9 #15
let desk, drawerEl, tabs, nowc, devv, devp, listt, libC, libpanel, statusbar, content, navButtons = [], pageDlg = null, minicol = null, miniInst = null;
/** 0.3.6 K14 / K22: the real mini player lives in the right-hand column while the Library or the Playlist is expanded (and is not running otherwise). */
function syncMini() { holdPage();
  if (!desk || !minicol) return;
  const need = wide() && desk.classList.contains('libexpanded');   // 0.4.6 F36/F37: only the expanded Library (Full and Roomy) shrinks Now Playing to the column mini player
  desk.classList.toggle('devfull', wide() && desk.classList.contains('devexpanded') && !desk.classList.contains('libexpanded'));   // 0.4.8 F53 v2: expanded Devices = no player at all, every column full height
  if (need && !miniInst) { const host = minicol.querySelector('.embedded-host'); miniInst = mountMini(host, { embedded: true, replica: true, run: runShortcut, home: goHome,   // 0.6.9 #9: the standalone mini player's layout and controls
    popout: () => { try { if (window.chrome?.webview) { window.chrome.webview.postMessage({ cmd: 'mini' }); return; } } catch { /* browser */ } openMini(); }, collapse: () => toggleLibExpanded(false) }); minicol.append(miniInst.rail); }
  else if (!need && miniInst) { miniInst.destroy(); miniInst = null; minicol.replaceChildren(h('div', { class: 'mp embedded-host' })); }
  desk.classList.toggle('minishown', need); paintMiniStyle();
}
/** 0.4.6 F38: the condensed player under the Queue (expanded Library) is a small version of the chosen Now Playing layout: minicol gets the same
 *  pn-<style> class and effect variables as the Now Playing panel, and follows changes at once. */
function paintMiniStyle() {
  if (!minicol) return; const p = loadNpPrefs();
  applyNpClasses(minicol, p);   // F95
  for (const [k, v] of Object.entries(npVars(p))) minicol.style.setProperty(k, v);
}
applyNpColor(loadNpPrefs()); // F94
window.addEventListener('wavwiz:npstyle', () => { applyNpColor(loadNpPrefs()); paintMiniStyle(); });
window.addEventListener('storage', ev => { if (ev.key === 'wavwiz.npstyle.v1') { applyNpColor(loadNpPrefs()); paintMiniStyle(); } });

// F250-P1: phone destinations are routes except Settings, which owns a dialog,
// not S.view. Keep the mounted page/scroll/player intact while it is open.
function createPhoneTabs() {
  return h('nav', { class: 'tabbar', 'aria-label': 'Main navigation' },
    [['library', 'library', 'Library'], ['queue', 'queue', 'Queue'], ['devices', 'devices', 'Devices'], ['settings', 'gear', 'Settings']].map(([k, ic, label]) =>
      h('button', { type: 'button', 'data-k': k, ...(k === 'settings' ? { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' } : {}),
        onclick: ev => k === 'settings' ? openPhoneSettings(ev.currentTarget) : go(k) }, icon(ic), h('span', null, label))));
}
function openPhoneSettings(from) {
  const view = S.view;
  // Safari does not always focus a tapped button; give native dialog restoration
  // an explicit opener. Never re-go(view) on close (that would reload the page).
  from.focus({ preventScroll: true });
  openSettings(S, refreshAll, go).catch(handleErr);
  const dlg = document.querySelector('dialog.settings-dlg[open]');
  if (!dlg) return;
  from.setAttribute('aria-expanded', 'true');
  dlg.addEventListener('close', () => {
    from.setAttribute('aria-expanded', 'false');
    // Settings can deliberately navigate or the viewport can become desktop.
    if (!wide() && S.view === view && from.isConnected) from.focus({ preventScroll: true });
  }, { once: true });
}

// F250-P2: full-page phone Library only. Lazily own separate adapters so a
// direct route or the desktop panel can never steal its mounted DOM/state.
function createPhoneLibrary() {
  let radio, playlists;
  const lib = libraryView(S, { phone: true, extras: {
    get radio() { return radio ||= radioTab(S, act); },
    get playlists() {
      if (!playlists) {
        const view = playlistsView(S, { deferInitial: true });
        let loading = null;
        // An initial source/RS refresh can arrive together. Coalesce only this
        // adapter's reload so smartSection cannot append twice to one draw.
        playlists = { el: view.el, reload: () => loading || (loading = view.reload().finally(() => { loading = null; })) };
      }
      return playlists;
    }
  } });
  // Informational cue, not another zone owner. The existing mini/Now picker
  // still selects the controlling zone through zones40.
  const zone = h('span', { class: 'libzone small' });
  const paintZone = () => { const name = Z.current()?.name; zone.textContent = name || 'No zone selected'; zone.setAttribute('aria-label', name ? `Controlling ${name}` : 'No zone selected'); };
  lib.el.prepend(h('header', { class: 'libpage-heading' }, h('h1', null, 'Library'), zone));
  const reload = lib.reload;
  lib.reload = () => { paintZone(); return reload(); };
  window.addEventListener('wavwiz:zonesync', paintZone);
  paintZone();
  return lib;
}

async function startMain() {
  installSliderGuard(document);     // 0.3.0 §9/§7.8: drag-safe sliders + wheel fine-tune everywhere
  const connDot = h('span', { class: 'dot', id: 'conn' }), connTxt = h('span', { id: 'conntxt', class: 'small dim' }, 'Connecting…');
  const control = canControl(S);
  const ctl = { openQueue: () => openQueue(), act, refreshAll, showInLibrary: (t, q) => showInLibrary(t, q), go, openSetup, openEq: () => showEq(), runShortcut: id => runShortcut(id), goHome: () => goHome(), checklistGo, pill: roomPill, saveQueue, toggleLib: f => toggleLib(f), toggleLibExpanded: f => toggleLibExpanded(f), toggleDev: f => toggleDev(f), toggleDevExpanded: f => toggleDevExpanded(f), setDevSize: (sz, hl) => setDevSize(sz, hl), toggleList: f => toggleList(f), listStep: d => listStepUi(d), libCollapsed: () => desk?.classList.contains('libcollapsed'), devCollapsed: () => desk?.classList.contains('devcollapsed'), libSwap: v => libSwap(v) };
  nowc = createNow(S, ctl); devv = devicesView(S, ctl); devp = devicesPanel(S, ctl); listt = listTable(S, ctl);
  // F262 capture tooling ONLY: no diagnostic module, listeners or buffer without this exact opt-in.
  if (new URLSearchParams(location.search).get('diag') === '1')
    void import('./f262diag.js').then(m => m.installCapture()).catch(() => {}); // optional diagnostic init only

  views.library = createPhoneLibrary(); views.playlists = playlistsView(S); views.cleanup = cleanupView(S); views.diag = diagnosticsView(S);
  views.queue = { el: h('div', { id: 'p-list', class: 'phone-queue' }), reload: drawQueue, hide: hidePhoneQueue, show: showPhoneQueue }; views.radio = radioTab(S, act);   // 0.3.5 J9: one Radio page (stations + finder)
  views.finder = radioFinderView(S, act); views.tags = tagsView(S); views.rip = ripView(S); views.remote = remoteView(S);
  views.devices = { el: devv.el, reload: () => devv.draw(), hide: () => devv.hide() }; views.about = { el: h('div', { id: 'p-about' }), reload: () => openAboutInto(views.about.el) };
  // 0.3.5 J9: the desktop Library panel hosts Playlists, Radio and (expanded) the tools as tabs
  libC = libraryView(S, { compact: true, extras: { playlists: playlistsView(S), radio: radioTab(S, act), rip: ripView(S), tags: tagsView(S), cleanup: cleanupView(S) } });
  content = h('main', { class: 'view', id: 'view', tabindex: -1 });
  S.view = wide() ? 'library' : 'now';

  const hamburger = h('button', { class: 'iconbtn hamburger', 'aria-label': 'Menu', 'aria-expanded': 'false', onclick: () => toggleDrawer(true) }, h('span', { class: 'hb-bars', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
  const menubar = createMenuBar(S, { go, refreshAll, act, openSetup, openMini, openQueue, openNew, jumpTo, openPlaylist, toggleLib: f => toggleLib(f), toggleLibExpanded: f => toggleLibExpanded(f), toggleDev: f => toggleDev(f), toggleDevExpanded: f => toggleDevExpanded(f), setDevSize: (sz, hl) => setDevSize(sz, hl), toggleList: f => toggleList(f) });
  const inline = h('nav', { class: 'navwide', 'aria-label': 'Sections' }, [['playlists', 'Playlists'], ['radio', 'Radio'], ['scenes', 'Scenes & Schedules'], ['devices', 'Devices & zones']].map(([k, t]) => h('button', { class: 'iconbtn', 'data-k': k, onclick: () => go(k) }, t)),
    control ? h('button', { class: 'iconbtn', onclick: () => openCalibration(S, refreshAll) }, '🎤 Calibrate') : null, h('button', { class: 'iconbtn', onclick: () => showEq() }, '🎚 Sound'), h('button', { class: 'iconbtn', onclick: () => openSettings(S, refreshAll, go) }, '⚙ Settings'));
  // 0.6.9 #26 (t1876): no 'Jukebox TV <address>' pill in the title bar any more (it ate the bar) - the view-only TV address is in the Jukebox host
  // panel ('Show on a TV…'), next to 'Open on another screen'; the big screen shows its own join QR
  const bar = topbar([menubar, adminChip(S), h('span', { class: 'conn row', style: 'gap:6px', title: 'Connecting…' }, connDot, connTxt), inline], hamburger);
  installTitlebar(bar);   // 0.6.8-#16: Windows app only - the top bar becomes the themed window title bar
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
  // 0.4.5 T1: in the tight layout Devices is a thin right-edge tab that opens a full-height slide-over (scrim click / Esc close it)
  devTab = h('button', { type: 'button', class: 'devtab', 'aria-expanded': 'false', title: 'Open Devices', onclick: () => devOpen(!desk.classList.contains('devopen')) }, h('span', { class: 'devtab-t' }, devTabText(0)));
  devScrim = h('div', { class: 'devscrim', 'aria-hidden': 'true', onclick: () => desk?.classList.contains('roomyopen') ? toggleDev(true) : devOpen(false) });
  desk = h('div', { class: 'desk' + (P6.list === 'collapsed' ? ' listcollapsed' : P6.list === 'expanded' ? ' listexpanded' : ''), id: 'desk', 'data-view': S.view }, libpanel, content, nowc.el, devp.el, listt.el, nowc.npbar, minicol, devTab, devScrim);
  desk.addEventListener('transitionend', ev => { if (ev.target === desk && /grid-template/.test(ev.propertyName)) { nowc.viz?.resize?.(); placeNext(); } });   // §6: the viz resizes once the move has finished
  listt.setCollapsed?.(P6.list);
  wireNextBlock();
  tabs = createPhoneTabs();
  drawerEl = buildDrawer();
  app.replaceChildren(bar, desk, statusbar, nowc.mini, tabs); document.body.append(drawerEl);
  const applyMode = () => {   // 0.3.9 L52: keep the view state valid on both sides of the breakpoint (idle or playing)
    const m = viewForMode({ wide: wide(), view: S.view, hasContent: !!content.firstChild });
    if (m.clearContent) { views[S.view]?.hide?.(); content.replaceChildren(); S.view = m.view; desk.dataset.view = m.view; tabs.querySelectorAll('button').forEach(b => { b.classList.remove('on'); b.removeAttribute('aria-current'); }); }
    else if (m.view !== S.view || desk.dataset.view !== m.view) go(m.view, true);
    // Now and drawer-only pages have no bottom destination: do not remount on resize.
    else if (!content.firstChild) go(m.view, true);
  };
  // 0.6.8e: at most one layout pass per frame while the window is dragged (applyPanels only toggles classes; it no longer redraws the Library / Devices)
  let resizeRaf = 0; window.addEventListener('resize', () => { if (resizeRaf) return; resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; applyMode(); applyPanels(); }); });
  try { matchMedia('(max-width:900px)').addEventListener('change', () => { applyMode(); applyPanels(); }); } catch { /* old engines */ }
  applyMode();
  window.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') toggleDrawer(false);
    const nk = !document.querySelector('dialog[open],.sheet,.dlg,.jb,.pd42-sheet') && newKindForKey(ev, isTypingTarget(ev.target)); if (nk) { ev.preventDefault(); openNew(nk); return; }   // K17
    if (!wide() || document.querySelector('dialog[open],.sheet,.dlg,.jb,.pd42-sheet')) return;
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
  // 0.3.8 L37: a pin icon on every pinnable title bar toggles that destination as a shortcut in ONE click (no menu, no confirm); right-click does the same.
  const titleId = t => t.closest('.libpanel') ? 'library' : t.closest('.devpanel') ? 'devices' : t.closest('.listpanel') ? 'queue' : 'eq';
  const togglePinFor = id => { const lab = pinInfo(id).label, r = pinToggle(id); toast(r.full ? `All ${MAX_PINS} shortcut slots are taken - unpin one first.` : r.pins.includes(id) ? `Pinned: ${lab}` : `Unpinned: ${lab}`, r.full); };
  const paintTitlePins = () => { const pins = loadPins(); document.querySelectorAll('.tpin').forEach(b => { const on = pins.includes(b.dataset.pin), lab = pinInfo(b.dataset.pin).label; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.title = on ? `Unpin ${lab} from shortcuts` : `Pin ${lab} to shortcuts`; b.setAttribute('aria-label', b.title); }); };
  const addTitlePins = () => {
    if (isHandset()) return;   // 0.6.8-#11d: no pins on actual phones (a narrow PC window keeps them)
    for (const sel of ['.libpanel > .pane-h', '.devpanel > .pane-h', '.listpanel > .pane-h']) {
      const hd = document.querySelector(sel); if (!hd || hd.querySelector('.tpin')) continue;
      const id = titleId(hd), b = h('button', { type: 'button', class: 'plus tpin', 'data-pin': id, onclick: ev => { ev.stopPropagation(); togglePinFor(id); } }, icon('pin'));
      const place = () => {
        if (hd.closest('.libpanel')) { const exp = hd.querySelector(':scope > .libexp'); if (exp) { hd.insertBefore(b, exp); return; } }
        if (hd.closest('.devpanel')) { const col = hd.querySelector(':scope > .devcol'); if (col) { hd.insertBefore(b, col); return; } }
        if (hd.closest('.listpanel')) { const wrap = hd.querySelector(':scope > .listcolwrap, :scope > .row.listcolwrap'); if (wrap) { hd.insertBefore(b, wrap); return; } }
        const grow = hd.querySelector(':scope > .grow'); if (grow) { grow.after(b); return; }
        hd.append(b);
      };
      place(); paintTitlePins();
    }
  };
  addTitlePins(); window.addEventListener('wavwiz:pins', paintTitlePins);
  window.addEventListener('storage', ev => { if (!ev.key || ev.key === 'wavwiz.pins.v1') paintTitlePins(); });   // F145: pins changed in another window (mini player / second tab)
  new MutationObserver(() => addTitlePins()).observe(desk, { childList: true, subtree: true });
  document.addEventListener('contextmenu', ev => {
    const t = ev.target.closest?.('.libpanel .pane-h, .devpanel .pane-h, .listpanel .pane-h, .np-stage'); if (!t || ev.target.closest('input,textarea,.plpicker')) return;
    const id = titleId(t); if (id === 'queue' && ev.target.closest('th')) return;
    ev.preventDefault(); togglePinFor(id);
  });
  // 0.3.8 L44: the approved global shortcuts (one table in hotkeys.js)
  window.addEventListener('wavwiz:mixer', () => openMixer(S, { act, refreshAll: () => refreshZones() }));   // 0.4.8 F49: player bar / Devices / Alt+V / phone
  installHotkeys(id => {
    switch (id) {
      case 'playpause': return act(S.now?.state === 'playing' ? '/stream/pause' : '/stream/play', S.now?.state === 'playing' ? undefined : {});
      case 'next': return act('/stream/next');
      case 'prev': return act('/stream/prev');
      case 'mute': return [...document.querySelectorAll('.mutebtn')].find(b => b.getClientRects().length && !b.disabled)?.click();
      case 'mini': try { if (window.chrome?.webview) { window.chrome.webview.postMessage({ cmd: 'mini', toggle: true }); return; } } catch { /* browser */ } return openMini();
      case 'fullscreen': return toggleAppFull();
      case 'home': return goHome();
      case 'mixer': return window.dispatchEvent(new CustomEvent('wavwiz:mixer'));
      case 'settings': return runShortcut('settings');
      default: return runShortcut(id);
    }
  });
  installAppFull();   // 0.5.0 F120: Esc leaves app fullscreen
  installMedia({ S, api, act, masterLevel, allMuted });   // 0.3.8 L45
  pairReqs = startPairRequests(() => isAdmin(S));   // 0.6.9 #15: approval cards for administrators
  installMiniTargets(msg => { if (msg.home) goHome(); else if (msg.run) runShortcut(msg.run); });   // 0.3.7 L23: the standalone mini player's shortcuts
  connectWs(); go(S.view, true); libC.reload();
  await refreshAll();
  drawStatus(); if (!JB_DISPLAY) maybeWhatsNew(S); showPendingUndo();   /* 0.6.9 #18: no What's new popping over a TV display */
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
  if (!JB_DISPLAY) installAutoJoin(S, refreshAll);           // 0.6.9 #18: a ?jukebox=tv display never joins as a speaker (the Jukebox plays on its own speakers) // 0.2.0 item 1: every browser (not the Player window) joins as a speaker (F2: exactly one stream)
  setTimeout(() => maybeAutoSetup(), 900);   // 0.2.0 item 24: first run opens Getting started by itself
}
/** 0.3.0 §6: the menu / tray API keeps its names; everything goes through one state (P6) and one applyPanels(). */
function toggleLib(force) { if (force === true) return setPanels({ ...P6, lib: 'rail', exp: P6.exp === 'lib' ? null : P6.exp }, 'lib'); if (force === false) return setPanels(railClick(P6, 'lib'), 'lib'); setPanels(chevron(P6, 'lib'), 'lib'); }
function toggleLibExpanded(force) { if (force === true && P6.exp === 'lib') { pulse(libpanel); return; }   // K15: already open -> pulse it
  setPanels(expand(P6, 'lib', force ?? P6.exp !== 'lib'), 'lib'); }
function toggleDev(force) { holdPage(); if (desk?.classList.contains('tight') && !P6.exp) return devOpen(force === false ? true : force === true ? false : !desk.classList.contains('devopen'));   // 0.4.5 T1: the slide-over's own chevron / ] key
  if (force === true) return setPanels({ ...P6, dev: 'rail', exp: P6.exp === 'dev' ? null : P6.exp }, 'dev'); if (force === false) return setPanels(railClick(P6, 'dev'), 'dev'); setPanels(chevron(P6, 'dev'), 'dev'); }
function toggleDevExpanded(force) { holdPage(); if (force === true && P6.exp === 'dev') { pulse(devp.el); return; }   // K15
  setPanels(expand(P6, 'dev', force ?? P6.exp !== 'dev'), 'dev'); }
/** 0.3.5 J11 (option A): with the Library expanded the right column shows the playlist; "Devices ›" swaps the Devices panel in, "‹ Playlist" back. */
function libSwap(v) { holdPage(); if (!desk) return; desk.classList.toggle('libdev', !!v); devp.setSize(v ? 'standard' : (desk.classList.contains('devcollapsed') ? 'collapsed' : 'standard')); listt.relayout?.(); }
function setDevSize(sz, highlight = null) { devHl = highlight; setPanels(sz === 'expanded' ? expand(P6, 'dev', true) : sz === 'collapsed' ? { ...P6, dev: 'rail', exp: P6.exp === 'dev' ? null : P6.exp } : { ...P6, dev: 'normal', exp: P6.exp === 'dev' ? null : P6.exp }, 'dev'); }
let P6 = null, lastOpened = null, devHl = null, libWasExp = false, libWasShown = false, devWasSize = null, devTab = null, devScrim = null, tightLib = false, roomyDev = false;
const pageZoom = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;
function paintDevTab() { if (!devTab) return; const n = (S.groups || []).length, t = devTabText(n); devTab.firstChild.textContent = t; devTab.setAttribute('aria-label', `${t}. Open Devices`); }
function devOpen(v) { holdPage();
  if (!desk) return; v = !!v && desk.classList.contains('tight'); const was = desk.classList.contains('devopen'); desk.classList.toggle('devopen', v); devTab?.setAttribute('aria-expanded', String(v));
  if (v && !was) { setTimeout(() => devp.el.querySelector('button, [tabindex="0"]')?.focus?.({ preventScroll: true }), 50); } else if (!v && was) devTab?.focus?.({ preventScroll: true });
}
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && desk?.classList.contains('roomyopen') && !document.querySelector('dialog[open], .zmenu40, .ctxmenu') && !document.body.classList.contains('pdragging')) { ev.preventDefault(); toggleDev(true); return; }
  if (ev.key === 'Escape' && desk?.classList.contains('devopen') && !document.querySelector('dialog[open], .zmenu40, .ctxmenu') && !document.body.classList.contains('pdragging')) { ev.preventDefault(); devOpen(false); } });
window.addEventListener('wavwiz:zonesync', paintDevTab);
// 0.6.8-#6b: settings that change what Devices lists (e.g. Show Jukebox zone in Devices) re-read zones + S.jb at once
window.addEventListener('wavwiz:zones-changed', () => { refreshZones(); });
// 0.4.5 T1b: recompute on Appearance > Layout and on a DPR change (window moved to another monitor / Windows scaling changed); resize + Display size already call applyPanels
window.addEventListener('wavwiz:layout', () => applyPanels());
(function watchDpr() { try { const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`); mq.addEventListener('change', () => { applyPanels(); watchDpr(); }, { once: true }); } catch { /* old browser */ } })();
// 0.4.9 F83: expanding the Library shows the queue in the right column (a collapsed one opens); collapsing it puts the queue back as it was,
// unless the user changed it meanwhile with the column's show / hide control
let libListWas = null;
function setPanels(n, opened = null) { holdPage(); const wasLib = P6.exp === 'lib'; P6 = savePanels(normPanels(n)); lastOpened = opened; if (opened === 'lib') tightLib = P6.lib !== 'rail'; applyPanels();
  if (!wasLib && P6.exp === 'lib') { libListWas = P6.list; if (P6.list !== 'open') setList('open'); }
  else if (wasLib && P6.exp !== 'lib' && libListWas != null) { const w = libListWas; libListWas = null; if (w !== P6.list) setList(w); } }
/** Paint the layout for this width (auto-rail is applied here only, never saved). */
function applyPanels(first = false) {
  if (!desk) return;
  const mode = loadLayoutMode(), wantTight = isTight(window.innerWidth, pageZoom(), window.devicePixelRatio || 1, mode), roomy = wantTight && mode === 'roomy', tight = wantTight && !roomy && !P6.exp && P6.list !== 'expanded';   desk.classList.toggle('tight', tight); desk.classList.toggle('roomy', roomy); if (!tight) devOpen(false);   // 0.4.8 F58: Roomy uses Classic's (Full's) own Devices panel / collapsed bar - no .tight overrides; only Auto on a narrow window keeps the T1 tab   // 0.4.6 F31: Roomy (the user's choice) holds in the expanded Library / Queue / Devices views too; Auto keeps the T1 opt-out.   // an expanded Library / Devices view keeps its own layout if (!tight) devOpen(false);
  // 0.4.5 T1: tight = the Library on its rail (until opened from it), Devices behind the right-edge tab; Sound / Queue / Now Playing take the width
  if (lastOpened === 'dev') roomyDev = P6.dev !== 'rail';
  const e = roomy ? (P6.exp ? { ...P6, auto: false } : { ...P6, lib: tightLib ? P6.lib : 'rail', dev: roomyDev ? P6.dev : 'rail', auto: false })   // F58: Roomy = Library on its rail, Devices folded to Full's collapsed bar (until opened from them)
    : tight ? (P6.exp ? { ...P6, auto: false } : { ...P6, lib: tightLib ? P6.lib : 'rail', dev: 'normal', auto: false }) : effective(P6, window.innerWidth, { opened: lastOpened }), ls = shown(e, 'lib'), ds = shown(e, 'dev');
  paintDevTab();
  desk.classList.toggle('libcollapsed', ls === 'rail'); desk.classList.toggle('libexpanded', ls === 'expanded');
  if (ds === 'expanded' && !roomy && !desk.classList.contains('devexpanded')) devp.cacheStd?.();   // F221 A t1148u: measure Speakers width while desk is still standard, BEFORE the expand flip
  desk.classList.toggle('devcollapsed', ds === 'rail'); desk.classList.toggle('devexpanded', ds === 'expanded');
  desk.classList.toggle('roomyopen', roomy && ds === 'normal');   // 0.4.9 F65: Roomy keeps Full's narrow Devices bar in the grid; opened from it, Devices slides out over the side (as the 0.4.5-0.4.7 slide-over did)
  desk.classList.toggle('autorail', !!e.auto);
  libpanel.classList.toggle('israil', ls === 'rail'); libpanel.title = ls === 'rail' ? 'Open the Library panel ( [ )' : '';
  const b = libpanel.querySelector('.libcol'); setChev(b, chevronDir(e, 'lib')); b.setAttribute('aria-expanded', String(ls !== 'rail')); b.setAttribute('aria-label', chevronLabel(e, 'lib'));
  paintExpandBtn(libpanel.querySelector('.libexp'), 'Library', ls === 'expanded');   // 0.3.1 B4/B6
  if (ls !== 'expanded') desk.classList.remove('libdev');   // 0.3.5 J11
  const devSz = desk.classList.contains('libdev') ? 'standard' : ds === 'rail' ? 'collapsed' : ds === 'expanded' ? 'expanded' : 'standard';
  if (devSz !== devWasSize || devHl != null || first) { devWasSize = devSz; devp.setSize(devSz, devHl); } devHl = null;   // 0.6.8e: only when the size really changes - a resize must not rebuild the Devices cards
  if ((ls === 'expanded') !== libWasExp || first) { libWasExp = ls === 'expanded'; libC.setExpanded(libWasExp); }
  if (ls !== 'rail' && !first && !libWasShown) libC.reload(); libWasShown = ls !== 'rail';   // 0.6.8e: redraw the Library only when it is opened, never on a resize (it blanked the list mid-drag)
  syncMini();
  if (first) setTimeout(() => nowc.viz?.resize?.(), 0);
  // 0.4.7: panels shown / pinned / Roomy-Full / display size changed: anything that fits itself to a panel (the Library tab row) re-measures after layout
  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('wavwiz:relayout')));
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
    const wide = desk.classList.contains('listexpanded') && !desk.classList.contains('libexpanded') && !desk.classList.contains('devexpanded');
    const on = !window.matchMedia('(max-width:900px)').matches;   // 0.5.0 F88: shown with the Queue collapsed / open / full-screen; F137b: also in the narrow column beside the expanded Library (Copy is now an icon) - the gap check below still hides it when the header is too tight; phone (<=900px) keeps its own Up next
    nb.hidden = !on; nb.classList.toggle('wide', wide); listt.el.classList.toggle('nbshown', false);
    if (!on || !desk.isConnected) return;
    const two = desk.classList.contains('libexpanded') && !desk.classList.contains('listcollapsed');   // F137b: narrow Queue beside the expanded Library has no free gap in its title row - Up next gets its own slim line under it
    listt.head.classList.toggle('nb2', two);
    if (two) { nb.style.left = ''; nb.style.maxWidth = ''; nb.classList.remove('tight'); listt.el.classList.toggle('nbshown', true); return; }
    const hd = listt.head.getBoundingClientRect(); let col = nowc.ctlPanel.getBoundingClientRect();
    if (!col.width) col = hd;   // F137b: Now Playing column hidden (mini NP under the narrow Queue) - center on the Queue header, still gap-checked
    if (!hd.width) { nb.hidden = true; return; }
    // 0.4.8 F50 / 0.6.8: the free gap is between the title (and sort chip) and the track count / tools - never over either of them.
    // Wide (any desktop Queue that is not beside the expanded Library): Up next starts after the title and fills the gap; the count stays on the right.
    const L = listt.leftEdge() + 16, Rr = listt.rightEdge() - 16, gap = Rr - L, c = col.left + col.width / 2;
    nb.classList.toggle('tight', gap < 300); const zf = pageZoom(); nb.style.maxWidth = Math.max(0, Math.round(gap / zf)) + 'px';   // rects are zoomed, styles are not (Display size)
    const w = Math.min((nb.scrollWidth * pageZoom()) || gap, gap), x = !desk.classList.contains('libexpanded') ? L + w / 2 : Math.min(Math.max(c, L + w / 2), Rr - w / 2);   // wide Queue: starts right after the title
    nb.style.left = Math.round((x - hd.left) / zf) + 'px'; nb.hidden = gap < (wide ? 160 : 110) * zf; listt.el.classList.toggle('nbshown', !nb.hidden);   // too tight: hidden, the row pill shows instead
  };
  const later = () => { if (!raf) raf = requestAnimationFrame(place); };
  placeNext = () => { later(); setTimeout(later, 360); };
  const ro = new ResizeObserver(later); ro.observe(nowc.ctlPanel); ro.observe(listt.head); ro.observe(desk);
  window.addEventListener('resize', later); window.addEventListener('wavwiz:npcollapsed', placeNext); window.addEventListener('wavwiz:upnext', later);
  new MutationObserver(ms => { if (ms.some(m => !nb.contains(m.target))) later(); }).observe(listt.head, { childList: true, subtree: true, characterData: true });
  later();
}
function toggleList(force) { libListWas = null; const c = force ?? !desk.classList.contains('listcollapsed'); setList(c ? 'collapsed' : 'open'); }
/** 0.3.2 F13: collapsed · open · expanded (rises over the EQ / visualizer at center-column width; Now Playing stays visible below). */
// 0.3.3 G5: expanding the Playlist slides Now Playing up with it to the top of the center column (covering the EQ / visualizer, which stop
// rendering while covered); collapsing reverses it. Both move with the Playlist's timing (FLIP: measure, switch, animate from the old spot).
export const LIST_ANIM = GLIDE;   // 0.3.6 K8: the one shared glide (motion.js)
function flipList(change) { holdPage();
  const els = [nowc.el, listt.el].filter(Boolean), before = els.map(e => e.getBoundingClientRect().top);
  change();
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // 0.4.9 F72: the slide would push the translated panel past the bottom of the desk for a few frames; the page then grew a scrollbar,
  // which narrowed the viewport and shifted Devices left (the right-edge flash). Clip the desk while the slide runs.
  const anims = [];
  els.forEach((e, i) => { const dy = before[i] - e.getBoundingClientRect().top; if (Math.abs(dy) < 1 || !e.animate) return; anims.push(e.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: LIST_ANIM.ms, easing: LIST_ANIM.ease })); });
  holdFor(anims, LIST_ANIM.ms);   // 0.4.9 F74: the shared page hold (motion.js) replaces F72's desk-only clip
}
function setList(st) { const was = desk.classList.contains('listexpanded'); flipList(() => { desk.classList.toggle('listcollapsed', st === 'collapsed'); desk.classList.toggle('listexpanded', st === 'expanded'); });
  if (was !== (st === 'expanded')) window.dispatchEvent(new CustomEvent('wavwiz:listcover', { detail: { covered: st === 'expanded' } })); P6 = savePanels({ ...P6, list: st }); listt.setCollapsed?.(st); syncMini(); placeNext(); if (st !== 'collapsed') setTimeout(() => { listt.relayout?.(); nowc.viz?.resize?.(); }, 340); }
function listStepUi(dir) { if (P6.exp === 'lib') { libListWas = null; return setList(dir === 'up' ? 'open' : 'collapsed'); } setList(listStep(P6, dir).list); }   // 0.4.9 F83: beside the Library only shown / hidden
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
// 0.6.8f (t1729u): menu.js drawerOutsideClick - any click outside the menu column closes the open menu (capture phase).
let drawerOutsideWired = false;
function toggleDrawer(open) {
  if (!drawerOutsideWired) { drawerOutsideWired = true; document.addEventListener('click', ev => { if (drawerOutsideClick(drawerEl, ev.target)) toggleDrawer(false); }, true); }
  drawerEl.classList.toggle('open', open); document.querySelector('.hamburger')?.setAttribute('aria-expanded', String(open)); if (open) drawerEl.querySelector('nav button')?.focus(); }

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
    if (kind === 'zone') { document.querySelector('.devpanel .zadd-new')?.click(); pulseSel('.devpanel .tree42-h'); }
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
    case 'mixer': return window.dispatchEvent(new CustomEvent('wavwiz:mixer'));   // F149: pinned Master volume panel (Alt+V)
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
// F250-P7: same Now instance remains mounted/playing below the owned modal.
let eqSheet = null;
export function closePhoneEqSheet() { eqSheet?.close(); }
export function openPhoneEqSheet() {
  if (eqSheet) { eqSheet.x.focus(); return eqSheet; }
  eqSheet = openPhoneSound(S, { mount: el => document.body.append(el), from: nowc.el?.querySelector('.np-phone-sound') || document.activeElement, refreshAll, onClose: () => { eqSheet = null; } });
  return eqSheet;
}
export function showEq() {
  if (!wide()) {
    if (S.view !== 'now') go('now');
    openPhoneEqSheet();   // F128: phone never uses the hidden NP center stage
    return;
  } else {
    if (pageDlg) { pageDlg.close(); pageDlg = null; }
    if (P6.exp === 'lib') toggleLibExpanded(false); else if (P6.exp === 'dev') toggleDevExpanded(false);
    if (P6.list === 'expanded') setList('open');
  }
  nowc.showCenter?.('eq');
  const front = () => { const st = nowc.stage; if (st) { st.dataset.eqfront = String(Date.now()); pulse(st); } };
  if (!reduced()) setTimeout(front, GLIDE.ms); else front();
}
// F92: other modules (room.js phone role) can ask for a page without importing main.js
// 0.5.0 F109: All sound settings (center EQ) -> that speaker's settings page
window.addEventListener('wavwiz:openspk', e => { const id = +e.detail; if (!id) return;
  if (wide()) { if (!openSpeakerSettings(id)) jumpTo('device', id); return; }
  closePhoneEqSheet();   // F128: close the EQ sheet first (no stacked full-screen UIs)
  go('devices'); let n = 0; const t = () => { if (!openSpeakerSettings(id, true) && n++ < 20) setTimeout(t, 60); }; setTimeout(t, 0); });
window.addEventListener('wavwiz:go', e => { if (typeof e.detail === 'string') go(e.detail); });
export function go(k, force) {
  if (k?.startsWith?.('settings:')) return openSettings(S, refreshAll, go, k.slice(9));
  if (k === 'zones' || k === 'rooms') k = 'devices';
  if (k === 'calibrate') return canControl(S) ? openCalibration(S, refreshAll) : undefined;
  if (k === 'jukebox') return startJukebox(S);   // 0.3.0 §1 (beta)
  // 0.3.5 J9: Diagnostics, Away-from-home access and About are Settings sections (phone and desktop)
  if (k === 'diag' || k === 'remote' || k === 'about') return openSettings(S, refreshAll, go, k);
  if (k === 'sleep') return nowc.openSleep?.();       // 0.3.5 J8: Now Playing > Sleep
  // 0.2.1 F8: Theme and Visualizer live on Settings > Appearance (one home)
  if (k === 'themes' || k === 'visualizer') return openSettings(S, refreshAll, go, (k === 'themes' || isRealPhone()) ? 'theme' : 'viz');   // F125: phone has no Visualizer sub (0.6.8-#5: a real phone, not a narrow PC window)
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
    if (k === 'rip' && !ripAllowed()) return;   // 0.4.8 F57
    if (k === 'rip' || k === 'tags' || k === 'cleanup') { if (!desk.classList.contains('libexpanded')) toggleLibExpanded(true); libC.showTab(k); return; }
    if (k === 'eq') return showEq();     // Playback > Sound / EQ = the center EQ panel (0.3.7: one function for every EQ entry point)
    if (k === 'queue') return openQueue();
    return openPage(k);
  }
  if (k === 'scenes' || k === 'schedules' || k === 'alarms') return openScenesSchedules(S, refreshAll);   // phone sheet
  if (k === 'eq') return showEq();
  // F250-P5: one return bookmark on the existing router, not browser history.
  // Keep the prior DOM mounted under Now, preserving Library source/filter state.
  const returning = k === 'now:collapse' ? go.phoneNowReturn : null;
  if (k === 'now:collapse') k = returning?.view || 'library'; // direct/startup fallback
  if (k === 'now' && S.view !== 'now') go.phoneNowReturn = { view: S.view, el: content.firstChild, scroll: desk.scrollTop, focus: document.activeElement };
  if (S.view !== k) { views[S.view]?.hide?.(); if (S.view === 'now') nowc.hidePhone?.(); }
  S.view = k; desk.dataset.view = k;
  if (k !== 'now') {
    const v = views[k];
    if (returning && returning.el === content.firstChild && returning.el === v?.el) v.show?.();
    else { content.replaceChildren(v.el); v.reload?.(); }
    go.phoneNowReturn = null;
  }
  else if (!content.firstChild) content.replaceChildren(views.library.el);
  tabs.querySelectorAll('button').forEach(b => { const on = b.dataset.k === k; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  navButtons.forEach(b => b.classList.toggle('on', b.dataset.k === k));
  document.querySelectorAll('.navwide [data-k]').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  if (k === 'now') { nowc.drawChecklist(); nowc.el?.querySelector('.np-phone-collapse')?.focus({ preventScroll: true }); }
  if (returning) { desk.scrollTop = returning.scroll; if (returning.focus?.isConnected) returning.focus.focus({ preventScroll: true }); }
  else window.scrollTo(0, 0);
}
const checklistGo = a => go(a);
/** 0.3.2 F3: the mini player (replaces Remote mode). In a browser it is a small popup window; WavWiz Player has its own (tray > Mini player).
 *  It never joins as a speaker, so opening or closing it never changes the streams (F2). */
export function openMini() {
  try { window.chrome?.webview?.postMessage({ cmd: 'mini' }); if (window.chrome?.webview) return; } catch { /* not the Player */ }
  window.open('/mini.html', 'wavwiz-mini', 'popup,width=420,height=145');
}

if (typeof window !== 'undefined') window.addEventListener('wavwiz:queuechanged', () => refreshAll());
export async function refreshAll() { await Promise.allSettled([refreshNow(), refreshZones(), refreshStatus(), refreshRadio()]); nowc?.drawChecklist(); }
// 0.4.0: the selected zone (Now Playing bar, Queue, mini, hotkeys) - Z.init wires the API zone; a change redraws what shows a zone
Z.init(S, { refreshNow: () => refreshNow(), manage: () => { if (wide()) setDevSize('expanded'); else go('devices'); } });
window.addEventListener('wavwiz:zone', () => { devv.draw(); devp.draw(); nowc.draw(); listt.draw(); });
let zonesSoon = 0; const refreshZonesSoon = () => { clearTimeout(zonesSoon); zonesSoon = setTimeout(refreshZones, 150); };   // 0.4.8 F61: was 500 ms; device cards follow a track change in well under 1 s
async function refreshNow() { try { const responseZone = globalThis.__wavwizZoneKey, responseRoute = S._streamRoute;
    // Phone Queue edits outlive DOM engines. Reads started before/during a write
    // cannot re-enable stale indices, even if their HTTP response arrives late.
    // Capture every request's generation: a wide-started read may return on phone.
    const edit = S._phoneQueueEdit, read = edit?.readToken(), startedPhone = matchMedia('(max-width:900px)').matches;
    const r = await api('/stream');
    // F250-P5 amendment: provenance follows the resolved API request target,
    // not the visual zone. Route identity also rejects A → B → A races, while
    // linked selections sharing one stream need no playing tick/new evidence.
    // Wide desktop retains its existing ingest behavior.
    const phone = matchMedia('(max-width:900px)').matches, phoneRead = startedPhone || phone;
    if (phone && responseRoute !== S._streamRoute) return;
    if (phoneRead && edit && !edit.canRead(read)) return;
    S._nowZoneKey = responseZone; S._nowRoute = responseRoute; S.now = r.now; S.queue = r.queue.items; if (phoneRead) edit?.didRead(read);
    // F248: ingest server position into the smooth clock; do not let valid-duration zero blips poison localPos.
    const at = performance.now(), rec = reconcileSmoothPosition(S._smooth, r.now, r.now?.positionMs, at);
    S._smooth = rec; S.localPos = rec.posMs; S.localAt = rec.at;
    whenIdle(() => { nowc.draw(); listt.draw(); }, 'now'); drawStatus(); if (S.view === 'queue') drawQueue(); } catch (e) { handleErr(e); } }
async function refreshZones() { const t0 = Date.now(); try { let [z, g, jb, cast, ord] = await Promise.all([api('/zones'), api('/groups').catch(() => S.groups), api('/jukebox/zone').catch(() => S.jb), api('/cast').catch(() => S.cast), api('/zones/order').catch(() => undefined)]); S.jb = jb; S.cast = cast; if (ord !== undefined && t0 >= cardOrderChangedAt()) setCardOrder(ord?.order);   /* 0.6.9 #12: the shared Devices card order */   /* 0.4.9 F78 */ if ((S._optAt || 0) >= t0) g = S.groups;   /* F269: a read that started before an optimistic move must not put the speaker back */ S._groupsAt = Date.now(); const idsChanged = (S.zones || []).map(x => x.id).join() !== z.map(x => x.id).join(); S.zones = z; S.groups = g; Z.sync(); window.dispatchEvent(new CustomEvent('wavwiz:zonesdata'));   /* 0.4.8 F49: the mixer repaints live */ if (isDevDragging()) { /* redrawn when the drop lands */ } else if (idsChanged) { devv.draw(); devp.draw(); } else whenIdle(() => { devv.draw(); devp.draw(); }, 'zones');   // 0.3.0 §9: never re-render under a dragged slider (a removed device still redraws at once)
  nowc.drawStrip(); drawStatus(); } catch (e) { handleErr(e); } }
async function refreshStatus() { try { S.status = await api('/status'); } catch (e) { handleErr(e); } try { const c = await api('/checklist'); S.setupLeft = c.dismissed || checklistDismissedLocal() ? 0 : c.remaining; } catch { S.setupLeft = 0; } drawStatus(); }
async function refreshRadio() { try { S.radio = await api('/radio'); } catch (e) { handleErr(e); } }
function handleErr(e) { if (e instanceof ApiError && e.status === 401) location.reload(); else if (e.status !== 0) toast(e.message, true); }
async function act(path, body, method = 'POST') { try { await api(path, { method, body }); } catch (e) { toast(e.message, true); } }

let wsTries = 0;
/** 0.0.7: ticket-authenticated, self-healing UI event socket (keepalive + watchdog + backoff; see wsconn.js). */
function connectWs() {
  const dot = document.getElementById('conn'), txt = document.getElementById('conntxt');
  const setConn = (ok, label) => { S.connected = ok; if (dot) { dot.className = 'dot ' + (ok ? 'ok' : 'bad'); dot.title = label; } if (txt) { txt.textContent = label; txt.title = label; } const wrap = dot?.closest?.('.conn'); if (wrap) wrap.title = label; drawStatus(); };
  let downTimer = null;
  S.live = liveSocket('/ws', {
    onOpen: () => { clearTimeout(downTimer); setConn(true, 'Connected'); if (wsTries++) refreshAll(); },
    // short blips (a phone waking up) reconnect silently; only show the red state when it lasts longer than 3 s
    onClose: () => { clearTimeout(downTimer); downTimer = setTimeout(() => { if (!S.live?.socket() || S.live.socket().readyState !== 1) setConn(false, 'Reconnecting…'); }, 3000); },
    onUnauthorized: () => location.reload(),
    onMessage: ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'now' || m.type === 'queue') { refreshNow(); refreshZonesSoon(); } else if (m.type === 'zones') { refreshZones(); refreshStatus(); }
      else if (m.type === 'favorites') window.dispatchEvent(new CustomEvent('wavwiz:favorites'));   // 0.2.0 item 14
      else if (m.type === 'library') { refreshStatus(); window.dispatchEvent(new CustomEvent('wavwiz:library')); nowc.drawChecklist(); }
      else if (m.type === 'tick') { if (S.now?.state === 'playing') refreshNow(); if (S.view === 'devices' || wide() || S.view === 'now') refreshZones(); }
      else if (m.type === 'pairing') pairReqs?.refresh();   // 0.6.9 #15
      else if (m.type === 'notice') toast(m.data.message, true);
      else if (m.type === 'hello' && m.data?.appVersion && S.auth && m.data.appVersion !== S.auth.appVersion) { S.auth.appVersion = m.data.appVersion; paintVersion(); toast(`WavWiz was updated to ${m.data.appVersion}. Reload the page to use it.`); }   // 0.4.6
      else if (m.type === 'schedules' || m.type === 'scenes') window.dispatchEvent(new CustomEvent('wavwiz:schedules'));
      else if (m.type === 'sleep') { sleepChip(S, m.data); window.dispatchEvent(new CustomEvent('wavwiz:sleep', { detail: m.data })); }
      else if (m.type === 'alarm') showAlarm(S, m.data);
      else if (m.type === 'jukebox') jukeboxChip(S, m.data);   // 0.3.0 §1   // 0.3.0: alarm banner / full-screen takeover on phones
      else if (m.type === 'calphone') window.dispatchEvent(new CustomEvent('wavwiz:calphone', { detail: m.data }));   // 0.2.2 T9
      else if (m.type === 'calrun' || m.type === 'miclevel' || m.type === 'calmics') window.dispatchEvent(new CustomEvent('wavwiz:' + m.type, { detail: m.data }));   // 0.2.5 PC-mic run, live mic level, calibration-mic list
      else if (m.type === 'art') { artPushed(m.data); window.dispatchEvent(new CustomEvent('wavwiz:art', { detail: m.data })); }   // 0.2.2 T4b
      else if (m.type === 'rip') window.dispatchEvent(new CustomEvent('wavwiz:rip', { detail: m.data }));   // 0.6.8 CD ripper: disc insert/eject + live job progress
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
  if (lb) { const n = libCountLabel(tracks); lb.textContent = n.text; lb.title = n.title; } if (db) db.textContent = `${online}/${S.zones.length}`;
  // 0.5.0 F106: fold the count into the vertical rail title, like the Auto Devices tab ("DEVICES · 2 ZONES")
  const lt = document.querySelector('.libpanel .prail-t'), dt = document.querySelector('.devpanel .prail-t');
  if (lt) lt.textContent = tracks != null ? `LIBRARY · ${libCountLabel(tracks).text}` : 'LIBRARY';
  if (dt) dt.textContent = devTabText((S.groups || []).length);
  statusbar.replaceChildren(
    // 0.2.2 T10: the top-right indicator is the one home of "Connected"; the status bar speaks up only when the connection drops
    S.connected === false ? h('span', { class: 'sb sbconn', role: 'status' }, h('span', { class: 'dot bad' }), 'Reconnecting…') : null,
    h('span', { class: 'sb' }, `${online} of ${S.zones.length} device${S.zones.length === 1 ? '' : 's'} online`),
    h('span', { class: 'sb' }, playing ? `Playing on ${act_ ? 'zone “' + act_.name + '”' : on.length + ' device' + (on.length === 1 ? '' : 's')}` : (S.now?.state === 'paused' ? 'Paused' : 'Stopped')),
    bad.length ? h('span', { class: 'sb warn', title: bad.map(z => `${z.name}: ${z.room.text}`).join('\n') }, '⚠ ' + bad.map(z => `${z.name} ${z.room.state}`).join(', ')) : null,
    h('span', { class: 'grow' }), tracks != null ? h('span', { class: 'sb' }, `${tracks} song${tracks === 1 ? '' : 's'} in the library`) : null,
    S.setupLeft ? h('button', { class: 'sb link', onclick: () => openSetup() }, `Getting started: ${S.setupLeft} to go`) : null,
    h('button', { class: 'sb link', onclick: () => go('about'), title: 'About, credits and licenses', 'data-wwv': 'WavWiz BETA {v}' }, `WavWiz BETA ${S.auth?.appVersion ?? ''}`));
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
let qReorder = null, qMenus = [], qSettled = null, qRenderedZone = null, qPendingRefresh = false, qResume = null, qPaintSig = null;   // F252: skip identical phone Queue paints (keeps row <img>s)
// F250-P3 amendment: transaction ownership belongs to the phone controller,
// never a disposable row/drag engine. The optional menu adapter shares it with
// the phone current-song actions; desktop/native table callers do not opt in.
const qZoneKey = () => JSON.stringify([Z.zoneIdFor(Z.current())]); // linked choices edit the same actual queue
const qOccurrence = q => q && JSON.stringify([q.id, q.kind, q.refId, q.location]);
// F252-amend2: shared complete rendered-input signature for drawQueue skip AND qResume retained return.
const qRowSig = q => [qOccurrence(q), q?.title, q?.artist, q?.album, q?.durationMs, q?.artUrl, q?.source, q?.sourceLabel, q?.kind, q?.refId];
/** 0.7.0: the playing radio row's second line names the song (♪ Artist – Song). */
const qLiveLine = l => l ? h('div', { class: 't2 ell qlive', title: l.artist ? `${l.artist} – ${l.song}` : l.song }, '♪ ', l.artist ? `${l.artist} – ${l.song}` : l.song) : null;
const qNowItemSig = it => it == null ? null : [qOccurrence(it), it.title, it.artist, it.album, it.artUrl, it.source, it.sourceLabel, it.kind, it.refId, it.kind === 'radio' ? S.now?.liveTitle || null : null];   // 0.7.0: repaint the radio row when the song changes
function qPaintSignature() {
  const can = canControl(S);
  const locked0 = !!loadLayout(true).locked, busy0 = qEdit.pending();
  const zone0 = Z.current(), choices0 = Z.choicesNow();
  const nowItem = S.now?.item, hasNow0 = !!nowItem && S.now?.state !== 'stopped';
  return JSON.stringify([
    [zone0?.key, zone0?.playbackId, zone0?.name],
    choices0.map(c => [c.key, c.playbackId, c.name]),
    S.queue.map(qRowSig),
    S.now?.index ?? -1, S.now?.state ?? null, hasNow0, qNowItemSig(nowItem),
    can, locked0, busy0, artCv()]);
}
const qEdits = new Map(), qReadGenerations = new Map();
const qEdit = S._phoneQueueEdit = {
  pending: () => qEdits.has(qZoneKey()),
  readToken: () => { const zone = qZoneKey(), tx = qEdits.get(zone); return { zone, generation: qReadGenerations.get(zone) || 0, tx, settled: !!tx?.settled }; },
  canRead: read => !!read && read.zone === qZoneKey() && read.generation === (qReadGenerations.get(read.zone) || 0) && (!read.tx || read.settled) &&
    (!qEdits.has(read.zone) || (qEdits.get(read.zone) === read.tx && read.settled)),
  didRead: read => {
    const tx = qEdits.get(read.zone); if (!tx || tx !== read.tx || !read.settled) return;
    qEdits.delete(read.zone);
    // Resolve the actual resulting occurrence, not a stale destination index.
    const index = tx.move && tx.occurrence != null ? S.queue.findIndex(q => qOccurrence(q) === tx.occurrence) : -1;
    qSettled = { index, zone: read.zone, keyboard: tx.keyboard, error: tx.error };
  },
  run: async (path, body, method = 'POST', action = null) => {
    // Queue's existing Play next policy is lock-independent; ordinary moves/removes are not.
    const playNext = action === 'next' && path === '/queue/move' && method === 'POST';
    if (qEdit.pending() || !canControl(S) || (loadLayout(true).locked && !playNext)) return false;
    const zone = qZoneKey(), tx = { settled: false, move: path === '/queue/move',
      occurrence: body?.from != null ? qOccurrence(S.queue[body.from]) : null,
      keyboard: document.activeElement?.classList.contains('qgrip'), error: null };
    qEdits.set(zone, tx); qReadGenerations.set(zone, (qReadGenerations.get(zone) || 0) + 1);
    qMenus.forEach(m => m.close());
    if (S.view === 'queue' && !wide()) drawQueue();
    try { await api(path, { method, body }); } catch (e) { tx.error = e.message || 'Could not reorder'; }
    // Even a rejected/ambiguous response needs a fresh snapshot before retry.
    // A failed refresh leaves the fence in place until an ordinary poll succeeds.
    tx.settled = true;
    await refreshNow();
    if (S.view === 'queue' && !wide() && qEdits.has(zone)) drawQueue();
    if (tx.error) { toast(tx.error, true); return false; }
    return !qEdits.has(zone);
  }
};
function hidePhoneQueue() {
  // Ownership ends BEFORE detach/row replacement (including harmless refresh).
  qPendingRefresh = false; qReorder?.destroy(); qReorder = null;
  qMenus.forEach(m => m.destroy()); qMenus = [];
  qPaintSig = null;   // F252: next show / forced rebuild must not inherit a stale skip
}
// Rebind retained rows after hide(), never revive a canceled gesture/menu.
// An intervening data/access/lock/transaction change requires a fresh render.
function showPhoneQueue() { if (!qReorder && !qResume?.()) drawQueue(); }
function drawQueue() {
  // A complete ordered occurrence+zone snapshot proves an identical poll safe.
  // Do not tear an owned grip out from under a long drag on every stream tick.
  // F252: also skip teardown when the painted row signature is unchanged (WS tick /stream),
  // so phone Queue album <img> nodes are not recreated every second. Drag deferral clears
  // qPaintSig so the deferred post-drag redraw still replaces row closures.
  // F252-amend R1: row/menu validity uses occurrence (not object ===) so a skipped paint
  // after fresh JSON still allows jump/ellipsis. R2/R3: signature includes Now item +
  // zone name + choices inventory so summary/header/picker stay correct.
  // F252-amend2: qResume uses the same qPaintSignature() so retained Now→collapse
  // cannot certify stale badges/zone chrome after an accepted fresh JSON change.
  if (qReorder?.active && qReorder.isCurrent()) { qPendingRefresh = true; qPaintSig = null; return; }
  const root = views.queue.el; const can = canControl(S);
  const sig = qPaintSignature();
  // Do not skip while a Queue menu/sheet is open: unlock+drawQueue after an in-menu lock
  // must tear it down (same sig as last unlocked paint would otherwise no-op).
  if (sig === qPaintSig && root.firstChild && !document.querySelector('dialog.songsheet[open], .qmenu')) return;
  hidePhoneQueue();
  const total = S.queue.reduce((a, q) => a + (q.durationMs || 0), 0), cur = S.now?.index ?? -1;
  const lay = loadLayout(true), locked = !!lay.locked, busy = qEdit.pending(), dragOk = canDragRows({ can: can && !busy, locked });
  const zone = Z.current(), zoneKey = () => JSON.stringify([Z.current()?.key, Z.current()?.playbackId]);
  const renderedZone = zoneKey(); qRenderedZone = renderedZone;
  const renderedOcc = S.queue.map(qOccurrence), renderedNow = JSON.stringify([S.now?.index, S.now?.state, qNowItemSig(S.now?.item)]), bindMenus = [];
  const sameOcc = (i, occ) => qOccurrence(S.queue[i]) === occ;   // F252-amend R1: value identity after JSON refresh
  const rows = S.queue.map((q, i) => {
    const playing = i === cur && S.now?.state !== 'stopped', occ = qOccurrence(q);
    const grip = h('button', { type: 'button', class: 'qgrip', disabled: !dragOk, 'aria-label': `Reorder ${q.title}`, 'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown', oncontextmenu: ev => { ev.preventDefault(); ev.stopPropagation(); }, title: 'Drag to reorder; Alt+Up or Alt+Down to move', 'aria-pressed': 'false', onclick: ev => ev.stopPropagation() }, '⠿');
    const more = can ? h('button', { type: 'button', class: 'more qmore', 'aria-label': `Actions for ${q.title}`, 'aria-haspopup': 'menu' }, '⋯') : null;
    const rowEl = h('div', { class: 'item' + (playing ? ' cur' : ''), 'data-i': i, 'data-qtitle': q.title, onclick: () => canControl(S) && !qEdit.pending() && zoneKey() === renderedZone && sameOcc(i, occ) && act('/stream/jump', { index: i }) },
      grip, npCover(q, 96, 'qrow-art'), h('span', { class: 'num', 'aria-label': `Queue position ${i + 1}` }, playing ? (S.now.state === 'playing' ? '▶' : 'Ⅱ') : i + 1),
      h('div', { class: 't' }, h('div', { class: 't1 ell' }, srcPill(q), q.title), qLiveLine(playing ? liveSong(S.now, q) : null) || h('div', { class: 't2 ell' }, [q.artist, q.album].filter(Boolean).join(' • '))),
      h('span', { class: 'dur' }, q.durationMs ? fmtDur(q.durationMs) : ''), more);
    if (can) bindMenus.push(() => attachQueueMenu(rowEl, S, { refreshAll, showInLibrary, queueEdit: qEdit }, i, () => !!loadLayout(true).locked, {
      menuButton: more, suppressed: () => qReorder?.blocked(), valid: () => S.view === 'queue' && !wide() && zoneKey() === renderedZone && sameOcc(i, occ),
      onOpen: () => qReorder?.cancel()
    }));
    return rowEl;
  });
  const phoneKeep = () => (pKeep ??= keepControl({ can: () => canControl(S) }));
  const item = S.now?.item, state = S.now?.state, hasNow = !!item && state !== 'stopped';
  // Projection only: shared Now state/actions, no player/clock/Media Session mount.
  // Keep the very same cover node for an unchanged item/source/zone, including
  // its in-flight decode or last-good fallback. Stop clears the cache. All item
  // fields participate so a real occurrence/source/art metadata change replaces it.
  const artKey = hasNow ? JSON.stringify([renderedZone, item]) : null;
  if (root._qSummaryArt?.key !== artKey || !hasNow) root._qSummaryArt = hasNow ? { key: artKey, el: npCover(item, 192, 'qsummary-art') } : null;
  const summary = h('section', { class: 'qsummary', 'aria-label': 'Now playing summary' },
    h('h2', {}, hasNow ? (state === 'playing' ? 'Now playing' : 'Paused') : 'Nothing playing'),
    hasNow ? h('div', { class: 'qsummary-card' }, root._qSummaryArt.el, h('div', { class: 't' }, ...(l => l ? [h('b', { class: 'ell' }, l.song), h('div', { class: 'small dim ell' }, [l.artist, item.title].filter(Boolean).join(' · '))] : [h('b', { class: 'ell' }, item.title), h('div', { class: 'small dim ell' }, item.artist || '')])(liveSong(S.now, item)), h('span', { class: 'small dim' }, 'On ' + (zone?.name || 'selected zone'))),   // 0.7.0 radio song
      h('button', { type: 'button', class: 'iconbtn qsummary-play', disabled: !can, 'aria-label': state === 'playing' ? 'Pause' : 'Resume', onclick: () => canControl(S) && zoneKey() === renderedZone && act(S.now?.state === 'playing' ? '/stream/pause' : '/stream/resume') }, icon(state === 'playing' ? 'pause' : 'play'))) : h('p', { class: 'small dim' }, 'Choose a song from the queue or Library.'));
  // 0.6.8: compact Queue head — same icon row as the desktop header (∞ / recent / save / clear / lock) beside the track count; Up next on one ellipsis line.
  const nTracks = S.queue.length;
  const trackLabel = `${nTracks} track${nTracks === 1 ? '' : 's'}${total ? ' • ' + fmtDur(total) : ''}`;
  const lockTip = locked ? 'Queue locked - click to unlock' : 'Lock the queue (no reordering or sorting)';
  const lockBtn = h('button', { type: 'button', class: 'plus pllock' + (locked ? ' on' : ''), 'data-act': 'phonelock', 'aria-pressed': String(locked), title: lockTip, 'aria-label': lockTip, onclick: () => { saveLayout(setLocked(loadLayout(true), !locked), true); drawQueue(); } }, icon(locked ? 'lock' : 'unlock'));
  const recentBtn = h('button', { type: 'button', class: 'plus', 'data-act': 'recentqueues', 'aria-label': 'Recent queues', title: 'Recent queues…', onclick: () => openRecentQueues({ can: canControl(S) }) }, icon('history'));
  const saveBtn = can && nTracks ? h('button', { type: 'button', class: 'plus', 'data-act': 'savequeue', 'aria-label': 'Save queue as a playlist', title: 'Save queue as a playlist', onclick: saveQueue }, icon('save')) : null;
  const clearBtn = can && nTracks ? h('button', { type: 'button', class: 'plus', 'data-act': 'clearqueue', 'aria-label': 'Clear the queue', title: locked ? CLEAR_LOCK_HINT : 'Clear the queue', disabled: locked || busy || undefined, onclick: () => { if (!locked && !qEdit.pending()) clearQueueFlow(S, { act, refreshAll }); } }, icon('trash')) : null;
  const tools = h('span', { class: 'row plbtns pq-tools', 'aria-label': 'Queue tools' }, phoneKeep(), recentBtn, saveBtn, clearBtn, can && nTracks ? lockBtn : null);
  const nextIdx = queueNextIndex(S.now, S.queue), nxt = nextIdx >= 0 ? S.queue[nextIdx] : null;
  const upNext = h('div', { class: 'plnext pq-upnext' + (nxt ? '' : ' none'), 'aria-label': 'Up next', title: nxt ? ['Up next', nxt.title, nxt.artist].filter(Boolean).join(' · ') : 'Nothing queued after this' },
    h('span', { class: 'pln-lbl' }, 'UP NEXT'),
    h('span', { class: 'pln-t1 ell' }, nxt ? (nxt.title || 'Untitled') : 'Nothing queued after this'),
    nxt?.artist ? h('span', { class: 'pln-dot', 'aria-hidden': 'true' }, '·') : null,
    nxt?.artist ? h('span', { class: 'pln-t2 ell' }, nxt.artist) : null);
  root.classList.toggle('pq-handset', !!isRealPhone());
  root.replaceChildren(h('header', { class: 'qpage-heading' }, h('div', { class: 'qtitle-line' }, h('h1', {}, 'Queue'), phonePick() || h('span', { class: 'qzone small dim' }, zone?.name || 'No zone selected')),
    h('div', { class: 'qcount-line' }, h('span', { class: 'dim small qcount' }, trackLabel), tools),
    upNext),
    summary, h('h2', { class: 'qrows-heading' }, 'Queue', h('span', { class: 'small dim' }, ' · all tracks')),
    nTracks ? h('div', { class: 'list qlist' }, rows) : h('p', { class: 'dim' }, 'The queue is empty. Open the Library and tap a song, or use ⋯ > Add to queue.'));
  const list = root.querySelector('.qlist');
  qResume = () => {
    // F252-amend2: complete signature (metadata/sourceLabel/choices/artCv) — not only occurrences.
    if (qPaintSignature() !== sig) return false;
    if (zoneKey() !== renderedZone || S.queue.length !== renderedOcc.length || !renderedOcc.every((occ, i) => qOccurrence(S.queue[i]) === occ) ||
      renderedNow !== JSON.stringify([S.now?.index, S.now?.state, qNowItemSig(S.now?.item)]) || can !== canControl(S) || locked !== !!loadLayout(true).locked || busy !== qEdit.pending()) return false;
    qMenus = bindMenus.map(bind => bind());
    if (list) qReorder = attachReorder(list, {
      guardRoot: root, can: () => canControl(S) && !qEdit.pending(), locked: () => !!loadLayout(true).locked, active: () => S.view === 'queue' && !wide(),
      // Full ordered occurrence snapshot, NOT refId identity (duplicates are valid).
      identity: () => JSON.stringify([zoneKey(), S.queue]), onStart: () => qMenus.forEach(m => m.close()),
      onEnd: () => queueMicrotask(() => { if (qPendingRefresh && S.view === 'queue' && !wide()) { qPendingRefresh = false; drawQueue(); } }),
      onMove: mv => qEdit.run('/queue/move', mv),
      onError: e => toast(e.message || 'Could not reorder', true),
      announce: text => { const el = root.querySelector('.qresult'); if (el) el.textContent = text; }
    });
    qPaintSig = sig;   // F252-amend2: hide cleared skip; resume that kept DOM restores it
    return true;
  };
  qResume();
  const result = h('div', { class: 'phone-qstatus qresult', role: 'status', 'aria-live': 'polite' }, busy ? 'Updating queue — waiting for the current order…' : ''); root.append(result);
  if (qSettled && qSettled.zone !== qZoneKey()) qSettled = null;
  if (qSettled && qSettled.zone === qZoneKey()) {
    const { index, keyboard, error } = qSettled, row = rows[index]; qSettled = null;
    if (error) result.textContent = `Could not reorder: ${error}`;
    else if (!row) result.textContent = 'Queue updated';
    if (row && !error) { row.classList.add('qsettled'); result.textContent = `Moved ${S.queue[index]?.title} to #${index + 1}`; row.scrollIntoView({ block: 'nearest' }); if (keyboard) row.querySelector('.qgrip')?.focus({ preventScroll: true }); }
  }
  qPaintSig = sig;   // F252: remember what this paint drew
}
// A selected-zone switch cancels immediately, before its async stream refresh.
window.addEventListener('wavwiz:zonesync', () => { if (qRenderedZone !== JSON.stringify([Z.current()?.key, Z.current()?.playbackId])) { qReorder?.cancel(); qMenus.forEach(m => m.close()); } });
/** 0.4.2: the phone Queue page names its zone and lets you switch the zone it shows (same zone choices as the Now Playing chip). */
function phonePick() {
  const cs = Z.choicesNow(), cur = Z.current(); if (cs.length < 2) return null;
  const sel = wsel({ class: 'qzpick pq', 'aria-label': 'Zone whose queue to show', title: 'Show another zone\'s queue', onchange: () => { Z.select(sel.value); setTimeout(() => Promise.resolve(refreshAll()).then(() => drawQueue()), 150); } }, cs.map(c => h('option', { value: c.key }, Z.choiceLabel(c, cur))));   // 0.6.9 #21
  sel.value = cur?.key || ''; return h('span', { class: 'qzwrap pqwrap' }, sel);
}
function saveQueue() {   // 0.3.5 J9 #9: inline name field (phone Queue page)
  const root = views.queue.el; root.querySelector('.qsave')?.remove();
  const name = h('input', { type: 'text', maxlength: 80, placeholder: 'New playlist name', 'aria-label': 'New playlist name' });
  const box = h('div', { class: 'qsave row inlineform' }, name, h('button', { class: 'btn primary', onclick: async () => { try { await api('/playlists', { method: 'POST', body: { name: name.value, fromQueue: true } }); toast('Saved'); box.remove(); window.dispatchEvent(new CustomEvent('wavwiz:playlists')); } catch (e) { toast(e.message, true); } } }, 'Save'), h('button', { class: 'btn', onclick: () => box.remove() }, 'Cancel'));
  root.firstChild?.after(box); name.focus();
}

boot();

/** 0.3.8 L48: Queue item menu > Show in Library: open the Library and search for the song (phone: the Library page). */
export function showInLibrary(title) {
  const fill = () => { const s = document.querySelector('.libsearch input, input.libsearch'); if (!s) return; s.value = title; s.dispatchEvent(new Event('input', { bubbles: true })); try { s.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ } };
  if (wide()) { toggleLibExpanded(true); setTimeout(fill, P6?.exp === 'lib' ? 0 : GLIDE.ms + 80); } else { go('library'); setTimeout(fill, 400); }
}
