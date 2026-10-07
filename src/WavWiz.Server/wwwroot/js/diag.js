import { h, api, toast } from './util.js';
import { vizStats, webgl2Ok, vizPrefs, vizName } from './viz.js';
import { loadReact } from './vizcore.js';

const ICON = { ok: '✓', warn: '!', fail: '✕', unknown: '?' };
export const roomPillClass = s => ({ ok: 'ok', idle: 'idle', buffering: 'warn', dropped: 'bad', reconnecting: 'bad', offline: 'offline' }[s] || 'idle');
export const roomPill = (z) => { const r = z.room; if (!r) return null; return h('span', { class: 'pill ' + roomPillClass(r.state), title: r.detail || r.text || '' }, ({ ok: 'Playing', idle: 'Idle', buffering: 'Buffering', dropped: 'Dropped', reconnecting: 'Reconnecting', offline: 'Offline' }[r.state] || r.state)); };

/** Visualizer check: WebGL ok, data arriving, current look, frames drawn, last error. */
export function vizReport() {
  const st = vizStats(), p = vizPrefs(), rows = [], gl = webgl2Ok();
  if (!st) { rows.push(['WebGL', gl ? 'ok' : 'warn', gl ? 'available (full 3D looks)' : 'not available on this device - a simpler 2D picture is shown']); }
  else rows.push(['WebGL', st.webgl ? 'ok' : 'warn', st.webgl ? `${st.webgl2 ? 'WebGL 2' : 'WebGL 1 (older graphics; everything still works)'}, ${st.hdr ? 'half-float glow buffers' : '8-bit buffers with dithering'}, ${st.instancing ? 'GPU particles' : 'CPU particles'}${st.renderer ? ' - ' + st.renderer : ''}` : 'not available on this device - a simpler 2D picture is shown']);
  if (!st) { rows.push(['Visualizer running', 'unknown', p.on ? 'not started yet - it starts when the Now Playing banner is on screen' : 'switched off on this device']); return rows; }
  rows.push(['Look', 'ok', `${vizName(st.engine)} (${st.mode === 'webgl' ? 'WebGL, one shared context' : st.mode === '2d-native' ? 'Canvas 2D' : st.mode === 'waiting' ? 'waiting for the graphics chip' : '2D fallback'}${st.particles ? ', ' + st.particles + ' particles' : ''})`]);
  const tierName = { tiny: 'Low (minimal)', min: 'Low (reduced)', low: 'Low', high: 'High', ultra: 'Ultra' }[st.tier] || st.tier;
  rows.push(['Quality', st.govSteps > 1 && st.tier === 'tiny' ? 'warn' : 'ok', st.quality === 'auto' ? `Auto - running at ${tierName}${st.govSteps ? ` (stepped ${st.govSteps}× to keep it smooth)` : ''}` : `${tierName} (set by you)`]);
  rows.push(['Frame time', !st.frameMs ? 'unknown' : st.frameMs > 40 ? 'warn' : 'ok', st.frameMs ? `${st.frameMs} ms between frames, ${st.workMs} ms of drawing each` : 'not measured yet']);
  rows.push(['Graphics context', st.contextLost ? 'warn' : 'ok', st.contextLost ? 'lost - restoring (the picture keeps its last frame)' : `healthy (context #${st.contextGen}${st.losses ? `, recovered ${st.losses}× from a graphics reset` : ''})`]);
  const r = loadReact();
  rows.push(['Reactivity', 'ok', `energy ${r.energy} %, sensitivity ${r.sensitivity} %, auto-gain ${r.autoGain ? r.autoGain + ' %' : 'off'} (gain x${st.gain ?? 1})${st.stereo ? ', stereo levels from the server' : ''}`]);
  rows.push(['Audio data arriving', st.dataArriving ? 'ok' : st.dataFrames ? 'warn' : 'unknown', st.dataArriving ? `yes (${st.dataFrames} windows received, last ${st.dataAgeMs} ms ago)` : st.dataFrames ? `stopped (last ${st.dataAgeMs} ms ago) - nothing is playing, or the feed was interrupted` : 'none yet - start some music (unknown, not a failure)']);
  rows.push(['Frames drawn', st.frames > 0 ? 'ok' : 'unknown', `${st.frames} (${st.fps} per second now) at ${st.canvas || '?'}${st.light ? ', light mode' : ''}`]);
  rows.push(['Last error', st.lastError ? 'warn' : 'ok', st.lastError || 'none']);
  return rows;
}
function vizCard() {
  const box = h('div', { class: 'card', id: 'diag-viz' }), out = h('div');
  const paint = () => out.replaceChildren(...vizReport().map(([t, s, d]) => h('div', { class: 'chk ' + (s === 'ok' ? 'done' : '') }, h('span', { class: 'mark', style: s === 'warn' ? 'border-color:#ffb300;color:#ffb300' : '' }, ICON[s] || '?'), h('div', { class: 'grow' }, h('b', null, t), ' ', h('span', { class: 'dim' }, d)))));
  paint(); box.append(h('div', { class: 'row wrap' }, h('h3', { class: 'grow' }, 'Visualizer (this device)'), h('button', { class: 'btn', onclick: paint }, 'Refresh')), out);
  return box;
}

