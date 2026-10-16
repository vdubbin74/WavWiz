import { h, api, toast, dialog, ask } from './util.js';
import { adminOnly, ADMIN_HINT } from './ui.js';
import { THEME_RESET_KEYS, savedMark, learn, adminTag, resetBar, settingsSearch, ROLE_NAMES, jukeboxPane, backupCard, calibrationExtras } from './settingsui.js';
import { networkCard, diagnosticsView } from './diag.js';
import { pulseSel } from './motion.js';
import { remoteView } from './remote.js';
import { aboutBody } from './about.js';
import { appearancePane } from './appearance.js';
import { npPreview, npStyleThumb } from './nppreview.js';
import { loadLibPrefs, saveLibPrefs, resetLibView, TILE_SIZES, DEF_SORTS } from './libsort.js';

// 0.2.1 F8: four tabs - Appearance, Devices, Library, Network. The About tab is gone (Help > About); the Status card moved to Help > Diagnostics.
// 0.3.0 §7: General (Backup) · Appearance · Playback (crossfade, leveling) · Devices (sub-tabs Players & access | Calibration) · Library · Network · Jukebox
/** 0.3.2 F16: the two card columns stack on their own (like settings-cards.png): every card spans as many 2 px grid rows as it is tall,
 *  so a short card never leaves a gap beside a tall one. Re-measured whenever a card changes size (tab switch, help opened, list grew). */
function masonry(sections) {
  if (typeof ResizeObserver !== 'function') return;
  const fit = c => { if (!c.isConnected || !c.offsetParent || !c.parentElement?.matches('.settings-sec,.devsubsec')) return; c.style.gridRowEnd = ''; const hgt = c.getBoundingClientRect().height; if (hgt > 0) c.style.gridRowEnd = 'span ' + Math.ceil((hgt + 10) / 2); };
  const ro = new ResizeObserver(es => es.forEach(e => fit(e.target)));
  for (const sec of sections) sec.querySelectorAll?.(':scope > *, :scope > .devsubsec > *').forEach(c => ro.observe(c));
}
export const GROUPS = [
  ['general', 'General'],
  ['appearance', 'Appearance'],
  ['playback', 'Playback'],
  ['devices', 'Devices'],
  ['library', 'Library'],
  ['network', 'Network'],
  ['jukebox', 'Jukebox'],
  // 0.3.5 J9: these were popups from the File / Help / Devices menus
  ['access', 'Access'],
  ['diagnostics', 'Diagnostics'],
  ['about', 'About'],
];
/** 0.3.0 §7.6: what "Reset this section" puts back (server settings) - local looks are reset in the browser. */
export const RESET = {
  general: { 'ui.checklistDismissed': false },
  appearance: {},
  playback: { 'playback.crossfadeSec': 0, 'playback.replayGain': 'auto' },
  devices: { 'bt.defaultLatencyMs': 200, 'wired.defaultLatencyMs': 0, 'tls.redirect': false, 'calibration.testLevelDb': -20 },
  library: { 'library.onlineArt': true },
  network: { 'airplay.levelDb': 0, 'spotify.levelDb': 0 },
  jukebox: { 'jukebox.config': null },
  access: {}, diagnostics: {}, about: {},
};
/** 0.3.5 J9: which Settings section a deep link opens. Pure. */
export function sectionFor(section) {
  return section === 'players' || section === 'phone' || section === 'devices' || section === 'calibration' ? 'devices'
    : section === 'library' ? 'library' : section === 'network' ? 'network' : section === 'playback' ? 'playback'
    : section === 'general' || section === 'backup' ? 'general' : section === 'jukebox' ? 'jukebox'
    : section === 'remote' || section === 'access' ? 'access' : section === 'diag' || section === 'diagnostics' ? 'diagnostics' : section === 'about' ? 'about'
    : 'appearance';
}

