import { h, api, toast, fmtTime, fmtDur, dialog } from './util.js';
import { cover, itemArtUrl, setMediaSession, isLive, isReceiver, sourceLabel, streamingChip } from './art.js';
import { Viz, vizPrefs, saveVizPrefs, inDesktopPlayer, isPhone, setVizProgress } from './viz.js';
import { icon, setIcon, iconSvg } from './icons.js';
import { canControl, thisDevice } from './ui.js';
import { NP_STYLES, loadNpPrefs, npVars, waveBars, ringFrac } from './npstyle.js';
import { heartBtn } from './fav.js';

/** Now Playing - 0.0.8 layout per the "waveform river" mockup:
 *  [bordered visualizer panel: look name top-left, progress bar along its bottom edge with elapsed (left) / look name (center) / remaining (right)]
 *  [album art | title, artist (accent), genre line with an equalizer icon | divider | bordered transport box: shuffle, prev, big round play, next, repeat]
 *  [Up next ─────────]
 *  [bordered strip: monitor icon, device chips (active = accent outline, phone chip with phone icon) | divider | volume button + status dot]
 *  The volume slider, Stop and Sound (EQ) live in the volume button's pop-up.
 * 0.2.0 item 9: the panel's volume and Mute control ONLY this device (the speaker this page plays on - see ui.js thisDevice); the speaker chips
 * moved to the panel header and are status only (this device first and marked, "+N" for the rest); "This device muted" shows in the header.
 * Master volume moved to the top of Devices (item 10). The same this-device volume/Mute sits on the full-width mini bar (items 16 + 27). */