const fmtAgo = sec => sec == null ? 'never' : sec < 90 ? `${sec} s ago` : sec < 5400 ? `${Math.round(sec / 60)} min ago` : `${Math.round(sec / 3600)} h ago`;
/** 0.1.3: AirPlay / Spotify buffer and drop-outs, orphaned sessions, with Restart AirPlay and Clear orphans. */
function receiversCard(S) {
  const box = h('div', { class: 'card', id: 'diag-receivers' }), out = h('div'), admin = S?.auth?.role === 'admin';
  const row = (name, r) => {
    if (!r.enabled && !r.running) return h('div', { class: 'small dim' }, `${name}: switched off`);
    const f = r.feed || {}, state = !r.running ? 'not running' : r.inSession ? (f.active ? 'playing' : 'connected, no audio') : 'ready, waiting for a phone';
    const health = !r.running ? 'bad' : f.underruns && f.lastUnderrunAgoSec != null && f.lastUnderrunAgoSec < 600 ? 'warn' : 'ok';
    return h('div', { class: 'rcv' }, h('div', { class: 'row wrap' }, h('b', { class: 'grow' }, name), h('span', { class: 'pill ' + health }, state)),
      h('div', { class: 'small dim' }, `Buffer ${f.bufferedMs ?? 0} ms of ${f.targetMs ?? '?'} ms • drop-outs ${f.underruns ?? 0}${f.underruns ? ` (last ${fmtAgo(f.lastUnderrunAgoSec)})` : ''} • restarted ${r.restarts}× • audio last arrived ${fmtAgo(f.dataAgeSec)}`),
      r.lastError ? h('div', { class: 'small warnc' }, r.lastError) : null,
      f.underruns > 5 ? h('div', { class: 'small warnc' }, 'Frequent drop-outs usually mean weak Wi-Fi between the phone and this PC. Move closer to the router, or connect this PC by cable.') : null);
  };
  const act = async (url, busy) => { try { const r = await api(url, { method: 'POST' }); toast(r.message || 'Done'); } catch (e) { toast(e.message, true); } setTimeout(paint, busy || 300); };
  async function paint() {
    let d; try { d = await api('/health/receivers'); } catch (e) { out.replaceChildren(h('p', { class: 'small dim' }, 'Receiver health is not available: ' + e.message)); return; }
    out.replaceChildren(row('AirPlay', d.airplay), row('Spotify Connect', d.spotify),
      h('div', { class: 'sec' }, 'Orphaned sessions'),
      d.orphans.length ? h('ul', { class: 'small' }, d.orphans.map(o => h('li', null, h('b', null, o.name), ' - ', o.detail))) : h('div', { class: 'small dim' }, 'None. Every connection is accounted for.'),
      admin ? h('div', { class: 'row wrap', style: 'margin-top:8px' },
        h('button', { class: 'btn', 'data-act': 'restart-airplay', onclick: () => act('/health/airplay/restart', 2500) }, 'Restart AirPlay'),
        h('button', { class: 'btn', 'data-act': 'clear-orphans', disabled: !d.orphans.length, onclick: () => act('/health/orphans/clear') }, 'Clear orphans')) : h('div', { class: 'small dim' }, 'Sign in as admin to restart AirPlay or clear orphans.'));
  }
  paint(); box.append(h('div', { class: 'row wrap' }, h('h3', { class: 'grow' }, 'Receivers (AirPlay & Spotify)'), h('button', { class: 'btn', onclick: paint }, 'Refresh')), out);
  return box;
}
/** 0.1.3: which address WavWiz listens on, Private/Public network, re-detect, use the new address. */
export function networkCard(S) {
  const box = h('div', { class: 'card', id: 'diag-network' }), out = h('div'), admin = S?.auth?.role === 'admin';
  async function use(addr) {
    if (!confirm(`Switch WavWiz to ${addr}? It restarts, and players reconnect on their own within a minute.`)) return;
    try { const r = await api('/network/bind', { method: 'POST', body: { address: addr } }); toast(r.message); if (r.restarting) out.prepend(h('p', { class: 'warnc' }, r.message, ' ', h('a', { href: r.url }, r.url))); } catch (e) { toast(e.message, true); }
  }
  async function paint(fresh) {
    let d; try { d = await api('/network' + (fresh ? '?fresh=true' : '')); } catch (e) { out.replaceChildren(h('p', { class: 'small dim' }, 'Network check is not available: ' + e.message)); return; }
    const prof = p => p === 'Unknown' ? h('span', { class: 'pill' }, 'type unknown') : h('span', { class: 'pill ' + (p === 'Public' ? 'bad' : 'ok') }, p);
    out.replaceChildren(
      h('div', null, 'WavWiz listens on ', h('b', { class: 'mono' }, d.bind), d.status === 'ok' ? h('span', { class: 'okc' }, ' - looks good.') : null),
      d.problems.length ? h('ul', { class: 'warnc' }, d.problems.map(p => h('li', null, p))) : null,
      d.fixes.length ? h('div', { class: 'small' }, h('b', null, 'What to do: '), h('ul', null, d.fixes.map(p => h('li', null, p)))) : null,
      h('div', { class: 'sec' }, "This PC's home-network addresses"),
      d.adapters.length ? h('table', { class: 'tbl small' }, h('tbody', null, d.adapters.map(a => h('tr', null, h('td', { class: 'mono' }, a.address), h('td', null, `${a.kind}: ${a.name}`), h('td', null, prof(a.profile)), h('td', null, a.isBind ? h('b', null, 'in use') : admin && d.canRebind && a.kind !== 'Virtual' ? h('button', { class: 'btn', 'data-use': a.address, onclick: () => use(a.address) }, `Use ${a.address}`) : ''))))) : h('div', { class: 'small dim' }, 'No home-network address found. Is this PC connected to your router?'),
      h('p', { class: 'small dim' }, 'WavWiz only opens its firewall ports on Private networks. If a network shows Public, Windows hides WavWiz from your phones and other PCs.'));
  }
  paint(false); box.append(h('div', { class: 'row wrap' }, h('h3', { class: 'grow' }, 'Network'), h('button', { class: 'btn', 'data-act': 'redetect', onclick: () => paint(true) }, 'Re-detect')), out);
  return box;
}