// 0.2.2 T2: deep links into the Appearance sub-sections
const APP_SECTION = { theme: 'theme', themes: 'theme', viz: 'viz', visualizer: 'viz', eq: 'eq', eqstyle: 'eq', np: 'np', npstyle: 'np', display: 'display' };
/** 0.3.5 J9 #15: after an Appearance reset (or its Undo) the looks are applied in place - no page reload, so Undo stays on screen. */
async function reapplyLooks() {
  try { const t = await import('./theme.js'); t.applyTheme(t.loadTheme()); } catch { /* ignore */ }
  try { const u = await import('./uiscale.js'); u.applyScale(u.loadScale()); } catch { /* ignore */ }
  try { const sl = await import('./sliderstyle.js'); sl.applySlider?.(sl.loadSlider()); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('wavwiz:viz')); window.dispatchEvent(new CustomEvent('wavwiz:eqstyle')); } catch { /* ignore */ }
}
export async function openSettings(S, refresh, nav, section) {
  const admin = S.auth.role === 'admin';
  const body = h('div', { class: 'settings-body' });
  // 0.2.1 F8: theme / viz open Appearance (one page) - the visualizer panel's Looks button unfolds the looks gallery there
  let app = null;
  const d = dialog('Settings', body, [{ text: 'Close' }], { cls: 'settings-dlg', onClose: () => { app?.hide?.(); refresh?.(); } });   // 0.2.5 C: up to ~1200 px wide
  let active = sectionFor(section);
  let devSub = section === 'phone' || section === 'calibration' ? 'calibration' : 'players';
  const search = settingsSearch(body, { show: g => { active = g; body._paint?.(); }, showSub: sub => { devSub = sub; body._paint?.(); } });
  d.el.querySelector('header .grow').after(search.el);
  const focusSec = section === 'players' ? 'sec-players' : null;

  const draw = async () => {
    let roots = [], st = null, settings = {}, tokens = [], rc = null;
    try {
      [roots, st, settings] = await Promise.all([api('/library/roots'), api('/status'), api('/settings')]);
      rc = await api('/receivers').catch(() => null);
      if (admin) tokens = await api('/tokens');
    } catch (e) { body.replaceChildren(h('p', { class: 'err' }, e.message)); return; }

    const panes = { general: [], appearance: [], playback: [], devices: [], library: [], network: [], jukebox: [], access: [], diagnostics: [], about: [] };
    // 0.3.5 J9: Away-from-home access, Diagnostics and About are Settings sections (no page popups)
    { const rv = remoteView(S); panes.access.push(h('div', { class: 'card setpage', id: 'sec-remote' }, rv.el)); }
    { const dv = diagnosticsView(S); panes.diagnostics.push(h('div', { class: 'card setpage', id: 'sec-diag' }, dv.el)); dv.reload?.(); }
    panes.about.push(h('div', { class: 'card setpage', id: 'sec-about' }, aboutBody(S)));
    const cal = [], players = [];

    app?.hide?.(); app = appearancePane({ S, looks: section === 'viz', section: APP_SECTION[section], preview: () => npPreview(), npThumb: npStyleThumb });
    panes.appearance.push(app.el);

    // Devices: phone/https, pairing, tokens, delay defaults

    cal.push(...calibrationExtras(S, settings, { admin, put: putSettings, go: k => { d.close(); nav?.(k); } }));
    cal.push(h('div', { class: 'card', id: 'sec-phone' }, h('h3', null, 'Phone & HTTPS'),
      learn('A phone only allows its microphone on a trusted HTTPS page. Install the WavWiz certificate once on each phone.', 'WavWiz makes its own small certificate that is valid only for this PC\'s address. A phone that plays as a speaker also gets more reliable sound on HTTPS.'),
      st.tls.enabled ? h('div', null, h('p', { class: 'okc' }, 'HTTPS is on.'),
        h('div', { class: 'row wrap', style: 'align-items:flex-start' }, h('div', { class: 'qr' }, h('img', { src: '/tls/qr.svg?to=setup', alt: 'QR code for the phone set-up page', width: 200, height: 200 })),
          h('div', { class: 'grow' }, h('p', null, h('b', null, 'On the phone: '), 'point the camera at the code and tap the link. It shows the steps (about two minutes) and checks they worked.'),
            h('p', { class: 'small' }, 'No camera? Open ', h('a', { href: '/tls/setup', target: '_blank', rel: 'noopener' }, 'the set-up page'), ' on the phone by typing its address.'),
            h('p', { class: 'small mono dim' }, 'Certificate fingerprint (SHA-256): ' + st.tls.rootSha256))),
        admin ? h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: async () => { try { const r = await api('/tls/enable', { method: 'POST', body: {} }); toast('Certificate refreshed. ' + r.note); draw(); } catch (e) { toast(e.message, true); } } }, 'Refresh certificate (after an address change)')) : null)
        : h('div', { class: 'row' }, adminOnly(S, h('button', { class: 'btn primary', onclick: async () => { try { const r = await api('/tls/enable', { method: 'POST', body: {} }); toast('HTTPS is set up. ' + r.note); draw(); } catch (e) { toast(e.message, true); } } }, 'Set up HTTPS')), admin ? null : adminTag()),
      // 0.3.0 §7.2: the redirect option lives under Advanced, with a warning. Default stays off.
      h('details', { class: 'advanced', id: 'sec-redirect' }, h('summary', { class: 'small' }, 'Advanced'),
        h('p', { class: 'warn-t small', role: 'note' }, 'Turning this on can stop phones and calibration from loading. Leave off unless you know you need it.'),
        h('label', { class: 'row', style: 'margin-top:8px' }, adminOnly(S, h('input', { type: 'checkbox', checked: settings['tls.redirect'] === true, onchange: ev => putSettings({ 'tls.redirect': ev.target.checked }) })), 'Send web browsers on other devices to the secure (HTTPS) address. (WavWiz Player on your PCs is never redirected.)', admin ? null : adminTag()))));

    {
      const out = h('div', { class: 'mono accent', style: 'font-size:32px;letter-spacing:6px', 'aria-live': 'polite' });
      // 0.3.7 L28: a QR beside the code - a phone scans it and lands on the setup page with the code already typed in. PCs still type the code.
      const qr = h('img', { class: 'pairqr', alt: 'QR code: scan with a phone to pair it', width: 160, height: 160, hidden: true });
      const qrNote = h('p', { class: 'small dim pairqr-note', hidden: true }, 'Phone: scan this to open the setup page with the code filled in. PC: type the code in WavWiz Player.');
      const qrAddr = h('div', { class: 'small mono pairqr-addr', hidden: true, 'aria-label': 'Server address for manual pairing' });
      const pairBox = h('div', { class: 'row pairbox', style: 'align-items:center;gap:16px' }, out, qr);
      players.push(h('div', { class: 'card', id: 'sec-players' }, h('h3', null, 'Pair a phone or a PC player ', admin ? null : adminTag()),
        learn('Show a code, then type it on the phone or in WavWiz Player on another PC.', 'The player finds this server by itself - the code is all it needs. The code works once and expires in a few minutes.'),
        adminOnly(S, h('button', { class: 'btn primary', onclick: async () => { try { const r = await api('/pairing/code', { method: 'POST' }); out.textContent = r.code; qr.src = `/tls/qr.svg?to=pair&code=${encodeURIComponent(r.code)}&t=${Date.now()}`; qr.hidden = false; qrNote.hidden = false; fetch('/tls/info').then(r => r.json()).then(i => { qrAddr.textContent = `Server address: http://${i.host}:${i.httpPort}`; qrAddr.hidden = false; }).catch(() => {}); } catch (e) { toast(e.message, true); } } }, 'Show a pairing code')), pairBox, qrAddr, qrNote));
      players.push(!admin ? h('div', { class: 'card', id: 'sec-tokens' }, h('h3', null, 'Paired devices & tokens ', adminTag()), h('p', { class: 'dim small' }, 'Only an administrator can see and revoke paired devices.'), h('div', { class: 'row' }, adminOnly(S, h('button', { class: 'btn' }, 'Create API token…')))) : h('div', { class: 'card', id: 'sec-tokens' }, h('h3', null, 'Paired devices & tokens'),
        tokens.filter(t => !t.revoked).length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Name', 'Role', 'Last used', ''].map(x => h('th', null, x)))), h('tbody', null, tokens.filter(t => !t.revoked).map(t =>
          h('tr', null, h('td', null, t.name), h('td', null, t.role), h('td', null, t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'never'),
            h('td', null, h('button', { class: 'btn danger', onclick: () => revokeToken(t) }, 'Revoke')))))) : h('p', { class: 'dim' }, 'None.'),
        h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: makeToken }, 'Create API token…'))));
      const num = (key, label, def) => { const i = adminOnly(S, h('input', { type: 'number', min: 0, max: 1000, value: settings[key] ?? def, style: 'width:90px', onchange: () => putSettings({ [key]: +i.value }, i) })); return h('label', { class: 'row' }, h('span', { style: 'min-width:260px' }, label), i, 'ms'); };
      cal.push(h('div', { class: 'card', id: 'sec-delaydefaults' }, h('h3', null, 'Delay defaults ', admin ? null : adminTag()),
        h('p', { class: 'dim small' }, 'Used until a speaker is calibrated (shown as “not calibrated”).'),
        num('bt.defaultLatencyMs', 'Bluetooth speaker (typical)', 200), num('wired.defaultLatencyMs', 'Wired / HDMI / built-in', 0)));
    }

    panes.general.push(backupCard(S, { admin, done: () => draw() }));
    panes.jukebox.push(jukeboxPane(S, settings, { admin, put: putSettings }));
    panes.devices.push(h('nav', { class: 'appnav subtabs devsub', role: 'tablist', 'aria-label': 'Devices sections' }, [['players', 'Players & access'], ['calibration', 'Calibration']].map(([k, t]) => h('button', { type: 'button', role: 'tab', 'data-sub': k, 'aria-selected': String(devSub === k), class: devSub === k ? 'on' : '', onclick: () => { devSub = k; paint(); } }, t))),
      h('div', { class: 'devsubsec', 'data-sub': 'players' }, ...players), h('div', { class: 'devsubsec', 'data-sub': 'calibration' }, ...cal));

    // Library - 0.2.1 F8: the "Library view" card sits on top
    panes.library.push(libViewCard());
    const pathIn = h('input', { type: 'text', placeholder: 'D:\\Music   or   \\\\NAS\\music', class: 'grow', 'aria-label': 'Music folder path' });
    panes.library.push(h('div', { class: 'card', id: 'sec-library' }, h('h3', null, 'Music folders'),
      h('p', { class: 'dim small' }, 'Folders are read from the server PC (a local drive or a network share the WavWiz service can read). Files are never modified.'),
      roots.map(r => h('div', { class: 'row', style: 'margin:4px 0' }, h('div', { class: 'grow' }, h('span', { class: 'mono' }, r.path), h('div', { class: 'small ' + (r.lastError ? 'err' : 'dim') }, r.lastError ? r.lastError : `${r.tracks} tracks`)),
        adminOnly(S, h('button', { class: 'btn danger', onclick: async () => { if (!(await ask('Remove folder', `Stop using ${r.path}? The files are not touched.`, { ok: 'Remove', danger: true }))) return; try { await api(`/library/roots/${r.id}`, { method: 'DELETE' }); draw(); } catch (e) { toast(e.message, true); } } }, 'Remove')))),
      admin ? h('div', { class: 'row', style: 'margin-top:8px' }, pathIn, h('button', { class: 'btn primary', onclick: async () => { try { await api('/library/roots', { method: 'POST', body: { path: pathIn.value } }); toast('Folder added. Scanning…'); draw(); } catch (e) { toast(e.message, true); } } }, 'Add')) : null,
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: async () => { try { await api('/library/rescan', { method: 'POST' }); toast('Scanning…'); } catch (e) { toast(e.message, true); } } }, 'Rescan now'),
        h('span', { class: 'dim small' }, st.library.scanning ? `Scanning${st.library.progress ? ` ${st.library.progress.done}/${st.library.progress.total}` : ''}…` : ''))));
    panes.library.push(admin ? nasCard() : h('div', { class: 'card', id: 'sec-nas' }, h('h3', null, 'Network share logins (NAS) ', adminTag()), h('p', { class: 'dim small' }, 'Only an administrator can add share logins.')));
    panes.library.push(onlineArtCard(settings, admin));
    panes.playback.push(crossfadeCard(settings, admin), replayGainCard(settings));
    panes.library.push(acoustIdCard(settings));

    // Network
    panes.network.push(h('div', { class: 'card' }, h('h3', null, 'Home network'),
      h('p', { class: 'dim small' }, 'WavWiz listens only on the address chosen at install (never “all interfaces” unless you opt in). Away-from-home access uses Tailscale only — nothing is opened to the public internet.'),
      h('p', { class: 'small' }, `Listening on ${st.bind}`),
      h('button', { class: 'btn', onclick: () => { active = 'access'; paint(); } }, 'Away-from-home access (Tailscale)')));
    panes.network.push(networkCard({ auth: { role: admin ? 'admin' : 'view' } }));      // 0.1.3: Private/Public, re-detect, use the new address
    // 0.1.2: AirPlay + Spotify Connect with level (0…+6 dB) arrows
    const apState = rc?.airplay ? (rc.airplay.running && rc.airplay.ready ? (rc.airplay.inSession ? 'Playing from a phone or Mac now.' : 'Ready.') : rc.airplay.installed ? 'Not running - see Diagnostics.' : 'Not installed on this PC.') : '';
    const levelRow = (key, label, cur) => {
      let val = Math.max(0, Math.min(6, Math.round(Number(cur) || 0)));
      const shown = h('span', { class: 'mono', style: 'min-width:3.5em;text-align:center' }, `+${val} dB`);
      const set = async (n) => {
        const v = Math.max(0, Math.min(6, Math.round(n)));
        if (v === val) return;
        try { await putSettings({ [key]: v }); val = v; shown.textContent = `+${v} dB`; } catch (e) { toast(e.message, true); }
      };
      return h('div', { class: 'row', style: 'margin-top:8px;gap:8px;align-items:center' },
        h('span', { style: 'min-width:140px' }, label),
        h('button', { class: 'btn', 'aria-label': `${label} down 1 dB`, disabled: !admin, onclick: () => set(val - 1) }, '▼'),
        shown,
        h('button', { class: 'btn', 'aria-label': `${label} up 1 dB`, disabled: !admin, onclick: () => set(val + 1) }, '▲'),
        h('span', { class: 'dim small' }, '0 dB default, +6 dB max (after phone volume)'));
    };
    const apLv = typeof settings['airplay.levelDb'] === 'number' ? settings['airplay.levelDb'] : (rc?.airplay?.levelDb ?? 0);
    const spLv = typeof settings['spotify.levelDb'] === 'number' ? settings['spotify.levelDb'] : (rc?.spotify?.levelDb ?? 0);
    panes.network.push(h('div', { class: 'card', id: 'sec-airplay' }, h('h3', null, 'AirPlay & Spotify Connect'),
      h('p', null, h('b', null, 'AirPlay: '), '“WavWiz – Whole House” is always on. On an iPhone, iPad or Mac, pick it in Control Center > AirPlay (or the AirPlay button in any app); it plays in every zone. ', h('span', { class: 'dim small' }, apState)),
      levelRow('airplay.levelDb', 'AirPlay level', apLv),
      admin
        ? h('label', { class: 'row', style: 'margin-top:12px' }, h('input', { type: 'checkbox', id: 'spotify-enabled', checked: settings['spotify.enabled'] === true, onchange: ev => putSettings({ 'spotify.enabled': ev.target.checked }) }), h('b', null, 'Spotify Connect'), h('span', { class: 'dim small' }, 'Requires Spotify Premium.'))
        : h('p', { style: 'margin-top:12px' }, h('b', null, 'Spotify Connect: '), settings['spotify.enabled'] === true ? 'On' : 'Off', ' ', h('span', { class: 'dim small' }, 'Requires Spotify Premium.')),
      levelRow('spotify.levelDb', 'Spotify Connect level', spLv)));
    if (admin) {
      const curPw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Current password' });
      const nw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'New password (≥8)' });
      const resetNw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'New password (≥8)' });
      panes.network.push(h('div', { class: 'card' }, h('h3', null, 'Administrator password'),
        h('div', { class: 'row wrap' }, h('input', { type: 'password', hidden: true }), curPw, nw,
          h('button', { class: 'btn', onclick: async () => { try { await api('/auth/password', { method: 'POST', body: { current: curPw.value, password: nw.value } }); toast('Password changed'); curPw.value = nw.value = ''; } catch (e) { toast(e.message, true); } } }, 'Change')),
        h('p', { class: 'dim small', style: 'margin-top:12px' }, 'Forgot the password? On this server PC only you can set a new one without wiping the music library.'),
        h('div', { class: 'row wrap' }, resetNw,
          h('button', { class: 'btn danger', onclick: async () => {
            if (!resetNw.value || resetNw.value.length < 8) { toast('New password must be at least 8 characters.', true); return; }
            try { await api('/auth/reset-password', { method: 'POST', body: { password: resetNw.value } }); toast('Password reset'); resetNw.value = ''; }
            catch (e) { toast(e.message, true); }
          } }, 'Reset on this PC'))));
    }

    const navEl = h('div', { class: 'settings-nav', role: 'tablist', 'aria-label': 'Settings sections' }, GROUPS.map(([id, label]) =>
      h('button', { class: active === id ? 'on' : '', role: 'tab', id: 'stab-' + id, 'aria-controls': 'ssec-' + id, 'aria-selected': String(active === id), 'data-g': id, onclick: () => { if (active === id) { pulseSel(body.querySelector('.settings-sec.on')); return; } active = id; paint(); } }, label)));   // K15: the current tab pulses
    navEl.addEventListener('keydown', ev => { if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return; const i = GROUPS.findIndex(g => g[0] === active), n = (i + (ev.key === 'ArrowRight' ? 1 : -1) + GROUPS.length) % GROUPS.length; active = GROUPS[n][0]; paint(); navEl.children[n].focus(); });
    const sections = GROUPS.map(([id, label]) => h('div', { class: 'settings-sec' + (active === id ? ' on' : ''), 'data-g': id, id: 'ssec-' + id, role: 'tabpanel', 'aria-labelledby': 'stab-' + id },
      resetBar(S, label, { admin, server: RESET[id], local: id === 'appearance' ? THEME_RESET_KEYS : null, done: () => { if (id === 'appearance') reapplyLooks(); draw(); } }), ...panes[id]));
    // 0.3.1 B10: "Reset this section" gets a fixed slot - the right end of the sub-tab bar where a section has sub-tabs, else its own row
    for (const sec of sections) placeReset(sec);
    // 0.3.1 B12: one fixed-size shell - the tab menu stays pinned, only the content area below it scrolls
    body.replaceChildren(navEl, h('div', { class: 'settings-scroll' }, ...sections)); masonry(sections);
    body._paint = paint; search.reindex();
    if (focusSec) requestAnimationFrame(() => body.querySelector('#' + focusSec)?.scrollIntoView({ block: 'start' }));

    paint();
    function paint() {
      navEl.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.g === active); b.setAttribute('aria-selected', String(b.dataset.g === active)); b.tabIndex = b.dataset.g === active ? 0 : -1; });
      body.querySelectorAll('.devsub button').forEach(b => { b.classList.toggle('on', b.dataset.sub === devSub); b.setAttribute('aria-selected', String(b.dataset.sub === devSub)); });
      body.querySelectorAll('.devsubsec').forEach(x => { x.hidden = x.dataset.sub !== devSub; });
      body.querySelectorAll('.settings-sec').forEach(s => s.classList.toggle('on', s.dataset.g === active));
      if (active !== 'appearance') app?.hide?.(); else app?.resume?.();     // live visualizer previews run only while Appearance is shown
    }
  };

  /** B10: move the section's reset bar into a flex row with its sub-tab bar (the tabs take the free space and scroll sideways; the button never overlaps). */
  function placeReset(sec) {
    const bar = sec.querySelector(':scope > .secbar'), sub = sec.querySelector('.subtabs');
    if (!bar || !sub) return;
    const btn = bar.querySelector('.resetsec'); if (!btn) return;
    const row = h('div', { class: 'subbar' }); sub.replaceWith(row); row.append(sub, h('span', { class: 'subbar-slot' }, btn)); bar.remove();
  }
  function revokeToken(t) {
    const rm = h('input', { type: 'checkbox', checked: true, id: 'rev-rm' });
    dialog(`Revoke “${t.name}”?`, h('div', null, h('p', null, 'This device is signed out at once and can no longer control WavWiz or play music. A player that is still running will say “not paired” and offer to pair again.'),
      h('p', { class: 'small dim' }, 'Speakers it opened in a browser leave the device list at once, on every open page.'),
      h('label', { class: 'row' }, rm, 'Also remove its WavWiz Player from the device list')),
    [{ text: 'Revoke', cls: 'danger', onclick: async () => { try { await api(`/tokens/${t.id}${rm.checked ? '?removeFromList=1' : ''}`, { method: 'DELETE' }); toast('Revoked'); } catch (e) { toast(e.message, true); return false; } draw(); } }, { text: 'Cancel' }]);
  }
  // 0.3.0 §7.4: an inline "Saved ✓" beside the changed control; toasts only for errors
  async function putSettings(o, el = document.activeElement) { try { await api('/settings', { method: 'PUT', body: o }); savedMark(el); } catch (e) { toast('Not saved. ' + e.message, true); } }
  /** 0.3.5 J9 #11: Create API token is inline in the Paired devices & tokens card (no popup). */
  function makeToken(ev) {
    const card = ev?.target?.closest?.('.card') || document.getElementById('sec-tokens'); if (!card) return;
    card.querySelector('.tokform')?.remove();
    const name = h('input', { type: 'text', maxlength: 60, placeholder: 'e.g. Home Assistant', 'aria-label': 'Token name' }), role = h('select', { 'aria-label': 'Access' }, ROLE_NAMES.map(([r, t, d]) => h('option', { value: r, title: d }, `${t} - ${d}`)));
    const out = h('div', { class: 'mono small', style: 'word-break:break-all' });
    const form = h('div', { class: 'tokform inlineform' }, h('div', { class: 'field' }, h('label', null, 'Name'), name), h('div', { class: 'field' }, h('label', null, 'Access'), role), out,
      h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn', type: 'button', onclick: () => { form.remove(); if (out.childNodes.length) draw(); } }, 'Done'),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => { try { const r = await api('/tokens', { method: 'POST', body: { name: name.value, role: role.value } }); out.replaceChildren(h('p', { class: 'amber' }, r.note), h('code', null, r.token)); } catch (e) { toast(e.message, true); } } }, 'Create')));
    card.append(form); name.focus();
  }
  /** 0.2.1 F8: Library view (this device) - how the Expanded Library opens. Saves at once; the Library redraws through 'wavwiz:libprefs'. */
  function libViewCard() {
    const box = h('div', { class: 'card', id: 'sec-libview' });
    const set = patch => { saveLibPrefs({ ...loadLibPrefs(), ...patch }); window.dispatchEvent(new CustomEvent('wavwiz:libprefs')); paintLib(); };
    const seg = (opts, cur, key, label) => h('div', { class: 'seg', role: 'group', 'aria-label': label }, opts.map(([v, t]) =>
      h('button', { type: 'button', class: cur === v ? 'on' : '', 'aria-pressed': String(cur === v), 'data-libpref': key + ':' + v, onclick: () => set({ [key]: v }) }, t)));
    function paintLib() {
      const p = loadLibPrefs();
      const sort = h('select', { 'aria-label': 'Default sort', 'data-libpref': 'defSort', onchange: ev => { const q = loadLibPrefs(); set({ defSort: ev.target.value, sort: { ...q.sort, albums: ev.target.value } }); } },
        DEF_SORTS.map(([v, t]) => h('option', { value: v, selected: p.defSort === v }, t)));
      const remember = h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: p.remember, 'aria-label': 'Remember view per tab', 'data-libpref': 'remember', onchange: ev => set({ remember: ev.target.checked }) }), h('span', { 'aria-hidden': 'true' }));
      box.replaceChildren(h('h3', null, 'Library view'),
        h('p', { class: 'dim small' }, 'How the expanded Library opens on this device.'),
        h('div', { class: 'setrow' }, h('div', { class: 'grow' }, 'Default view'), seg([['grid', 'Tiles'], ['list', 'List']], p.defView, 'defView', 'Default view')),
        h('div', { class: 'setrow' }, h('div', { class: 'grow' }, 'Tile size'), seg(TILE_SIZES, p.tileSize, 'tileSize', 'Tile size')),
        h('div', { class: 'setrow' }, h('div', { class: 'grow' }, h('div', null, 'Default sort'), h('div', { class: 'small dim' }, 'Artist, Album, Recently added, or Year')), sort),
        h('div', { class: 'setrow' }, h('div', { class: 'grow' }, h('div', null, 'Remember view per tab'), h('div', { class: 'small dim' }, 'Switching a tab to List keeps it that way')), remember),
        h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:6px' }, h('button', { class: 'linkbtn', onclick: () => { saveLibPrefs(resetLibView(loadLibPrefs())); window.dispatchEvent(new CustomEvent('wavwiz:libprefs')); paintLib(); } }, 'Reset to defaults')));
    }
    paintLib();
    return box;
  }
  function acoustIdCard(settings) {
    const key = typeof settings['acoustid.apiKey'] === 'string' ? settings['acoustid.apiKey'] : '';
    const inp = h('input', { type: 'password', autocomplete: 'off', maxlength: 80, placeholder: 'Paste AcoustID application API key', value: key, class: 'grow' });
    return h('div', { class: 'card', id: 'sec-acoustid' }, h('h3', null, 'AcoustID / Chromaprint (tag auto-fill)'),
      h('p', { class: 'dim small' }, 'When an AcoustID application API key is set, Tag & cover fix fingerprints tracks (Chromaprint / fpcalc) and looks up MusicBrainz recordings. Without a key, title/artist/album text search still works. Get a free key at acoustid.org for application owners.'),
      admin ? h('div', { class: 'row', style: 'margin-top:8px' }, inp, h('button', { class: 'btn primary', onclick: async () => { try { await putSettings({ 'acoustid.apiKey': inp.value.trim() }); draw(); } catch (e) { toast(e.message, true); } } }, 'Save')) : h('p', { class: 'dim' }, key ? 'A key is configured.' : 'Ask the administrator to set an AcoustID API key.'),
      h('p', { class: 'small dim' }, key ? 'Key is set — fingerprint lookup is enabled when Chromaprint (fpcalc) is available beside FFmpeg.' : 'No key yet — fingerprint lookup stays off until one is saved.'));
  }
  draw();
}

