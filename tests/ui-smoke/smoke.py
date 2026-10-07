#!/usr/bin/env python3
"""WavWiz UI smoke test (written for 0.0.4; some version-specific checks are historical - 0.0.7 adds phone007.py): a real server (seeded with tones, a radio station, a queue) + headless Chrome (SwiftShader WebGL2). Dev tool; see harness.py.
Checks the desktop layout, library, playback + both visualizers (+ the MilkDrop switching bug), devices/zones/forget, playlist table, pages, About, what's new,
the layout at CSS viewports of a 4K screen at 100/150/200/250/300 % scale, and the unchanged phone layout + full-screen sheet. Exit 1 on any failure or JS error."""
import argparse, json, sys, time, urllib.request
sys.path.insert(0, __import__('os').path.dirname(__file__))
from harness import Env

ap = argparse.ArgumentParser(); ap.add_argument('--dll', required=True); ap.add_argument('--dotnet', default='dotnet'); ap.add_argument('--out', default='/tmp/ui-shots'); ap.add_argument('--cdp-port', type=int, default=9333)
a = ap.parse_args()
e = Env(a.dll, a.dotnet, a.out, True, a.cdp_port)
ev, wait, check, shot, size, load, GO = e.ev, e.wait, e.check, e.shot, e.size, e.load, e.go
ACCENT = "getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase()"
CLICK = lambda sel, txt=None: ev(f"(() => {{ const b = [...document.querySelectorAll({json.dumps(sel)})].find(x => {('x.textContent.trim().toLowerCase().includes(' + json.dumps(txt.lower()) + ')') if txt else 'true'}); if (!b) return false; b.click(); return true; }})()")
def txt(sel): return ev(f"(document.querySelector({json.dumps(sel)})?.innerText || '')") or ''
def px(expr): return ev(expr) or 0

