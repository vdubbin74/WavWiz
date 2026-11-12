// WavWiz 0.4.2: the zone tree. A zone holds its own speakers (nested); a speaker belongs to exactly one zone or to "Unassigned".
// Every zone is a neutral "Queue: <Zone>" box (now playing + one volume + the zone card + its speakers). Zones that play the same music (linked) share ONE accent box
// "Queue: <Leader> · IN SYNC". The Controlling zone's whole box (card + speakers) gets a thick accent edge; the selected speaker row gets its own highlight.
import { h, api, toast } from './util.js';
import { icon, setIcon } from './icons.js';
import { phoneZoneMembers, phoneZoneLevel, phoneZoneVolWriter, uniqueMembers } from './mixer-core.js';   // F250-P8: phone Devices max-based (desktop average untouched)
import { startPointerDrag, pointerDropTarget } from './pdrag.js';
import * as Z from './zones40.js';
import { swapQuestion, offerSwap, dismissNote } from './zoneref.js';   // 0.6.8-#15
import { airPlaySetupCard } from './airplaysetup.js';   // 0.6.8-#14b inline card at the bottom of the zone list
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
/** F266: folded zone boxes (leader ids), saved per browser. */
export const FOLD_KEY = 'wavwiz.zfold';
export function loadZoneFolds(store = globalThis.localStorage) { try { const a = JSON.parse(store.getItem(FOLD_KEY) || '[]'); return new Set(Array.isArray(a) ? a.map(String) : []); } catch { return new Set(); } }
export function saveZoneFolds(set, store = globalThis.localStorage) { try { store.setItem(FOLD_KEY, JSON.stringify([...set])); } catch { /* private mode */ } }
export const boxTitle = (box, now) => `Queue: ${box.leader.name} · ${box.kind === 'linked' ? 'IN SYNC' : (now?.state === 'playing' ? 'PLAYING' : now?.state === 'paused' ? 'PAUSED' : 'IDLE')}`;
/** The PATCH calls that move speaker `devId` into zone `toId` (null = Unassigned). The server also takes it out of its old zone; the source is sent too so it never depends on that. */
export function movePlan(groups, devId, toId) {
  const ops = [], from = (groups || []).find(g => (g.deviceIds || []).includes(devId));
  if (toId != null && from && from.id === toId) return ops;
  if (toId != null) { const to = groups.find(g => g.id === toId); if (to) ops.push({ id: to.id, name: to.name, deviceIds: [...(to.deviceIds || []).filter(x => x !== devId), devId] }); }
  if (from) ops.push({ id: from.id, name: from.name, deviceIds: (from.deviceIds || []).filter(x => x !== devId) });
  return ops;
}
/** F269: apply a movePlan to the local inventory at once (optimistic move); the next /groups read replaces it with the server's answer. */
export function applyMovePlan(S, ops) {
  if (!S || !Array.isArray(S.groups) || !ops?.length) return;
  const by = new Map(ops.map(o => [o.id, o.deviceIds]));
  S.groups = S.groups.map(g => by.has(g.id) ? { ...g, deviceIds: [...by.get(g.id)] } : g);
  S._optAt = Date.now();
}
/** F269: the zone a dragged speaker is in RIGHT NOW (live inventory at pointerdown; never a value cached at render time). */
export function dragFromKey(groups, devId) {
  const from = (groups || []).find(g => (g.deviceIds || []).includes(devId));
  return { from, fromKey: from ? String(from.id) : 'none' };
}
/** Which accent class a zone box gets: the Controlling zone's box (solo) or the zone wrap inside a linked box. */
export const isControlling = (g, cur) => !!cur && cur.kind === 'zone' && cur.id === g.id;

