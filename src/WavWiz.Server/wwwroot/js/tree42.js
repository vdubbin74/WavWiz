// WavWiz 0.4.2: the zone tree. A zone holds its own speakers (nested); a speaker belongs to exactly one zone or to "Unassigned".
// Every zone is a neutral "Queue: <Zone>" box (now playing + one volume + the zone card + its speakers). Zones that play the same music (linked) share ONE accent box
// "Queue: <Leader> · IN SYNC". The Controlling zone's whole box (card + speakers) gets a thick accent edge; the selected speaker row gets its own highlight.
import { h, api, toast } from './util.js';
import { icon } from './icons.js';
import { startPointerDrag, pointerDropTarget } from './pdrag.js';
import * as Z from './zones40.js';
import { loadOrder, saveOrder, zoneOrderAfterDrop } from './devorder.js';
import { attachCtx, openCtx, zoneMenu42, speakerMenu42, unassignedMenu42 } from './ctxmenu.js';

// ---------------------------------------------------------------- pure parts (unit-tested)
/** The tree's shape: boxes (a solo zone, or a linked set sharing one queue), the unassigned speakers and the header counts. */
export function treeModel(zones, groups) {
  const gs = groups || [], zs = zones || [], inZone = new Set(gs.flatMap(g => g.deviceIds || []));
  const seen = new Set(), boxes = [];
  for (const g of gs) {
    const pid = g.playbackId || 'default', set = (g.linked || []).length ? gs.filter(x => (x.playbackId || 'default') === pid) : [g];
    if (set.length < 2) { boxes.push({ kind: 'solo', zones: [g], leader: g }); continue; }
    if (seen.has(pid)) continue; seen.add(pid); boxes.push({ kind: 'linked', zones: set, leader: set[0] });
  }
  const unassigned = zs.filter(z => !inZone.has(z.id));
  return { boxes, unassigned, counts: { zones: gs.length, speakers: zs.length } };
}
/** Creates a zone with its own queue (0.4.2: Link joins zones later). The API itself still starts a new zone in the house group, so the split is a follow-up call. */
export async function createZone(name, deviceIds = []) { const g = await api('/groups', { method: 'POST', body: { name, deviceIds } }); try { await api(`/groups/${g.id}/split`, { method: 'POST', body: {} }); } catch { /* already on its own queue */ } return g; }
export const countsText = m => `ZONES ${m.counts.zones} · SPEAKERS ${m.counts.speakers}`;
/** "Queue: Patio · PLAYING" / "Queue: Patio · IDLE" / "Queue: Patio · IN SYNC". */
export const boxTitle = (box, now) => `Queue: ${box.leader.name} · ${box.kind === 'linked' ? 'IN SYNC' : (now?.state === 'playing' ? 'PLAYING' : now?.state === 'paused' ? 'PAUSED' : 'IDLE')}`;
/** The PATCH calls that move speaker `devId` into zone `toId` (null = Unassigned). The server also takes it out of its old zone; the source is sent too so it never depends on that. */
export function movePlan(groups, devId, toId) {
  const ops = [], from = (groups || []).find(g => (g.deviceIds || []).includes(devId));
  if (toId != null && from && from.id === toId) return ops;
  if (toId != null) { const to = groups.find(g => g.id === toId); if (to) ops.push({ id: to.id, name: to.name, deviceIds: [...(to.deviceIds || []).filter(x => x !== devId), devId] }); }
  if (from) ops.push({ id: from.id, name: from.name, deviceIds: (from.deviceIds || []).filter(x => x !== devId) });
  return ops;
}
/** Which accent class a zone box gets: the Controlling zone's box (solo) or the zone wrap inside a linked box. */
export const isControlling = (g, cur) => !!cur && cur.kind === 'zone' && cur.id === g.id;