/** 0.2.2 T4e: Online art - found / not found / pending counts for artist photos and album covers, "Retry missing photos", the on/off switch
 * and the sources it uses. The counts refresh every few seconds while the card is open and something is still pending. */
export function onlineArtCard(settings, admin) {
  const box = h('div', { class: 'card', id: 'sec-onlineart' }), stat = h('div', { class: 'oastat', 'aria-live': 'polite' });
  const on = settings['library.onlineArt'] !== false && settings['library.onlineArt'] !== 'false';
  let timer = 0;
  const line = (label, k) => h('div', { class: 'setrow' }, h('div', { class: 'grow' }, label),
    h('span', { class: 'oachip ok', title: 'Found' }, `${k.found} found`), h('span', { class: 'oachip', title: 'Not found on any source' }, `${k.notFound} not found`), h('span', { class: 'oachip pend', title: 'Waiting for a lookup or a retry' }, `${k.pending} pending`));
  async function load() {
    clearTimeout(timer);
    let r; try { r = await api('/library/online-art'); } catch (e) { stat.replaceChildren(h('p', { class: 'small err' }, e.message)); return; }
    if (!r) { stat.replaceChildren(h('p', { class: 'small dim' }, 'Online art is not available on this server.')); return; }
    stat.replaceChildren(onlineArtSummary(r), line('Artist photos', r.artists), line('Album covers', r.albums));
    if ((r.artists.pending + r.albums.pending) > 0 && r.enabled && box.isConnected !== false) timer = setTimeout(() => { if (box.isConnected) load(); }, 5000);
  }
  box.append(h('h3', null, 'Online art'),
    h('p', { class: 'dim small' }, 'Looks up missing album covers and artist photos on the internet and keeps them on the server PC. Only artist and album names are sent. An artist with no photo shows their album covers instead.'),
    admin ? h('div', { class: 'setrow' }, h('div', { class: 'grow' }, 'Look up covers and photos online'),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: on, 'aria-label': 'Look up covers and photos online', onchange: async ev => { try { await api('/settings', { method: 'PUT', body: { 'library.onlineArt': ev.target.checked } }); toast('Saved'); load(); } catch (e) { toast(e.message, true); } } }), h('span', { 'aria-hidden': 'true' }))) : null,
    stat,
    admin ? h('div', { class: 'row', style: 'margin-top:8px;gap:8px' }, h('button', { class: 'btn', id: 'oa-retry', onclick: async () => { try { const r = await api('/library/online-art/retry', { method: 'POST' }); toast(`Looking again for ${r.queued} artist photo${r.queued === 1 ? '' : 's'}.`); load(); } catch (e) { toast(e.message, true); } } }, 'Retry missing photos')) : null,
    h('p', { class: 'small dim', style: 'margin-top:8px' }, 'Sources: MusicBrainz, Cover Art Archive, Wikidata and Wikimedia Commons, and TheAudioDB (theaudiodb.com). Pictures belong to their owners.'));
  load();
  return box;
}
/** The one-line summary above the counts. */
export function onlineArtSummary(r) {
  if (!r.enabled) return h('p', { class: 'small dim' }, 'Off. Albums without a picture show a generated cover.');
  const pend = r.artists.pending + r.albums.pending;
  return h('p', { class: 'small ' + (pend ? 'amber' : 'okc') }, pend ? `Looking up ${pend} picture${pend === 1 ? '' : 's'}. Tiles update by themselves.` : 'Up to date.');
}