export function diagnosticsView(S) {
  const root = h('div'); let timer = null;
  async function draw() {
    let d; try { d = await api('/diagnostics'); } catch (e) { root.replaceChildren(h('p', { class: 'err' }, e.status === 403 ? 'Diagnostics need Control or Admin access.' : e.message)); return; }
    const report = () => [`WavWiz ${d.version} ${d.channel} diagnostics ${d.generatedAt}`, d.os, '', ...vizReport().map(([t, s, x]) => `[VIZ ${s.toUpperCase()}] ${t}: ${x}`), '', ...d.checks.map(c => `[${c.status.toUpperCase()}] ${c.title}: ${c.detail}${c.fix ? '  -> ' + c.fix : ''}`), '', ...d.devices.map(r => `DEVICE ${r.name} (${r.link || 'link unknown'}, ${r.remoteIp || 'no ip'}): ${r.state}; drops ${r.drops}, reconnects ${r.reconnects}, underrun events ${r.underrunEvents}\n   ` + r.events.map(e => `${e.at} ${e.kind} ${e.text}`).join('\n   '))].join('\n');
    root.replaceChildren(h('div', { class: 'row wrap' }, h('h2', { class: 'grow' }, 'Diagnostics'), h('button', { class: 'btn', onclick: draw }, 'Refresh'), h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(report()); toast('Report copied'); } catch { toast('Could not copy automatically - select the text on the page.', true); } } }, 'Copy report')),
      h('p', { class: 'small dim' }, `Checked ${d.generatedAt}. Nothing here leaves your network. “?” means WavWiz could not check it - never that it is fine.`),
      h('div', { class: 'card' }, d.checks.map(c => h('div', { class: 'chk ' + (c.status === 'ok' ? 'done' : '') }, h('span', { class: 'mark', style: c.status === 'fail' ? 'border-color:#e5483f;color:#e5483f' : c.status === 'warn' ? 'border-color:#ffb300;color:#ffb300' : '' }, ICON[c.status] || '?'),
        h('div', { class: 'grow' }, h('div', null, h('b', null, c.title), ' ', h('span', { class: 'dim' }, c.detail)), c.fix ? h('div', { class: 'small warnc' }, 'What to do: ' + c.fix) : null)))),
      vizCard(), receiversCard(S), networkCard(S),
      h('h3', null, 'Devices'), d.devices.length ? d.devices.map(r => h('div', { class: 'card' }, h('div', { class: 'row wrap' }, h('b', { class: 'grow' }, r.name), h('span', { class: 'pill ' + roomPillClass(r.state) }, r.state), h('span', { class: 'pill' }, r.link || 'link unknown')),
        h('div', { class: 'small dim' }, `${r.remoteIp || 'not connected'} • dropped ${r.drops}× • reconnected ${r.reconnects}× • underrun events ${r.underrunEvents}${r.syncErrorMs != null ? ` • sync error ${r.syncErrorMs.toFixed(1)} ms` : ' • sync error unknown'}`),
        r.detail ? h('div', { class: 'small' }, r.detail) : null,
        r.events.length ? h('details', null, h('summary', { class: 'small' }, `Recent events (${r.events.length})`), h('table', { class: 'tbl' }, h('tbody', null, r.events.map(e => h('tr', null, h('td', { class: 'mono small' }, e.at), h('td', null, e.kind), h('td', null, e.text)))))) : null)) : h('p', { class: 'dim' }, 'No devices yet.'));
  }
  draw(); timer = setInterval(() => { if (document.body.contains(root)) draw(); else clearInterval(timer); }, 15000);
  return { el: root, reload: draw };
}

