#!/usr/bin/env python3
"""WavWiz 0.0.8 UI smoke (headless Chrome against a real server).
Desktop: no browser-white buttons on any page (item 2), Devices panel collapse arrow + per-device memory (3), menu Devices & zones / Browse library
toggle the side panels (4, 5), delay slider <-> ms box (7), Display size scales live + saved (9), visualizer page: 8 cards, rapid clicks, one shared
WebGL context, survives a forced context loss (11, 16), no Adjust button (12), Now Playing layout parts (14).
Phone: every hamburger item opens its target - full-screen pages stay pages (6, 8)."""
import argparse, json, sys, time
sys.path.insert(0, __import__('os').path.dirname(__file__))
from harness import Env
ap = argparse.ArgumentParser(); ap.add_argument('--dll', required=True); ap.add_argument('--dotnet', default='dotnet'); ap.add_argument('--out', default='/tmp/ui-shots-008'); ap.add_argument('--cdp-port', type=int, default=9335)
a = ap.parse_args()
e = Env(a.dll, a.dotnet, a.out, True, a.cdp_port)
ev, wait, check, shot, size, load = e.ev, e.wait, e.check, e.shot, e.size, e.load
IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
LIGHT = """(() => { const bad = []; for (const b of document.querySelectorAll('button')) { const r = b.getBoundingClientRect(); if (!r.width || !r.height) continue;
  const cs = getComputedStyle(b); if (cs.visibility === 'hidden' || cs.display === 'none') continue; const m = cs.backgroundColor.match(/[\\d.]+/g); if (!m) continue;
  const [R, G, B, A = 1] = m.map(Number); if (A < 0.5) continue; if ((0.2126 * R + 0.7152 * G + 0.0722 * B) / 255 > 0.8) bad.push((b.className || '(no class)') + ' "' + (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 24) + '"'); }
  return JSON.stringify(bad); })()"""
def light(where):
    bad = json.loads(ev(LIGHT) or '[]'); check(not bad, f'no white/light buttons: {where}' + (f' -> {bad[:5]}' if bad else ''))
