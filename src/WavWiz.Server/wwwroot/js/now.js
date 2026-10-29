import { holdPage } from './motion.js';
import { h, api, toast, fmtTime, fmtDur, dialog } from './util.js';
import { openSleep } from './scenesched.js';   // 0.3.5 J8
import { cover, npCover, npKey, itemArtUrl, setMediaSession, isLive, isReceiver, sourceLabel, streamingChip } from './art.js';
import { Viz, vizPrefs, saveVizPrefs, inDesktopPlayer, isPhone, setVizProgress } from './viz.js';
import { icon, setIcon, iconSvg, setChev } from './icons.js';
import { mixerButton } from './mixer.js';
import { shortcutsRow, shortcutsSide } from './shortcuts.js';
import { canControl, thisDevice } from './ui.js';
import { loadNpPrefs, npVars, waveBars, eqBars, applyNpClasses } from './npstyle.js';
import { npArtBox } from './npart.js';   // 0.5.0 F98: Album art axis on the compact strips too
import { heartBtn } from './fav.js';
import { loadCenter, saveCenter, toggleLabel, centerEq } from './centerview.js';
import { kioskOpen } from './jukebox-kiosk.js';
import { mountMini } from './mini.js';
import { loadPanels, savePanels } from './panels.js';
import { scaleTo, changed, groupLevel, members } from './mixer-core.js';   // 0.4.9 F68: the phone remote's zone volume scales like the Volume Mixer's zone slider
import { zoneLink, current as currentZone } from './zones40.js';   // 0.4.5 F27: the inline "on <zone> ▾" is the only Controlling picker in Now Playing views
import { loadEqLock, saveEqLock } from './eqstyle.js';
import { loadLooks, btnOpacity, overlayButtons, looksRows, getLook, setLook, resetLooks, stepPct, ovSvg } from './looks.js';

/** Now Playing - 0.0.8 layout per the "waveform river" mockup:
 *  [bordered visualizer panel: look name top-left, progress bar along its bottom edge with elapsed (left) / look name (center) / remaining (right)]
 *  [album art | title, artist (accent), genre line with an equalizer icon | divider | bordered transport box: shuffle, prev, big round play, next, repeat]
 *  [Up next ─────────]
 * 0.2.0 item 9: the panel's volume and Mute control ONLY this device (the speaker this page plays on - see ui.js thisDevice).
 * 0.2.1 F10/F11: no pop-up menu, no Stop, Sound (EQ) is a regular button; no speaker status in the header (it lives in the Devices panel).
 * Master volume moved to the top of Devices (item 10). The same this-device volume/Mute sits on the full-width mini bar (items 16 + 27). */