// ---------------------------------------------------------------- the tree
/** kit = helpers from devices.js; st = { zone, spk, onZone(id), onSpk(id), busy() }. Returns the tree element (rebuilt on each draw). */
export const JB = 'jukebox';   // 0.4.9 F76: the Jukebox zone's id in the tree / settings pane
export function treeEl(S, ctl, kit, st) {
  const { capBar, onPill, ro, tagEls3, cardTags3, zoneTags3, zoneMembers, zoneMuted, zoneOn, zoneLevel, zoneCap, canControl, isAdmin, promptName, confirmRemoveZone, canTune, dotClass, orderedGroups, openCalibration, forget } = kit;
  const groups = orderedGroups(S.groups || []), model = treeModel(S.zones, groups), cur = Z.current(), can = canControl(S), admin = isAdmin(S);
  const done = () => { ctl.refreshAll?.(); window.dispatchEvent(new CustomEvent('wavwiz:zones-changed')); };
  const root = h('div', { class: 'tree42', 'data-tree': '1' });
  // 0.4.9 F69: a tap / click on a zone row opens the zone settings, on a speaker row the speaker settings (every Devices panel); both have a Back.
  const phone = typeof matchMedia === 'function' && matchMedia('(max-width:760px)').matches;
  // control a zone: make it the Controlling one and show Now Playing (phone: the remote; desktop: Now Playing in view / focused, else go there)
  const controlZone = id => { Z.select('g:' + id); const np = !phone && document.querySelector('.nowcol');
    if (np && np.offsetParent && np.getBoundingClientRect().width > 0) { np.scrollIntoView?.({ block: 'nearest' }); (np.querySelector('.tbtn.play, button') || np).focus?.({ preventScroll: true }); } else ctl.go?.('now'); };
  const zname = id => groups.find(g => g.id === id)?.name || '';
  const create = () => promptName('New zone', '', async v => { await createZone(v, []); done(); });
  // 0.4.3 #9: the counts are plain text inside the accent caps title, as in the render
  root.append(h('div', { class: 'pane-h dsec-h tree42-h' }, h('span', { class: 'tree42-n' }, ...countsText(model).split(/(\d+)/).map(x => /^\d+$/.test(x) ? h('span', { class: 'tree42-num' }, x) : x)), h('span', { class: 'grow' }),
    ro(h('button', { type: 'button', class: 'btn sm zadd-new', 'aria-label': 'New zone', title: 'New zone', onclick: create }, '+'), admin)));

  const move = async (z, toId) => {
    try { for (const op of movePlan(S.groups, z.id, toId)) await api(`/groups/${op.id}`, { method: 'PATCH', body: { name: op.name, deviceIds: op.deviceIds } }); toast(toId == null ? `${z.name} is now unassigned` : `${z.name} moved to ${zname(toId)}`); done(); }
    catch (e) { toast(e.message, true); }
  };
  const playPause = async g => {
    const ch = Z.choices(S.groups, S.jb).find(c => c.kind === 'zone' && c.id === g.id), zid = Z.zoneIdFor(ch), q = zid ? '?zoneId=' + encodeURIComponent(zid) : '', playing = g.now?.state === 'playing';
    try { await api((playing ? '/stream/pause' : '/stream/play') + q, { method: 'POST', body: {} }); ctl.refreshAll?.(); } catch (e) { toast(e.message, true); }
  };
  const openQueue = g => { Z.select('g:' + g.id); ctl.openQueue?.(); };
  const rename = g => promptName(`Rename zone ${g.name}`, g.name, async v => { await api(`/groups/${g.id}`, { method: 'PATCH', body: { name: v, deviceIds: g.deviceIds || [] } }); done(); });
  const speakerSettings = z => st.onSpk(z.id, true);

  // ---- context menus
  const zoneCtx = (g, el) => attachCtx(el, () => {
    const ms = zoneMembers(S.zones, g), others = groups.filter(o => o.id !== g.id && o.playbackId !== g.playbackId), muted = zoneMuted(S.zones, g);
    const act = { playpause: () => playPause(g), mute: () => ctl.act(`/groups/${g.id}/mute`, { muted: !muted }), control: () => Z.select('g:' + g.id), queue: () => openQueue(g), settings: () => st.onZone(g.id), movetop: () => moveZone(g, 'top'), moveup: () => moveZone(g, 'up'), movedown: () => moveZone(g, 'down'), movebottom: () => moveZone(g, 'bottom'), split: () => Z.splitOff(g, done), rename: () => rename(g), delete: () => confirmRemoveZone(S, g, done) };
    return zoneMenu42({ admin, can, playing: g.now?.state === 'playing', muted, controlling: isControlling(g, cur), order: orderOf(g), linked: (g.linked || []).length > 0, others: others.map(o => ({ id: o.id, name: o.name })) })
      .map(it => it.sep ? it : it.sub ? { ...it, sub: it.sub.map(s => ({ ...s, onclick: () => linkTo(g, s.zone) })) } : { ...it, onclick: act[it.id] });
  }, `${g.name} zone actions`);
  const linkTo = async (g, withId) => { try { await api(`/groups/${g.id}/link`, { method: 'POST', body: { with: withId } }); toast(`${g.name} now plays the same music as ${zname(withId)}`); done(); } catch (e) { toast(e.message, true); } };
  const speakerCtx = (z, el, inZone) => attachCtx(el, () => {
    const act = { mute: () => ctl.act(`/zones/${z.id}`, { muted: !z.muted }, 'PATCH'), settings: () => speakerSettings(z), calibrate: () => openCalibration(S, ctl.refreshAll, z.id, { quick: true }),
      rename: () => promptName(`Rename ${z.name}`, z.name, async v => { await api(`/zones/${z.id}`, { method: 'PATCH', body: { name: v } }); ctl.refreshAll?.(); }), off: () => ctl.act(`/zones/${z.id}`, { enabled: !z.enabled }, 'PATCH') };
    if (!inZone) return unassignedMenu42({ admin, zones: groups.map(g => ({ id: g.id, name: g.name })) }).map(it => it.sub ? { ...it, sub: it.sub.map(s => ({ ...s, onclick: () => move(z, s.zone) })) } : { ...it, onclick: act[it.id] });
    const mine = groups.find(g => (g.deviceIds || []).includes(z.id));
    return speakerMenu42({ admin, can, muted: !!z.muted, on: !!z.enabled, canCalibrate: canTune(S, z) && z.connected, zones: groups.filter(g => g !== mine).map(g => ({ id: g.id, name: g.name })) })
      .map(it => it.sub ? { ...it, sub: it.sub.map(s => ({ ...s, onclick: () => move(z, s.zone === '' ? null : s.zone) })) } : { ...it, onclick: act[it.id] });
  }, `${z.name} actions`);

  // ---- a speaker row
  const spRow = (z, gid) => {
    const tags = cardTags3(z).filter(t => t.k !== 'muted' || true);
    const grip = ro(h('span', { class: 'dgrip42', role: 'img', 'aria-label': `Drag ${z.name} to another zone`, title: 'Drag to another zone', 'data-drag-device': z.id }, '⋮'), admin, 'Only an administrator can change zones.');   // 0.4.3 #9: the render's grip gutter
    // 0.4.3 #9: no ⋯ button (the render has none): right-click, Shift+F10 / the Menu key, or a long press opens the speaker menu
    const row = h('div', { class: 'sp42' + (st.spk === z.id ? ' sel' : '') + (z.enabled ? '' : ' off') + (z.connected ? '' : ' gone') + (z.muted ? ' muted' : ''), 'data-device-id': z.id, 'data-device': z.name, 'data-zone-id': z.id, 'data-in-zone': gid ?? '', role: 'listitem', 'aria-selected': String(st.spk === z.id) },
      grip, h('span', { class: 'dot ' + dotClass(z), title: z.connected ? 'Online' : 'Offline' }),
      h('span', { class: 'sp42-nt' }, h('button', { type: 'button', class: 'dname sp42-n ell', title: `${z.name} - open its settings`, onclick: () => st.onSpk(z.id) }, z.name),
        h('span', { class: 'dtagrow sp42-tags' }, tagEls3(tags))),
      // 0.4.3 #9: tags sit inline after the name when they fit, else wrap under it
      h('span', { class: 'sp42-v small', title: 'Volume' }, `${Math.round(z.volume)}%`),
      // 0.4.4 F25: per-speaker mute / unmute, right of the % (amber while muted)
      ro(h('button', { type: 'button', class: 'mutebtn sp42-mute' + (z.muted ? ' on' : ''), 'aria-pressed': String(!!z.muted), 'aria-label': (z.muted ? 'Unmute ' : 'Mute ') + z.name, title: z.muted ? 'Unmute' : 'Mute', 'data-icon': z.muted ? 'mute' : 'volume',
        onclick: ev => { ev.stopPropagation(); ctl.act(`/zones/${z.id}`, { muted: !z.muted }, 'PATCH'); } }, icon(z.muted ? 'mute' : 'volume')), canControl(S), 'Your access is view-only.'));
    speakerCtx(z, row, gid != null);
    return row;
  };
  // ---- a zone card + its speakers
  const zoneWrap = (g, box, leaderOf) => {
    const ms = zoneMembers(S.zones, g), sel = isControlling(g, cur), linked = (g.linked || []).length > 0, on = zoneOn(S.zones, g), connected = ms.filter(z => z.connected).length;
    const name = h('button', { type: 'button', class: 'dname zname ell', title: `${g.name} - open the zone settings`, onclick: () => st.onZone(g.id) }, g.name);
    const pill = onPill(`Zone ${g.name}`, on, can, () => { const want = !zoneOn(S.zones, g); for (const z of ms) { z.enabled = want; ctl.act(`/zones/${z.id}`, { enabled: want }, 'PATCH'); } pill._set(want); });
    // 0.4.3 #9: an empty zone has nothing to link (as in the render)
    const lb = (S.groups || []).length < 2 || (!ms.length && !linked) ? null : ro(linked
      ? h('button', { type: 'button', class: 'btn sm zlinkbtn split', 'data-act': 'split', title: 'Give this zone its own music', onclick: ev => { ev.stopPropagation(); Z.splitOff(g, done); } }, 'Split off')
      : h('button', { type: 'button', class: 'btn sm zlinkbtn link', 'data-act': 'link', title: 'Play the same music as another zone', onclick: ev => { ev.stopPropagation(); Z.linkMenu(ev.currentTarget, S, g, done); } }, icon('link'), ' Link'), can, 'Your access is view-only.');
    // 0.4.3 #9 (render final042l): grip-style gutter (zone actions) | dot, name, inline speaker-count badge ... OFF/ON
    //                              | CONTROLLING / "Queue from X" / other tags ... Link or Split off
    const all3 = zoneTags3(S.zones, g), cnt = all3.find(t => t.k === 'count'), tags = all3.filter(t => t.k !== 'count');
    const badge = h('span', { class: 'zcount42', title: cnt?.title || '', 'aria-label': `${ms.length} speaker${ms.length === 1 ? '' : 's'}` }, icon('volume'), String(ms.length));
    const gut = h('button', { type: 'button', class: 'zgut42', 'aria-label': `${g.name} zone actions`, title: 'Zone actions',
      onclick: ev => { ev.stopPropagation(); const r = ev.currentTarget.getBoundingClientRect(); ev.currentTarget.closest('.zwrap42').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.right, clientY: r.top + 8 })); } }, '⋮');
    // 0.4.9 F69: the zone NAME ROW (name, count, OFF/ON, tags) opens the zone settings; its own controls keep their behavior
    const card = h('div', { class: 'zcard42' + (on ? '' : ' off'), 'data-group-id': g.id, onclick: ev => { ev.stopPropagation(); if (ev.target.closest('button,input,select,a[href],[role="slider"],[role="switch"],.tagact,.dgrip,.dgrip42,.pill42,.tog')) return; st.onZone(g.id); } }, gut,
      h('div', { class: 'zc42-body' },
        h('div', { class: 'zc42-1' }, h('span', { class: 'dot ' + (connected ? 'ok' : 'off'), title: `${connected} of ${ms.length} online` }), name, badge, h('span', { class: 'zacts' }, pill)),
        h('div', { class: 'dtagrow ztagrow zc42-2' }, sel ? Z.controllingTag() : null, S.cast?.active && (S.cast.zones || []).includes(g.id) ? h('span', { class: 'dtag zcast', title: `Playing what a phone sends to ${S.cast.name}` }, S.cast.kind === 'spotify' ? 'SPOTIFY' : 'AIRPLAY') : null, leaderOf ? h('span', { class: 'small dim zc42-q' }, `Queue from ${leaderOf.name}`) : null, tagEls3(tags), lb ? h('span', { class: 'zacts zc42-lb' }, lb) : null)));
    const list = h('div', { class: 'zsp42', role: 'list', 'aria-label': `Speakers in ${g.name}` }, ms.length ? ms.map(z => spRow(z, g.id)) : h('div', { class: 'drop42' }, 'Drop speakers here'));
    const wrap = h('div', { class: 'zwrap42' + (sel ? ' ctl' : '') + (st.zone === g.id ? ' picked' : ''), 'data-group-id': g.id, 'data-drop': g.id, 'data-playback-id': g.playbackId || 'default', 'data-zone': g.name }, card, list);
    zoneCtx(g, wrap);
    return wrap;
  };
  // ---- a queue box (solo zone or linked set)
  const queueBox = box => {
    // 0.4.3 #2: a stopped zone (nothing playing or paused) shows "Nothing playing" and a dimmed slider, not the last song
    const lead = box.leader, linked = box.kind === 'linked', idle = !(lead.now?.state === 'playing' || (lead.now?.state === 'paused' && lead.now?.positionMs > 0)),   // a paused song still at 0:00 is a leftover, not a pause
      now = idle ? null : lead.now, sel = box.zones.some(g => isControlling(g, cur)), all = box.zones, ms = all.flatMap(g => zoneMembers(S.zones, g));
    const bt = boxTitle(box, now), cut = bt.lastIndexOf(' · ');   // 0.4.3 #9: "Queue: Patio" bold + small "· IN SYNC" status (same text)
    // 0.4.4 F14: the title line is a click target that makes this box's (leader) zone the Controlling one and shows it in the middle pane
    const pick = ev => { ev?.stopPropagation?.(); controlZone(lead.id); };   // 0.4.9 F69: the box (Queue header, now-playing bar, empty area) = control this zone + go to Now Playing   // the middle pane only exists expanded / on the Devices page
    const title = h('div', { class: 'qb42-t qb42-pick', role: 'button', tabindex: 0, title: `Control ${lead.name}`, 'aria-label': `Control ${lead.name}`, 'aria-pressed': String(sel), onclick: pick, onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(ev); } } },
      h('b', { class: 'qb42-name' }, bt.slice(0, cut)), h('span', { class: 'qb42-st' + (!linked && now?.state !== 'playing' ? ' dim' : '') }, bt.slice(cut)));
    const sync = h('span', { class: 'sr-only' }, '');
    const lvl = ms.length ? Math.round(ms.reduce((a, z) => a + z.volume, 0) / ms.length) : 0, muted = ms.length > 0 && ms.every(z => z.muted);
    const bar = capBar(linked ? 'Shared volume' : `${lead.name} zone volume`, lvl, linked ? null : zoneCap(S.zones, lead), can, v => { for (const g of all) ctl.act(`/groups/${g.id}/volume`, { set: v }); }, linked ? 'Moves every linked zone together' : 'Moves every speaker in this zone together (keeps their balance)');
    const mute = ro(h('button', { type: 'button', class: 'mutebtn zmute' + (muted ? ' on' : ''), 'aria-pressed': String(muted), 'aria-label': (muted ? 'Unmute ' : 'Mute ') + (linked ? 'the linked zones' : `zone ${lead.name}`), title: muted ? 'Unmute' : 'Mute',
      onclick: ev => { ev.stopPropagation(); for (const g of all) ctl.act(`/groups/${g.id}/mute`, { muted: !muted }); } }, icon(muted ? 'mute' : 'volume')), can, 'Your access is view-only.');
    const selectLead = () => controlZone(lead.id);
    const el = h('section', { class: 'qb42' + (linked ? ' linked' : ' solo') + (sel && !linked ? ' ctl' : '') + (idle ? ' idle' : ''), 'data-box': linked ? 'linked' : 'solo', 'data-leader-id': lead.id, 'aria-label': boxTitle(box, now) },
      h('div', { class: 'qb42-head' }, title, Z.nowLine(now, { at: S._groupsAt || Date.now(), onSelect: selectLead, selected: sel }), h('div', { class: 'dvol qb42-vol' }, bar.wrap, bar.pct, mute)),
      ...all.map(g => zoneWrap(g, null, linked && g.id !== lead.id ? lead : null)));
    el.addEventListener('click', ev => { if (ev.defaultPrevented || ev.target.closest(BOXSKIP)) return; controlZone(lead.id); });
    return el;
  };
  // 0.4.9 F69: a zone with no speakers is one compact row (name, "No speakers" / "Offline") - still a drop target (its hint opens while dragging)
  const emptyBox = (g, off = false) => {
    const sel = isControlling(g, cur);
    const wrap = h('section', { class: 'qb42 empty42' + (off ? ' off42' : '') + (sel ? ' ctl' : ''), 'data-leader-id': g.id, 'aria-label': `${g.name} (${off ? 'offline' : 'no speakers'})` },
      h('div', { class: 'zwrap42 zempty42' + (st.zone === g.id ? ' picked' : ''), 'data-group-id': g.id, 'data-drop': g.id, 'data-zone': g.name },
        h('div', { class: 'ze42-row' }, h('button', { type: 'button', class: 'dname zname ell', title: `${g.name} - open the zone`, onclick: () => st.onZone(g.id) }, g.name),
          h('span', { class: 'small dim ze42-note' }, off ? 'Offline' : 'No speakers'), h('span', { class: 'grow' })),
        h('div', { class: 'drop42 ze42-drop' }, 'Drop speakers here')));
    zoneCtx(g, wrap.firstChild);
    return wrap;
  };
  // 0.4.9 F69: ONE manual order list over all zones (the saved zone order). Shown: ACTIVE zones (a speaker online) in that order, then
  // INACTIVE zones (speakers, none online) in that order, then EMPTY zones (no speakers). A zone that comes back online pops into its remembered slot.
  const spk = box => box.zones.flatMap(g => zoneMembers(S.zones, g));
  const isEmpty = box => box.kind === 'solo' && !spk(box).length;
  const rank = box => { const m = spk(box); return !m.length ? 2 : m.some(z => z.connected) ? 0 : 1; };
  const full = model.boxes.slice();   // the manual order (orderedGroups), before the rank split
  const activeBoxes = () => full.filter(b => rank(b) === 0);
  const orderOf = g => { const a = activeBoxes(), i = a.findIndex(b => b.zones.some(z => z.id === g.id)); return i < 0 ? null : { i, n: a.length }; };
  // Move to top / up / down / to bottom (active zones only): reorder among the active zones INSIDE the full list - the inactive and empty zones keep their slots
  const moveZone = (g, how) => {
    const a = activeBoxes(), i = a.findIndex(b => b.zones.some(z => z.id === g.id)); if (i < 0) return;
    const j = how === 'top' ? 0 : how === 'up' ? i - 1 : how === 'down' ? i + 1 : a.length - 1, [m] = a.splice(i, 1); a.splice(Math.max(0, Math.min(a.length, j)), 0, m);
    setActiveOrder(a);
  };
  // the active zones in a new sequence, written into their slots of the ONE full order (inactive / empty zones keep theirs)
  const setActiveOrder = a => { let k = 0; const next = full.map(b => (rank(b) === 0 ? a[k++] : b));
    saveOrder({ ...loadOrder(), g: next.flatMap(b => b.zones.map(z => String(z.id))) }); window.dispatchEvent(new CustomEvent('wavwiz:devredraw')); };
  model.boxes = full.map((b, i) => [rank(b), i, b]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
  const un = model.unassigned;
  // 0.4.9 F76: the Jukebox zone is in the tree again (it was only drawn once it had speakers, so nobody could pick them). Admins always see it,
  // others once it has its own speakers. Same F69 ranks / click map: active (a picked speaker online) = a queue box after the active zones,
  // else a compact row ("No speakers" / "Offline") with the empty zones; the name opens its settings (speaker picker), the box selects it.
  const jb = S.jb, jbIds = new Set(jb?.deviceIds || []), jbMs = (S.zones || []).filter(z => jbIds.has(z.id));
  const jbRank = !jb || !(jb.own || admin) || (jb.showInDevices === false && !jb.running) ? -1 : !jbMs.length ? 2 : jbMs.some(z => z.connected) ? 0 : 1;
  const jbBox = () => {
    const sel = cur?.kind === 'jukebox', open = () => st.onZone(JB);
    const nameBtn = h('button', { type: 'button', class: 'dname zname ell', title: 'Jukebox - open the zone settings (pick its speakers)', onclick: ev => { ev.stopPropagation(); open(); } }, 'Jukebox');
    if (jbRank > 0) {
      const wrap = h('section', { class: 'qb42 empty42 jb42' + (jbRank === 1 ? ' off42' : '') + (sel ? ' ctl' : ''), 'data-leader-id': JB, 'data-group-id': JB, 'aria-label': `Jukebox (${jbRank === 1 ? 'offline' : 'no speakers'})` },
        h('div', { class: 'zwrap42 zempty42' + (st.zone === JB ? ' picked' : ''), 'data-group-id': JB, 'data-zone': 'Jukebox' },
          h('div', { class: 'ze42-row', onclick: open }, nameBtn, h('span', { class: 'small dim ze42-note' }, jbRank === 1 ? 'Offline' : 'No speakers'), h('span', { class: 'grow' }),
            ro(h('button', { type: 'button', class: 'btn sm jb42-set', 'data-act': 'jb-settings', title: 'Jukebox zone settings', 'aria-label': 'Jukebox zone settings', onclick: ev => { ev.stopPropagation(); open(); } }, 'Settings'), admin, 'Only an administrator can pick the Jukebox speakers.'))));
      return wrap;
    }
    const now = jb.own && jb.now && jb.now.state !== 'stopped' ? jb.now : null, pick = ev => { ev?.stopPropagation?.(); Z.select(Z.JUKEBOX_KEY); const np = !phone && document.querySelector('.nowcol'); if (!(np && np.offsetParent)) ctl.go?.('now'); };
    const lvl = Math.round(jbMs.reduce((a, z) => a + z.volume, 0) / jbMs.length), muted = jbMs.every(z => z.muted), on = jbMs.some(z => z.enabled);
    const bar = capBar('Jukebox zone volume', lvl, null, can, v => api('/jukebox/zone/volume', { method: 'POST', body: { set: v } }).catch(e => toast(e.message, true)), 'Moves every speaker of the Jukebox zone together');
    const mute = ro(h('button', { type: 'button', class: 'mutebtn zmute' + (muted ? ' on' : ''), 'aria-pressed': String(muted), 'aria-label': (muted ? 'Unmute' : 'Mute') + ' the Jukebox zone', title: muted ? 'Unmute' : 'Mute',
      onclick: ev => { ev.stopPropagation(); api('/jukebox/zone/mute', { method: 'POST', body: { muted: !muted } }).then(() => ctl.refreshAll?.()).catch(e => toast(e.message, true)); } }, icon(muted ? 'mute' : 'volume')), can, 'Your access is view-only.');
    const pill = onPill('Jukebox zone', on, can, () => { const want = !jbMs.some(z => z.enabled); for (const z of jbMs) { z.enabled = want; ctl.act(`/zones/${z.id}`, { enabled: want }, 'PATCH'); } pill._set(want); });
    const title = h('div', { class: 'qb42-t qb42-pick', role: 'button', tabindex: 0, title: 'Control the Jukebox', 'aria-label': 'Control the Jukebox', 'aria-pressed': String(sel), onclick: pick, onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(ev); } } },
      h('b', { class: 'qb42-name' }, 'Queue: Jukebox'), h('span', { class: 'qb42-st dim' }, now?.state === 'playing' ? ' · PLAYING' : ' · IDLE'));
    const card = h('div', { class: 'zcard42' + (on ? '' : ' off'), 'data-group-id': JB, onclick: ev => { ev.stopPropagation(); if (ev.target.closest('button,input,select,a[href],[role="slider"],[role="switch"],.pill42,.tog')) return; open(); } },
      h('span', { class: 'zgut42', 'aria-hidden': 'true' }, ''),
      h('div', { class: 'zc42-body' },
        h('div', { class: 'zc42-1' }, h('span', { class: 'dot ok', title: `${jbMs.filter(z => z.connected).length} of ${jbMs.length} online` }), nameBtn, h('span', { class: 'zcount42', 'aria-label': `${jbMs.length} speakers` }, icon('volume'), String(jbMs.length)), h('span', { class: 'zacts' }, pill)),
        h('div', { class: 'dtagrow ztagrow zc42-2' }, sel ? Z.controllingTag() : null, h('span', { class: 'dtag zjb', title: 'Guests choose the songs; they play only on these speakers' }, 'JUKEBOX'))));
    const wrap = h('div', { class: 'zwrap42' + (sel ? ' ctl' : '') + (st.zone === JB ? ' picked' : ''), 'data-group-id': JB, 'data-zone': 'Jukebox', 'data-playback-id': jb.zoneId || 'jukebox' }, card,
      h('div', { class: 'zsp42', role: 'list', 'aria-label': 'Speakers in the Jukebox' }, jbMs.map(z => spRow(z, JB))));
    const el = h('section', { class: 'qb42 solo jb42' + (sel ? ' ctl' : '') + (now ? '' : ' idle'), 'data-box': 'solo', 'data-leader-id': JB, 'aria-label': 'Jukebox' },
      h('div', { class: 'qb42-head' }, title, Z.nowLine(now, { at: S._groupsAt || Date.now(), onSelect: pick, selected: sel }), h('div', { class: 'dvol qb42-vol' }, bar.wrap, bar.pct, mute)), wrap);
    el.addEventListener('click', ev => { if (ev.defaultPrevented || ev.target.closest(BOXSKIP)) return; pick(ev); });
    return el;
  };
  const boxEls = model.boxes.map(b => [rank(b), rank(b) > 0 ? emptyBox(b.leader, rank(b) === 1) : queueBox(b)]);
  if (jbRank >= 0) { const r = jbRank, at = boxEls.findIndex(x => x[0] > r); boxEls.splice(at < 0 ? boxEls.length : at, 0, [r, jbBox()]); }
  root.append(...boxEls.map(x => x[1]));
  if (!model.boxes.length) root.append(h('p', { class: 'dim small pad' }, 'Zones hold speakers, like “Downstairs”. An administrator can create one with +.'));
  const addMenu = (z, btn) => { const r = btn.getBoundingClientRect(); openCtx(r.left, r.bottom + 2, groups.length ? groups.map(g => ({ id: 'move:' + g.id, label: g.name, onclick: () => move(z, g.id) })) : [{ id: 'none', label: 'Create a zone first', disabled: true }], { label: `Add ${z.name} to a zone`, from: btn }); };
  const unBox = h('section', { class: 'un42' + (un.length ? '' : ' empty'), 'data-drop': 'none', 'aria-label': 'Unassigned speakers' },
    h('div', { class: 'un42-h' }, h('b', null, 'UNASSIGNED'), h('span', { class: 'un42-n' }, ` ${un.length} `), h('span', { class: 'small dim' }, 'Not in any zone, so silent')),
    h('div', { role: 'list' }, un.length ? un.map(z => {
      const row = h('div', { class: 'sp42 un' + (st.spk === z.id ? ' sel' : '') + (z.connected ? '' : ' gone'), 'data-device-id': z.id, 'data-device': z.name, 'data-zone-id': z.id, 'data-in-zone': '', role: 'listitem' },
        ro(h('span', { class: 'dgrip42', role: 'img', 'aria-label': `Drag ${z.name} into a zone`, title: 'Drag into a zone', 'data-drag-device': z.id }, '⋮'), admin, 'Only an administrator can change zones.'),
        h('span', { class: 'dot ' + dotClass(z) }), h('button', { type: 'button', class: 'dname sp42-n ell', onclick: () => st.onSpk(z.id) }, z.name), h('span', { class: 'grow' }),
        ro(h('button', { type: 'button', class: 'btn sm saddzone', onclick: ev => { ev.stopPropagation(); addMenu(z, ev.currentTarget); } }, 'Add to zone'), admin, 'Only an administrator can change zones.'));
      speakerCtx(z, row, false); return row;
    }) : h('div', { class: 'drop42' }, 'Drop speakers here to unassign them')));
  root.append(unBox);
  attachDrag(root, S, move);
  // 0.4.9 F69: zones drag only by their left-edge ⋮ handle and only ACTIVE zones; a drop writes the same manual order as Move up / down
  attachZoneDrag(root, model.boxes, () => window.dispatchEvent(new CustomEvent('wavwiz:devredraw')), { active: b => rank(b) === 0, reorder: (fromBox, toBox, after) => {
    const a = activeBoxes(), m = a.indexOf(fromBox); if (m < 0 || fromBox === toBox) return; a.splice(m, 1); const t = a.indexOf(toBox); if (t < 0) return; a.splice(t + (after ? 1 : 0), 0, fromBox); setActiveOrder(a); } });
  // 0.4.9 F69: a tap / click on a speaker row (not its handle, name button or controls) opens that speaker's settings
  root.addEventListener('click', ev => { const row = ev.target.closest('.sp42[data-device-id]'); if (!row || !root.contains(row) || ev.defaultPrevented || ev.target.closest('button,input,select,a[href],[role="slider"],.dgrip42,.tagact')) return;
    ev.stopPropagation(); st.onSpk(+row.dataset.deviceId); });
  return root;
}