/** The first-run checklist card (shown at the top of Devices/Now Playing until everything is done or dismissed). */
export async function checklistCard(S, go, force = false) {
  let c; try { c = await api('/checklist'); } catch { return null; }
  const local = localStorage.getItem('unison.checklist.dismissed') === '1';
  if (!force && (c.dismissed || local)) return null;
  const dismiss = async () => { localStorage.setItem('unison.checklist.dismissed', '1'); try { if (S.auth.role === 'admin') await api('/settings', { method: 'PUT', body: { 'ui.checklistDismissed': true } }); } catch { /* local only */ } window.dispatchEvent(new CustomEvent('wavwiz:checklist')); };
  return h('div', { class: 'card', style: 'border-color:var(--accent)' }, h('div', { class: 'row' }, h('h3', { class: 'grow' }, c.done ? 'All set up 🎉' : `Getting started (${c.remaining} to go)`), h('button', { class: 'btn', onclick: dismiss }, c.done ? 'Hide' : 'Hide this')),
    c.items.map(i => h('div', { class: 'chk ' + (i.done ? 'done' : '') }, h('span', { class: 'mark' }, i.done ? '✓' : ''), h('div', { class: 'grow' }, h('div', null, h('b', null, i.title), i.required ? '' : h('span', { class: 'dim small' }, ' (optional)')), h('div', { class: 'small dim' }, i.detail), !i.done && i.action ? h('button', { class: 'btn', style: 'margin-top:6px', onclick: () => go(i.action) }, 'Do this') : null))));
}