// ---------------------------------------------------------------- the tree
/** kit = helpers from devices.js; st = { zone, spk, onZone(id), onSpk(id), busy() }. Returns the tree element (rebuilt on each draw). */
export const JB = 'jukebox';   // 0.4.9 F76: the Jukebox zone's id in the tree / settings pane
export function treeEl(S, ctl, kit, st) {
  const { capBar, onPill, ro, tagEls3, cardTags3, zoneTags3, zoneMembers, zoneMuted, zoneOn, zoneLevel, zoneCap, canControl, isAdmin, promptName, confirmRemoveZone, canTune, dotClass, orderedGroups, openCalibration, forget, phoneMaxBars = false } = kit;   // F250-P8 phoneMaxBars: max/scaleTo; desktop kit omits it → average
  const groups = orderedGroups(S.groups || []), model = treeModel(S.zones, groups), cur = Z.current(), can = canControl(S), admin = isAdmin(S);
  const done = () => { ctl.refreshAll?.(); window.dispatchEvent(new CustomEvent('wavwiz:zones-changed')); };
  const root = h('div', { class: 'tree42', 'data-tree': '1' });
  // 0.4.9 F69: a tap / click on a zone row opens the zone settings, on a speaker row the speaker settings (every Devices panel); both have a Back.
  const phone = typeof matchMedia === 'function' && matchMedia('(max-width:760px)').matches;
  // DIG idle collapse: hide .zsp42 on idle boxes; expand control + session preference
  const OPEN_KEY = 'wavwiz.qb42.open';
  const loadOpen = () => { try { return new Set(JSON.parse(sessionStorage.getItem(OPEN_KEY) || '[]')); } catch { return new Set(); } };
  const saveOpen = set => { try { sessionStorage.setItem(OPEN_KEY, JSON.stringify([...set])); } catch { /* private mode */ } };
  const openBoxes = loadOpen();
  const boxKey = box => String(box.leader?.id ?? box);
  const isOpen = (box, idle) => !idle || openBoxes.has(boxKey(box));
  const setOpen = (box, v) => { const k = boxKey(box); if (v) openBoxes.add(k); else openBoxes.delete(k); saveOpen(openBoxes); };
  // F266: every zone box (playing or idle) folds to one compact row; saved per zone in localStorage (replaces the idle "▸ n / ▾" speakers toggle)
  const folds = loadZoneFolds();
  const isFolded = box => folds.has(boxKey(box));
  const setFolded = (box, v) => { const k = boxKey(box); if (v) folds.add(k); else folds.delete(k); saveZoneFolds(folds); try { window.dispatchEvent(new CustomEvent('wavwiz:devredraw')); } catch { /* node */ } };
  const foldBtn = (box, folded, name) => h('button', { type: 'button', class: 'zfold42-t' + (folded ? '' : ' open'), 'data-act': 'zfold', 'aria-expanded': String(!folded),
    'aria-label': folded ? `Expand ${name}` : `Collapse ${name} to one row`, title: folded ? 'Expand this zone' : 'Collapse this zone to one row',
    onclick: ev => { ev.stopPropagation(); ev.preventDefault(); setFolded(box, !folded); } }, folded ? '▸' : '▾');
  // control a zone: make it the Controlling one and show Now Playing (phone: the remote; desktop: Now Playing in view / focused, else go there)
  const controlZone = id => { Z.select('g:' + id); const np = !phone && document.querySelector('.nowcol');
    if (np && np.offsetParent && np.getBoundingClientRect().width > 0) { np.scrollIntoView?.({ block: 'nearest' }); (np.querySelector('.tbtn.play, button') || np).focus?.({ preventScroll: true }); } else ctl.go?.('now'); };
  const zname = id => groups.find(g => g.id === id)?.name || '';
  const create = () => promptName('New zone', '', async v => { await createZone(v, []); done(); });
  // 0.4.3 #9: the counts are plain text inside the accent caps title, as in the render
  root.append(h('div', { class: 'pane-h dsec-h tree42-h' }, h('span', { class: 'tree42-n' }, ...countsText(model).split(/(\d+)/).map(x => /^\d+$/.test(x) ? h('span', { class: 'tree42-num' }, x) : x)), h('span', { class: 'grow' }),
    ro(h('button', { type: 'button', class: 'btn sm zadd-new', 'aria-label': 'New zone', title: 'New zone', onclick: create }, '+'), admin)));

  const move = async (z, toId) => {
    // F269: optimistic - the speaker lands in its new zone at once (S.groups updated locally, tree redrawn); the server answer then confirms, a failure re-reads.
    const q = swapQuestion(S, z, toId);   // 0.6.8-#15: asked from the state before the move
    const plan = movePlan(S.groups, z.id, toId);
    applyMovePlan(S, plan);
    try { window.dispatchEvent(new CustomEvent('wavwiz:devredraw')); } catch { /* node */ }
    try { for (const op of plan) await api(`/groups/${op.id}`, { method: 'PATCH', body: { name: op.name, deviceIds: op.deviceIds } }); const tg = toId == null ? null : groups.find(g => g.id === toId), live = tg && [...(tg.deviceIds || []).filter(x => x !== z.id).map(x => (S.zones || []).find(d => d.id === x)), z].some(d => d?.connected);   // F160: landing in a zone with no speaker online
      toast(toId == null ? `${z.name} is now unassigned` : tg && !live ? `Added to ${zname(toId)} — zone is offline until a speaker comes online.` : `${z.name} moved to ${zname(toId)}`); done(); offerSwap(q, toId, z, done); }
    catch (e) { toast(e.message, true); done(); }
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
    const live = (S.groups || []).find(x => x.id === g.id); if (!live) return []; g = live;   // F263: retained row, fresh inventory
    const ms = zoneMembers(S.zones, g), others = (S.groups || []).filter(o => o.id !== g.id && o.playbackId !== g.playbackId), muted = zoneMuted(S.zones, g);
    const act = { playpause: () => playPause(g), mute: () => { const m = !zoneMuted(S.zones, g); for (const z of zoneMembers(S.zones, g)) z.muted = m; ctl.act(`/groups/${g.id}/mute`, { muted: m }); }, control: () => Z.select('g:' + g.id), queue: () => openQueue(g), settings: () => st.onZone(g.id), movetop: () => moveZone(g, 'top'), moveup: () => moveZone(g, 'up'), movedown: () => moveZone(g, 'down'), movebottom: () => moveZone(g, 'bottom'), split: () => Z.splitOff(g, done), rename: () => rename(g), delete: () => confirmRemoveZone(S, g, done) };
    return zoneMenu42({ admin, can, playing: g.now?.state === 'playing', muted, controlling: isControlling(g, cur), order: orderOf(g), linked: (g.linked || []).length > 0, others: others.map(o => ({ id: o.id, name: o.name })) })
      .map(it => it.sep ? it : it.sub ? { ...it, sub: it.sub.map(s => ({ ...s, onclick: () => linkTo(g, s.zone) })) } : { ...it, onclick: act[it.id] });
  }, `${g.name} zone actions`);
  const linkTo = async (g, withId) => { try { await api(`/groups/${g.id}/link`, { method: 'POST', body: { with: withId } }); toast(`${g.name} now plays the same music as ${zname(withId)}`); done(); } catch (e) { toast(e.message, true); } };
  const speakerCtx = (z, el, inZone) => attachCtx(el, () => {
    const live = (S.zones || []).find(x => x.id === z.id); if (!live) return []; z = live;   // F263: current speaker, not old poll objects
    const act = { mute: () => { const cur = (S.zones || []).find(x => x.id === z.id) || z; const next = !cur.muted; cur.muted = next; z.muted = next; ctl.act(`/zones/${z.id}`, { muted: next }, 'PATCH'); }, settings: () => speakerSettings(z), calibrate: () => openCalibration(S, ctl.refreshAll, z.id, { quick: true }),
      rename: () => promptName(`Rename ${z.name}`, z.name, async v => { await api(`/zones/${z.id}`, { method: 'PATCH', body: { name: v } }); ctl.refreshAll?.(); }), off: () => ctl.act(`/zones/${z.id}`, { enabled: !z.enabled }, 'PATCH') };
    if (!inZone) return unassignedMenu42({ admin, zones: (S.groups || []).map(g => ({ id: g.id, name: g.name })) }).map(it => it.sub ? { ...it, sub: it.sub.map(s => ({ ...s, onclick: () => move(z, s.zone) })) } : { ...it, onclick: act[it.id] });
    const mine = (S.groups || []).find(g => (g.deviceIds || []).includes(z.id));
    return speakerMenu42({ admin, can, muted: !!z.muted, on: !!z.enabled, canCalibrate: canTune(S, z) && z.connected, zones: (S.groups || []).filter(g => g.id !== mine?.id).map(g => ({ id: g.id, name: g.name })) })
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
      // tags on their own line under the name (sp42-nt stacks them; 0.4.3 #9 had them inline)
      h('span', { class: 'sp42-v small', title: 'Volume' }, `${Math.round(z.volume)}%`),
      // 0.4.4 F25: per-speaker mute / unmute, right of the % (amber while muted)
      ro((() => { const mb = h('button', { type: 'button', class: 'mutebtn sp42-mute' + (z.muted ? ' on' : ''), 'aria-pressed': String(!!z.muted), 'aria-label': (z.muted ? 'Unmute ' : 'Mute ') + z.name, title: z.muted ? 'Unmute' : 'Mute', 'data-icon': z.muted ? 'mute' : 'volume',
        onclick: ev => { ev.stopPropagation(); const cur = (S.zones || []).find(x => x.id === z.id) || z; const next = !cur.muted; cur.muted = next; z.muted = next; ctl.act(`/zones/${z.id}`, { muted: next }, 'PATCH');
          mb.classList.toggle('on', next); mb.setAttribute('aria-pressed', String(next)); mb.setAttribute('aria-label', (next ? 'Unmute ' : 'Mute ') + z.name); mb.title = next ? 'Unmute' : 'Mute'; setIcon(mb, next ? 'mute' : 'volume'); mb.dataset.icon = next ? 'mute' : 'volume'; } }, icon(z.muted ? 'mute' : 'volume')); return mb; })(), canControl(S), 'Your access is view-only.'));
    speakerCtx(z, row, gid != null);
    return row;
  };
  // ---- a zone card + its speakers
  const zoneWrap = (g, box, leaderOf) => {
    const ms = zoneMembers(S.zones, g), sel = isControlling(g, cur), linked = (g.linked || []).length > 0, on = zoneOn(S.zones, g), connected = ms.filter(z => z.connected).length;
    const name = h('button', { type: 'button', class: 'dname zname ell', title: `${g.name} - open the zone settings`, onclick: () => st.onZone(g.id) }, g.name);
    const pill = onPill(`Zone ${g.name}`, on, can, () => { const live = (S.groups || []).find(x => x.id === g.id); if (!live || !canControl(S)) return; const want = !zoneOn(S.zones, live); for (const z of zoneMembers(S.zones, live)) { z.enabled = want; ctl.act(`/zones/${z.id}`, { enabled: want }, 'PATCH'); } pill._set(want); });
    // 0.4.3 #9: an empty zone has nothing to link (as in the render)
    const lb = (S.groups || []).length < 2 || (!ms.length && !linked) ? null : ro(linked
      ? h('button', { type: 'button', class: 'btn sm zlinkbtn split', 'data-act': 'split', title: 'Give this zone its own music', onclick: ev => { ev.stopPropagation(); Z.splitOff(g, done); } }, 'Split off')
      : h('button', { type: 'button', class: 'btn sm zlinkbtn link zlinkic', 'data-act': 'link', 'aria-label': `Link ${g.name} to another zone`, title: 'Link: play the same music as another zone', onclick: ev => { ev.stopPropagation(); Z.linkMenu(ev.currentTarget, S, g, done); } }, icon('link')), can, 'Your access is view-only.');   // 0.6.8-#12: chain-link icon beside OFF/ON
    // 0.4.3 #9 (render final042l): grip-style gutter (zone actions) | dot, name, inline speaker-count badge ... OFF/ON
    //                              | CONTROLLING / "Queue from X" / other tags ... Link or Split off
    const all3 = zoneTags3(S.zones, g), cnt = all3.find(t => t.k === 'count'), tags = all3.filter(t => t.k !== 'count');
    const badge = h('span', { class: 'zcount42', title: cnt?.title || '', 'aria-label': `${ms.length} speaker${ms.length === 1 ? '' : 's'}` }, icon('volume'), String(ms.length));
    const gut = h('button', { type: 'button', class: 'zgut42', 'aria-label': `${g.name} zone actions`, title: 'Zone actions',
      onclick: ev => { ev.stopPropagation(); const r = ev.currentTarget.getBoundingClientRect(); ev.currentTarget.closest('.zwrap42').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.right, clientY: r.top + 8 })); } }, '⋮');
    // 0.4.9 F69: the zone NAME ROW (name, count, OFF/ON, tags) opens the zone settings; its own controls keep their behavior
    const card = h('div', { class: 'zcard42' + (on ? '' : ' off'), 'data-group-id': g.id, onclick: ev => { ev.stopPropagation(); if (ev.target.closest('button,input,select,a[href],[role="slider"],[role="switch"],.tagact,.dgrip,.dgrip42,.pill42,.tog')) return; st.onZone(g.id); } }, gut,
      h('div', { class: 'zc42-body' },
        h('div', { class: 'zc42-1' }, h('span', { class: 'dot ' + (connected ? 'ok' : 'off'), title: `${connected} of ${ms.length} online` }), name, badge, h('span', { class: 'zacts' }, linked ? null : lb, pill)),
        h('div', { class: 'dtagrow ztagrow zc42-2' }, sel ? Z.controllingTag() : null, S.cast?.active && (S.cast.zones || []).includes(g.id) ? h('span', { class: 'dtag zcast', title: `Playing what a phone sends to ${S.cast.name}` }, S.cast.kind === 'spotify' ? 'SPOTIFY' : 'AIRPLAY') : null, leaderOf ? h('span', { class: 'small dim zc42-q' }, `Queue from ${leaderOf.name}`) : null, tagEls3(tags), lb && linked ? h('span', { class: 'zacts zc42-lb' }, lb) : null)));
    const list = h('div', { class: 'zsp42', role: 'list', 'aria-label': `Speakers in ${g.name}` }, ms.length ? ms.map(z => spRow(z, g.id)) : h('div', { class: 'drop42' }, 'Drop speakers here'));
    if (box && box._collapsed) { list.hidden = true; list.classList.add('zsp42-collapsed'); }
    // 0.6.8-#15: quiet note after the zone's reference speaker left (the server picked a new one and re-based the delays)
    const note = g.refNote ? h('div', { class: 'zrefnote42', role: 'status' }, h('span', { class: 'grow' }, g.refNote), h('button', { type: 'button', class: 'zrefnote-x', 'aria-label': 'Dismiss', title: 'Dismiss', onclick: ev => { ev.stopPropagation(); dismissNote(g, done); } }, '✕')) : null;
    const wrap = h('div', { class: 'zwrap42' + (sel ? ' ctl' : '') + (st.zone === g.id ? ' picked' : ''), 'data-group-id': g.id, 'data-drop': g.id, 'data-playback-id': g.playbackId || 'default', 'data-zone': g.name }, card, note, list);
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
    // F250-P8: phone Devices uses max-based groupLevel + proportional member PATCH (NP/mixer contract).
    // Wide desktop keeps average display + /groups/{id}/volume (ZoneVolume.Shift) untouched.
    // F250-P8 + amend: phone max path; resolve CURRENT S.groups by id (not construction-time box.zones).
    const gids = all.map(g => g.id);
    const liveGroups = () => gids.map(id => (S.groups || []).find(x => x.id === id)).filter(Boolean);
    const livePhoneMs = () => uniqueMembers(liveGroups().flatMap(g => zoneMembers(S.zones, g)).filter(z => z.enabled !== false));
    const phoneMs = phoneMaxBars ? livePhoneMs() : ms;
    const lvl = phoneMaxBars ? phoneZoneLevel(phoneMs) : (ms.length ? Math.round(ms.reduce((a, z) => a + z.volume, 0) / ms.length) : 0);
    const muted = phoneMs.length > 0 && phoneMs.every(z => z.muted);
    const phoneKey = () => JSON.stringify([gids, livePhoneMs().map(z => [z.id, z.volCap ?? 100, z.enabled])]);
    const phoneWriter = phoneMaxBars ? phoneZoneVolWriter({
      act: (z, body) => ctl.act(`/zones/${z.id}`, body, 'PATCH'),
      can: () => canControl(S),
      keyOf: phoneKey,
    }) : null;
    // P8-R1: phone max bars must NOT use average zoneCap clamp; NP/scaleTo apply per-member caps.
    const phoneCap = phoneMaxBars ? null : (linked ? null : zoneCap(S.zones, lead));
    let gestureKey = null;
    const bar = capBar(linked ? 'Shared volume' : `${lead.name} zone volume`, lvl, phoneCap, can,
      phoneMaxBars
        ? v => {
            if (!bar.vol.isConnected) return;   // P8-R2: detached after hide/redraw
            if (gestureKey != null && gestureKey !== phoneKey()) { cancelPhone(); return; }   // P8-R3: membership replaced
            phoneWriter.apply(livePhoneMs(), v);
          }
        : v => { for (const g of all) ctl.act(`/groups/${g.id}/volume`, { set: v }); },
      linked ? 'Moves every linked zone together' : 'Moves every speaker in this zone together (keeps their balance)');
    const cancelPhone = () => { bar.cancelSend?.(); phoneWriter?.cancel(); gestureKey = null; };
    if (phoneWriter) {
      bar.vol._p8cancel = cancelPhone;
      bar.vol.addEventListener('pointerdown', () => { gestureKey = phoneKey(); phoneWriter.resetBase(); });
      bar.vol.addEventListener('pointerup', () => { phoneWriter.resetBase(); gestureKey = null; });
      bar.vol.addEventListener('pointercancel', () => cancelPhone());
      bar.vol.addEventListener('change', () => { phoneWriter.resetBase(); gestureKey = null; });
    }
    const mute = ro(h('button', { type: 'button', class: 'mutebtn zmute' + (muted ? ' on' : ''), 'aria-pressed': String(muted), 'aria-label': (muted ? 'Unmute ' : 'Mute ') + (linked ? 'the linked zones' : `zone ${lead.name}`), title: muted ? 'Unmute' : 'Mute', 'data-icon': muted ? 'mute' : 'volume',
      onclick: ev => { ev.stopPropagation(); const cur = all.flatMap(g => zoneMembers(S.zones, g)), m = !(cur.length > 0 && cur.every(z => z.muted)); for (const z of cur) z.muted = m; for (const g of all) ctl.act(`/groups/${g.id}/mute`, { muted: m }); mute.classList.toggle('on', m); mute.setAttribute('aria-pressed', String(m)); mute.setAttribute('aria-label', (m ? 'Unmute ' : 'Mute ') + (linked ? 'the linked zones' : `zone ${lead.name}`)); mute.title = m ? 'Unmute' : 'Mute'; setIcon(mute, m ? 'mute' : 'volume'); } }, icon(muted ? 'mute' : 'volume')), can, 'Your access is view-only.');
    const selectLead = () => controlZone(lead.id);
    const collapsed = false; box._collapsed = false;   // F266: speakers always listed while the box is open (old idle auto-fold removed)
    if (isFolded(box)) return foldedBox(box, { lead, linked, sel, ms, now });
    const expand = foldBtn(box, false, linked ? 'the linked zones' : lead.name);
    const el = h('section', { class: 'qb42' + (linked ? ' linked' : ' solo') + (sel && !linked ? ' ctl' : '') + (idle ? ' idle' : '') + (collapsed ? ' qb42-folded' : ''), 'data-box': linked ? 'linked' : 'solo', 'data-leader-id': lead.id, 'aria-label': boxTitle(box, now) },
      h('div', { class: 'qb42-head' }, h('div', { class: 'qb42-trow' }, expand, title), Z.nowLine(now, { at: S._groupsAt || Date.now(), onSelect: selectLead, selected: sel }), h('div', { class: 'dvol qb42-vol' }, bar.wrap, bar.pct, mute)),
      ...all.map(g => zoneWrap(g, box, linked && g.id !== lead.id ? lead : null)));
    el.addEventListener('click', ev => { if (ev.defaultPrevented || ev.target.closest(BOXSKIP)) return; controlZone(lead.id); });
    return el;
  };
  // F266: a folded zone box = the empty-zone look: [▸] name, green dot when a speaker is on and online, what it is doing.
  const foldedBox = (box, { lead, linked, sel, ms, now }) => {
    const active = ms.filter(z => z.enabled !== false && z.connected), playing = now?.state === 'playing';
    const dot = h('span', { class: 'dot zfold42-dot ' + (active.length ? 'ok' : 'off'), title: active.length ? `${active.length} of ${ms.length} speaker${ms.length === 1 ? '' : 's'} active` : 'No active speaker', 'aria-label': active.length ? 'Active' : 'Not active', role: 'img' });
    const name = linked ? box.zones.map(g => g.name).join(' + ') : lead.name;
    // 0.6.8 t1651: the now-playing line sits under the zone name (same .zl-now chrome as an expanded card). Idle / no title = one row, matching the AirPlay card.
    const line = now?.title ? Z.nowLine(now, { at: S._groupsAt || Date.now(), onSelect: () => controlZone(lead.id), selected: sel }) : null;
    return h('section', { class: 'qb42 empty42 zfold42' + (linked ? ' linked' : ' solo') + (sel && !linked ? ' ctl' : '') + (sel && linked ? ' ctlz' : '') + (playing ? '' : ' idle'), 'data-box': linked ? 'linked' : 'solo', 'data-leader-id': lead.id, 'aria-label': `${name} (collapsed)` },
      h('div', { class: 'zwrap42 zempty42' + (st.zone === lead.id ? ' picked' : ''), 'data-group-id': lead.id, 'data-drop': lead.id, 'data-zone': lead.name },
        h('div', { class: 'ze42-row' }, foldBtn(box, true, name), dot, h('button', { type: 'button', class: 'dname zname ell', title: `${name} - open the zone`, onclick: () => st.onZone(lead.id) }, name)),
        line,
        h('div', { class: 'drop42 ze42-drop' }, 'Drop speakers here')));
  };
  // 0.4.9 F69: a zone with no speakers is one compact row (name, "No speakers" / "Offline") - still a drop target (its hint opens while dragging)
  // 0.5.2 F160: an OFFLINE zone (speakers, none online) keeps the compact Offline header but lists its real speakers as dimmed .gone rows (Move / Remove still work)
  const emptyBox = (g, off = false, box = null) => {
    const sel = isControlling(g, cur), gone = off ? (box ? box.zones : [g]).flatMap(zg => zoneMembers(S.zones, zg).map(z => spRow(z, zg.id))) : [];
    const wrap = h('section', { class: 'qb42 empty42' + (off ? ' solo off42' : '') + (sel ? ' ctl' : ''), 'data-leader-id': g.id, 'aria-label': `${g.name} (${off ? 'offline' : 'no speakers'})` },
      h('div', { class: 'zwrap42 zempty42' + (st.zone === g.id ? ' picked' : ''), 'data-group-id': g.id, 'data-drop': g.id, 'data-zone': g.name },
        h('div', { class: 'ze42-row' }, h('button', { type: 'button', class: 'dname zname ell', title: `${g.name} - open the zone`, onclick: () => st.onZone(g.id) }, g.name),
          h('span', { class: 'small dim ze42-note' }, off ? 'Offline' : 'No speakers'), h('span', { class: 'grow' })),
        gone.length ? h('div', { class: 'zsp42 ze42-gone', role: 'list', 'aria-label': `Speakers in ${g.name} (offline)` }, ...gone) : null,
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
    if (jbRank === 2) {   // F205: only an EMPTY Jukebox is the compact row; offline-with-speakers uses the full card below
      const wrap = h('section', { class: 'qb42 empty42 jb42' + (jbRank === 1 ? ' solo off42' : '') + (sel ? ' ctl' : ''), 'data-leader-id': JB, 'data-group-id': JB, 'aria-label': `Jukebox (${jbRank === 1 ? 'offline' : 'no speakers'})` },
        h('div', { class: 'zwrap42 zempty42' + (st.zone === JB ? ' picked' : ''), 'data-group-id': JB, 'data-zone': 'Jukebox' },
          h('div', { class: 'ze42-row', onclick: open }, nameBtn, h('span', { class: 'small dim ze42-note' }, jbRank === 1 ? 'Offline' : 'No speakers'), h('span', { class: 'grow' }),
            ro(h('button', { type: 'button', class: 'btn sm jb42-set', 'data-act': 'jb-settings', title: 'Jukebox zone settings', 'aria-label': 'Jukebox zone settings', onclick: ev => { ev.stopPropagation(); open(); } }, 'Settings'), admin, 'Only an administrator can pick the Jukebox speakers.')),
          jbRank === 1 ? h('div', { class: 'zsp42 ze42-gone', role: 'list', 'aria-label': 'Speakers in the Jukebox (offline)' }, ...jbMs.map(z => spRow(z, JB))) : null));   // F160
      return wrap;
    }
    const now = jb.own && jb.now && jb.now.state !== 'stopped' ? jb.now : null, pick = ev => { ev?.stopPropagation?.(); Z.select(Z.JUKEBOX_KEY); const np = !phone && document.querySelector('.nowcol'); if (!(np && np.offsetParent)) ctl.go?.('now'); };
    // F250-P8: phone Jukebox volume uses max + member PATCH (backend /jukebox/zone/volume is average Shift — not the phone contract).
    // P8-amend: always read current S.jb.deviceIds (API refresh replaces the object)
    const jbIdsLive = () => S.jb?.deviceIds || [];
    const jbPhone = phoneMaxBars ? phoneZoneMembers(S.zones, jbIdsLive()) : jbMs;
    const lvl = phoneMaxBars ? phoneZoneLevel(jbPhone) : Math.round(jbMs.reduce((a, z) => a + z.volume, 0) / (jbMs.length || 1) || 0);
    const muted = (phoneMaxBars ? jbPhone : jbMs).length > 0 && (phoneMaxBars ? jbPhone : jbMs).every(z => z.muted), on = jbMs.some(z => z.enabled);
    const jbKey = () => { const live = phoneZoneMembers(S.zones, jbIdsLive()); return JSON.stringify(['jukebox', live.map(z => [z.id, z.volCap ?? 100, z.enabled])]); };
    const jbWriter = phoneMaxBars ? phoneZoneVolWriter({
      act: (z, body) => ctl.act(`/zones/${z.id}`, body, 'PATCH'),
      can: () => canControl(S),
      keyOf: jbKey,
    }) : null;
    let jbGesture = null;
    const bar = capBar('Jukebox zone volume', lvl, null, can,
      phoneMaxBars
        ? v => {
            if (!bar.vol.isConnected) return;
            if (jbGesture != null && jbGesture !== jbKey()) { cancelJb(); return; }
            jbWriter.apply(phoneZoneMembers(S.zones, jbIdsLive()), v);
          }
        : v => api('/jukebox/zone/volume', { method: 'POST', body: { set: v } }).catch(e => toast(e.message, true)),
      'Moves every speaker of the Jukebox zone together');
    const cancelJb = () => { bar.cancelSend?.(); jbWriter?.cancel(); jbGesture = null; };
    if (jbWriter) {
      bar.vol._p8cancel = cancelJb;
      bar.vol.addEventListener('pointerdown', () => { jbGesture = jbKey(); jbWriter.resetBase(); });
      bar.vol.addEventListener('pointerup', () => { jbWriter.resetBase(); jbGesture = null; });
      bar.vol.addEventListener('pointercancel', () => cancelJb());
      bar.vol.addEventListener('change', () => { jbWriter.resetBase(); jbGesture = null; });
    }
    const mute = ro(h('button', { type: 'button', class: 'mutebtn zmute' + (muted ? ' on' : ''), 'aria-pressed': String(muted), 'aria-label': (muted ? 'Unmute' : 'Mute') + ' the Jukebox zone', title: muted ? 'Unmute' : 'Mute', 'data-icon': muted ? 'mute' : 'volume',
      onclick: ev => { ev.stopPropagation(); const cur = (S.zones || []).filter(z => jbIds.has(z.id)), m = !(cur.length > 0 && cur.every(z => z.muted)); for (const z of cur) z.muted = m; api('/jukebox/zone/mute', { method: 'POST', body: { muted: m } }).then(() => ctl.refreshAll?.()).catch(e => toast(e.message, true)); mute.classList.toggle('on', m); mute.setAttribute('aria-pressed', String(m)); mute.setAttribute('aria-label', (m ? 'Unmute' : 'Mute') + ' the Jukebox zone'); mute.title = m ? 'Unmute' : 'Mute'; setIcon(mute, m ? 'mute' : 'volume'); } }, icon(muted ? 'mute' : 'volume')), can, 'Your access is view-only.');
    const pill = onPill('Jukebox zone', on, can, () => { const want = !jbMs.some(z => z.enabled); for (const z of jbMs) { z.enabled = want; ctl.act(`/zones/${z.id}`, { enabled: want }, 'PATCH'); } pill._set(want); });
    const title = h('div', { class: 'qb42-t qb42-pick', role: 'button', tabindex: 0, title: 'Control the Jukebox', 'aria-label': 'Control the Jukebox', 'aria-pressed': String(sel), onclick: pick, onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(ev); } } },
      h('b', { class: 'qb42-name' }, 'Queue: Jukebox'), h('span', { class: 'qb42-st dim' }, jbRank === 1 ? ' · OFFLINE' : now?.state === 'playing' ? ' · PLAYING' : ' · IDLE'));
    const card = h('div', { class: 'zcard42' + (on ? '' : ' off'), 'data-group-id': JB, onclick: ev => { ev.stopPropagation(); if (ev.target.closest('button,input,select,a[href],[role="slider"],[role="switch"],.pill42,.tog')) return; open(); } },
      h('span', { class: 'zgut42', 'aria-hidden': 'true' }, ''),
      h('div', { class: 'zc42-body' },
        h('div', { class: 'zc42-1' }, h('span', { class: 'dot ' + (jbRank === 1 ? 'off' : 'ok'), title: `${jbMs.filter(z => z.connected).length} of ${jbMs.length} online` }), nameBtn, h('span', { class: 'zcount42', 'aria-label': `${jbMs.length} speakers` }, icon('volume'), String(jbMs.length)), h('span', { class: 'zacts' }, pill)),
        h('div', { class: 'dtagrow ztagrow zc42-2' }, sel ? Z.controllingTag() : null, h('span', { class: 'dtag zjb', title: 'Guests choose the songs; they play only on these speakers' }, 'JUKEBOX'))));
    const jbIdle = !now, jbBoxObj = { leader: { id: JB } };
    if (!jbIdle) openBoxes.delete(boxKey(jbBoxObj));
    const jbCollapsed = jbIdle && !isOpen(jbBoxObj, jbIdle);
    const jbList = h('div', { class: 'zsp42', role: 'list', 'aria-label': 'Speakers in the Jukebox' }, jbMs.map(z => spRow(z, JB)));
    if (jbCollapsed) { jbList.hidden = true; jbList.classList.add('zsp42-collapsed'); }
    const jbExpand = jbIdle ? h('button', { type: 'button', class: 'qb42-exp' + (jbCollapsed ? '' : ' open'), 'aria-expanded': String(!jbCollapsed), 'aria-label': jbCollapsed ? `Show ${jbMs.length} speakers` : 'Hide speakers', title: jbCollapsed ? `Show speakers (${jbMs.length})` : 'Hide speakers',
      onclick: ev => { ev.stopPropagation(); setOpen(jbBoxObj, jbCollapsed); window.dispatchEvent(new CustomEvent('wavwiz:devredraw')); } }, jbCollapsed ? `▸ ${jbMs.length}` : '▾') : null;
    const wrap = h('div', { class: 'zwrap42' + (sel ? ' ctl' : '') + (st.zone === JB ? ' picked' : ''), 'data-group-id': JB, 'data-zone': 'Jukebox', 'data-playback-id': jb.zoneId || 'jukebox' }, card, jbList);
    const el = h('section', { class: 'qb42 solo jb42' + (sel ? ' ctl' : '') + (jbIdle ? ' idle' : '') + (jbCollapsed ? ' qb42-folded' : ''), 'data-box': 'solo', 'data-leader-id': JB, 'aria-label': 'Jukebox' },
      h('div', { class: 'qb42-head' }, title, Z.nowLine(now, { at: S._groupsAt || Date.now(), onSelect: pick, selected: sel }), jbExpand, h('div', { class: 'dvol qb42-vol' }, bar.wrap, bar.pct, mute)), wrap);
    el.addEventListener('click', ev => { if (ev.defaultPrevented || ev.target.closest(BOXSKIP)) return; pick(ev); });
    return el;
  };
  const boxEls = model.boxes.map(b => [rank(b), rank(b) === 2 ? emptyBox(b.leader, false, b) : queueBox(b)]);   // F205: offline-with-speakers (rank 1) = full queueBox chrome; compact row only for 0 speakers
  if (jbRank >= 0) { const r = jbRank, at = boxEls.findIndex(x => x[0] > r); boxEls.splice(at < 0 ? boxEls.length : at, 0, [r, jbBox()]); }
  root.append(...boxEls.map(x => x[1]));
  if (!model.boxes.length) root.append(h('p', { class: 'dim small pad' }, 'Zones hold speakers, like “Downstairs”. An administrator can create one with +.'));
  const addMenu = (z, btn) => { const r = btn.getBoundingClientRect(); openCtx(r.left, r.bottom + 2, groups.length ? groups.map(g => ({ id: 'move:' + g.id, label: g.name, onclick: () => move(z, g.id) })) : [{ id: 'none', label: 'Create a zone first', disabled: true }], { label: `Add ${z.name} to a zone`, from: btn }); };
  const unBox = h('section', { class: 'un42' + (un.length ? '' : ' empty'), 'data-drop': 'none', 'aria-label': 'Unassigned speakers' },
    h('div', { class: 'un42-h' }, h('b', null, 'UNASSIGNED'), h('span', { class: 'un42-n' }, ` ${un.length} `), h('span', { class: 'small dim' }, 'Not in any zone, so silent')),
    h('div', { role: 'list' }, un.length ? un.map(z => {
      const row = h('div', { class: 'sp42 un' + (st.spk === z.id ? ' sel' : '') + (z.connected ? '' : ' gone'), 'data-device-id': z.id, 'data-device': z.name, 'data-zone-id': z.id, 'data-in-zone': '', role: 'listitem' },
        ro(h('span', { class: 'dgrip42', role: 'img', 'aria-label': `Drag ${z.name} into a zone`, title: 'Drag into a zone', 'data-drag-device': z.id }, '⋮'), admin, 'Only an administrator can change zones.'),
        // 0.6.8 zone fix: the same name + tag line (ANALOG, NO DELAY, REF...) as a speaker in a zone, tags on the second line under the name
        h('span', { class: 'dot ' + dotClass(z) }), h('span', { class: 'sp42-nt' }, h('button', { type: 'button', class: 'dname sp42-n ell', title: `${z.name} - open its settings`, onclick: () => st.onSpk(z.id) }, z.name),
          h('span', { class: 'dtagrow sp42-tags' }, tagEls3(cardTags3(z)))),
        ro(h('button', { type: 'button', class: 'btn sm saddzone', onclick: ev => { ev.stopPropagation(); addMenu(z, ev.currentTarget); } }, 'Add to zone'), admin, 'Only an administrator can change zones.'));
      speakerCtx(z, row, false); return row;
    }) : h('div', { class: 'drop42' }, 'Drop speakers here to unassign them')));
  root.append(unBox);
  // 0.6.8: AirPlay speakers card sits under Unassigned (the card itself expands / collapses; no header button)
  if (admin) { const apc = airPlaySetupCard(S, ctl); if (apc) root.append(apc); }
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
    let offs = [], from = null, fromKey = 'none';
    const onStart = () => {
      ({ from, fromKey } = dragFromKey(S.groups, id));   // F269: read when the drag starts (after any optimistic / polled move), not at render
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
  // F250-P8: phone zone settings sheet agrees with tree/NP max contract; desktop zonePane stays average.
  const phoneMax = !!kit.phoneMaxBars;
  const gid = g.id;
  const paneIds = () => (S.groups || []).find(x => x.id === gid)?.deviceIds || [];
  const paneMs = phoneMax ? phoneZoneMembers(S.zones, paneIds()) : ms;
  const muted = phoneMax ? (paneMs.length > 0 && paneMs.every(z => z.muted)) : zoneMuted(S.zones, g);
  const paneKey = () => { const live = phoneZoneMembers(S.zones, paneIds()); return JSON.stringify([gid, live.map(z => [z.id, z.volCap ?? 100, z.enabled])]); };
  const paneWriter = phoneMax ? phoneZoneVolWriter({
    act: (z, body) => ctl.act(`/zones/${z.id}`, body, 'PATCH'),
    can: () => canControl(S),
    keyOf: paneKey,
  }) : null;
  let paneGesture = null;
  // P8-R1: no average zoneCap on phone max pane
  const bar = capBar(`${g.name} zone volume`, phoneMax ? phoneZoneLevel(paneMs) : zoneLevel(S.zones, g), phoneMax ? null : zoneCap(S.zones, g), can,
    phoneMax
      ? v => {
          if (!bar.vol.isConnected) return;
          if (paneGesture != null && paneGesture !== paneKey()) { cancelPane(); return; }
          paneWriter.apply(phoneZoneMembers(S.zones, paneIds()), v);
        }
      : v => ctl.act(`/groups/${g.id}/volume`, { set: v }));
  const cancelPane = () => { bar.cancelSend?.(); paneWriter?.cancel(); paneGesture = null; };
  if (paneWriter) {
    bar.vol._p8cancel = cancelPane;
    bar.vol.addEventListener('pointerdown', () => { paneGesture = paneKey(); paneWriter.resetBase(); });
    bar.vol.addEventListener('pointerup', () => { paneWriter.resetBase(); paneGesture = null; });
    bar.vol.addEventListener('pointercancel', () => cancelPane());
    bar.vol.addEventListener('change', () => { paneWriter.resetBase(); paneGesture = null; });
  }
  const mute = ro(h('button', { type: 'button', class: 'mutebtn zmute' + (muted ? ' on' : ''), 'aria-pressed': String(muted), 'aria-label': (muted ? 'Unmute zone ' : 'Mute zone ') + g.name, 'data-icon': muted ? 'mute' : 'volume', onclick: () => { const m = !zoneMuted(S.zones, g); for (const z of zoneMembers(S.zones, g)) z.muted = m; ctl.act(`/groups/${g.id}/mute`, { muted: m }); mute.classList.toggle('on', m); mute.setAttribute('aria-pressed', String(m)); mute.setAttribute('aria-label', (m ? 'Unmute zone ' : 'Mute zone ') + g.name); setIcon(mute, m ? 'mute' : 'volume'); } }, icon(muted ? 'mute' : 'volume')), can, 'Your access is view-only.');
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
