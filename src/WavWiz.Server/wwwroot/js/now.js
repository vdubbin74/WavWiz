import { h, api, toast, fmtTime, fmtDur, dialog } from './util.js';
import { cover, itemArtUrl, setMediaSession, isLive, isReceiver, sourceLabel, streamingChip } from './art.js';
import { Viz, vizPrefs, saveVizPrefs, inDesktopPlayer, isPhone, setVizProgress, vizName } from './viz.js';
import { icon, setIcon } from './icons.js';
import { canControl } from './ui.js';

/** Now Playing - 0.0.8 layout per the "waveform river" mockup:
 *  [bordered visualizer panel: look name top-left, progress bar along its bottom edge with elapsed (left) / look name (center) / remaining (right)]
 *  [album art | title, artist (accent), genre line with an equalizer icon | divider | bordered transport box: shuffle, prev, big round play, next, repeat]
 *  [Up next ─────────]
 *  [bordered strip: monitor icon, device chips (active = accent outline, phone chip with phone icon) | divider | volume button + status dot]
 *  The volume slider, Stop and Sound (EQ) live in the volume button's pop-up. */
export function createNow(S, ctl) {
  const E = {}; let viz = null, vizState = { audible: false, error: null, preset: '' }, overlay = null, receivers = null;
  const act = ctl.act;
  const stage = h('div', { class: 'stage np-stage' }), coverHolder = h('div', { class: 'stagecover' }), host = h('div', { class: 'vizhost' }), vname = h('div', { class: 'vname' }), vbtns = h('div', { class: 'vbtns' });
  const vlabel = h('div', { class: 'np-vlabel', 'aria-hidden': 'true' }), vcenter = h('span', { class: 'np-vcenter ell' });
  const srcChip = h('div', { class: 'np-srcchip', hidden: true });
  stage.append(coverHolder, host, vlabel, vname, vbtns);
  const art = h('div', { class: 'npart' });
  const t1 = h('div', { class: 't1' }, 'Nothing playing'), t2 = h('div', { class: 't2' }, ' '), t3line = h('div', { class: 't3line' }, ''), t3 = h('div', { class: 'notice' });
  const fill = h('div', { class: 'fill' }), knob = h('div', { class: 'knob' }), elv = h('span', { class: 'np-elv' }, '--:--'), rev = h('span', { class: 'np-rev' }, '-:--');
  const seek = ev => { if (!canControl(S) || !S.now?.item || isLive(S.now.item)) return; const r = prog.getBoundingClientRect(); act('/stream/seek', { ms: Math.round(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * S.now.durationMs) }); };
  const prog = h('div', { class: 'prog', role: 'slider', 'aria-label': 'Position', tabindex: 0, onclick: seek }, h('div', { class: 'bar' }), fill, knob);
  const play = h('button', { class: 'tbtn play', 'aria-label': 'Play or pause', onclick: () => act(S.now?.state === 'playing' ? '/stream/pause' : S.now?.state === 'paused' ? '/stream/resume' : (S.queue.length ? '/stream/jump' : '/stream/resume'), S.now?.state === 'stopped' ? { index: Math.max(0, S.now.index) } : undefined) }, icon('play'));
  const shuffle = h('button', { class: 'tbtn tog', 'aria-label': 'Shuffle', 'aria-pressed': 'false', onclick: () => act('/stream/shuffle', { on: !S.now?.shuffle }) }, icon('shuffle'));
  const repeat = h('button', { class: 'tbtn tog', 'aria-label': 'Repeat', 'aria-pressed': 'false', onclick: () => act('/stream/repeat', { mode: { off: 'all', all: 'one', one: 'off' }[S.now?.repeat ?? 'off'] }) }, icon('repeat'));
  const vol = h('input', { type: 'range', min: 0, max: 100, value: 60, 'aria-label': 'Master volume', oninput: ev => { clearTimeout(vol._t); vol._t = setTimeout(() => { const cur = avgVolume(); if (cur > 0) act('/zones/master', { scale: ev.target.value / cur }); else act('/zones/master', { set: +ev.target.value }); }, 120); } });
  const volPct = h('span', { class: 'volpct small dim' }, '');
  const genre = h('div', { class: 'np-genre' }, h('span', { class: 'np-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')), t3line);
  const liveDot = h('span', { class: 'np-dot', 'aria-hidden': 'true' });
  const volPop = h('div', { class: 'np-volpop', role: 'group', 'aria-label': 'Stop and sound', hidden: true },
    h('div', { class: 'row' }, h('button', { class: 'tbtn ico', 'aria-label': 'Stop', title: 'Stop', onclick: () => act('/stream/stop') }, icon('stop')), h('span', { class: 'grow' }),
      h('button', { class: 'tbtn tog sound', 'aria-label': 'Sound (EQ)', onclick: () => { volPop.hidden = true; ctl.openEq(); } }, icon('eq'), h('span', null, 'SOUND'))));
  const volBtn = h('button', { class: 'np-volbtn', 'aria-label': 'Stop and sound', 'aria-expanded': 'false', title: 'More', onclick: ev => { ev.stopPropagation(); volPop.hidden = !volPop.hidden; volBtn.setAttribute('aria-expanded', String(!volPop.hidden)); } }, icon('volume'));
  document.addEventListener('click', ev => { if (!volPop.hidden && !volPop.contains(ev.target) && ev.target !== volBtn) { volPop.hidden = true; volBtn.setAttribute('aria-expanded', 'false'); } });
  const upnext = h('div', { class: 'upnext np-upnext', 'aria-label': 'Up next' });
  const chips = h('div', { class: 'devchips', 'aria-label': 'Followed speakers' });
  const strip = h('div', { class: 'phone-only' }), checklist = h('div', { class: 'checklist' });
  Object.assign(E, { t1, t2, t3, elv, rev, fill, knob, play, shuffle, repeat, vol });
  const prev = h('button', { class: 'tbtn', 'aria-label': 'Previous', onclick: () => act('/stream/prev') }, icon('prev')), next = h('button', { class: 'tbtn', 'aria-label': 'Next', onclick: () => act('/stream/next') }, icon('next'));
  // 0.1.2 panel hotfix: controls live in their own SOLID panel below a separate visualizer panel (same chrome as Library / Devices / Playlist).
  // Control layout is unchanged: title/times | transport | master volume, device dots underneath.
  const ovT1 = h('div', { class: 't1' }, 'Nothing playing'), ovT2 = h('div', { class: 't2' }, ' ');
  const tableMeta = h('div', { class: 'np-tablemeta' },
    h('div', { class: 'np-tabletitles' }, ovT1, ovT2),
    h('div', { class: 'np-tableseek' }, prog, h('div', { class: 'np-times' }, elv, rev)));
  const tableXport = h('div', { class: 'transport np-tablexport', role: 'group', 'aria-label': 'Transport' }, shuffle, prev, play, next, repeat);
  const tableVol = h('div', { class: 'np-tablevol' },
    h('div', { class: 'np-vollbl' }, 'Master volume'),
    h('div', { class: 'np-volrow' }, icon('volume'), vol, volPct, h('div', { class: 'np-vol' }, volBtn, liveDot, volPop)));
  const statusBody = h('div', { class: 'np-statusbody' }, chips);
  const tableFoot = h('div', { class: 'np-tablefoot', 'aria-label': 'Followed speakers' }, statusBody);
  // Collapse arrow = the same `plus listcol` toggle the Playlist uses (˅ / ˄, themed accent). Collapsing the control panel
  // slides it down to its header strip and the visualizer panel grows into the freed space. Saved per device.
  let ctlCollapsed = false; try { ctlCollapsed = localStorage.getItem('wavwiz.npctlcollapsed') === '1'; } catch { /* ignore */ }
  const ctlColBtn = h('button', { class: 'plus listcol np-ctlcol', 'aria-label': 'Collapse or expand the playback controls', 'aria-expanded': String(!ctlCollapsed), title: 'Collapse / expand the controls', onclick: () => toggleCtl() }, ctlCollapsed ? '˄' : '˅');
  const ctlNow = h('span', { class: 'np-ctlnow small dim ell' }, '');
  const ctlBody = h('div', { class: 'np-ctlbody' }, h('div', { class: 'np-tablemain' }, tableMeta, tableXport, tableVol), tableFoot);
  const ctlPanel = h('section', { class: 'np-ctlpanel' + (ctlCollapsed ? ' collapsed' : ''), role: 'group', 'aria-label': 'Playback controls' },
    h('div', { class: 'pane-h' }, h('span', { class: 'np-ctltitle' }, 'NOW PLAYING'), ctlNow, h('span', { class: 'grow' }), h('span', { class: 'row listcolwrap' }, ctlColBtn)), ctlBody);
  function toggleCtl(force) {
    ctlCollapsed = force ?? !ctlCollapsed;
    ctlPanel.classList.toggle('collapsed', ctlCollapsed);
    el.classList.toggle('ctlcollapsed', ctlCollapsed);
    ctlColBtn.textContent = ctlCollapsed ? '˄' : '˅';
    ctlColBtn.setAttribute('aria-expanded', String(!ctlCollapsed));
    try { localStorage.setItem('wavwiz.npctlcollapsed', ctlCollapsed ? '1' : '0'); } catch { /* ignore */ }
    setTimeout(() => viz?.resize(), 340);
  }
  // Visualizer panel: header + the stage (no longer full-bleed behind overlays). Source chip (AirPlay / Spotify Connect) sits in its header.
  const vizPanel = h('section', { class: 'np-vizpanel', 'aria-label': 'Visualizer' },
    h('div', { class: 'pane-h' }, h('span', { class: 'grow ell' }, 'VISUALIZER'), srcChip), stage);
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

  const avgVolume = () => { const on = S.zones.filter(z => z.enabled); return on.length ? on.reduce((a, z) => a + z.volume, 0) / on.length : 0; };

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
    const lbl = show ? (vizState.preset || vizName(p.engine) || '') : ''; vlabel.textContent = p.names !== false ? lbl : ''; vcenter.textContent = lbl;
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
    stage.insertBefore(host, vlabel); overlay.remove(); overlay = null; try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* ok */ } viz?.resize(); paintStage();
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
    }
    miniT.textContent = t1.textContent; miniS.textContent = it ? it.artist || sourceLabel(it) : '';
    const playing = n.state === 'playing'; setIcon(play, playing ? 'pause' : 'play'); setIcon(miniPlay, playing ? 'pause' : 'play'); play.classList.toggle('playing', playing);
    shuffle.classList.toggle('on', !!n.shuffle); repeat.classList.toggle('on', n.repeat !== 'off'); shuffle.setAttribute('aria-pressed', String(!!n.shuffle)); repeat.setAttribute('aria-pressed', String(n.repeat !== 'off')); setIcon(repeat, n.repeat === 'one' ? 'repeatOne' : 'repeat');
    if (document.activeElement !== vol) vol.value = Math.round(avgVolume()); volPct.textContent = Math.round(avgVolume()) + '%';
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
    const frac = live || !dur ? 0 : Math.min(1, pos / dur); fill.style.width = frac * 100 + '%'; knob.style.left = frac * 100 + '%'; setVizProgress(live || !dur ? null : frac);
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
  function drawChips() {
    const zones = (S.zones || []).filter(z => z.enabled);   // followed / active speakers
    if (!zones.length) { chips.replaceChildren(h('span', { class: 'small dim' }, 'No speakers on')); liveDot.classList.remove('on'); return; }
    chips.replaceChildren(...zones.map(z => h('button', {
      type: 'button', class: 'np-spk',
      title: `${z.name}: ${statusLabel(z)} — tap for delay & volume`,
      onclick: () => ctl.go('devices'),
    }, h('span', { class: 'dot ' + statusDot(z), 'aria-hidden': 'true' }), h('span', { class: 'ell' }, z.name))));
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
  return { el, mini, draw, tickPos, drawStrip, drawChecklist, stage, get viz() { return viz; } };
}