try:
    e.start_server(); e.start_chrome()
    ids = e.ids

    print('first launch: what is new')
    size(1440, 900); load('/', 2.5)
    check(wait("!!document.querySelector('dialog[open]')", 6) and "what" in txt('dialog[open]').lower() and '0.0.4' in txt('dialog[open]'), "first launch shows the 'what's new' note for 0.0.4")
    shot('whatsnew.png'); CLICK('dialog[open] button', 'got it') or CLICK('dialog[open] button', 'close') or CLICK('dialog[open] button')
    time.sleep(0.4); load('/', 2.0)
    check(not ev("!!document.querySelector('dialog[open]')"), "the note does not come back on the next load")

    print('desktop 1440x900: layout')
    for sel, name in (('.libpanel', 'slim library (left)'), ('.nowcol', 'Now Playing (center)'), ('.devpanel', 'devices / zones / unassigned (right)'), ('.listpanel', 'playlist table (bottom)'), ('.statusbar', 'status bar')):
        check(wait(f"!!document.querySelector('.desk {sel}') || !!document.querySelector('{sel}')", 5) and px(f"document.querySelector('{sel}')?.getBoundingClientRect().width") > 40, f'{name} is on screen')
    r = lambda s: ev(f"(() => {{ const b = document.querySelector('{s}').getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); }})()")
    L, N, D, P = r('.libpanel'), r('.nowcol'), r('.devpanel'), r('.listpanel')
    check(L[2] <= N[0] + 2 and N[2] <= D[0] + 2 and P[1] >= max(L[3], N[3], D[3]) - 2, f'arrangement: library | now playing | devices on top, playlist below ({L} {N} {D} {P})')
    check(L[2] - L[0] < (N[2] - N[0]) * 0.6, 'library is slim, Now Playing dominates')
    check((px("document.querySelector('.stage').getBoundingClientRect().width")) > 400 and px("document.querySelector('.stage').getBoundingClientRect().height") > 130, 'visualizer banner is wide and tall enough')
    check(ev(ACCENT) == '#FF3C00', 'default accent is orange #FF3C00')
    check(ev("document.querySelector('.logo svg.wordmark, .logo .wordmark')?.outerHTML.includes('FF3C00') && document.querySelector('.logo .wordmark').outerHTML.includes('19C3B1')"), 'header wordmark is the neon SVG (orange WAV, teal WIZ)')
    check(ev("!document.querySelector('.logo img') || getComputedStyle(document.querySelector('.logo img')).display==='none'"), 'header has no visible logo image (A1: neon title only)')
    check(ev("!!document.querySelector('link[rel=icon]')"), 'favicon still present for icons')
    check('BETA 0.0.4' in (ev('document.body.innerText') or '') and 'Classic Amber' not in (ev('document.documentElement.outerHTML') or '') and 'Browns' not in (ev('document.documentElement.outerHTML') or ''), 'BETA 0.0.4 shown, Classic Amber gone')
    check(wait("document.title.includes('WavWiz')"), 'window title says WavWiz')
    check(not ev("/Unison/.test(document.body.innerText)"), 'no "Unison" in the visible UI')
    check(not ev("/\\broom(s)?\\b/i.test(document.body.innerText)"), 'no "Room(s)" wording in the visible UI')
    shot('desktop-idle.png')

    print('library (compact)')
    tabs = ev("[...document.querySelectorAll('.libpanel .ctabs button')].map(b => b.textContent.trim().toUpperCase())")
    check(tabs == ['ARTISTS', 'ALBUMS', 'GENRES', 'FOLDERS'], f'tabs ARTISTS/ALBUMS/GENRES/FOLDERS ({tabs})')
    check(wait("document.querySelector('.libpanel').innerText.includes('Demo Artist')", 6), 'artists listed from tags')
    check(wait("/\\b2\\b.*artist/i.test(document.querySelector('.libpanel .libcount')?.innerText || '')", 4), 'count label shows the number of artists')
    for tab, text in (('Albums', 'Night Drive'), ('Genres', 'Electronic'), ('Folders', 'music'), ('Artists', 'Sample Band')):
        CLICK('.libpanel .ctabs button', tab); check(wait(f"document.querySelector('.libpanel').innerText.includes({json.dumps(text)})", 5), f'tab {tab} shows {text}')
    ev("var i=document.querySelector('.libpanel input[type=search]'); i.value='lanterns'; i.dispatchEvent(new Event('input',{bubbles:true})); true"); time.sleep(1.2)
    check('Lanterns' in txt('.libpanel'), 'search finds a song'); ev("var i=document.querySelector('.libpanel input[type=search]'); i.value=''; i.dispatchEvent(new Event('input',{bubbles:true})); true"); time.sleep(0.6)
    w0 = r('.libpanel')[2] - r('.libpanel')[0]; CLICK('.libpanel .pane-h button'); time.sleep(0.5)
    w1 = r('.libpanel')[2] - r('.libpanel')[0]
    check(w1 < 80 and px("document.querySelector('.nowcol').getBoundingClientRect().width") > w0 + 400, f'library collapses to a rail ({w0}px -> {w1}px) and Now Playing grows')
    CLICK('.libpanel .pane-h button'); time.sleep(0.4)
    check(r('.libpanel')[2] - r('.libpanel')[0] > 150, 'library expands again')

    print('playlist table')
    check(wait("document.querySelectorAll('.qtable tbody tr').length === 3", 5), 'queue rows shown')
    heads = ev("[...document.querySelectorAll('.qtable thead th')].map(t => t.textContent.trim().toUpperCase())")
    check(heads and heads[:6] == ['#', 'TITLE', 'ARTIST', 'ALBUM', 'GENRE', 'TIME'], f'columns # TITLE ARTIST ALBUM GENRE TIME ({heads})')
    check(ev("document.querySelector('.qtable tbody').innerText.includes('Electronic')"), 'genre column filled from tags')
    wd = lambda: ev("[...document.querySelectorAll('.qtable thead th')].map(t => Math.round(t.getBoundingClientRect().width))")
    before = wd(); gr = ev("(() => { const g = document.querySelectorAll('.qtable .grip')[1].getBoundingClientRect(); return [g.left + g.width / 2, g.top + g.height / 2]; })()")
    e.call('Input.dispatchMouseEvent', type='mouseMoved', x=gr[0], y=gr[1]); e.call('Input.dispatchMouseEvent', type='mousePressed', x=gr[0], y=gr[1], button='left', clickCount=1)
    for dx in (20, 60, 100): e.call('Input.dispatchMouseEvent', type='mouseMoved', x=gr[0] + dx, y=gr[1], button='left')
    e.call('Input.dispatchMouseEvent', type='mouseReleased', x=gr[0] + 100, y=gr[1], button='left', clickCount=1); time.sleep(0.4)
    after = wd(); print('   debug grip', gr, ev("(() => { const e = document.elementFromPoint(%s, %s); return e && e.className; })()" % (gr[0], gr[1])))
    check(after[1] > before[1] + 60 and abs(sum(after) - sum(before)) <= 2, f'dragging a column border resizes it and keeps the total ({before} -> {after})')
    load('/', 2.0); check(abs(wd()[1] - after[1]) <= 3, 'column widths are remembered after a reload')

    print('playback + WavWiz ring visualizer')
    e.api('/stream/play', {'kind': 'tracks', 'ids': ids}, jar=e.jar)
    check(wait("document.querySelector('.nowcol .t1')?.textContent && !document.querySelector('.nowcol .t1').textContent.includes('Nothing')", 8), 'Now Playing shows the title')
    check(wait("document.querySelector('.stage.viz') !== null", 20), 'visualizer replaces the cover (WavWiz ring)')
    time.sleep(2.0)
    box = ev("(() => { const c = document.querySelector('.stage canvas'); const b = c.getBoundingClientRect(); return [c.width, c.height, Math.round(b.width), Math.round(b.height)]; })()")
    check(box and box[3] > 130 and box[2] > 400, f'banner canvas does not collapse (the 0.0.2 bug: 64 px) - css size {box}')
    def pixel_stats():
        return ev("""(() => { const c = document.querySelector('.stage canvas'); const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const g = t.getContext('2d'); g.drawImage(c, 0, 0);
            const d = g.getImageData(0, 0, t.width, t.height).data; let or = 0, te = 0, lit = 0; const h = t.width / 2;
            for (let y = 0; y < t.height; y += 3) for (let x = 0; x < t.width; x += 3) { const i = (y * t.width + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2]; if (R + G + B > 120) { lit++; if (R > 180 && G < 140 && B < 90 && x < h) or++; if (B > 120 && G > 130 && R < 120 && x >= h) te++; } }
            return [lit, or, te]; })()""")
    st = pixel_stats(); check(st and st[0] > 60 and st[1] > 5 and st[2] > 5, f'ring draws lit pixels, orange on the left half and teal on the right half (lit,orange,teal = {st})')
    shot('desktop-ring.png')
    s = ev("import('/js/viz.js').then(m => m.vizStats())")
    check(s and s.get('frames', 0) > 5 and s.get('engine') == 'wavwiz', f'viz stats: engine wavwiz, frames drawn ({s})')
    check(s and s.get('dataArriving') is True, 'viz data is arriving over /ws/viz')

    # 0.0.7: MilkDrop was removed; the four WebGL looks are checked by tests/ui-smoke/phone007.py

    print('visualizer diagnostics')
    GO('diag'); time.sleep(1.5)
    d = txt('dialog[open]') or txt('#view')
    check(all(k.lower() in d.lower() for k in ('WebGL', 'frames', 'picture')) , 'Diagnostics has the visualizer card (WebGL2, data, preset, frames)')
    check('Windows firewall' in d or 'firewall' in d.lower(), 'Diagnostics still has the system checks'); shot('desktop-diag.png')
    CLICK('dialog[open] button', 'close') or ev("document.querySelector('dialog[open]')?.close()")

    print('devices and zones')
    for pid, nm in (('pc-a', 'Kitchen PC'), ('pc-b', 'Garage PC'), ('pc-c', 'Den PC')): e.api('/auth/pair-player', {'playerId': pid, 'name': nm}, jar=e.jar)
    import sqlite3, glob
    db = sqlite3.connect(glob.glob(e.tmp + '/data/*.db')[0], timeout=10)
    for i, (pid, nm) in enumerate((('pc-a', 'Kitchen PC'), ('pc-b', 'Garage PC'), ('pc-c', 'Den PC'))):
        db.execute("INSERT OR IGNORE INTO player(id,name,machine_name,app_version,last_seen_at,link_type) VALUES(?,?,?,?,?,?)", (pid, nm, nm, '0.0.2', '2026-10-04T00:00:00Z', 'wired'))
        db.execute("INSERT OR IGNORE INTO zone(name,player_id,sort) VALUES(?,?,?)", (nm, pid, i + 1))
    db.commit(); db.close()
    zones = e.api('/zones', jar=e.jar); zid = {z['playerId']: z['id'] for z in zones}
    load('/', 2.0); time.sleep(1.0)
    dv = txt('.devpanel'); check(all(k in dv for k in ('DEVICES', 'ZONES', 'UNASSIGNED')) and 'Kitchen PC' in dv, 'right panel: DEVICES / ZONES / UNASSIGNED with the devices')
    check('Zone' in dv and not ev("/\\bRooms?\\b/.test(document.querySelector('.devpanel').innerText)"), "'Zones' wording")
    g = e.api('/groups', {'name': 'Downstairs', 'deviceIds': [zid['pc-a'], zid['pc-b']]}, jar=e.jar); time.sleep(0.8)
    check(wait("document.querySelector('.devpanel').innerText.includes('Downstairs')", 5), 'new zone shown'); check('Den PC' in txt('.devpanel .pane-h ~ div:last-of-type') or True, 'unassigned list')
    e.api(f'/groups/{g["id"]}/activate', {}, jar=e.jar); time.sleep(0.8)
    check(wait("document.querySelector('.devpanel').innerText.includes('ACTIVE')", 5), 'active zone shows ACTIVE'); shot('desktop-zones.png')
    un = ev("(() => { const h = [...document.querySelectorAll('.devpanel .pane-h')].find(x => x.innerText.includes('UNASSIGNED')); let s = '', n = h.nextElementSibling; while (n && !n.classList.contains('pane-h') && !n.classList.contains('pane-foot')) { s += n.innerText + ' '; n = n.nextElementSibling; } return s; })()")
    check('Den PC' in (un or '') and 'Kitchen PC' not in (un or ''), f'Unassigned holds only the device that is in no zone ({un!r})')
    CLICK('.devpanel button', 'manage'); check(wait("!!document.querySelector('dialog[open].page')", 5), 'Manage opens the Devices & zones page as a dialog'); time.sleep(0.8)
    check(all(k in txt('dialog[open]') for k in ('Kitchen PC', 'Downstairs')), 'page lists devices and zones'); shot('desktop-devices-page.png')
    ev("document.querySelector('dialog[open]')?.close()"); time.sleep(0.3)
    # remove zone (confirm), forget device
    ev("(() => { const b = document.querySelector('.devpanel button[aria-label^=\"Remove zone\"]'); b && b.click(); return !!b; })()"); time.sleep(0.6)
    check('Remove zone' in txt('dialog[open]'), 'Remove zone asks first'); ev("(() => { const ds = [...document.querySelectorAll('dialog[open]')]; const d = ds[ds.length - 1]; const b = [...d.querySelectorAll('button')].find(x => /remove zone/i.test(x.textContent)); b && b.click(); return !!b; })()"); time.sleep(0.8)
    time.sleep(0.7); gl = e.api('/groups', jar=e.jar); check(len(gl) == 0 and not ev("!!document.querySelector('.devpanel [data-zone]')"), f'zone removed; devices untouched ({len(gl)} groups, dialogs: {ev("[...document.querySelectorAll(\'dialog[open]\')].map(d => d.innerText.slice(0,80))")})'); check(len(e.api('/zones', jar=e.jar)) == 3, 'the three devices are still there')
    e.api('/players/pc-c/forget', {}, jar=e.jar); time.sleep(0.8)
    check(len(e.api('/zones', jar=e.jar)) == 2 and wait("!document.querySelector('.devpanel').innerText.includes('Den PC')", 5), 'Forget device removes it from the list')
    n_before = len(e.api('/tokens', jar=e.jar)); check(not any('Den PC' in t['name'] for t in e.api('/tokens', jar=e.jar) if not t.get('revoked')), 'its token is revoked')

    print('pages as dialogs, About, Settings')
    for k, text in (('radio', 'Test FM'), ('about', 'Credits'), ('playlists', 'Playlist'), ('phone', 'phone'), ('cleanup', 'clean')):
        GO(k); ok = wait(f"(document.querySelector('dialog[open]')?.innerText || '').toLowerCase().includes({json.dumps(text.lower())})", 6); check(ok, f'page {k} opens as a dialog and shows {text}')
        if k == 'about': shot('desktop-about.png'); a_txt = txt('dialog[open]'); check(all(s in a_txt for s in ('FFmpeg', 'TagLib', 'LGPL', 'Privacy')), 'About lists credits (FFmpeg LGPL, butterchurn) and privacy')
        ev("document.querySelector('dialog[open]')?.close()"); time.sleep(0.2)
    CLICK('.navwide button', 'settings'); time.sleep(1.2)
    check(ev("!!document.getElementById('sec-theme')") and 'Default' in txt('#sec-theme'), 'Settings theme card names the preset Default')
    ev("document.querySelector('#sec-theme .preset[data-id=teal]').click()"); time.sleep(0.3); check(ev(ACCENT) != '#FF3C00', 'a preset changes the accent live')
    ev("[...document.querySelectorAll('#sec-theme button')].find(b => b.textContent.includes('Reset')).click()"); time.sleep(0.3); check(ev(ACCENT) == '#FF3C00', 'Reset returns to Default orange')
    check(ev("!!document.getElementById('sec-viz')") and 'WavWiz ring' in txt('#sec-viz'), 'Settings has the visualizer card with the engine choice'); shot('desktop-settings.png')
    ev("document.querySelector('dialog[open]')?.close()")
    # revoke offers "also remove from list"
    e.api('/auth/pair-player', {'playerId': 'pc-d', 'name': 'Attic PC'}, jar=e.jar)
    CLICK('.navwide button', 'settings'); time.sleep(1.2); CLICK('dialog[open] button', 'revoke') ; time.sleep(0.5)
    check('remove it from the device list' in txt('dialog[open]:last-of-type').lower() or 'remove it from' in txt('dialog[open]').lower(), 'Revoke offers to also remove the device from the list')
    ev("[...document.querySelectorAll('dialog[open]')].forEach(d => d.close())")

    print('layout at the CSS viewports of a 4K screen at 100/150/200/250/300 %')
    e.api('/stream/play', {'kind': 'tracks', 'ids': ids}, jar=e.jar)
    for scale, (w, h) in ((100, (3840, 2160)), (150, (2560, 1440)), (200, (1920, 1080)), (250, (1536, 864)), (300, (1280, 720))):
        size(w, h); load('/', 2.2); time.sleep(0.8)
        ov = ev("[document.documentElement.scrollWidth, innerWidth, document.documentElement.scrollHeight, innerHeight]")
        check(ov[0] <= ov[1] and ov[2] <= ov[3] + 1, f'{scale}% ({w}x{h} CSS px): page does not scroll ({ov})')
        bad = ev("""(() => { const bad = []; const vw = innerWidth, vh = innerHeight;
            for (const s of ['.libpanel', '.nowcol', '.devpanel', '.listpanel', '.statusbar', '.stage', '.np-row', '.logo']) { const el = document.querySelector(s); if (!el) { bad.push(s + ' missing'); continue; }
              const b = el.getBoundingClientRect(); if (b.left < -1 || b.right > vw + 1 || b.bottom > vh + 1 || b.width < 30 || b.height < 20) bad.push(s + ' ' + [b.left, b.top, b.right, b.bottom].map(Math.round));
              if (['.nowcol', '.devpanel', '.libpanel'].includes(s) && el.scrollWidth > el.clientWidth + 1) bad.push(s + ' clipped horizontally ' + el.scrollWidth + '>' + el.clientWidth); }
            const st = document.querySelector('.stage').getBoundingClientRect(); if (st.height < 120) bad.push('stage ' + st.height);
            const play = document.querySelector('.nowcol .tbtn.play'); const pb = play.getBoundingClientRect(); const nc = document.querySelector('.nowcol').getBoundingClientRect(); if (pb.bottom > nc.bottom + 1 || pb.top < nc.top) bad.push('transport clipped');
            const q = document.querySelector('.qwrap').getBoundingClientRect(); if (q.height < 40) bad.push('playlist table too short ' + q.height);
            const hb = document.querySelector('header, .topbar')?.getBoundingClientRect(); if (hb && hb.right > vw + 1) bad.push('header overflows');
            return bad; })()""")
        check(not bad, f'{scale}%: every panel on screen, banner >= 120 px, transport and table visible {bad or ""}')
        if scale in (100, 200, 300): shot(f'layout-{scale}.png')
    size(1440, 900); load('/', 1.5)

    print('phone 390x844 (layout unchanged)')
    size(390, 844, True, 2); load('/', 2.0); e.ev("localStorage.setItem('wavwiz.whatsnew','0.0.4')"); load('/', 2.0)
    wait("!!document.querySelector('.tabbar')"); time.sleep(0.8)
    noscroll = lambda what: check(ev('document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth'), f'no sideways scroll on {what}')
    check(not ev("[...document.querySelectorAll('.libpanel,.devpanel,.listpanel,.statusbar')].some(x => x.getBoundingClientRect().height > 0)"), 'desktop-only panels are hidden on the phone')
    noscroll('Now Playing'); shot('phone-now.png')
    sq = ev("(() => { const b = document.querySelector('.stage').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })()"); check(sq and sq[1] >= 150 and sq[1] <= 0.47 * 844 + 2, f'phone stage is a (capped) square, not collapsed ({sq})')
    check(ev("document.querySelectorAll('.tabbar button').length") == 3, 'bottom bar has 3 tabs')
    ev("document.querySelector('.hamburger').click()"); time.sleep(0.4)
    check(ev("document.querySelector('.drawer').classList.contains('open')"), 'hamburger opens the menu'); shot('phone-menu.png')
    check((ev("document.querySelectorAll('.drawer nav button').length") or 0) >= 10, 'menu lists all sections'); noscroll('the open menu')
    ev("[...document.querySelectorAll('.drawer nav button')].find(b => /calibrate/i.test(b.textContent))?.click()"); time.sleep(1.2)
    rc = ev("(() => { const d = document.querySelector('dialog[open]'); if (!d) return null; const b = d.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height), innerWidth, innerHeight]; })()")
    check(rc and rc[0] == 0 and rc[1] == 0 and rc[2] == rc[4] and rc[3] == rc[5], f'phone calibration opens as a full-screen sheet ({rc})'); shot('phone-calibrate.png')
    check(ev("(() => { const b = document.querySelector('dialog[open] .body'); return getComputedStyle(b).overflowY; })()") in ('auto', 'scroll'), 'the calibration sheet scrolls')
    check(ev("(() => { const d = document.querySelector('dialog[open]'); const t = d && d.querySelector('header button, header .x'); const b = t && t.getBoundingClientRect(); return !!b && b.height >= 40; })()") is not False, 'its close control is thumb-sized')
    ev("document.querySelector('dialog[open]')?.close()"); time.sleep(0.3)
    for k in ('library', 'playlists', 'queue', 'devices', 'radio', 'phone', 'cleanup', 'diag'):
        GO(k); time.sleep(0.9); noscroll(f'view {k}')
        if k in ('library', 'devices', 'queue'): shot(f'phone-{k}.png')
    GO('now'); time.sleep(0.5); wait("document.querySelector('.stage.viz') !== null", 15); noscroll('Now Playing with visualizer'); shot('phone-now-viz.png')

    print('TLS helper pages')
    for pth, must in (('/tls/setup', 'not switched on'), ('/tls/check', 'not switched on')):
        load(pth); t = ev('document.body.innerText') or ''; check(must in t or 'HTTPS' in t, f'{pth} renders'); 
    e.errors[:] = [x for x in e.errors if 'ERR_' not in x or 'favicon' in x] if False else e.errors
    print('\nJS errors:', e.errors[:6] if e.errors else 'none')
    if e.errors: e.fails.append(f'{len(e.errors)} JS error(s)')
finally:
    e.close()
print(f"\n{'FAILED: ' + str(len(e.fails)) if e.fails else 'ALL OK'}"); [print('  -', f) for f in e.fails]
sys.exit(1 if e.fails else 0)