/** 0.3.0 §4: crossfade 0-12 s, 0 (off) by default. Never between consecutive songs of the same album (gapless stays). */
function crossfadeCard(settings, admin) {
  const v0 = typeof settings['playback.crossfadeSec'] === 'number' ? settings['playback.crossfadeSec'] : 0;
  const out = h('span', { class: 'mono', style: 'min-width:4em' }, v0 ? `${v0} s` : 'Off');
  const r = h('input', { type: 'range', min: 0, max: 12, step: 1, 'data-coarse': 3, value: v0, class: 'grow', id: 'xfade', 'aria-label': 'Crossfade in seconds', disabled: !admin, title: admin ? '' : ADMIN_HINT,
    oninput: ev => { out.textContent = +ev.target.value ? `${ev.target.value} s` : 'Off'; },
    onchange: async ev => { try { await api('/settings', { method: 'PUT', body: { 'playback.crossfadeSec': +ev.target.value } }); savedMark(ev.target); } catch (e) { toast('Not saved. ' + e.message, true); } } });
  return h('div', { class: 'card', id: 'sec-crossfade' }, h('h3', null, 'Crossfade ', admin ? null : adminTag()),
    learn('Blends the end of a song into the next one. Off (0 s) by default.', 'Songs of the same album that play in order stay gapless and are never crossfaded. All speakers stay in sync: the fade happens before the music is sent.'),
    h('div', { class: 'row' }, r, out));
}