// ---------------------------------------------------------------- drag a speaker (grip) onto a zone box / the Unassigned group
// 0.4.4 F9 behavior (lifted source, every valid target outlined, the one under the pointer solid + an insertion line, own zone not a target, Esc cancels)
// 0.4.5 F26: runs on the shared pointer engine (pdrag.js) - mouse 5 px, touch / pen a short hold (a swipe still scrolls); the ghost is a copy of the
// speaker row pinned at the exact point it was grabbed at any Display size / Windows scaling; zones that are not targets dim.
function attachDrag(root, S, move) {
  root.addEventListener('pointerdown', ev => {
    const grip = ev.target.closest('.dgrip42'); if (!grip || !root.contains(grip) || grip.classList.contains('ro') || grip.hasAttribute('aria-disabled') || ev.button > 0) return;
    const id = +grip.dataset.dragDevice, z = (S.zones || []).find(x => x.id === id); if (!z) return;
    const src = grip.closest('.sp42, .un42-row, [data-device-id]');
    const from = (S.groups || []).find(g => (g.deviceIds || []).includes(id)), fromKey = from ? String(from.id) : 'none';
    let offs = [];
    const onStart = () => {
      root.classList.add('dragging'); src?.classList.add('drag42-src');
      for (const t of root.querySelectorAll('[data-drop]')) {
        if (t.dataset.drop === fromKey) { t.classList.add('dropno'); continue; }
        t.classList.add('droppable');
        offs.push(pointerDropTarget(t, { accept: pl => pl?.kind === 'device42', over: () => { root.querySelectorAll('.dropping').forEach(e => e !== t && e.classList.remove('dropping')); t.classList.add('dropping'); }, leave: () => t.classList.remove('dropping'),
          drop: () => { const d = t.dataset.drop, to = d === 'none' ? null : +d; if ((from?.id ?? null) !== to) move(z, to); } }));
      }
    };
    const onEnd = () => { offs.forEach(f => f()); offs = []; root.classList.remove('dragging'); src?.classList.remove('drag42-src'); root.querySelectorAll('.dropping,.droppable,.dropno').forEach(t => t.classList.remove('dropping', 'droppable', 'dropno')); };
    startPointerDrag(ev, grip, () => ({ kind: 'device42', id, title: z.name }), { mode: 'pointer', pin: src || grip, onStart, onEnd, noSkip: true });
  });
}