close_dialogs = lambda: ev("(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); return true; })()")
try:
    e.start_server(); e.start_chrome()
    e.api('/stream/play', {'kind': 'tracks', 'ids': e.ids}, jar=e.jar)
    size(1440, 900); load('/', 3.0); ev("document.querySelector('dialog[open] button')?.click()"); time.sleep(1)
    check(wait("!!document.querySelector('.devpanel .devcol')", 6), 'item 3: Devices panel has a collapse arrow')
    light('desktop main screen')
    # item 3 / 4: collapse via arrow, remembered, menu toggles the right panel
    w0 = ev("document.querySelector('.nowcol, .nowc, #desk > :nth-child(3)').getBoundingClientRect().width")
    ev("document.querySelector('.devpanel .devcol').click()"); time.sleep(0.6)
    check(ev("document.getElementById('desk').classList.contains('devcollapsed') && localStorage.getItem('wavwiz.devcollapsed') === '1'"), 'item 3: arrow collapses the Devices panel and saves it')
    w1 = ev("document.querySelector('.nowcol, .nowc, #desk > :nth-child(3)').getBoundingClientRect().width")
    check(w1 > w0 + 150, f'item 3: Now Playing widens ({w0:.0f} -> {w1:.0f} px)')
    load('/', 2.5); check(ev("document.getElementById('desk').classList.contains('devcollapsed')"), 'item 3: collapsed state survives a reload (per device)')
    ev("import('/js/main.js').then(() => true)")
    def menu(top, label):
        return ev(f"""(() => {{ const t = [...document.querySelectorAll('button.mtop')].find(b => b.textContent.trim() === {json.dumps(top)}); if (!t) return 'no top';
          t.click(); const it = [...t.parentElement.querySelectorAll('.mpanel button')].find(b => b.textContent.trim().startsWith({json.dumps(label)}));
          if (!it) return 'no item'; it.click(); return 'ok'; }})()""")
    r = menu('Devices', 'Devices & zones'); time.sleep(0.6)
    check(r == 'ok' and ev("!document.getElementById('desk').classList.contains('devcollapsed') && !document.querySelector('dialog[open]')"), f'item 4: Devices > Devices & zones re-opens the right panel, no page ({r})')
    r = menu('Devices', 'Devices & zones'); time.sleep(0.6)
    check(ev("document.getElementById('desk').classList.contains('devcollapsed')"), 'item 4: ...and slides it closed again')
    r = menu('Library', 'Browse library'); time.sleep(0.6)
    lc = ev("document.getElementById('desk').classList.contains('libcollapsed')")
    r2 = menu('Library', 'Browse library'); time.sleep(0.6)
    check(r == 'ok' and r2 == 'ok' and lc != ev("document.getElementById('desk').classList.contains('libcollapsed')") and not ev("!!document.querySelector('dialog[open]')"), 'item 5: Library > Browse library toggles the left panel')
    ev("(() => { const d = document.getElementById('desk'); if (!d.classList.contains('libcollapsed')) document.querySelector('.libpanel .plus').click(); return true; })()"); time.sleep(0.5)
    shot('desk-both-collapsed.png')
    wb = ev("document.querySelector('.nowcol, .nowc, #desk > :nth-child(3)').getBoundingClientRect().width")
    check(wb >= 1440 - 2 * 46 - 60, f'item 3: both panels collapsed -> Now Playing ~full width ({wb:.0f} px)')
    ev("document.querySelector('.libpanel .plus').click(); document.querySelector('.devpanel .devcol').click(); true"); time.sleep(0.5)
    # item 14: Now Playing parts
    for sel, what in (('.np-stage .np-seek, .stage .np-seek', 'progress bar inside the visualizer panel'), ('.np-vlabel', 'visualizer name label'), ('.np-genre', 'genre line'),
                      ('.np-transport', 'bordered transport box'), ('.np-upnext', 'Up next line'), ('.np-strip', 'bottom device strip')):
        check(ev(f"!!document.querySelector({json.dumps(sel)})"), f'item 14: Now Playing has the {what}')
    shot('desk-now.png')
    # item 9: display size scales live + saved
    ev("import('/js/uiscale.js').then(m => { m.applyScale('large'); return true; })"); time.sleep(0.4)
    check(ev("getComputedStyle(document.documentElement).zoom === '1.25' && localStorage.getItem('wavwiz.uiscale') === 'large'"), 'item 9: Display size Large zooms the UI live and saves it')
    shot('desk-large.png')
    load('/', 2.5); check(ev("getComputedStyle(document.documentElement).zoom === '1.25'"), 'item 9: Display size survives a reload')
    ev("import('/js/uiscale.js').then(m => { m.applyScale('compact'); return true; })"); time.sleep(0.3)
    # item 2: every page
    for k in ('devices', 'visualizer', 'themes', 'diag', 'playlists', 'radio', 'scenes', 'schedules', 'finder', 'tags', 'cleanup', 'remote', 'about', 'settings:appearance'):
        close_dialogs(); e.go(k); time.sleep(1.0); light('page ' + k)
    close_dialogs(); e.go('devices'); time.sleep(1.0)
    check(ev("!!document.querySelector('dialog[open] .zadd') && !!document.querySelector('.devpanel .plus.zbtn') && document.querySelectorAll('.devpanel .zbtn.danger').length === document.querySelectorAll('.devpanel .zbtn.zedit').length"), 'item 2: zone Add / Edit / Delete buttons all use the themed classes')
    close_dialogs()
    # item 7: delay slider <-> ms box (open the first device that reports outputs)
    zid = next((z['id'] for z in e.api('/zones', jar=e.jar) if z.get('outputs')), None)
    if zid is not None:
        ev(f"import('/js/zone.js').then(m => {{ m.openZone(window.__wwS || {{ auth: {{ role: 'admin' }} }}, {json.dumps(zid)}, () => {{}}); return true; }})"); time.sleep(1.5)
        light('device dialog')
        ok = ev("""(() => { const s = document.querySelector('dialog[open] .latslider'), b = document.querySelector('dialog[open] .latbox'); if (!s || !b) return false;
          s.value = 250; s.dispatchEvent(new Event('input')); const a = b.value === '250'; b.value = 333; b.dispatchEvent(new Event('input')); return a && s.value === '335'; })()""")
        check(ok, 'item 7: delay slider and ms box stay in sync (slider snaps to 5 ms)')
        close_dialogs()
    else: print('note: no device with outputs in the seeded server - delay slider checked by the JS unit tests')
    # items 11/12/16: visualizer page
    e.go('visualizer'); time.sleep(2.5)
    check(ev("document.querySelectorAll('dialog[open] .vizcard').length === 8"), 'item 16: Visualizer page lists 8 looks')
    check(not ev("[...document.querySelectorAll('dialog[open] button')].some(b => /^adjust/i.test(b.textContent.trim()))"), 'item 12: no Adjust button')
    for i in range(24): ev(f"document.querySelectorAll('dialog[open] .vizcard')[{i % 8}]?.click()"); time.sleep(0.12)
    time.sleep(1.5)
    check(ev("import('/js/vizgl.js').then(m => m.sharedGen() <= 1)"), 'item 11: 24 rapid card taps reuse one WebGL context (no context churn)')
    ev("import('/js/vizgl.js').then(m => { m.loseSharedForTest(); return true; })"); time.sleep(5)
    check(wait("import('/js/viz.js').then(m => (m.vizStats()?.frames || 0) > 10)", 6), 'item 11: visualizer keeps drawing after a forced context loss')
    shot('desk-vizpage.png'); close_dialogs()
    # phone: every hamburger item opens its target (items 6, 8)
    e.call('Emulation.setUserAgentOverride', userAgent=IPHONE, platform='iPhone'); size(390, 844, mobile=True, dpr=2)
    load('/', 3.0); ev("document.querySelector('dialog[open] button')?.click()"); time.sleep(0.5)
    skip = {'Sign out', 'Play / Pause', 'Next', 'Previous', 'Rescan folders'}
    tops = json.loads(ev("JSON.stringify([...document.querySelectorAll('.drawer .macc > button')].map(b => b.textContent.trim()))") or '[]')
    tested = 0
    scale_names = {'Small': 'small', 'Compact (default)': 'compact', 'Medium': 'medium', 'Large': 'large', 'Extra large (TV)': 'xlarge'}
    for top in tops:
        ev("document.querySelector('.hamburger').click()"); time.sleep(0.2)
        ev(f"(() => {{ const b = [...document.querySelectorAll('.drawer .macc > button')].find(b => b.textContent.trim() === {json.dumps(top)}); if (!b.parentElement.classList.contains('open')) b.click(); return true; }})()"); time.sleep(0.2)
        leaves = json.loads(ev("JSON.stringify([...document.querySelectorAll('.drawer .macc.open .mpanel > button')].map(b => b.textContent.trim()))") or '[]')
        ev("document.querySelector('.drawer .scrim').click()"); time.sleep(0.2)
        for lab in leaves:
            if lab in skip: continue
            close_dialogs(); ev("import('/js/main.js').then(m => { m.go('now', true); return true; })"); time.sleep(0.2)
            ev("document.querySelector('.hamburger').click()"); time.sleep(0.2)
            ev(f"(() => {{ const b = [...document.querySelectorAll('.drawer .macc > button')].find(b => b.textContent.trim() === {json.dumps(top)}); if (!b.parentElement.classList.contains('open')) b.click(); return true; }})()"); time.sleep(0.2)
            sc0 = ev("document.documentElement.dataset.uiscale")
            ev(f"[...document.querySelectorAll('.drawer .macc.open .mpanel > button')].find(b => b.textContent.trim() === {json.dumps(lab)}).click()"); time.sleep(1.0)
            st = ev("JSON.stringify({ view: document.getElementById('desk')?.dataset.view, dlg: document.querySelector('dialog[open] header span, dialog[open] h2, dialog[open] h3')?.textContent || '', drawer: document.getElementById('drawer').classList.contains('open') })")
            st = json.loads(st or '{}')
            if lab in scale_names:
                sc = ev("document.documentElement.dataset.uiscale"); check(sc == scale_names[lab] and not st.get('drawer'), f'items 8/9: phone menu View > Display size > {lab} applies ({sc0} -> {sc})'); tested += 1; continue
            opened = (st.get('view') not in (None, 'now')) or bool(st.get('dlg'))
            check(opened and not st.get('drawer'), f'item 8: phone menu {top} > {lab} opens its target ({st.get("view")}{" / " + st["dlg"][:30] if st.get("dlg") else ""})')
            if lab.startswith(('Browse library', 'Devices & zones')): check(st.get('view') in ('library', 'devices'), f'item 6: phone {lab} keeps its full-screen page')
            if lab.startswith('Visualizer'): shot('phone-vizpage.png'); light('phone visualizer page')
            tested += 1
    check(tested >= 18, f'item 8: tested {tested} phone menu items')
    close_dialogs(); ev("import('/js/main.js').then(m => { m.go('now', true); return true; })"); time.sleep(1); shot('phone-now.png'); light('phone Now Playing')
    ev("import('/js/uiscale.js').then(m => { m.applyScale('compact'); return true; })")
    errs = [x for x in e.errors if 'favicon' not in x]
    print('JS errors:', errs[:8]); check(not errs, 'no JS errors')
finally:
    e.close()
print('FAILURES:', e.fails) if e.fails else print('ALL OK')
sys.exit(1 if e.fails else 0)