/** 0.1.3: ReplayGain - even out loudness between songs (server side, every zone). */
function replayGainCard(settings) {
  const cur = typeof settings['playback.replayGain'] === 'string' ? settings['playback.replayGain'] : 'auto';
  const opts = [['auto', 'Automatic - album levels when an album plays in order, song levels otherwise'], ['track', 'Song - every song at the same loudness'], ['album', 'Album - keep the loud and quiet songs of an album as mastered'], ['off', 'Off - play files exactly as they are']];
  const sel = h('select', { 'aria-label': 'Volume leveling', id: 'rg-mode', onchange: async ev => { try { await api('/settings', { method: 'PUT', body: { 'playback.replayGain': ev.target.value } }); savedMark(ev.target); } catch (e) { toast(e.message, true); } } },
    opts.map(([v, t]) => h('option', { value: v, selected: v === cur }, t)));
  return h('div', { class: 'card', id: 'sec-replaygain' }, h('h3', null, 'Volume leveling (ReplayGain)'),
    h('p', { class: 'dim small' }, 'Uses the ReplayGain or R128 loudness tags in your files (taggers such as foobar2000 or MusicBrainz Picard add them). Songs without tags play unchanged. It never makes a song clip.'),
    h('div', { class: 'row wrap' }, sel));
}