/** 0.2.1 F9: the live control panel, so Settings > Appearance can preview it with the very same markup + CSS (cloned, scaled down). */
let panelTpl = null;
export const npPanelTemplate = () => panelTpl;
export function createNow(S, ctl) {
  const mkSc = cls => shortcutsRow({ run: id => ctl.runShortcut?.(id), home: () => ctl.goHome?.(), cls }).el;   // 0.3.7 L5/L11: Home (far right) + up to 3 pins
  let ctlPanel = null;
  // 0.5.0 F130: NP header = one Shortcuts toggle -> vertical side icon strip (pins + Home); the bar / mini keep their rows
  const scSide = shortcutsSide({ run: id => ctl.runShortcut?.(id), home: () => ctl.goHome?.(), cls: 'np-scside', onChange: o => ctlPanel?.classList.toggle('scopen', o) });
  const E = {}; let viz = null, vizState = { audible: false, error: null, preset: '' }, overlay = null, receivers = null;
  const act = ctl.act;
  const stage = h('div', { class: 'stage np-stage' }), coverHolder = h('div', { class: 'stagecover' }), host = h('div', { class: 'vizhost' }), vname = h('div', { class: 'vname' }), vbtns = h('div', { class: 'vbtns' });
  // 0.2.1 F3: clean visualizer panel - no "VISUALIZER" title and no look-name label; only the small Looks / full screen / pop-out buttons.
  // The AirPlay / Spotify Connect source chip (shown only while a phone streams) floats in the stage's top-left corner instead.
  const srcChip = h('div', { class: 'np-srcchip', hidden: true });
  stage.append(coverHolder, host, srcChip, vname, vbtns);
  const art = h('div', { class: 'npart' });
  const t1 = h('div', { class: 't1' }, 'Nothing playing'), t2 = h('div', { class: 't2' }, ' '), t3line = h('div', { class: 't3line' }, ''), t3 = h('div', { class: 'notice' });
  const fill = h('div', { class: 'fill' }), knob = h('div', { class: 'knob' }), elv = h('span', { class: 'np-elv' }, '--:--'), rev = h('span', { class: 'np-rev' }, '-:--');
  const seek = ev => { if (!canControl(S) || !S.now?.item || isLive(S.now.item)) return; const r = prog.getBoundingClientRect(); act('/stream/seek', { ms: Math.round(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * S.now.durationMs) }); };
  const prog = h('div', { class: 'prog', role: 'slider', 'aria-label': 'Position', tabindex: 0, onclick: seek }, h('div', { class: 'bar' }), fill, knob);
  const play = h('button', { class: 'tbtn play', 'aria-label': 'Play or pause', onclick: () => act(S.now?.state === 'playing' ? '/stream/pause' : S.now?.state === 'paused' ? '/stream/resume' : (S.queue.length ? '/stream/jump' : '/stream/resume'), S.now?.state === 'stopped' ? { index: Math.max(0, S.now.index) } : undefined) }, icon('play'));
  const shuffle = h('button', { class: 'tbtn tog', 'aria-label': 'Shuffle', 'aria-pressed': 'false', onclick: () => act('/stream/shuffle', { on: !S.now?.shuffle }) }, icon('shuffle'));
  const repeat = h('button', { class: 'tbtn tog', 'aria-label': 'Repeat', 'aria-pressed': 'false', onclick: () => act('/stream/repeat', { mode: { off: 'all', all: 'one', one: 'off' }[S.now?.repeat ?? 'off'] }) }, icon('repeat'));
  const me = () => thisDevice(S);
  const setMyVol = v => { const z = me(); if (!z) return; z.volume = v; act(`/zones/${z.id}`, { volume: v }, 'PATCH'); };
  const mkVol = () => { const r = h('input', { type: 'range', min: 0, max: 100, value: 0, class: 'myvol', 'aria-label': 'Volume of this device', oninput: ev => { syncVol(+ev.target.value, r); clearTimeout(r._t); r._t = setTimeout(() => setMyVol(+ev.target.value), 120); } }); return r; };
  const toggleMute = () => { const z = me(); if (!z || !canControl(S)) return; z.muted = !z.muted; act(`/zones/${z.id}`, { muted: z.muted }, 'PATCH'); drawMine(); };
  const mkMute = () => h('button', { class: 'tbtn tog mutebtn', 'aria-label': 'Mute this device', 'aria-pressed': 'false', title: 'Mute this device', onclick: toggleMute }, icon('volume'));
  // 0.3.5 J8: the Sleep timer's permanent home - a Sleep button in Now Playing (small menu of times; shows the countdown while it runs)
  function mkSleep() { const b = h('button', { class: 'btn sm npsleep', type: 'button', 'aria-haspopup': 'menu', title: 'Sleep timer', onclick: () => { if (!canControl(S)) return toast('Your access is view-only.'); openSleep(S, null, b); } }, 'Sleep'); return b; }
  const vol = mkVol(), muteBtn = mkMute();
  const volPct = h('span', { class: 'volpct small dim' }, '');
  const genre = h('div', { class: 'np-genre' }, h('span', { class: 'np-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')), t3line);
  // 0.2.1 F10: no three-dot menu and no Stop - Sound (EQ) is a regular panel button next to Mute (one click), styled like Shuffle / Repeat
  const mkMix = () => mixerButton('tbtn');   // 0.4.8 F49
  const mkEq = () => h('button', { class: 'tbtn eqbtn', 'aria-label': 'Sound (EQ)', title: 'Sound (EQ)', onclick: () => ctl.openEq() }, icon('eq'));
  const eqBtn = mkEq();
  const upnext = h('div', { class: 'upnext np-upnext', 'aria-label': 'Up next' });
  const strip = h('div', { class: 'phone-only' }), checklist = h('div', { class: 'checklist' });
  Object.assign(E, { t1, t2, t3, elv, rev, fill, knob, play, shuffle, repeat, vol });
  const prev = h('button', { class: 'tbtn', 'aria-label': 'Previous', onclick: () => act('/stream/prev') }, icon('prev')), next = h('button', { class: 'tbtn', 'aria-label': 'Next', onclick: () => act('/stream/next') }, icon('next'));
  // 0.1.2 panel hotfix: controls live in their own SOLID panel below a separate visualizer panel (same chrome as Library / Devices / Playlist).
  // Control layout is unchanged: title/times | transport | master volume, device dots underneath.
  const ovAl = h('div', { class: 'np-album ell' }), ovT1 = h('div', { class: 't1' }, 'Nothing playing'),   /* 0.4.9 F68: album line (phone remote only) */ ovT2 = h('div', { class: 't2' }, ' '), ovAA = h('span', { class: 'pn-aa ell' });   // 0.3.6 K21: artist - album on the time line (Center style)
  // 0.2.0 item 8: four panel styles (Classic default, Center, Stack, Horizon) share one set of controls; CSS (.pn-<style>) shows each
  // style's art + seek treatment. Art LEFT, one matching button style per panel, volume = speaker icon + slider + %, then Mute and More.
  const seekFrac = f => { if (!canControl(S) || !S.now?.item || isLive(S.now.item) || !S.now.durationMs) return; act('/stream/seek', { ms: Math.round(Math.min(1, Math.max(0, f)) * S.now.durationMs) }); };
  const fracAt = (el, ev) => { const r = el.getBoundingClientRect(); return (ev.clientX - r.left) / r.width; };
  const pnCover = h('div', { class: 'pn-cover' }), pnRefl = h('div', { class: 'pn-refl', 'aria-hidden': 'true' }), pnDisc = h('div', { class: 'pn-disc', 'aria-hidden': 'true' }, h('i'));
  // 0.5.0 F97: cassette shell (art: cassette) - opaque body, gold meta bar under the label (cover art moves into the label), hubs spin while playing, brown tape behind each hub tracks --np-frac
  const cassSpool = side => h('span', { class: 'pc-sp pc-' + side }, h('i', { class: 'pc-tape' }), h('i', { class: 'pc-hub' }));
  const pnCass = h('div', { class: 'pn-cass', 'aria-hidden': 'true' }, h('i', { class: 'pc-lbl' }),   // F104: Matte Tape - no grips / gold TYPE I bar; recessed label window frame
    ...['tl', 'tr', 'bl', 'br', 'bc'].map(c => h('i', { class: 'pc-scr pc-' + c })),
    h('div', { class: 'pc-well' }, h('i', { class: 'pc-bridge' }), cassSpool('l'), cassSpool('r')), h('div', { class: 'pc-notch' }, h('i'), h('i'), h('i')));
  const pnRing = h('span', { class: 'pn-ring', 'aria-hidden': 'true' });
  pnRing.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><rect class="trk" x="1.5" y="1.5" width="97" height="97" rx="9" pathLength="100"/><rect class="val" x="1.5" y="1.5" width="97" height="97" rx="9" pathLength="100"/></svg>';
  const ringVal = pnRing.querySelector('.val'), ringDot = h('span', { class: 'pn-ringdot', 'aria-hidden': 'true' });
  const npHeart = h('span', { class: 'np-heartslot' }), barHeart = h('span', { class: 'np-heartslot' });   // 0.2.0 item 14: heart the playing song
  const idleHeart = () => { const b = h('button', { type: 'button', class: 'heart tbtn ico', disabled: true, 'aria-label': 'Favorite (nothing playing)', title: 'Nothing playing' }); b.innerHTML = iconSvg('heart'); return b; };
  const xHeart = h('span', { class: 'np-heartslot np-xheart' }, idleHeart());   // 0.2.1 F10: Classic shows the heart as a round button left of Shuffle
  const pnArt = h('div', { class: 'pn-art' }, pnDisc, pnCass, pnCover, pnRing, ringDot, pnRefl);   // F96: ring (square) / spinning cover (disc) / sliding vinyl (sleeve) per pn-art-*; reflection stays off
  const pillElv = h('span', { class: 'pn-pel' }, '--:--'), pillDur = h('span', { class: 'pn-pdur' }, '-:--');
  const pnPill = h('div', { class: 'pn-pill' }, h('i', { 'aria-hidden': 'true' }), pillElv, h('span', { class: 'dim' }, ' / '), pillDur);
  const waveBase = h('div', { class: 'pn-wbars' }), waveTop = h('div', { class: 'pn-wbars on' }), waveClip = h('div', { class: 'pn-wclip' }, waveTop);
  const pnWave = h('div', { class: 'pn-wave', role: 'slider', 'aria-label': 'Position', tabindex: 0, onclick: ev => seekFrac(fracAt(pnWave, ev)) }, waveBase, waveClip);
  const clockVal = h('span', { class: 'pn-cval' }, '--:--'), pnClock = h('div', { class: 'pn-clock', 'aria-hidden': 'true' }, h('span', { class: 'pn-cghost' }, '88:88'), clockVal);
  const trackNo = h('span', { class: 'pn-trk' }, 'TRACK --'), lcdRev = h('span', { class: 'pn-lrev' }, '-:--');
  const ledFill = h('div', { class: 'pn-ledfill' });
  const pnLed = h('div', { class: 'pn-led', role: 'slider', 'aria-label': 'Position', tabindex: 0, onclick: ev => seekFrac(fracAt(pnLed, ev)) }, ledFill);
  // 0.5.0 F95: EQ-bars seek - even-width bars of varying height, the played part lit (clip), click seeks by x like wave / LED
  const eqBase = h('div', { class: 'pn-eqbars' }), eqTop = h('div', { class: 'pn-eqbars on' }), eqClip = h('div', { class: 'pn-wclip pn-eqclip' }, eqTop);
  const pnEq = h('div', { class: 'pn-eq', role: 'slider', 'aria-label': 'Position', tabindex: 0, onclick: ev => seekFrac(fracAt(pnEq, ev)) }, eqBase, eqClip);
  // keyboard: left / right nudge 5 s on any of the bar seeks
  const keySeek = ev => { const d = { ArrowLeft: -5000, ArrowRight: 5000 }[ev.key]; const n0 = S.now; if (!d || !n0?.durationMs) return; ev.preventDefault();
    const pos = n0.state === 'playing' ? S.localPos + (performance.now() - S.localAt) : n0.positionMs; seekFrac((pos + d) / n0.durationMs); };
  for (const s of [pnWave, pnLed, pnEq]) s.addEventListener('keydown', keySeek);
  // 0.5.0 F130: labeled ARTIST · ALBUM line (desktop flat NP); album part omitted when missing
  const aaArtist = h('span', { class: 'np-aav ell' }), aaAlbum = h('span', { class: 'np-aav ell' });
  const aaAlbumWrap = h('span', { class: 'np-aapart np-aaalb' }, h('span', { class: 'np-aadot', 'aria-hidden': 'true' }, '·'), h('span', { class: 'np-aal' }, 'Album'), aaAlbum);
  const aaArtistLbl = h('span', { class: 'np-aal' }, 'Artist');
  const aaLine = h('div', { class: 'np-aaline' }, h('span', { class: 'np-aapart' }, aaArtistLbl, aaArtist), aaAlbumWrap);
  const tableMeta = h('div', { class: 'np-tablemeta pn-meta' },
    h('div', { class: 'pn-titlerow' }, h('div', { class: 'np-tabletitles' }, ovT1, ovT2, ovAl, aaLine), npHeart, pnClock),
    h('div', { class: 'pn-lcdrow' }, trackNo, lcdRev), pnLed, pnPill, pnWave, pnEq,
    h('div', { class: 'np-tableseek' }, prog, h('div', { class: 'np-times' }, elv, ovAA, rev)));
  const tableXport = h('div', { class: 'transport np-tablexport', role: 'group', 'aria-label': 'Transport' }, xHeart, shuffle, prev, play, next, repeat);
  const tableVol = h('div', { class: 'np-tablevol' },
    h('div', { class: 'np-vollbl sr-only' }, 'Volume'),
    h('div', { class: 'np-volrow' }, muteBtn, mkMix(), h('div', { class: 'np-vol' }, eqBtn), mkSleep()),   /* 0.4.8 F54: no volume slider in the play bars - the mixer button is in its place */
    zoneLink('zl-ov'),   // 0.5.0 F130: "on <zone> ▾" sits bottom-right under mute / mixer / EQ / Sleep (same F119 picker; phone grid-area unchanged)
    zoneVolRow());   // 0.4.9 F68: phone only (CSS) - full-width volume of the zone being controlled
  // 0.4.9 F68: phone remote - one volume + mute for the zone in the "on <zone>" picker; same scaling (scaleTo / caps) as the Volume Mixer's zone slider
  function zoneGroup() { const c = currentZone(); return c?.kind === 'zone' ? (S.groups || []).find(g => g.id === c.id) || null : null; }
  function zoneMembers() { const g = zoneGroup(); return g ? members(S.zones, g).filter(z => z.enabled !== false) : []; }
  function zoneVolRow() {
    let base = null; const timers = new Map();
    const send = (z, body) => { clearTimeout(timers.get(z.id)); timers.set(z.id, setTimeout(() => act(`/zones/${z.id}`, body, 'PATCH'), 90)); };
    const r = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, class: 'np-zvol', 'aria-label': 'Zone volume' });
    const pct = h('span', { class: 'np-zpct' }, '—');
    const mute = h('button', { type: 'button', class: 'tbtn tog np-zmute', 'aria-label': 'Mute this zone', 'aria-pressed': 'false', onclick: () => {
      const g = zoneGroup(), zs = zoneMembers(); if (!g || !canControl(S)) return; const m = !(zs.length && zs.every(z => z.muted)); for (const z of zs) z.muted = m;
      api(`/groups/${g.id}/mute`, { method: 'POST', body: { muted: m } }).catch(e => toast(e.message, true)); drawZoneVol(); } }, icon('volume'));
    r.addEventListener('pointerdown', () => { base = null; });
    r.addEventListener('input', () => {
      const zs = zoneMembers(); if (!zs.length || !canControl(S)) return;
      if (!base) base = { zs, vols: zs.map(z => z.volume) };
      const next = scaleTo(base.vols, +r.value, base.zs.map(z => z.volCap ?? 100));
      for (const [i, v] of changed(base.vols, next)) { const z = base.zs[i]; z.volume = v; send(z, { volume: Math.round(v) }); }
      pct.textContent = r.value + '%'; r.style.setProperty('--v', r.value + '%'); });
    r.addEventListener('change', () => { base = null; });
    E.zoneVol = { r, pct, mute };
    return h('div', { class: 'np-phvol', role: 'group', 'aria-label': 'Zone volume' }, mute, h('div', { class: 'np-zvolw' }, r, pct));
  }
  function drawZoneVol() {
    const zv = E.zoneVol; if (!zv) return; const zs = zoneMembers(), v = Math.round(groupLevel(zs.map(z => z.volume))), muted = !!zs.length && zs.every(z => z.muted);
    zv.r.disabled = zv.mute.disabled = !canControl(S) || !zs.length;
    if (document.activeElement !== zv.r) { zv.r.value = String(v); zv.r.style.setProperty('--v', v + '%'); }
    zv.pct.textContent = zs.length ? v + '%' : '—';
    zv.mute.classList.toggle('on', muted); zv.mute.setAttribute('aria-pressed', String(muted)); setIcon(zv.mute, muted ? 'mute' : 'volume'); zv.mute.setAttribute('aria-label', muted ? 'Unmute this zone' : 'Mute this zone');
  }
  // Collapse arrow = the same `plus listcol` toggle the Playlist uses (˅ / ˄, themed accent). Collapsing the control panel
  // slides it down to its header strip and the visualizer panel grows into the freed space. Saved per device.
  // 0.4.9 F67: on the phone the EQ / visualizer no longer take the space, so the card starts expanded unless the user folded it themselves
  const P0 = loadPanels(), phoneNp = typeof matchMedia === 'function' && matchMedia('(max-width:760px)').matches;
  // 0.4.9 F68: on the phone Now Playing IS the remote - never folded (the fold button is hidden there)
  let ctlCollapsed = P0.ctl === 'collapsed' && !phoneNp;   // 0.3.0 §6: one key for all panels
  const ctlColBtn = h('button', { class: 'plus listcol np-ctlcol', 'aria-label': 'Collapse or expand the playback controls', 'aria-expanded': String(!ctlCollapsed), title: 'Collapse / expand the controls', onclick: () => toggleCtl() }); setChev(ctlColBtn, ctlCollapsed ? 'u' : 'd');
  const ctlNow = h('span', { class: 'np-ctlnow small dim ell' }, '');
  // 0.2.3 U1 (replaces 0.2.2 T3): collapsed = ONE line - thumbnail, title · artist over a progress bar with elapsed / total, then every
  // control (heart, shuffle, prev, play/pause, next, repeat, volume + %, mute, EQ), all scaled to fit; nothing moves to the Playlist bar.
  // U3: the line wears the selected panel style (.pn-<style> on the panel: buttons, progress look, thumbnail effect) in the theme's colors.
  const sHeart = h('span', { class: 'np-heartslot' }, idleHeart());
  const sShuffle = h('button', { class: 'tbtn tog', 'aria-label': 'Shuffle', 'aria-pressed': 'false', onclick: () => shuffle.click() }, icon('shuffle'));
  const sRepeat = h('button', { class: 'tbtn tog', 'aria-label': 'Repeat', 'aria-pressed': 'false', onclick: () => repeat.click() }, icon('repeat'));
  const sPrev = h('button', { class: 'tbtn', 'aria-label': 'Previous', onclick: () => act('/stream/prev') }, icon('prev'));
  const sNext = h('button', { class: 'tbtn', 'aria-label': 'Next', onclick: () => act('/stream/next') }, icon('next'));
  const sPlay = h('button', { class: 'tbtn play', 'aria-label': 'Play or pause', onclick: () => play.click() }, icon('play'));
  const sVol = mkVol(), sPct = h('span', { class: 'volpct' }, ''), sMute = mkMute(), sEq = mkEq();
  const sArtB = npArtBox({ cls: 'npa-sm' }), sArt = h('div', { class: 'ns-art' }, sArtB.el), sT1 = h('span', { class: 'ns-t1 ell' }, 'Nothing playing'), sT2 = h('span', { class: 'ns-t2 ell' }, '');
  const sElv = h('span', { class: 'ns-elv' }, '--:--'), sDur = h('span', { class: 'ns-dur' }, '-:--');
  const sFill = h('div', { class: 'fill' }), sKnob = h('div', { class: 'knob' }), sLedFill = h('div', { class: 'ns-ledfill' });
  const sWaveBase = h('div', { class: 'pn-wbars' }), sWaveTop = h('div', { class: 'pn-wbars on' }), sWaveClip = h('div', { class: 'pn-wclip' }, sWaveTop);
  const sEqBase = h('div', { class: 'pn-eqbars' }), sEqTop = h('div', { class: 'pn-eqbars on' }), sEqClip = h('div', { class: 'pn-wclip' }, sEqTop);
  const sProg = h('div', { class: 'ns-prog', role: 'slider', 'aria-label': 'Position', tabindex: 0, onclick: ev => seekFrac(fracAt(sProg, ev)) },
    h('div', { class: 'bar' }), sFill, sKnob, h('div', { class: 'ns-led', 'aria-hidden': 'true' }, sLedFill), h('div', { class: 'ns-wave', 'aria-hidden': 'true' }, sWaveBase, sWaveClip), h('div', { class: 'ns-eq', 'aria-hidden': 'true' }, sEqBase, sEqClip));
  const ctlStrip = h('div', { class: 'np-strip', role: 'group', 'aria-label': 'Now playing (compact)' },
    h('div', { class: 'ns-song' }, sArt, h('div', { class: 'ns-main' }, h('div', { class: 'ns-titles' }, sT1, h('span', { class: 'ns-dot', 'aria-hidden': 'true' }, '·'), sT2, zoneLink('zl-strip')), h('div', { class: 'ns-seek' }, sElv, sProg, sDur))),
    h('div', { class: 'ns-x', role: 'group', 'aria-label': 'Transport' }, sHeart, sShuffle, sPrev, sPlay, sNext, sRepeat),
    h('div', { class: 'ns-vol' }, sMute, mkMix(), sEq));
  // U2: with the Playlist minimized its title bar shows only "Up next: Title · Artist", centered on the Now Playing column (main.js places it)
  const nxArt = h('div', { class: 'pln-art' }), nxT1 = h('span', { class: 'pln-t1 ell' }, ''), nxT2 = h('span', { class: 'pln-t2 ell' }, '');
  const nextBlock = h('div', { class: 'plnext', 'aria-label': 'Up next', hidden: true }, h('span', { class: 'pln-lbl' }, 'UP NEXT'), nxArt, nxT1, h('span', { class: 'pln-dot', 'aria-hidden': 'true' }, '·'), nxT2);
  const ctlBody = h('div', { class: 'np-ctlbody' }, h('div', { class: 'np-tablemain' }, pnArt, tableMeta, h('div', { class: 'pn-ctl' }, tableXport, tableVol)));
  ctlPanel = h('section', { class: 'np-ctlpanel np-flat' + (ctlCollapsed ? ' collapsed' : '') + (scSide.isOpen() ? ' scopen' : ''), role: 'group', 'aria-label': 'Playback controls' },
    h('div', { class: 'pane-h' }, h('span', { class: 'np-ctltitle' }, 'NOW PLAYING'), ctlNow, ctlStrip, h('span', { class: 'grow' }), scSide.toggle, h('span', { class: 'row listcolwrap' }, ctlColBtn)), ctlBody, scSide.strip);
  function applyNpStyle() {
    const p = loadNpPrefs();
    applyNpClasses(ctlPanel, p);   // F95: pn-seek-<line|wave|led|eq> + pn-btn-<round|soft|square|ring> + pn-art-<square|disc|sleeve>
    for (const [k, v] of Object.entries(npVars(p))) ctlPanel.style.setProperty(k, v);
  }
  panelTpl = ctlPanel;
  applyNpStyle(); window.addEventListener('wavwiz:npstyle', applyNpStyle);
  window.addEventListener('storage', ev => { if (ev.key === 'wavwiz.npstyle.v1') applyNpStyle(); });
  function toggleCtl(force) { holdPage();   // 0.4.9 F74: page held BEFORE the change (the scrollbar shows in the very first frame)
    ctlCollapsed = force ?? !ctlCollapsed;
    ctlPanel.classList.toggle('collapsed', ctlCollapsed);
    el.classList.toggle('ctlcollapsed', ctlCollapsed);
    setChev(ctlColBtn, ctlCollapsed ? 'u' : 'd');
    ctlColBtn.setAttribute('aria-expanded', String(!ctlCollapsed));
    savePanels({ ...loadPanels(), ctl: ctlCollapsed ? 'collapsed' : 'open', ctlSet: true });
    paintCollapsed();
    setTimeout(() => viz?.resize(), 340);
  }
  /** The desk knows the panel is collapsed (layout hooks); 0.2.3 U1: the song stays on the panel's own line. */
  function paintCollapsed() {
    el.closest?.('.desk')?.classList.toggle('npcollapsed', ctlCollapsed);
    window.dispatchEvent(new CustomEvent('wavwiz:npcollapsed', { detail: ctlCollapsed }));
  }
  // Visualizer panel: just the stage (0.2.1 F3: no header bar). Source chip (AirPlay / Spotify Connect) floats in the stage corner.
  const vizPanel = h('section', { class: 'np-vizpanel', 'aria-label': 'Visualizer' }, stage);
  const ovTitles = { children: [ovT1, ovT2] };   // draw() updates title/artist via E.ovTitles
  const el = h('section', { class: 'nowcol np8 np12' + (ctlCollapsed ? ' ctlcollapsed' : ''), id: 'p-now', 'aria-label': 'Now playing' },
    h('h2', { class: 'sr-only' }, 'Now playing'), vizPanel,
    h('div', { class: 'np-row' },
      h('div', { class: 'np-meta' }, art, h('div', { class: 'titles' }, t1, t2, zoneLink('zl-meta'), genre, t3))),
    ctlPanel, upnext, strip, checklist);
  E.ovTitles = ovTitles;

  const miniArtB = npArtBox({ cls: 'npa-sm npa-phone' }), miniCover = h('div', { class: 'mini-art' }, miniArtB.el), miniT = h('div', { class: 't1 ell' }, 'Nothing playing'), miniS = h('div', { class: 't2 ell' });
  const miniPlay = h('button', { class: 'tbtn play mini-play', 'aria-label': 'Play or pause', onclick: ev => { ev.stopPropagation(); play.click(); } }, icon('play'));
  const mini = h('div', { class: 'mini', onclick: () => ctl.go('now') }, miniCover, h('div', { class: 'grow' }, miniT, h('div', { class: 'zl-line' }, miniS, zoneLink('zl-phone'))), miniPlay);

  // 0.2.0 items 16 + 27: full-width Now Playing bar for the expanded Library / Devices views (art, titles, transport, seek + times,
  // this-device volume, Mute, More). Same Classic button style as the panel.
  const barArtB = npArtBox({ cls: 'npa-sm' }), barCover = h('div', { class: 'npb-art' }, barArtB.el), barT1 = h('div', { class: 't1 ell' }, 'Nothing playing'), barT2 = h('div', { class: 't2 ell' });
  const barFill = h('div', { class: 'fill' }), barKnob = h('div', { class: 'knob' }), barElv = h('span', { class: 'np-elv' }, '--:--'), barRev = h('span', { class: 'np-rev' }, '-:--');
  const barProg = h('div', { class: 'prog', role: 'slider', 'aria-label': 'Position', tabindex: 0, onclick: ev => { if (!canControl(S) || !S.now?.item || isLive(S.now.item)) return; const r = barProg.getBoundingClientRect(); act('/stream/seek', { ms: Math.round(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * S.now.durationMs) }); } }, h('div', { class: 'bar' }), barFill, barKnob);
  const barPlay = h('button', { class: 'tbtn play', 'aria-label': 'Play or pause', onclick: () => play.click() }, icon('play'));
  const barVol = mkVol(), barMute = mkMute(), barPct = h('span', { class: 'volpct small dim' }, '');
  const barEq = mkEq();
  const npbar = h('section', { class: 'npbar', 'aria-label': 'Now playing (compact)' },
    barCover, h('div', { class: 'npb-titles' }, barT1, h('div', { class: 'zl-line' }, barT2, zoneLink('zl-bar'))), barHeart,
    h('div', { class: 'transport npb-x', role: 'group', 'aria-label': 'Transport' }, h('button', { class: 'tbtn', 'aria-label': 'Previous', onclick: () => act('/stream/prev') }, icon('prev')), barPlay, h('button', { class: 'tbtn', 'aria-label': 'Next', onclick: () => act('/stream/next') }, icon('next'))),
    h('div', { class: 'npb-seek' }, barElv, barProg, barRev),
    h('div', { class: 'npb-vol' }, mkSleep(), barMute, mkMix(), barEq), mkSc('npb-sc'));
  function syncVol(v, from) { for (const r of [vol, barVol, sVol]) if (r !== from && document.activeElement !== r) r.value = v; volPct.textContent = barPct.textContent = sPct.textContent = Math.round(v) + '%'; }
  /** This device's volume / mute on the panel, the mini bar and the header tag. */
  function drawMine() {
    const z = me(), can = canControl(S) && !!z;
    for (const r of [vol, barVol, sVol]) { r.disabled = !can; r.title = z ? `Volume of this device (${z.name})` : 'This page is not playing as a speaker yet'; }
    drawZoneVol();
    syncVol(z ? z.volume : 0); if (!z) volPct.textContent = barPct.textContent = sPct.textContent = '—';
    for (const b of [muteBtn, barMute, sMute]) { b.disabled = !can; b.classList.toggle('on', !!z?.muted); b.setAttribute('aria-pressed', String(!!z?.muted)); setIcon(b, z?.muted ? 'mute' : 'volume'); b.title = z?.muted ? 'Unmute this device' : 'Mute this device'; }
  }

  // 0.3.0 §3: EQ is the default center view; the toggle beside Looks switches EQ ⇄ Visualizer (remembered on this device)
  let center = loadCenter(), eqv = null; const eqHost = h('div', { class: 'np-eqhost' });
  stage.append(eqHost);
  function setCenter(m) { center = saveCenter(m); ensureViz(); drawVBtns(); paintStage(); }
  // 0.3.1 B18 (viz-controls-icons): ONE overlay group of 28x28 icon buttons in the stage's top-right corner, muted Lock EQ style, theme
  // variables only, labels in tooltips + aria-labels. B17: Lock EQ lives in this group, above every glow / visualizer layer.
  let looksPop = null;
  const OV_LABEL = { lock: l => (l ? 'Lock EQ (locked) - click to unlock' : 'Lock EQ'), swap: () => (center === 'eq' ? 'Show the visualizer' : 'Show the EQ'), looks: () => 'Looks', full: () => 'Full screen', power: on => (on ? 'Visualizer on - click to turn off' : 'Visualizer off - click to turn on'), popout: () => 'Pop out' };
  function ovBtn(name, label, on, onclick, iconName = name) {
    const b = h('button', { type: 'button', class: 'ib ov-' + name + (name === 'swap' ? ' np-centertoggle' : '') + (on ? ' on' : ''), 'aria-label': label, title: label, 'data-ov': name, onclick });
    if (name === 'lock' || name === 'swap' || name === 'power' || name === 'looks') b.setAttribute('aria-pressed', String(!!on));
    b.innerHTML = ovSvg(iconName); return b;
  }
  function applyLooks() {
    const l = loadLooks(), f = Math.min(1, l.overlay / 50), x = Math.max(0, (l.overlay - 50) / 50);
    vbtns.style.setProperty('--ov-rest', String(btnOpacity(l.btn)));
    stage.style.setProperty('--wz-ovf', f.toFixed(2)); stage.style.setProperty('--wz-ovx', x.toFixed(2));
  }
  // 0.5.1: refresh the open popover's values IN PLACE - rebuilding it on every input event (Overlay opacity / Button transparency save -> wavwiz:looks)
  // replaced the slider under the pointer, so those drags froze. The input being dragged is left alone.
  const syncLooks = () => { if (!looksPop) return; const eng = vizPrefs().engine; for (const r of looksPop.querySelectorAll('input[data-look]')) { if (r === document.activeElement) continue; const v = getLook(r.dataset.look, eng); r.value = v; const o = r.parentElement?.querySelector('.p'); if (o) o.textContent = v + '%'; } };
  window.addEventListener('wavwiz:looks', () => { applyLooks(); syncLooks(); });
  function drawVBtns() {
    const p = vizPrefs(), locked = loadEqLock(), mode = center;
    const want = overlayButtons(mode, { popout: !inDesktopPlayer() && !isPhone() });
    const make = {
      lock: () => ovBtn('lock', OV_LABEL.lock(locked), locked, () => { saveEqLock(!loadEqLock()); drawVBtns(); }, locked ? 'lock' : 'unlock'),
      swap: () => ovBtn('swap', OV_LABEL.swap(), mode === 'viz', () => { closeLooks(); setCenter(mode === 'eq' ? 'viz' : 'eq'); }),
      looks: () => ovBtn('looks', OV_LABEL.looks(), !!looksPop, ev => { ev.stopPropagation(); looksPop ? closeLooks() : openLooks(); }),
      full: () => ovBtn('full', OV_LABEL.full(), false, () => (mode === 'viz' ? fullscreen() : stageFull())),
      power: () => ovBtn('power', OV_LABEL.power(p.on), p.on, () => { p.on = !p.on; saveVizPrefs(p); ensureViz(); drawVBtns(); paintStage(); }),
      popout: () => ovBtn('popout', OV_LABEL.popout(), false, () => window.open('/viz.html', 'wavwiz-viz', 'popup,width=960,height=600')),
    };
    vbtns.replaceChildren(...want.map(n => make[n]()));
    vbtns.setAttribute('role', 'toolbar'); vbtns.setAttribute('aria-label', mode === 'eq' ? 'EQ controls' : 'Visualizer controls');
    vbtns.classList.toggle('solid', !!looksPop); applyLooks();
  }
  // full screen in EQ mode = the whole stage (EQ + glow); visualizer mode keeps its own full-screen view
  function stageFull() { try { if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen?.().catch(() => {}); } catch { /* optional */ } }
  /** The Looks popover: 300 px, --panel, 2 px accent top border; bottom sheet on phones. Closes on outside click / Esc / second click; focus trapped. */
  function openLooks() {
    closeLooks(); const ret = document.activeElement;
    looksPop = h('div', { class: 'looks-pop' + (isPhone() ? ' sheet' : ''), role: 'dialog', 'aria-modal': 'false', 'aria-label': (center === 'eq' ? 'EQ' : 'Visualizer') + ' looks' });
    looksPop._ret = ret; paintLooks(); stage.append(looksPop); drawVBtns();
    looksPop.querySelector('input')?.focus();
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0); document.addEventListener('keydown', popKeys, true);
  }
  function paintLooks() {
    const mode = center, eng = vizPrefs().engine, rows = looksRows(mode);
    const rowEl = ([k, label]) => {
      const v = getLook(k, eng), out = h('span', { class: 'p mono' }, v + '%');
      const r = h('input', { type: 'range', min: 0, max: 100, step: 1, value: v, class: 'dvol', 'aria-label': label, 'data-look': k, 'data-coarse': 10,
        oninput: ev => { out.textContent = setLook(k, +ev.target.value, eng) + '%'; } });
      r.addEventListener('keydown', ev => { if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(ev.key) || !ev.shiftKey) return; ev.preventDefault(); r.value = stepPct(+r.value, /Up|Right/.test(ev.key) ? 1 : -1, true); r.dispatchEvent(new Event('input')); });
      return h('label', { class: 'looks-row' }, h('span', null, label), r, out);
    };
    const extra = mode === 'viz' ? h('label', { class: 'looks-row looks-sw' }, h('span', null, 'Visualizer'), h('input', { type: 'checkbox', checked: vizPrefs().on, 'aria-label': 'Visualizer on', onchange: ev => { const p = vizPrefs(); p.on = ev.target.checked; saveVizPrefs(p); ensureViz(); drawVBtns(); paintStage(); } }), h('span', { class: 'p' }, '')) : null;
    looksPop.replaceChildren(h('h4', null, mode === 'eq' ? 'EQ LOOKS' : 'VISUALIZER LOOKS'), ...rows.map(rowEl), extra,
      h('div', { class: 'looks-ft' }, h('span', { class: 's' }, 'Wheel ±1 · Shift ±10'),
        h('button', { type: 'button', class: 'btn', onclick: () => { resetLooks(mode, eng); paintLooks(); } }, 'Reset'),
        h('button', { type: 'button', class: 'btn', onclick: () => { closeLooks(); ctl.go(mode === 'eq' ? 'settings:eqstyle' : 'visualizer'); } }, 'More…')));
  }
  const outside = ev => { if (looksPop && !looksPop.contains(ev.target) && !ev.target.closest?.('.ov-looks')) closeLooks(); };
  function popKeys(ev) {
    if (!looksPop) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeLooks(true); return; }
    if (ev.key === 'Tab') {   // focus stays inside the popover
      const f = [...looksPop.querySelectorAll('input,button')].filter(e => !e.disabled); if (!f.length) return;
      const i = f.indexOf(document.activeElement); ev.preventDefault();
      f[(i + (ev.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  }
  function closeLooks(refocus) {
    if (!looksPop) return; const ret = looksPop._ret; looksPop.remove(); looksPop = null;
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', popKeys, true);
    drawVBtns(); if (refocus) (vbtns.querySelector('.ov-looks') || ret)?.focus?.();
  }
  window.addEventListener('wavwiz:eqlock', () => drawVBtns());
  function ensureViz() {
    const p = vizPrefs();
    // 0.3.0 §3: the EQ view lives only while shown; the visualizer renders ONLY while selected (no rAF, analyser or GL work when hidden or under the Jukebox screen)
    const covered = listCovers();   // 0.3.3 G5: Now Playing slid up over the EQ / visualizer - nothing renders underneath
    if (center === 'eq' && !kioskOpen() && !covered) { if (!eqv) eqv = centerEq(S, eqHost); else eqv.refresh(); } else if (eqv) { eqv.destroy(); eqv = null; }
    if (!p.on || center !== 'viz' || kioskOpen() || document.hidden || covered) { if (viz) { viz.destroy(); viz = null; } vizState = { audible: false, error: null, preset: '' }; paintStage(); return; }
    // Start even when idle so every look can show its calm idle animation.
    if (!viz) {
      viz = new Viz(host, { onStatus: (k, t) => { if (k === 'audible') vizState.audible = t === 'yes'; else if (k === 'error') vizState.error = t; else if (k === 'preset') { vizState.preset = t; drawVBtnsSoon(); } paintStage(); } });
      viz.start().then(drawVBtns);
    }
  }
  let vbT = 0; const drawVBtnsSoon = () => { clearTimeout(vbT); vbT = setTimeout(drawVBtns, 50); };
  function paintStage() {
    const p = vizPrefs();
    // Show canvas whenever viz is on and healthy (including idle animation); cover only when viz off.
    const show = center === 'viz' && p.on && viz?.ok;
    stage.classList.toggle('viz', !!show); stage.classList.toggle('eqmode', center === 'eq'); vname.textContent = vizState.error ? vizState.error : '';
    vname.classList.toggle('bad', !!vizState.error);
  }
  let fullMini = null;
  function fullscreen() {
    if (overlay) return closeFull();
    overlay = h('div', { class: 'vizfull', role: 'dialog', 'aria-label': 'Visualizer full screen' }, h('button', { class: 'x', onclick: closeFull }, '✕ Close'));
    overlay.prepend(host); document.body.append(overlay); stage.classList.remove('viz'); viz?.resize();
    overlay.addEventListener('dblclick', closeFull); overlay.addEventListener('click', ev => { if (ev.target === host || ev.target.tagName === 'CANVAS') viz?.next(); });
    try { overlay.requestFullscreen?.().catch(() => {}); } catch { /* optional */ }
    // 0.3.8 L47: a softly glowing button bottom right; hover floats the mini player over the visualizer (same bridge + 300 ms grace as the Devices button, L41). The button dims and the cursor hides when the mouse is idle.
    const fm = h('div', { class: 'vfmini', 'data-vf': '1' }, h('button', { type: 'button', class: 'vfbtn', 'aria-label': 'Mini player', title: 'Mini player (hover)' }, '♪'), h('div', { class: 'vfpop' }));
    overlay.append(fm); try { fullMini = mountMini(fm.querySelector('.vfpop'), { embedded: true, run: id => { closeFull(); ctl.runShortcut?.(id); }, home: () => { closeFull(); ctl.goHome?.(); } }); fm.querySelector('.vfpop').append(fullMini.root); } catch { /* optional */ }
    let idleT = 0; const wake = () => { overlay?.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => { if (overlay && !fm.matches(':hover') && !fm.matches(':focus-within')) overlay.classList.add('idle'); }, 3000); };
    overlay.addEventListener('mousemove', wake); overlay.addEventListener('pointerdown', wake); wake(); overlay._idleStop = () => clearTimeout(idleT);
    document.addEventListener('fullscreenchange', fsc); document.addEventListener('keydown', esc);
  }
  const fsc = () => { if (!document.fullscreenElement && overlay) closeFull(); };
  const esc = ev => { if (ev.key === 'Escape' && overlay) closeFull(); };
  function closeFull() {
    if (!overlay) return; overlay._idleStop?.(); try { fullMini?.destroy(); } catch { /* ok */ } fullMini = null; document.removeEventListener('fullscreenchange', fsc); document.removeEventListener('keydown', esc);
    stage.insertBefore(host, srcChip); overlay.remove(); overlay = null; try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* ok */ } viz?.resize(); paintStage();
  }
  window.addEventListener('wavwiz:kiosk', () => { ensureViz(); paintStage(); });
  window.addEventListener('wavwiz:listcover', () => { ensureViz(); paintStage(); });
  document.addEventListener('visibilitychange', () => { ensureViz(); paintStage(); });
  window.addEventListener('wavwiz:viz', () => { const p = vizPrefs(); if (viz) { viz.setLight(); if (viz.engine !== p.engine) viz.useEngine(p.engine); } ensureViz(); drawVBtns(); paintStage(); });

  function draw() {
    const n = S.now; if (!n) return;
    const it = n.item, radio = it?.kind === 'radio';
    t1.textContent = it ? (radio ? (n.liveTitle || it.title) : it.title) : 'Nothing playing';
    t2.textContent = it ? (radio ? (n.liveTitle ? it.title : 'Internet radio') : (it.artist || ' ')) : 'Pick something from the library';
    if (E.ovTitles) { E.ovTitles.children[0].textContent = t1.textContent; E.ovTitles.children[1].textContent = t2.textContent; }
    { const it2 = S.now?.item; ovAA.textContent = it2 && it2.kind !== 'radio' ? [it2.artist, it2.album].filter(Boolean).join(' - ') : t2.textContent.trim(); ovAA.title = ovAA.textContent; ovAl.textContent = it2 && it2.kind !== 'radio' ? it2.album || '' : ''; for (const e of [t2, ovT2]) e.dataset.album = ovAl.textContent;
      const rad = !it2 || it2.kind === 'radio'; aaArtistLbl.hidden = rad; aaArtist.textContent = rad ? t2.textContent.trim() : (it2.artist || ''); aaAlbum.textContent = ovAl.textContent; aaAlbumWrap.hidden = !ovAl.textContent; aaLine.title = [aaArtist.textContent, aaAlbum.textContent].filter(Boolean).join(' · '); }   // F102e: phone shows Artist · Album on one line
    ctlNow.textContent = it ? [t1.textContent, t2.textContent.trim()].filter(Boolean).join(' — ') : '';
    // genre line (mockup: "Ambient • Electronica"); falls back to album • year when the file has no genre tag
    const genres = it?.genre ? String(it.genre).split(/\s*[;/,|]\s*/).filter(Boolean).slice(0, 3) : [];
    const bits = it ? (genres.length ? genres : [it.album, it.year || null].filter(Boolean)) : [];
    if (radio && it) t3line.textContent = [it.genre || null, 'Internet radio'].filter(Boolean).join(' • ');
    else if (isReceiver(it)) t3line.textContent = [it.album || null, sourceLabel(it)].filter(Boolean).join(' • ');
    else t3line.textContent = bits.length ? bits.join(' • ') : '';
    genre.title = it ? [it.album, it.year].filter(Boolean).join(' • ') : '';
    genre.classList.toggle('on', n.state === 'playing');
    t3.textContent = n.notice || '';
    const src = itemArtUrl(it, 768), srcMd = itemArtUrl(it, 384), srcSm = itemArtUrl(it, 96);
    const npk = npKey(it, src);   // 0.5.0 F123: key includes artist + album so a new track with the same (missing) art rebuilds
    if (coverHolder.dataset.src !== npk) {
      coverHolder.dataset.src = npk;
      const nowcol = ctlPanel.closest('.nowcol');
      pnArt.style.setProperty('--np-cover', 'none'); nowcol?.style.setProperty('--np-bloom', 'none');   // F123: only a loaded track picture feeds bloom / jacket
      const realMd = u => { if (coverHolder.dataset.src === npk) pnArt.style.setProperty('--np-cover', `url("${u}")`); };   // F104: Jacket vinyl center label = cover crop
      const realSm = u => { if (coverHolder.dataset.src === npk) nowcol?.style.setProperty('--np-bloom', `url("${u}")`); };   // F102: phone cover bloom
      coverHolder.replaceChildren(npCover(it, 768, ''));
      art.replaceChildren(npCover(it, 384, 'md', realMd));
      miniArtB.setCover(npCover(it, 96, 'sm', realSm));
      pnCover.replaceChildren(npCover(it, 384, 'md')); pnRefl.replaceChildren(npCover(it, 384, 'md'));
      sArtB.setCover(npCover(it, 96, 'sm'));
    }
    const wseed = it ? (it.id ?? it.title ?? '') + '' : '';
    if (pnWave.dataset.seed !== wseed) {
      pnWave.dataset.seed = wseed; const hs = waveBars(wseed || 'idle');
      for (const box of [waveBase, waveTop, sWaveBase, sWaveTop]) box.replaceChildren(...hs.map(v => h('i', { style: `height:${Math.round(v * 100)}%` })));
      const es = eqBars(wseed || 'idle'), es2 = eqBars(wseed || 'idle', 16);
      for (const box of [eqBase, eqTop]) box.replaceChildren(...es.map(v => h('i', { style: `height:${Math.round(v * 100)}%` })));
      for (const box of [sEqBase, sEqTop]) box.replaceChildren(...es2.map(v => h('i', { style: `height:${Math.round(v * 100)}%` })));
    }
    trackNo.textContent = 'TRACK ' + (it?.trackNo || it?.track ? String(it.trackNo || it.track).padStart(2, '0') : (n.index >= 0 ? String(n.index + 1).padStart(2, '0') : '--'));
    ctlPanel.classList.toggle('playing', n.state === 'playing'); for (const b of [sArtB, miniArtB, barArtB]) b.setPlaying(n.state === 'playing');
    const favId = it?.kind === 'track' && !isReceiver(it) ? it.refId : null;
    if (npHeart.dataset.id !== String(favId ?? '')) { npHeart.dataset.id = barHeart.dataset.id = String(favId ?? ''); npHeart.replaceChildren(...(favId ? [heartBtn(S, 'track', favId, it.title)] : [])); xHeart.replaceChildren(favId ? heartBtn(S, 'track', favId, it.title, { round: true }) : idleHeart()); sHeart.replaceChildren(favId ? heartBtn(S, 'track', favId, it.title, { round: true }) : idleHeart()); barHeart.replaceChildren(...(favId ? [heartBtn(S, 'track', favId, it.title)] : [])); }
    miniT.textContent = t1.textContent; miniS.textContent = it ? it.artist || sourceLabel(it) : '';
    const playing = n.state === 'playing'; setIcon(play, playing ? 'pause' : 'play'); setIcon(miniPlay, playing ? 'pause' : 'play'); play.classList.toggle('playing', playing);
    for (const b of [shuffle, sShuffle]) { b.classList.toggle('on', !!n.shuffle); b.setAttribute('aria-pressed', String(!!n.shuffle)); }
    for (const b of [repeat, sRepeat]) { b.classList.toggle('on', n.repeat !== 'off'); b.setAttribute('aria-pressed', String(n.repeat !== 'off')); setIcon(b, n.repeat === 'one' ? 'repeatOne' : 'repeat'); }
    setIcon(sPlay, playing ? 'pause' : 'play'); sPlay.classList.toggle('playing', playing);
    sT1.textContent = t1.textContent; sT2.textContent = [t2.textContent.trim(), S.now?.item?.kind !== 'radio' && S.now?.item?.album].filter(Boolean).join(' · ');   /* F130: collapsed line = Artist · Album */ ctlStrip.querySelector('.ns-titles').title = [t1.textContent, t2.textContent.trim()].filter(Boolean).join(' · ');
    drawMine(); barT1.textContent = t1.textContent; barT2.textContent = t2.textContent; barPlay.classList.toggle('playing', playing); setIcon(barPlay, playing ? 'pause' : 'play');
    { const bk = npKey(it, srcSm); if (barCover.dataset.src !== bk) { barCover.dataset.src = bk; barArtB.setCover(npCover(it, 96, 'sm')); } }
    document.title = it ? `${t1.textContent} - WavWiz` : `WavWiz BETA ${S.auth?.appVersion ?? ''}`;
    setMediaSession(n, { play: () => act('/stream/resume'), pause: () => act('/stream/pause'), nexttrack: () => act('/stream/next'), previoustrack: () => act('/stream/prev'),
      seekto: d => act('/stream/seek', { ms: Math.round((d.seekTime || 0) * 1000) }), stop: () => act('/stream/stop') });
    // Up next
    // 0.4.9 F73: the server says what really plays next (shuffle pick, Repeat All wrap, Repeat One); the list neighbour only for an older server
    const qi = n.index ?? -1; const nxt = 'nextIndex' in n ? (n.nextIndex >= 0 ? (S.queue?.[n.nextIndex]?.id === n.nextTrack?.id && S.queue?.[n.nextIndex] || n.nextTrack || null) : null)
      : (qi >= 0 && S.queue && qi + 1 < S.queue.length) ? S.queue[qi + 1] : null;
    upnext.replaceChildren(h('span', { class: 'np-uplbl' }, 'Up next'),
      nxt ? h('span', { class: 'ell np-uptitle' }, `${nxt.title}${nxt.artist ? ' - ' + nxt.artist : ''}${nxt.durationMs ? ' • ' + fmtDur(nxt.durationMs) : (nxt.kind === 'radio' ? ' • LIVE' : '')}`) : null,
      isPhone() ? null : h('span', { class: 'np-upline', 'aria-hidden': 'true' }));   // F102b: no decorative rule on phone
    upnext.title = nxt ? '' : (it ? 'Nothing queued after this' : 'Pick something from the library');
    drawNext(nxt);
    ensureViz(); tickPos(); drawChips(); paintSrcChip();
    if (isReceiver(S.now?.item)) refreshReceivers();
  }
  /** U2: the minimized Playlist's "Up next" line (next song in the queue; a quiet note when nothing follows). */
  function drawNext(nxt) {
    nextBlock.classList.toggle('none', !nxt);
    nxT1.textContent = nxt ? nxt.title || 'Untitled' : 'Nothing queued after this';
    nxT2.textContent = nxt ? (nxt.kind === 'radio' ? 'Internet radio' : nxt.artist || '') : '';
    const src = nxt ? itemArtUrl(nxt, 96) : null;
    const nk = nxt ? npKey(nxt, src) : ''; if (nxArt.dataset.src !== nk || !nxArt.firstChild) { nxArt.dataset.src = nk; nxArt.replaceChildren(nxt ? npCover(nxt, 96, 'sm') : ''); }   // F123
    nextBlock.title = nxt ? ['Up next', nxt.title, nxt.artist].filter(Boolean).join(' · ') : 'Nothing queued after this';
    window.dispatchEvent(new CustomEvent('wavwiz:upnext'));
  }
  function tickPos() {
    const n = S.now; if (!n) return;
    let pos = n.positionMs; if (n.state === 'playing') pos = S.localPos + (performance.now() - S.localAt);
    const live = isLive(n.item), dur = n.durationMs;
    elv.textContent = n.item ? fmtTime(pos) : '--:--'; rev.textContent = !n.item ? '-:--' : live ? 'LIVE' : '-' + fmtTime(Math.max(0, dur - pos));
    const frac = live || !dur ? 0 : Math.min(1, pos / dur); fill.style.width = barFill.style.width = frac * 100 + '%'; knob.style.left = barKnob.style.left = frac * 100 + '%'; setVizProgress(live || !dur ? null : frac);
    barElv.textContent = sElv.textContent = elv.textContent; barRev.textContent = rev.textContent;
    sDur.textContent = !n.item ? '-:--' : live ? 'LIVE' : fmtTime(dur || 0);
    sFill.style.width = sLedFill.style.width = frac * 100 + '%'; sKnob.style.left = frac * 100 + '%'; sWaveClip.style.clipPath = sEqClip.style.clipPath = `inset(0 ${100 - frac * 100}% 0 0)`; ctlStrip.style.setProperty('--ns-frac', frac.toFixed(4));
    pillElv.textContent = clockVal.textContent = elv.textContent; lcdRev.textContent = rev.textContent;
    pillDur.textContent = !n.item ? '-:--' : live ? 'LIVE' : fmtTime(dur || 0);
    ringVal.style.strokeDashoffset = String(100 - frac * 100); ctlPanel.style.setProperty('--np-frac', frac.toFixed(4)); for (const b of [sArtB, miniArtB, barArtB]) b.setFrac(frac);   // F96: sleeve vinyl
    ledFill.style.width = frac * 100 + '%';
    waveClip.style.clipPath = eqClip.style.clipPath = `inset(0 ${100 - frac * 100}% 0 0)`;
    for (const s of [pnWave, pnLed, pnEq]) s.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
  }
  // 0.2.1 F11: no speaker status chips, live dot or "muted" tag in the panel header - device status lives in the Devices panel
  // (this device's Mute button still shows its own state). Kept as a hook: the zone refresh still repaints this device's volume / mute.
  function drawChips() { drawMine(); }
  async function refreshReceivers() {
    try { receivers = await api('/receivers'); } catch { receivers = null; }
    paintSrcChip();
  }
  function paintSrcChip() {
    const lab = streamingChip(S.now?.item, receivers);
    if (lab) { srcChip.hidden = false; srcChip.textContent = lab; }
    else { srcChip.hidden = true; srcChip.textContent = ''; }
  }
  function drawStrip() {
    if (!ctl.pill) return;
    strip.replaceChildren(S.zones.length ? h('div', { class: 'card', style: 'margin:0;cursor:pointer', onclick: () => ctl.go('devices') }, h('div', { class: 'sec', style: 'margin-top:0' }, 'Devices'),
      S.zones.map(z => h('div', { class: 'row', style: 'padding:3px 0' }, h('span', { class: 'grow ell' + (z.enabled ? '' : ' dim') }, z.name), ctl.pill(z)))) : h('div'));
    drawChips();
  }
  async function drawChecklist() { const { checklistCard } = await import('./diag.js'); const c = await checklistCard(S, ctl.checklistGo); checklist.replaceChildren(...(c ? [c] : [])); }
  window.addEventListener('wavwiz:checklist', drawChecklist);
  drawVBtns();
  queueMicrotask(paintCollapsed);
  /** 0.3.5: Playback > Sound / EQ shows the EQ in the center panel; Playback > Sleep timer opens the Sleep menu. */
  function showCenter(m) { setCenter(m); stage.scrollIntoView?.({ block: 'nearest' }); }
  function openSleepMenu() { const b = [...document.querySelectorAll('.npsleep')].find(x => x.getClientRects().length) || null; openSleep(S, null, b); }
  return { el, mini, npbar, nextBlock, showCenter, toggleCtl, openSleep: openSleepMenu, ctlStrip, ctlPanel, draw, drawMine, tickPos, drawStrip, drawChecklist, stage, get viz() { return viz; } };
}

/** 0.3.3 G5: true while the expanded Playlist (with Now Playing slid up) covers the EQ / visualizer. */
export const listCovers = () => typeof document !== 'undefined' && !!document.getElementById('desk')?.classList.contains('listexpanded') && (typeof matchMedia !== 'function' || matchMedia('(min-width:901px)').matches);