/** 0.2.1 F9: the live control panel, so Settings > Appearance can preview it with the very same markup + CSS (cloned, scaled down). */
let panelTpl = null;
export const npPanelTemplate = () => panelTpl;
export function createNow(S, ctl) {
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
  const vol = mkVol(), muteBtn = mkMute();
  const volPct = h('span', { class: 'volpct small dim' }, '');
  const mutedTag = h('span', { class: 'np-mutedtag', hidden: true, role: 'status' }, 'This device muted');
  const genre = h('div', { class: 'np-genre' }, h('span', { class: 'np-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')), t3line);
  const liveDot = h('span', { class: 'np-dot', 'aria-hidden': 'true' });
  // 0.2.1 F10: no three-dot menu and no Stop - Sound (EQ) is a regular panel button next to Mute (one click), styled like Shuffle / Repeat
  const mkEq = () => h('button', { class: 'tbtn eqbtn', 'aria-label': 'Sound (EQ)', title: 'Sound (EQ)', onclick: () => ctl.openEq() }, icon('eq'));
  const eqBtn = mkEq();
  const upnext = h('div', { class: 'upnext np-upnext', 'aria-label': 'Up next' });
  const chips = h('div', { class: 'devchips np-hchips', 'aria-label': 'Speakers (status)' });
  const strip = h('div', { class: 'phone-only' }), checklist = h('div', { class: 'checklist' });
  Object.assign(E, { t1, t2, t3, elv, rev, fill, knob, play, shuffle, repeat, vol });
  const prev = h('button', { class: 'tbtn', 'aria-label': 'Previous', onclick: () => act('/stream/prev') }, icon('prev')), next = h('button', { class: 'tbtn', 'aria-label': 'Next', onclick: () => act('/stream/next') }, icon('next'));
  // 0.1.2 panel hotfix: controls live in their own SOLID panel below a separate visualizer panel (same chrome as Library / Devices / Playlist).
  // Control layout is unchanged: title/times | transport | master volume, device dots underneath.
  const ovT1 = h('div', { class: 't1' }, 'Nothing playing'), ovT2 = h('div', { class: 't2' }, ' ');
  // 0.2.0 item 8: four panel styles (Classic default, Center, Stack, Horizon) share one set of controls; CSS (.pn-<style>) shows each
  // style's art + seek treatment. Art LEFT, one matching button style per panel, volume = speaker icon + slider + %, then Mute and More.
  const seekFrac = f => { if (!canControl(S) || !S.now?.item || isLive(S.now.item) || !S.now.durationMs) return; act('/stream/seek', { ms: Math.round(Math.min(1, Math.max(0, f)) * S.now.durationMs) }); };
  const fracAt = (el, ev) => { const r = el.getBoundingClientRect(); return (ev.clientX - r.left) / r.width; };
  const pnCover = h('div', { class: 'pn-cover' }), pnRefl = h('div', { class: 'pn-refl', 'aria-hidden': 'true' }), pnDisc = h('div', { class: 'pn-disc', 'aria-hidden': 'true' }, h('i'));
  const pnRing = h('span', { class: 'pn-ring', 'aria-hidden': 'true' });
  pnRing.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><rect class="trk" x="1.5" y="1.5" width="97" height="97" rx="9" pathLength="100"/><rect class="val" x="1.5" y="1.5" width="97" height="97" rx="9" pathLength="100"/></svg>';
  const ringVal = pnRing.querySelector('.val'), ringDot = h('span', { class: 'pn-ringdot', 'aria-hidden': 'true' });
  const npHeart = h('span', { class: 'np-heartslot' }), barHeart = h('span', { class: 'np-heartslot' });   // 0.2.0 item 14: heart the playing song
  const idleHeart = () => { const b = h('button', { type: 'button', class: 'heart tbtn ico', disabled: true, 'aria-label': 'Favorite (nothing playing)', title: 'Nothing playing' }); b.innerHTML = iconSvg('heart'); return b; };
  const xHeart = h('span', { class: 'np-heartslot np-xheart' }, idleHeart());   // 0.2.1 F10: Classic shows the heart as a round button left of Shuffle
  const pnArt = h('div', { class: 'pn-art', title: 'Drag around the cover to seek (Classic)' }, pnDisc, pnCover, pnRing, ringDot, pnRefl);
  let ringDrag = false; const ringSeek = ev => { const r = pnArt.getBoundingClientRect(); seekFrac(ringFrac(r.left + r.width / 2, r.top + r.height / 2, ev.clientX, ev.clientY)); };
  pnArt.addEventListener('pointerdown', ev => { if (!ctlPanel.classList.contains('pn-classic')) return; ringDrag = true; pnArt.setPointerCapture?.(ev.pointerId); });
  pnArt.addEventListener('pointerup', ev => { if (ringDrag) { ringDrag = false; ringSeek(ev); } });
  const pillElv = h('span', { class: 'pn-pel' }, '--:--'), pillDur = h('span', { class: 'pn-pdur' }, '-:--');
  const pnPill = h('div', { class: 'pn-pill' }, h('i', { 'aria-hidden': 'true' }), pillElv, h('span', { class: 'dim' }, ' / '), pillDur);
  const waveBase = h('div', { class: 'pn-wbars' }), waveTop = h('div', { class: 'pn-wbars on' }), waveClip = h('div', { class: 'pn-wclip' }, waveTop);
  const pnWave = h('div', { class: 'pn-wave', role: 'slider', 'aria-label': 'Position', tabindex: 0, onclick: ev => seekFrac(fracAt(pnWave, ev)) }, waveBase, waveClip);
  const clockVal = h('span', { class: 'pn-cval' }, '--:--'), pnClock = h('div', { class: 'pn-clock', 'aria-hidden': 'true' }, h('span', { class: 'pn-cghost' }, '88:88'), clockVal);
  const trackNo = h('span', { class: 'pn-trk' }, 'TRACK --'), lcdRev = h('span', { class: 'pn-lrev' }, '-:--');
  const ledFill = h('div', { class: 'pn-ledfill' });
  const pnLed = h('div', { class: 'pn-led', role: 'slider', 'aria-label': 'Position', tabindex: 0, onclick: ev => seekFrac(fracAt(pnLed, ev)) }, ledFill);
  const tableMeta = h('div', { class: 'np-tablemeta pn-meta' },
    h('div', { class: 'pn-titlerow' }, h('div', { class: 'np-tabletitles' }, ovT1, ovT2), npHeart, pnClock),
    h('div', { class: 'pn-lcdrow' }, trackNo, lcdRev), pnLed, pnPill, pnWave,
    h('div', { class: 'np-tableseek' }, prog, h('div', { class: 'np-times' }, elv, rev)));
  const tableXport = h('div', { class: 'transport np-tablexport', role: 'group', 'aria-label': 'Transport' }, xHeart, shuffle, prev, play, next, repeat);
  const tableVol = h('div', { class: 'np-tablevol' },
    h('div', { class: 'np-vollbl sr-only' }, 'Volume'),
    h('div', { class: 'np-volrow' }, icon('volume'), vol, volPct, muteBtn, h('div', { class: 'np-vol' }, eqBtn, liveDot)));
  // Collapse arrow = the same `plus listcol` toggle the Playlist uses (˅ / ˄, themed accent). Collapsing the control panel
  // slides it down to its header strip and the visualizer panel grows into the freed space. Saved per device.
  let ctlCollapsed = false; try { ctlCollapsed = localStorage.getItem('wavwiz.npctlcollapsed') === '1'; } catch { /* ignore */ }
  const ctlColBtn = h('button', { class: 'plus listcol np-ctlcol', 'aria-label': 'Collapse or expand the playback controls', 'aria-expanded': String(!ctlCollapsed), title: 'Collapse / expand the controls', onclick: () => toggleCtl() }, ctlCollapsed ? '˄' : '˅');
  const ctlNow = h('span', { class: 'np-ctlnow small dim ell' }, '');
  const ctlBody = h('div', { class: 'np-ctlbody' }, h('div', { class: 'np-tablemain' }, pnArt, tableMeta, h('div', { class: 'pn-ctl' }, tableXport, tableVol)));
  const ctlPanel = h('section', { class: 'np-ctlpanel' + (ctlCollapsed ? ' collapsed' : ''), role: 'group', 'aria-label': 'Playback controls' },
    h('div', { class: 'pane-h' }, h('span', { class: 'np-ctltitle' }, 'NOW PLAYING'), chips, mutedTag, ctlNow, h('span', { class: 'grow' }), h('span', { class: 'row listcolwrap' }, ctlColBtn)), ctlBody);
  function applyNpStyle() {
    const p = loadNpPrefs();
    for (const [id] of NP_STYLES) ctlPanel.classList.toggle('pn-' + id, p.style === id);
    for (const [k, v] of Object.entries(npVars(p))) ctlPanel.style.setProperty(k, v);
    ctlPanel.dataset.style = p.style;
  }
  panelTpl = ctlPanel;
  applyNpStyle(); window.addEventListener('wavwiz:npstyle', applyNpStyle);
  window.addEventListener('storage', ev => { if (ev.key === 'wavwiz.npstyle.v1') applyNpStyle(); });
  function toggleCtl(force) {
    ctlCollapsed = force ?? !ctlCollapsed;
    ctlPanel.classList.toggle('collapsed', ctlCollapsed);
    el.classList.toggle('ctlcollapsed', ctlCollapsed);
    ctlColBtn.textContent = ctlCollapsed ? '˄' : '˅';
    ctlColBtn.setAttribute('aria-expanded', String(!ctlCollapsed));
    try { localStorage.setItem('wavwiz.npctlcollapsed', ctlCollapsed ? '1' : '0'); } catch { /* ignore */ }
    setTimeout(() => viz?.resize(), 340);
  }
  // Visualizer panel: just the stage (0.2.1 F3: no header bar). Source chip (AirPlay / Spotify Connect) floats in the stage corner.
  const vizPanel = h('section', { class: 'np-vizpanel', 'aria-label': 'Visualizer' }, stage);
  const ovTitles = { children: [ovT1, ovT2] };   // draw() updates title/artist via E.ovTitles
  const el = h('section', { class: 'nowcol np8 np12' + (ctlCollapsed ? ' ctlcollapsed' : ''), id: 'p-now', 'aria-label': 'Now playing' },
    h('h2', { class: 'sr-only' }, 'Now playing'), vizPanel,
    h('div', { class: 'np-row' },
      h('div', { class: 'np-meta' }, art, h('div', { class: 'titles' }, t1, t2, genre, t3))),
    ctlPanel, upnext, strip, checklist);
  E.ovTitles = ovTitles;

  const miniCover = h('div'), miniT = h('div', { class: 't1 ell' }, 'Nothing playing'), miniS = h('div', { class: 't2 ell' });
  const miniPlay = h('button', { class: 'tbtn play mini-play', 'aria-label': 'Play or pause', onclick: ev => { ev.stopPropagation(); play.click(); } }, icon('play'));
  const mini = h('div', { class: 'mini', onclick: () => ctl.go('now') }, miniCover, h('div', { class: 'grow' }, miniT, miniS), miniPlay);

  // 0.2.0 items 16 + 27: full-width Now Playing bar for the expanded Library / Devices views (art, titles, transport, seek + times,
  // this-device volume, Mute, More). Same Classic button style as the panel.
  const barCover = h('div', { class: 'npb-art' }), barT1 = h('div', { class: 't1 ell' }, 'Nothing playing'), barT2 = h('div', { class: 't2 ell' });
  const barFill = h('div', { class: 'fill' }), barKnob = h('div', { class: 'knob' }), barElv = h('span', { class: 'np-elv' }, '--:--'), barRev = h('span', { class: 'np-rev' }, '-:--');
  const barProg = h('div', { class: 'prog', role: 'slider', 'aria-label': 'Position', tabindex: 0, onclick: ev => { if (!canControl(S) || !S.now?.item || isLive(S.now.item)) return; const r = barProg.getBoundingClientRect(); act('/stream/seek', { ms: Math.round(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * S.now.durationMs) }); } }, h('div', { class: 'bar' }), barFill, barKnob);
  const barPlay = h('button', { class: 'tbtn play', 'aria-label': 'Play or pause', onclick: () => play.click() }, icon('play'));
  const barVol = mkVol(), barMute = mkMute(), barPct = h('span', { class: 'volpct small dim' }, '');
  const barEq = mkEq();
  const npbar = h('section', { class: 'npbar', 'aria-label': 'Now playing (compact)' },
    barCover, h('div', { class: 'npb-titles' }, barT1, barT2), barHeart,
    h('div', { class: 'transport npb-x', role: 'group', 'aria-label': 'Transport' }, h('button', { class: 'tbtn', 'aria-label': 'Previous', onclick: () => act('/stream/prev') }, icon('prev')), barPlay, h('button', { class: 'tbtn', 'aria-label': 'Next', onclick: () => act('/stream/next') }, icon('next'))),
    h('div', { class: 'npb-seek' }, barElv, barProg, barRev),
    h('div', { class: 'npb-vol' }, icon('volume'), barVol, barPct, barMute, barEq));
  function syncVol(v, from) { for (const r of [vol, barVol]) if (r !== from && document.activeElement !== r) r.value = v; volPct.textContent = barPct.textContent = Math.round(v) + '%'; }
  /** This device's volume / mute on the panel, the mini bar and the header tag. */
  function drawMine() {
    const z = me(), can = canControl(S) && !!z;
    for (const r of [vol, barVol]) { r.disabled = !can; r.title = z ? `Volume of this device (${z.name})` : 'This page is not playing as a speaker yet'; }
    syncVol(z ? z.volume : 0); if (!z) volPct.textContent = barPct.textContent = '—';
    for (const b of [muteBtn, barMute]) { b.disabled = !can; b.classList.toggle('on', !!z?.muted); b.setAttribute('aria-pressed', String(!!z?.muted)); setIcon(b, z?.muted ? 'mute' : 'volume'); b.title = z?.muted ? 'Unmute this device' : 'Mute this device'; }
    mutedTag.hidden = !z?.muted;
  }

  function drawVBtns() {
    const p = vizPrefs(); vbtns.replaceChildren();
    vbtns.append(h('button', { 'aria-label': p.on ? 'Turn the visualizer off' : 'Turn the visualizer on', title: p.on ? 'Visualizer on - tap to turn off' : 'Visualizer off - tap to turn on', onclick: () => { p.on = !p.on; saveVizPrefs(p); ensureViz(); drawVBtns(); paintStage(); } }, icon(p.on ? 'sparkle' : 'vizoff')));
    if (p.on && viz?.ok) {
      vbtns.append(h('button', { class: 'txt', 'aria-label': 'Choose the visualizer', title: 'Visualizer looks, colors and energy', onclick: () => ctl.go('visualizer') }, 'Looks'),
        h('button', { 'aria-label': 'Full screen visualizer', title: 'Full screen', onclick: fullscreen }, icon('full')));
      if (!inDesktopPlayer() && !isPhone()) vbtns.append(h('button', { 'aria-label': 'Open the visualizer in its own window', title: 'Pop out', onclick: () => window.open('/viz.html', 'wavwiz-viz', 'popup,width=960,height=600') }, icon('popout')));
    }
  }
  function ensureViz() {
    const p = vizPrefs();
    if (!p.on) { if (viz) { viz.destroy(); viz = null; } vizState = { audible: false, error: null, preset: '' }; paintStage(); return; }
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
    const show = p.on && viz?.ok;
    stage.classList.toggle('viz', !!show); vname.textContent = vizState.error ? vizState.error : '';
    vname.classList.toggle('bad', !!vizState.error);
  }
  function fullscreen() {
    if (overlay) return closeFull();
    overlay = h('div', { class: 'vizfull', role: 'dialog', 'aria-label': 'Visualizer full screen' }, h('button', { class: 'x', onclick: closeFull }, '✕ Close'));
    overlay.prepend(host); document.body.append(overlay); stage.classList.remove('viz'); viz?.resize();
    overlay.addEventListener('dblclick', closeFull); overlay.addEventListener('click', ev => { if (ev.target === host || ev.target.tagName === 'CANVAS') viz?.next(); });
    try { overlay.requestFullscreen?.().catch(() => {}); } catch { /* optional */ }
    document.addEventListener('fullscreenchange', fsc); document.addEventListener('keydown', esc);
  }
  const fsc = () => { if (!document.fullscreenElement && overlay) closeFull(); };
  const esc = ev => { if (ev.key === 'Escape' && overlay) closeFull(); };
  function closeFull() {
    if (!overlay) return; document.removeEventListener('fullscreenchange', fsc); document.removeEventListener('keydown', esc);
    stage.insertBefore(host, srcChip); overlay.remove(); overlay = null; try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* ok */ } viz?.resize(); paintStage();
  }
  window.addEventListener('wavwiz:viz', () => { const p = vizPrefs(); if (viz) { viz.setLight(); if (viz.engine !== p.engine) viz.useEngine(p.engine); } ensureViz(); drawVBtns(); paintStage(); });

  function draw() {
    const n = S.now; if (!n) return;
    const it = n.item, radio = it?.kind === 'radio';
    t1.textContent = it ? (radio ? (n.liveTitle || it.title) : it.title) : 'Nothing playing';
    t2.textContent = it ? (radio ? (n.liveTitle ? it.title : 'Internet radio') : (it.artist || ' ')) : 'Pick something from the library';
    if (E.ovTitles) { E.ovTitles.children[0].textContent = t1.textContent; E.ovTitles.children[1].textContent = t2.textContent; }
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
    const glyph = radio ? '📻' : isReceiver(it) ? '📱' : '♪';
    if (coverHolder.dataset.src !== (src || '')) {
      coverHolder.dataset.src = src || '';
      coverHolder.replaceChildren(cover(src, '', glyph));
      art.replaceChildren(cover(srcMd, 'md', glyph));
      miniCover.replaceChildren(cover(srcSm, 'sm', glyph));
      pnCover.replaceChildren(cover(srcMd, 'md', glyph)); pnRefl.replaceChildren(cover(srcMd, 'md', glyph));
    }
    const wseed = it ? (it.id ?? it.title ?? '') + '' : '';
    if (pnWave.dataset.seed !== wseed) {
      pnWave.dataset.seed = wseed; const hs = waveBars(wseed || 'idle');
      for (const box of [waveBase, waveTop]) box.replaceChildren(...hs.map(v => h('i', { style: `height:${Math.round(v * 100)}%` })));
    }
    trackNo.textContent = 'TRACK ' + (it?.trackNo || it?.track ? String(it.trackNo || it.track).padStart(2, '0') : (n.index >= 0 ? String(n.index + 1).padStart(2, '0') : '--'));
    ctlPanel.classList.toggle('playing', n.state === 'playing');
    const favId = it?.kind === 'track' && !isReceiver(it) ? it.refId : null;
    if (npHeart.dataset.id !== String(favId ?? '')) { npHeart.dataset.id = barHeart.dataset.id = String(favId ?? ''); npHeart.replaceChildren(...(favId ? [heartBtn(S, 'track', favId, it.title)] : [])); xHeart.replaceChildren(favId ? heartBtn(S, 'track', favId, it.title, { round: true }) : idleHeart()); barHeart.replaceChildren(...(favId ? [heartBtn(S, 'track', favId, it.title)] : [])); }
    miniT.textContent = t1.textContent; miniS.textContent = it ? it.artist || sourceLabel(it) : '';
    const playing = n.state === 'playing'; setIcon(play, playing ? 'pause' : 'play'); setIcon(miniPlay, playing ? 'pause' : 'play'); play.classList.toggle('playing', playing);
    shuffle.classList.toggle('on', !!n.shuffle); repeat.classList.toggle('on', n.repeat !== 'off'); shuffle.setAttribute('aria-pressed', String(!!n.shuffle)); repeat.setAttribute('aria-pressed', String(n.repeat !== 'off')); setIcon(repeat, n.repeat === 'one' ? 'repeatOne' : 'repeat');
    drawMine(); barT1.textContent = t1.textContent; barT2.textContent = t2.textContent; barPlay.classList.toggle('playing', playing); setIcon(barPlay, playing ? 'pause' : 'play');
    if (barCover.dataset.src !== (srcSm || '')) { barCover.dataset.src = srcSm || ''; barCover.replaceChildren(cover(srcSm, 'sm', glyph)); }
    document.title = it ? `${t1.textContent} - WavWiz` : `WavWiz BETA ${S.auth?.appVersion ?? ''}`;
    setMediaSession(n, { play: () => act('/stream/resume'), pause: () => act('/stream/pause'), nexttrack: () => act('/stream/next'), previoustrack: () => act('/stream/prev'),
      seekto: d => act('/stream/seek', { ms: Math.round((d.seekTime || 0) * 1000) }), stop: () => act('/stream/stop') });
    // Up next
    const qi = n.index ?? -1; const nxt = (qi >= 0 && S.queue && qi + 1 < S.queue.length) ? S.queue[qi + 1] : null;
    upnext.replaceChildren(h('span', { class: 'np-uplbl' }, 'Up next'),
      nxt ? h('span', { class: 'ell np-uptitle' }, `${nxt.title}${nxt.artist ? ' - ' + nxt.artist : ''}${nxt.durationMs ? ' • ' + fmtDur(nxt.durationMs) : (nxt.kind === 'radio' ? ' • LIVE' : '')}`) : null,
      h('span', { class: 'np-upline', 'aria-hidden': 'true' }));
    upnext.title = nxt ? '' : (it ? 'Nothing queued after this' : 'Pick something from the library');
    ensureViz(); tickPos(); drawChips(); paintSrcChip();
    if (isReceiver(S.now?.item)) refreshReceivers();
  }
  function tickPos() {
    const n = S.now; if (!n) return;
    let pos = n.positionMs; if (n.state === 'playing') pos = S.localPos + (performance.now() - S.localAt);
    const live = isLive(n.item), dur = n.durationMs;
    elv.textContent = n.item ? fmtTime(pos) : '--:--'; rev.textContent = !n.item ? '-:--' : live ? 'LIVE' : '-' + fmtTime(Math.max(0, dur - pos));
    const frac = live || !dur ? 0 : Math.min(1, pos / dur); fill.style.width = barFill.style.width = frac * 100 + '%'; knob.style.left = barKnob.style.left = frac * 100 + '%'; setVizProgress(live || !dur ? null : frac);
    barElv.textContent = elv.textContent; barRev.textContent = rev.textContent;
    pillElv.textContent = clockVal.textContent = elv.textContent; lcdRev.textContent = rev.textContent;
    pillDur.textContent = !n.item ? '-:--' : live ? 'LIVE' : fmtTime(dur || 0);
    ringVal.style.strokeDashoffset = String(100 - frac * 100); ledFill.style.width = frac * 100 + '%'; waveClip.style.clipPath = `inset(0 ${100 - frac * 100}% 0 0)`;
  }
  function statusDot(z) {
    if (!z.connected || !z.enabled) return 'bad';       // red = lost / off
    const st = z.room?.state;
    if (st === 'buffering' || st === 'reconnecting') return 'warn';  // yellow
    if (st === 'dropped') return 'bad';
    return 'ok';                                         // green = connected
  }
  function statusLabel(z) {
    if (!z.enabled) return 'Off';
    if (!z.connected) return 'Lost';
    return ({ ok: 'Playing', idle: 'Idle', buffering: 'Buffering', dropped: 'Dropped', reconnecting: 'Reconnecting', offline: 'Lost' }[z.room?.state] || (S.now?.state === 'playing' ? 'Playing' : 'Idle'));
  }
  /** 0.2.0 item 9: status only - no picking speakers here. This device first (marked), then the others; at most three, then "+N". */
  const CHIP_MAX = 3;
  function drawChips() {
    const mine = me(), zones = (S.zones || []).filter(z => z.enabled).sort((a, b) => (b === mine) - (a === mine));
    drawMine();
    if (!zones.length) { chips.replaceChildren(h('span', { class: 'small dim' }, 'No speakers on')); liveDot.classList.remove('on'); return; }
    const shown = zones.slice(0, CHIP_MAX), more = zones.length - shown.length;
    chips.replaceChildren(...shown.map(z => h('span', { class: 'np-spk' + (z === mine ? ' me' : '') + (z.muted ? ' muted' : ''), title: `${z.name}${z === mine ? ' (this device)' : ''}: ${z.muted ? 'Muted' : statusLabel(z)}` },
      h('span', { class: 'dot ' + statusDot(z), 'aria-hidden': 'true' }), h('span', { class: 'ell' }, z.name))),
      more > 0 ? h('span', { class: 'np-spk more', title: zones.slice(CHIP_MAX).map(z => `${z.name}: ${z.muted ? 'Muted' : statusLabel(z)}`).join('\n') }, '+' + more) : '');
    liveDot.classList.toggle('on', zones.some(z => z.connected) && S.now?.state === 'playing');
  }
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
  return { el, mini, npbar, draw, drawMine, tickPos, drawStrip, drawChecklist, stage, get viz() { return viz; } };
}
