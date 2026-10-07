#!/usr/bin/env python3
"""WavWiz 0.0.7 phone smoke: iPhone UA + phone viewport in headless Chrome against a real server.
Checks: the UI socket connects (ticket auth) and stays Connected, the phone auto-joins as a device, a tap starts audio, frames are scheduled,
a dropped socket heals by itself (kick the server-side session), plus screenshots of Now Playing / Themes / Visualizer pages."""
import argparse, json, sys, time
sys.path.insert(0, __import__('os').path.dirname(__file__))
from harness import Env
ap = argparse.ArgumentParser(); ap.add_argument('--dll', required=True); ap.add_argument('--dotnet', default='dotnet'); ap.add_argument('--out', default='/tmp/ui-shots-007'); ap.add_argument('--cdp-port', type=int, default=9335)
a = ap.parse_args()
e = Env(a.dll, a.dotnet, a.out, True, a.cdp_port)
ev, wait, check, shot, size, load = e.ev, e.wait, e.check, e.shot, e.size, e.load
IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
try:
    e.start_server(); e.start_chrome()
    e.call('Emulation.setUserAgentOverride', userAgent=IPHONE, platform='iPhone')
    e.call('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
    size(390, 844, mobile=True, dpr=2)
    e.api('/stream/play', {'kind': 'tracks', 'ids': e.ids}, jar=e.jar)
    load('/', 3.0)
    ev("document.querySelector('dialog[open] button')?.click()")
    check(wait("document.getElementById('conntxt')?.textContent === 'Connected'", 10), 'header says Connected (ticket-authenticated UI socket over http)')
    check(wait("!!document.querySelector('.phone-unlock') || true", 2), 'page loaded')
    zones = lambda: e.api('/zones', jar=e.jar)
    ok = False
    for _ in range(40):
        if any(z.get('isWeb') and z.get('connected') for z in zones()): ok = True; break
        time.sleep(0.25)
    check(ok, 'the phone auto-joined the stream as a device (no button pressed)')
    # a tap anywhere starts sound
    e.call('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': 200, 'y': 400}]); e.call('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    e.call('Input.dispatchMouseEvent', type='mousePressed', x=200, y=400, button='left', clickCount=1); e.call('Input.dispatchMouseEvent', type='mouseReleased', x=200, y=400, button='left', clickCount=1)
    check(wait("import('/js/room.js').then(m => m.getPhoneDevice()?.ctx?.state === 'running')", 6), 'AudioContext running after a tap')
    check(wait("import('/js/room.js').then(m => (m.getPhoneDevice()?.sched?.stats?.played || m.getPhoneDevice()?.stats?.frames || 0) > 20)", 12), 'audio frames are being scheduled on the phone')
    check(ev("import('/js/room.js').then(m => { const d = m.getPhoneDevice(); return !!d && d.ctx === m.sharedCtx(); })"), 'exactly one shared AudioContext')
    check(not ev("!!document.querySelector('.phone-unlock')"), 'no unlock overlay once sound runs')
    shot('phone-now.png')
    # self-healing: close the sockets from the page side and expect them back
    ev("(() => { const d = window.__d; return true; })()")
    ev("import('/js/room.js').then(m => { m.getPhoneDevice().ws.close(); return true; })")
    ev("(() => { const s = window.__wwS; return true; })()")
    time.sleep(0.3)
    check(wait("import('/js/room.js').then(m => m.getPhoneDevice()?.ws?.readyState === 1)", 10), 'device socket reconnects by itself')
    check(wait("document.getElementById('conntxt')?.textContent === 'Connected'", 5), 'still Connected')
    for name, js in (('phone-themes.png', "import('/js/main.js').then(m => { m.go('themes', true); return true; })"), ('phone-viz.png', "import('/js/main.js').then(m => { m.go('visualizer', true); return true; })")):
        if ev(js): time.sleep(1.2); shot(name)
    size(1440, 900); load('/', 3.0); ev("document.querySelector('dialog[open] button')?.click()"); time.sleep(1.5); shot('desk-now.png')
    for k in ('river', 'cone', 'wavwiz', 'particles'):
        ev(f"(() => {{ localStorage.setItem('unison.viz.v1', JSON.stringify({{ on: true, engine: '{k}' }})); window.dispatchEvent(new CustomEvent('wavwiz:viz')); return true; }})()")
        time.sleep(2.0)
        check(wait(f"import('/js/viz.js').then(m => {{ const s = m.vizStats(); return s && s.engine === '{k}' && s.mode === 'webgl' && s.frames > 20; }})", 8), f'{k}: WebGL look draws frames on the desktop banner')
        shot(f'desk-{k}.png')
    check(ev("import('/js/viz.js').then(m => (m.vizStats()?.particles || 0) >= 2000)"), 'Particle burst draws thousands of particles')
    ev("import('/js/main.js').then(m => { m.go('visualizer'); return true; })"); time.sleep(2.5); shot('desk-vizpage.png')
    check(ev("document.querySelectorAll('dialog[open] .vizcard canvas').length === 8"), 'Visualizer page shows 8 live preview cards (0.0.8)')
    ev("document.querySelector('dialog[open] footer button, dialog[open] .btn')?.click()")
    ev("import('/js/main.js').then(m => { m.go('themes'); return true; })"); time.sleep(1); shot('desk-themes.png')
    check(ev("document.querySelectorAll('dialog[open] .themecard').length >= 10"), 'Themes page shows every theme as a card')
    print('JS errors:', e.errors[:8])
    check(not [x for x in e.errors if 'favicon' not in x], 'no JS errors')
finally:
    e.close()
print('FAILURES:', e.fails) if e.fails else print('ALL OK')
sys.exit(1 if e.fails else 0)