/** 0.1.3: logins for password-protected network shares. Stored encrypted (Windows DPAPI); the password is never shown again. */
function nasCard() {
  const box = h('div', { class: 'card naslist', id: 'sec-nas' }), list = h('div');
  const share = h('input', { type: 'text', placeholder: '\\\\NAS\\Music', 'aria-label': 'Network share', style: 'min-width:180px' });
  const user = h('input', { type: 'text', placeholder: 'User name', autocomplete: 'off', 'aria-label': 'User name' });
  const pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'new-password', 'aria-label': 'Password' });
  async function load() {
    let r; try { r = await api('/library/nas'); } catch (e) { list.replaceChildren(h('p', { class: 'small err' }, e.message)); return; }
    if (!r.available) list.replaceChildren(h('p', { class: 'small dim' }, 'Saved network-share logins need the server to run on Windows.'));
    else list.replaceChildren(...(r.shares.length ? r.shares.map(x => h('div', { class: 'row wrap', style: 'margin:4px 0' },
      h('div', { class: 'grow' }, h('span', { class: 'mono' }, x.share), ' as ', h('b', null, x.user), h('div', { class: 'small ' + (x.lastError ? 'err' : 'dim') }, x.lastError || (x.connected ? 'Connected' : 'Saved'))),
      h('button', { class: 'btn', onclick: async () => { try { const t = await api('/library/nas/test', { method: 'POST', body: { share: x.share } }); toast(t.ok ? 'Connected' : t.error, !t.ok); load(); } catch (e) { toast(e.message, true); } } }, 'Test'),
      h('button', { class: 'btn danger', onclick: async () => { try { await api('/library/nas/remove', { method: 'POST', body: { share: x.share } }); load(); } catch (e) { toast(e.message, true); } } }, 'Forget'))) : [h('p', { class: 'small dim' }, 'No saved logins.')]));
  }
  box.append(h('h3', null, 'Network share logins (NAS)'),
    h('p', { class: 'dim small' }, 'If your music is on a NAS or another PC that asks for a user name and password, save it here first, then add the folder above. The password is encrypted by Windows for the WavWiz service on this PC and is never shown again or sent anywhere.'),
    list, h('div', { class: 'row wrap', style: 'margin-top:8px;gap:6px' }, share, user, pw,
      h('button', { class: 'btn primary', onclick: async () => { try { const r = await api('/library/nas', { method: 'POST', body: { share: share.value, user: user.value, password: pw.value } }); pw.value = ''; toast(r.message); load(); } catch (e) { toast(e.message, true); } } }, 'Connect & save')));
  load(); return box;
}