// ---------------------------------------------------------------- drag a zone (its card or its box title) to reorder the zone boxes
// 0.4.6 F30: same pointer engine and feedback as the speaker drag (F26) - mouse 5 px, touch / pen a short hold, Esc cancels, the ghost is a copy of the
// grabbed card / title pinned at the grab point, the other boxes outlined in the accent and the one under the pointer solid with an insertion line.
// A linked set moves as one box. The order is kept on this device (wavwiz.devorder.v1 .g - the 0.3.8 L40 card order the whole Devices UI uses).
const BOXSKIP = 'button,input,select,textarea,a[href],[role="slider"],[role="switch"],.qb42-vol,.zcard42,.zsp42,.dgrip,.dgrip42,.ctxmenu';
const ZSKIP = 'button:not(.zname),input,select,textarea,a[href],[role="slider"],.qb42-vol,.zacts,.zgut42,.zl-now,.tagact,.dgrip42,.zsp42';
function attachZoneDrag(root, boxes, redraw, opt = {}) {
  root.addEventListener('click', ev => { if (ev.target.closest?.('[data-justdragged]')) { ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);   // a finished drag is not also a click
  root.addEventListener('pointerdown', ev => {
    const grab = ev.target.closest('.zgut42'); if (!grab || !root.contains(grab) || ev.button > 0 || boxes.length < 2) return;   // 0.4.9 F69: the ⋮ handle only
    // 0.4.9 F69 fix: the DOM boxes are matched to the model by their leader id. The F76 Jukebox row is a .qb42 too but not a zone box, so the old
    // index match (DOM i = boxes[i]) shifted every box after it and threw on boxes[i] = undefined in onStart - targets past it were never armed.
    const byId = new Map(boxes.map((b, i) => [String(b.leader.id), i])), idx = t => byId.get(t.dataset.leaderId) ?? -1;
    const box = grab.closest('.qb42'), all = [...root.querySelectorAll(':scope > .qb42')].filter(t => idx(t) >= 0), from = idx(box); if (from < 0) return;
    const g = boxes[from], ids = boxes.map(b => b.zones.map(z => z.id)); let offs = [], where = null; if (opt.active && !opt.active(g)) return;
    const clear = t => t.classList.remove('dropping', 'zins-before', 'zins-after');
    const onStart = () => {
      root.classList.add('dragging', 'zdrag'); box.classList.add('drag42-src');
      all.forEach(t => { const i = idx(t); if (i === from || (opt.active && !opt.active(boxes[i]))) return; t.classList.add('droppable');
        offs.push(pointerDropTarget(t, { accept: pl => pl?.kind === 'zone42',
          over: (_, x, y) => { all.forEach(e => e !== t && clear(e)); const r = t.getBoundingClientRect(), after = y > r.top + r.height / 2; where = { i, after };
            t.classList.add('dropping'); t.classList.toggle('zins-after', after); t.classList.toggle('zins-before', !after); },
          leave: () => clear(t),   // the engine calls leave() right before drop(), so `where` is kept
          drop: () => { if (where?.i !== i) return; if (opt.reorder) { opt.reorder(g, boxes[i], where.after); return; } const o = loadOrder(); saveOrder({ ...o, g: zoneOrderAfterDrop(ids, from, where.i, where.after) }); redraw(); } })); });
    };
    const onEnd = () => { offs.forEach(f => f()); offs = []; root.classList.remove('dragging', 'zdrag'); box.classList.remove('drag42-src'); all.forEach(t => { clear(t); t.classList.remove('droppable'); }); };
    startPointerDrag(ev, grab, () => ({ kind: 'zone42', id: g.leader.id, title: g.leader.name }), { mode: 'pointer', pin: grab.closest('.zcard42') || grab, onStart, onEnd, noSkip: true });
  });
}

// ---------------------------------------------------------------- the middle pane: zone settings (the speaker page is speakerSettings in spkset.js)
export function crumb(zoneName, spkName) { return spkName ? `${zoneName || 'Unassigned'} > ${spkName}` : zoneName || ''; }
export const HINT42 = 'Pick a zone or a speaker in the tree on the right to see its settings here.';
export function zonePane(S, ctl, kit, g, st) {
  const { capBar, onPill, ro, zoneMembers, zoneMuted, zoneOn, zoneLevel, zoneCap, canControl, isAdmin, promptName, confirmRemoveZone } = kit;
  const can = canControl(S), admin = isAdmin(S), ms = zoneMembers(S.zones, g), done = () => { ctl.refreshAll?.(); window.dispatchEvent(new CustomEvent('wavwiz:zones-changed')); };
  const root = h('section', { class: 'zpane42', 'aria-label': `Zone settings, ${g.name}`, 'data-group-id': g.id });
  const name = h('input', { type: 'text', maxlength: 60, value: g.name, 'aria-label': 'Zone name', class: 'zp42-name' });
  const saveName = ro(h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'zone-rename', onclick: async () => { const v = name.value.trim(); if (!v) { toast('Type a name first', true); return; } try { await api(`/groups/${g.id}`, { method: 'PATCH', body: { name: v, deviceIds: g.deviceIds || [] } }); toast('Zone renamed'); done(); } catch (e) { toast(e.message, true); } } }, 'Rename'), admin, 'Only an administrator can rename a zone.');
  const on = zoneOn(S.zones, g), pill = onPill(`Zone ${g.name}`, on, can, () => { const want = !zoneOn(S.zones, g); for (const z of ms) ctl.act(`/zones/${z.id}`, { enabled: want }, 'PATCH'); pill._set(want); });
  const muted = zoneMuted(S.zones, g), bar = capBar(`${g.name} zone volume`, zoneLevel(S.zones, g), zoneCap(S.zones, g), can, v => ctl.act(`/groups/${g.id}/volume`, { set: v }));
  const mute = ro(h('button', { type: 'button', class: 'mutebtn zmute' + (muted ? ' on' : ''), 'aria-pressed': String(muted), 'aria-label': (muted ? 'Unmute zone ' : 'Mute zone ') + g.name, onclick: () => ctl.act(`/groups/${g.id}/mute`, { muted: !muted }) }, icon(muted ? 'mute' : 'volume')), can, 'Your access is view-only.');
  const others = (S.groups || []).filter(o => o.id !== g.id);
  root.append(
    h('div', { class: 'zp42-row' }, h('span', { class: 'dlbl' }, 'NAME'), name, saveName, h('span', { class: 'grow' }), h('span', { class: 'dlbl' }, 'ENABLED'), pill),
    h('div', { class: 'zp42-row zp42-now' }, Z.nowLine(g.now, { at: S._groupsAt || Date.now() })),
    h('div', { class: 'zp42-row dvol' }, h('span', { class: 'dlbl' }, 'VOLUME'), bar.wrap, bar.pct, mute),
    h('div', { class: 'zp42-row' }, h('span', { class: 'dlbl' }, 'QUEUE'), h('b', null, `Queue: ${g.name}`), h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn sm', 'data-act': 'zone-open-queue', onclick: () => { Z.select('g:' + g.id); ctl.openQueue?.(); } }, 'Open queue')),
    h('div', { class: 'zp42-row zp42-spk' }, h('span', { class: 'dlbl' }, `SPEAKERS IN ${g.name.toUpperCase()}`),
      ms.length ? h('ul', { class: 'zp42-list' }, ms.map(z => h('li', null, h('button', { type: 'button', class: 'dname ell', onclick: () => st.onSpk(z.id) }, z.name), h('span', { class: 'grow' }),
        ro(h('button', { type: 'button', class: 'btn sm', 'data-act': 'zone-remove-speaker', 'aria-label': `Remove ${z.name} from ${g.name}`, onclick: async () => { try { await api(`/groups/${g.id}`, { method: 'PATCH', body: { name: g.name, deviceIds: (g.deviceIds || []).filter(x => x !== z.id) } }); toast(`${z.name} is now unassigned`); done(); } catch (e) { toast(e.message, true); } } }, 'Remove'), admin, 'Only an administrator can change zones.'))))
        : h('p', { class: 'small dim' }, 'No speakers yet. Drag a speaker here, or use Add to zone.')),
    kit.receiverBlock ? h('div', { class: 'zp42-row zp42-recv' }, kit.receiverBlock(g, admin)) : null,
    h('div', { class: 'zp42-row zp42-acts' },
      others.length ? ro(h('button', { type: 'button', class: 'btn', 'data-act': 'zone-link', onclick: ev => Z.linkMenu(ev.currentTarget, S, g, done) }, icon('link'), ' Link to…'), can, 'Your access is view-only.') : null,
      (g.linked || []).length ? ro(h('button', { type: 'button', class: 'btn', 'data-act': 'zone-split', onclick: () => Z.splitOff(g, done) }, 'Split off'), can, 'Your access is view-only.') : null,
      h('span', { class: 'grow' }),
      ro(h('button', { type: 'button', class: 'btn danger', 'data-act': 'zone-delete', onclick: () => confirmRemoveZone(S, g, done) }, 'Delete zone'), admin, 'Only an administrator can delete a zone.')));
  return root;
}
