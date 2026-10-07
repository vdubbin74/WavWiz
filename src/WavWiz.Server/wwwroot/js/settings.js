import { h, api, toast, dialog } from './util.js';
import { SCALES, loadScale, applyScale } from './uiscale.js';
import { networkCard } from './diag.js';

const GROUPS = [
  ['appearance', 'Appearance'],
  ['devices', 'Devices & Zones'],
  ['library', 'Library'],
  ['network', 'Network'],
  ['about', 'About'],
];

export async function openSettings(S, refresh, nav, section) {
  if ((section === 'theme' || section === 'viz') && nav) return nav(section === 'theme' ? 'themes' : 'visualizer');      // 0.0.7: dedicated pages
  const admin = S.auth.role === 'admin';
  const body = h('div');
  const d = dialog('Settings', body, [{ text: 'Close' }], { onClose: refresh });
  let active = section === 'players' || section === 'phone' ? 'devices'
    : section === 'theme' || section === 'viz' || section === 'appearance' ? 'appearance'
    : section === 'library' ? 'library'
    : section === 'about' ? 'about'
    : 'appearance';

  const draw = async () => {
    let roots = [], st = null, settings = {}, tokens = [], rc = null;
    try {
      [roots, st, settings] = await Promise.all([api('/library/roots'), api('/status'), api('/settings')]);
      rc = await api('/receivers').catch(() => null);
      if (admin) tokens = await api('/tokens');
    } catch (e) { body.replaceChildren(h('p', { class: 'err' }, e.message)); return; }

    const panes = {
      appearance: [],
      devices: [],
      library: [],
      network: [],
      about: [],
    };

    panes.appearance.push(displaySizeCard());      // 0.0.7: themes and visualizers have their own pages (View > Theme…, View > Visualizer…)

    // Devices & Zones: pairing, tokens, delay defaults, phone/https
    panes.devices.push(h('div', { class: 'card', id: 'sec-status' }, h('h3', null, 'Status'),
      h('div', { class: 'small dim' }, `${st.display} • ${st.library.tracks} tracks • ${st.playersConnected} player(s) connected • listening on ${st.bind}`),
      st.warnings.length ? h('ul', null, st.warnings.map(w => h('li', { class: 'warnc' }, w))) : h('p', { class: 'okc' }, 'Everything looks fine.'),
      nav ? h('button', { class: 'btn', onclick: () => { d.close(); nav('diag'); } }, 'Open Diagnostics') : null));

    panes.devices.push(h('div', { class: 'card', id: 'sec-phone' }, h('h3', null, 'Phone & HTTPS'),
      h('p', { class: 'dim small' }, 'A phone only allows its microphone (speaker calibration) and reliable audio (phone as a device) on a trusted HTTPS page. WavWiz makes its own small certificate that is valid only for this PC\'s address. Install it once on each phone.'),
      st.tls.enabled ? h('div', null, h('p', { class: 'okc' }, 'HTTPS is on.'),
        h('div', { class: 'row wrap', style: 'align-items:flex-start' }, h('div', { class: 'qr' }, h('img', { src: '/tls/qr.svg?to=setup', alt: 'QR code for the phone set-up page', width: 200, height: 200 })),
          h('div', { class: 'grow' }, h('p', null, h('b', null, 'On the phone: '), 'point the camera at the code and tap the link. It shows the steps (about two minutes) and checks they worked.'),
            h('p', { class: 'small' }, 'No camera? Open ', h('a', { href: '/tls/setup', target: '_blank', rel: 'noopener' }, 'the set-up page'), ' on the phone by typing its address.'),
            h('p', { class: 'small mono dim' }, 'Certificate fingerprint (SHA-256): ' + st.tls.rootSha256))),
        admin ? h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: async () => { try { const r = await api('/tls/enable', { method: 'POST', body: {} }); toast('Certificate refreshed. ' + r.note); draw(); } catch (e) { toast(e.message, true); } } }, 'Refresh certificate (after an address change)')) : null)
        : admin ? h('button', { class: 'btn primary', onclick: async () => { try { const r = await api('/tls/enable', { method: 'POST', body: {} }); toast('HTTPS is set up. ' + r.note); draw(); } catch (e) { toast(e.message, true); } } }, 'Set up HTTPS') : h('p', { class: 'dim' }, 'Ask the administrator to set it up.'),
      admin ? h('label', { class: 'row', style: 'margin-top:8px' }, h('input', { type: 'checkbox', checked: settings['tls.redirect'] === true, onchange: ev => putSettings({ 'tls.redirect': ev.target.checked }) }), 'Send web browsers on other devices to the secure (HTTPS) address. (WavWiz Player on your PCs is never redirected.)') : null));

    if (admin) {
      const out = h('div', { class: 'mono accent', style: 'font-size:32px;letter-spacing:6px', 'aria-live': 'polite' });
      panes.devices.push(h('div', { class: 'card', id: 'sec-players' }, h('h3', null, 'Pair a phone or a PC player'),
        h('p', { class: 'dim small' }, 'Press the button, then type the 6-digit code on the phone, or in WavWiz Player on another PC. The player finds this server by itself - the code is all it needs. The code works once and expires in a few minutes.'),
        h('button', { class: 'btn primary', onclick: async () => { try { const r = await api('/pairing/code', { method: 'POST' }); out.textContent = r.code; } catch (e) { toast(e.message, true); } } }, 'Show a pairing code'), out));
      panes.devices.push(h('div', { class: 'card' }, h('h3', null, 'Paired devices & tokens'),
        tokens.filter(t => !t.revoked).length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Name', 'Role', 'Last used', ''].map(x => h('th', null, x)))), h('tbody', null, tokens.filter(t => !t.revoked).map(t =>
          h('tr', null, h('td', null, t.name), h('td', null, t.role), h('td', null, t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'never'),
            h('td', null, h('button', { class: 'btn danger', onclick: () => revokeToken(t) }, 'Revoke')))))) : h('p', { class: 'dim' }, 'None.'),
        h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: makeToken }, 'Create API token…'))));
      const num = (key, label, def) => { const i = h('input', { type: 'number', min: 0, max: 1000, value: settings[key] ?? def, style: 'width:90px', onchange: () => putSettings({ [key]: +i.value }) }); return h('label', { class: 'row' }, h('span', { style: 'min-width:260px' }, label), i, 'ms'); };
      panes.devices.push(h('div', { class: 'card' }, h('h3', null, 'Delay defaults'),
        h('p', { class: 'dim small' }, 'Used until a speaker is calibrated. Those speakers are shown as “not calibrated”.'),
        num('bt.defaultLatencyMs', 'Bluetooth speaker (typical)', 200), num('wired.defaultLatencyMs', 'Wired / HDMI / built-in', 0)));
    }

    // Library
    const pathIn = h('input', { type: 'text', placeholder: 'D:\\Music   or   \\\\NAS\\music', class: 'grow', 'aria-label': 'Music folder path' });
    panes.library.push(h('div', { class: 'card', id: 'sec-library' }, h('h3', null, 'Music folders'),
      h('p', { class: 'dim small' }, 'Folders are read from the server PC (a local drive or a network share the WavWiz service can read). Files are never modified.'),
      roots.map(r => h('div', { class: 'row', style: 'margin:4px 0' }, h('div', { class: 'grow' }, h('span', { class: 'mono' }, r.path), h('div', { class: 'small ' + (r.lastError ? 'err' : 'dim') }, r.lastError ? r.lastError : `${r.tracks} tracks`)),
        admin ? h('button', { class: 'btn danger', onclick: async () => { try { await api(`/library/roots/${r.id}`, { method: 'DELETE' }); draw(); } catch (e) { toast(e.message, true); } } }, 'Remove') : null)),
      admin ? h('div', { class: 'row', style: 'margin-top:8px' }, pathIn, h('button', { class: 'btn primary', onclick: async () => { try { await api('/library/roots', { method: 'POST', body: { path: pathIn.value } }); toast('Folder added. Scanning…'); draw(); } catch (e) { toast(e.message, true); } } }, 'Add')) : null,
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: async () => { try { await api('/library/rescan', { method: 'POST' }); toast('Scanning…'); } catch (e) { toast(e.message, true); } } }, 'Rescan now'),
        h('span', { class: 'dim small' }, st.library.scanning ? `Scanning${st.library.progress ? ` ${st.library.progress.done}/${st.library.progress.total}` : ''}…` : ''))));
    if (admin) panes.library.push(nasCard());
    panes.library.push(replayGainCard(settings));
    panes.library.push(acoustIdCard(settings));

    // Network
    panes.network.push(h('div', { class: 'card' }, h('h3', null, 'Home network'),
      h('p', { class: 'dim small' }, 'WavWiz listens only on the address chosen at install (never “all interfaces” unless you opt in). Away-from-home access uses Tailscale only — nothing is opened to the public internet.'),
      h('p', { class: 'small' }, `Listening on ${st.bind}`),
      nav ? h('button', { class: 'btn', onclick: () => { d.close(); nav('remote'); } }, 'Away-from-home (Tailscale)…') : null));
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

    panes.about.push(h('div', { class: 'card' }, h('h3', null, 'About'), h('p', null, `${st.display} - BETA software. WavWiz works only on your home network: nothing is sent to the internet and there is no tracking.`),
      h('p', { class: 'small dim' }, 'Beta limits: your own files, internet radio (incl. Radio Browser finder), devices/zones, scenes, schedules, follow-speaker, CD ripper (FLAC/AAC; libcdio CDDA), tag fix with AcoustID when a key is set, Tailscale remote. Apple Music/Pandora/Cast and opening the server to the public internet are not in this beta. AirPlay and optional Spotify Connect are included.'),
      h('button', { class: 'btn', onclick: () => import('./about.js').then(m => m.openAbout(S)) }, 'About, credits & licenses')));

    const navEl = h('div', { class: 'settings-nav', role: 'tablist' }, GROUPS.map(([id, label]) =>
      h('button', { class: active === id ? 'on' : '', 'data-g': id, onclick: () => { active = id; paint(); } }, label)));
    const sections = GROUPS.map(([id]) => h('div', { class: 'settings-sec' + (active === id ? ' on' : ''), 'data-g': id }, ...panes[id]));
    body.replaceChildren(navEl, ...sections);

    function paint() {
      navEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.g === active));
      body.querySelectorAll('.settings-sec').forEach(s => s.classList.toggle('on', s.dataset.g === active));
    }
  };

  function revokeToken(t) {
    const rm = h('input', { type: 'checkbox', checked: true, id: 'rev-rm' });
    dialog(`Revoke “${t.name}”?`, h('div', null, h('p', null, 'This device is signed out at once and can no longer control WavWiz or play music. A player that is still running will say “not paired” and offer to pair again.'),
      h('label', { class: 'row' }, rm, 'Also remove it from the device list')),
    [{ text: 'Revoke', cls: 'danger', onclick: async () => { try { await api(`/tokens/${t.id}${rm.checked ? '?removeFromList=1' : ''}`, { method: 'DELETE' }); toast('Revoked'); } catch (e) { toast(e.message, true); return false; } draw(); } }, { text: 'Cancel' }]);
  }
  async function putSettings(o) { try { await api('/settings', { method: 'PUT', body: o }); toast('Saved'); } catch (e) { toast(e.message, true); } }
  async function makeToken() {
    const name = h('input', { type: 'text', maxlength: 60, placeholder: 'e.g. Home Assistant' }), role = h('select', null, ['view', 'control', 'admin'].map(r => h('option', { value: r }, r)));
    const out = h('div', { class: 'mono small', style: 'word-break:break-all' });
    dialog('Create API token', [h('div', { class: 'field' }, h('label', null, 'Name'), name), h('div', { class: 'field' }, h('label', null, 'Access'), role), out],
      [{ text: 'Create', cls: 'primary', keep: true, onclick: async () => { try { const r = await api('/tokens', { method: 'POST', body: { name: name.value, role: role.value } }); out.replaceChildren(h('p', { class: 'amber' }, r.note), h('code', null, r.token)); } catch (e) { toast(e.message, true); } return false; } }, { text: 'Done', onclick: () => { draw(); } }]);
  }
  function displaySizeCard() {
    const cur = loadScale();
    const box = h('div', { class: 'card', id: 'sec-display' }, h('h3', null, 'Display size (this device only)'));
    box.append(h('p', { class: 'dim small' }, 'Makes the web UI larger or smaller on this phone or PC. Compact is the default.'),
      h('div', { class: 'row wrap' }, SCALES.map(([id, name]) => h('button', { class: 'chipbtn' + (cur === id ? ' on' : ''), onclick: () => { applyScale(id); draw(); } }, name))));
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

/** 0.1.3: ReplayGain - even out loudness between songs (server side, every zone). */
function replayGainCard(settings) {
  const cur = typeof settings['playback.replayGain'] === 'string' ? settings['playback.replayGain'] : 'auto';
  const opts = [['auto', 'Automatic - album levels when an album plays in order, song levels otherwise'], ['track', 'Song - every song at the same loudness'], ['album', 'Album - keep the loud and quiet songs of an album as mastered'], ['off', 'Off - play files exactly as they are']];
  const sel = h('select', { 'aria-label': 'Volume leveling', id: 'rg-mode', onchange: async ev => { try { await api('/settings', { method: 'PUT', body: { 'playback.replayGain': ev.target.value } }); toast('Volume leveling saved - it applies from the next song.'); } catch (e) { toast(e.message, true); } } },
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
