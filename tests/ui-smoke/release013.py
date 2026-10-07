#!/usr/bin/env python3
"""WavWiz 0.1.3 UI smoke (headless Chrome, real server): What's new, eight looks incl. Graphic EQ (Lightning gone, saved Lightning -> Graphic EQ),
every look cycled for console errors, Quality/Auto tiers, post effects, context loss without a white flash, forced WebGL 1, phone emulation
(Pixel + iPhone viewport, touch, 4x CPU throttle) frame times and Auto = Low, Diagnostics receiver/network cards, Settings ReplayGain/NAS cards."""
import argparse, json, sys, time, os
sys.path.insert(0, os.path.dirname(__file__))
from harness import Env
ap = argparse.ArgumentParser(); ap.add_argument('--dll', required=True); ap.add_argument('--dotnet', default='dotnet'); ap.add_argument('--out', default='screens'); ap.add_argument('--cdp-port', type=int, default=9343)
a = ap.parse_args()
e = Env(a.dll, a.dotnet, a.out, True, a.cdp_port)
ev, wait, check, size, load = e.ev, e.wait, e.check, e.size, e.load
shot = lambda n: e.shot('wavwiz-013-' + n + '.png')
close_dialogs = lambda: ev("(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); return true; })()")
stats = lambda: ev("import('/js/viz.js').then(m => m.vizStats())")
ENGINES = ['particles', 'river', 'cone', 'wavwiz', 'tunnel', 'terrain', 'vu', 'geq']
def set_prefs(**kw): return ev(f"import('/js/viz.js').then(m => {{ const p = m.vizPrefs(); Object.assign(p, {json.dumps(kw)}); m.saveVizPrefs(p); window.dispatchEvent(new CustomEvent('wavwiz:viz')); return true; }})")
def frames_after(secs):
    s0 = stats() or {}; time.sleep(secs); s1 = stats() or {}; return (s1.get('frames', 0) - s0.get('frames', 0)) / secs, s1
RAF = """new Promise(r => { const t = []; let last = 0; const f = ts => { if (last) t.push(ts - last); last = ts; if (t.length < %d) requestAnimationFrame(f); else r(t); }; requestAnimationFrame(f); })"""
def raf(n=240):
    t = ev(RAF % n) or [0]; t = sorted(t); return sum(t) / len(t), t[int(len(t) * 0.95) - 1], t[-1]
def canvas_luma():
    return ev("""(() => { const c = [...document.querySelectorAll('canvas')].filter(c => c.width > 200 && c.getBoundingClientRect().height > 100).sort((a, b) => b.width * b.height - a.width * a.height)[0]; if (!c) return -1;
      const x = c.getContext('2d'); if (!x) return -2; const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 97) { s += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; } return s / n; })()""")
report = {}
try:
    e.start_server(); e.start_chrome()
    e.api('/stream/play', {'kind': 'tracks', 'ids': e.all_ids}, jar=e.jar)
    # ---------- desktop 1600x900
    size(1600, 900); load('/', 3.0)
    wn = ev("document.querySelector('dialog[open]')?.innerText || ''") or ''
    check("0.1.3" in wn and 'Graphic EQ replaces Lightning' in wn, "What's new 0.1.3 opens and mentions the Lightning -> Graphic EQ swap")
    check('glass table' not in wn.lower() and 'crystal' not in wn.lower(), "What's new has no stale glass-table text")
    shot('whats-new'); close_dialogs(); time.sleep(0.5)
    check(wait("import('/js/viz.js').then(m => (m.vizStats()?.frames || 0) > 5)", 15), 'visualizer runs on Now Playing')
    s = stats() or {}; report['desktop_auto'] = {k: s.get(k) for k in ('quality', 'tier', 'webgl2', 'hdr', 'instancing', 'renderer')}
    check(s.get('webgl2') is True, f"WebGL 2 path ({s.get('renderer')})"); check(s.get('quality') == 'auto' and s.get('tier') in ('low', 'min', 'tiny'), f"Auto quality on software GL (SwiftShader) starts at Low and the governor may step lower (tier {s.get('tier')}, steps {s.get('govSteps')})")
    set_prefs(quality='high'); time.sleep(1.0); s = stats() or {}
    check(s.get('tier') == 'high' and s.get('hdr'), f"High quality: half-float targets ({s.get('hdr')})")
    for k in ENGINES:
        n0 = len(e.errors); set_prefs(engine=k, on=True); time.sleep(2.2)
        fps, s = frames_after(1.5)
        check(s.get('engine') == k and s.get('mode') == 'webgl' and fps > 0.5 and len(e.errors) == n0 and not s.get('lastError'), f"look {k}: WebGL, {fps:.0f} fps drawn, no console errors ({s.get('lastError') or ''})")
        report.setdefault('desktop_high', {})[k] = {'fps': round(fps, 1), 'frameMs': s.get('frameMs'), 'workMs': s.get('workMs'), 'particles': s.get('particles')}
        shot('desktop-' + k)
    set_prefs(engine='particles', quality='ultra'); time.sleep(2.0); fps, s = frames_after(1.5)
    check(s.get('tier') == 'ultra' and (s.get('particles') or 0) > 26000, f"Ultra: {s.get('particles')} GPU particles, {fps:.0f} fps (software GL)"); shot('desktop-particles-ultra')
    set_prefs(engine='tunnel'); time.sleep(1.5); shot('desktop-tunnel-ultra')
    set_prefs(quality='high', engine='geq'); time.sleep(1)
    # post knobs off -> still renders; 100 % -> renders
    ev("import('/js/vizcore.js').then(m => { m.savePost({ bloom: 0, streaks: 0, fringe: 0, depth: 0 }); window.dispatchEvent(new CustomEvent('wavwiz:vizsettings')); return true; })"); time.sleep(1.2)
    fps, s = frames_after(1.0); check(fps > 3 and not s.get('lastError'), 'post effects all at 0 % (off): still draws'); shot('desktop-geq-post-off')
    ev("import('/js/vizcore.js').then(m => { m.savePost({ bloom: 100, streaks: 100, fringe: 100, depth: 100 }); window.dispatchEvent(new CustomEvent('wavwiz:vizsettings')); return true; })"); set_prefs(engine='terrain'); time.sleep(1.5)
    fps, s = frames_after(1.0); check(fps > 3 and not s.get('lastError'), 'post effects at 100 % on Terrain (depth blur): draws'); shot('desktop-terrain-post-max')
    ev("import('/js/vizcore.js').then(m => { m.savePost({}); window.dispatchEvent(new CustomEvent('wavwiz:vizsettings')); return true; })")
    # context loss: no white flash, recovers
    set_prefs(engine='wavwiz'); time.sleep(1.5); lum0 = canvas_luma()
    ev("import('/js/vizgl.js').then(m => { m.loseSharedForTest(900); return true; })"); time.sleep(0.3); lum1 = canvas_luma()
    check(lum1 is not None and 0 <= lum1 < 200, f'context lost: picture keeps its last frame, no white flash (luma {lum0:.0f} -> {lum1:.0f})')
    ok = wait("import('/js/viz.js').then(m => { const s = m.vizStats(); return s && s.losses >= 1 && !s.contextLost && s.mode === 'webgl'; })", 10)
    fps, s = frames_after(1.0); check(ok and fps > 3, f"context restored and drawing again ({fps:.0f} fps, losses {s.get('losses')})")
    # saved Lightning falls back to Graphic EQ
    ev("(() => { const p = JSON.parse(localStorage.getItem('unison.viz.v1') || '{}'); p.engine = 'lightning'; localStorage.setItem('unison.viz.v1', JSON.stringify(p)); return true; })()")
    load('/', 3.0); close_dialogs(); time.sleep(1.5); s = stats() or {}
    check(s.get('engine') == 'geq', f"a saved Lightning choice opens as Graphic EQ ({s.get('engine')})")
    # Visualizer page
    e.go('visualizer'); time.sleep(2.0)
    txt = ev("document.body.innerText") or ''
    check('Lightning' not in txt and 'Graphic EQ' in txt, 'Visualizer page: Graphic EQ listed, Lightning gone')
    check(ev("document.querySelectorAll('.vizcard, [data-viz]').length >= 8") and ev("!!document.querySelector('select[data-quality]')"), 'Visualizer page: eight looks + Quality select')
    check(ev("[...document.querySelectorAll('.vslider input[type=range]')].every(i => i.min === '0' && i.max === '100')") and ev("document.querySelectorAll('.vslider input[type=range]').length >= 12"), 'every slider runs 0-100 %')
    shot('visualizer-page')
    ev("document.querySelector('.vizgfx')?.scrollIntoView()"); time.sleep(0.4); shot('visualizer-page-graphics'); close_dialogs()
    # Diagnostics
    e.go('diag'); time.sleep(3.0)
    check(wait("!!document.querySelector('#diag-receivers button[data-act=restart-airplay]') && !!document.querySelector('#diag-receivers button[data-act=clear-orphans]')", 6), 'Diagnostics: Restart AirPlay + Clear orphans buttons')
    check(wait("!!document.querySelector('#diag-network button[data-act=redetect]') && /listens on/.test(document.querySelector('#diag-network').innerText)", 6), 'Diagnostics: Network card with Re-detect')
    vt = ev("document.querySelector('#diag-viz')?.innerText || ''") or ''
    check('WebGL 2' in vt and 'Quality' in vt and 'Frame time' in vt, 'Diagnostics visualizer report: WebGL version, Quality, frame time')
    shot('diagnostics'); ev("document.querySelector('#diag-receivers').scrollIntoView()"); time.sleep(0.4); shot('diagnostics-receivers')
    # Settings > Library
    e.go('settings:library'); time.sleep(2.0)
    check(wait("!!document.querySelector('#rg-mode') && !!document.querySelector('#sec-nas')", 5), 'Settings > Library: Volume leveling (ReplayGain) + NAS logins cards')
    check(ev("document.querySelector('#rg-mode').value") == 'auto', 'ReplayGain default Automatic')
    ev("document.querySelector('#sec-replaygain').scrollIntoView()"); time.sleep(0.3); shot('settings-library'); close_dialogs()
    e.go('settings:network'); time.sleep(2.0); check(wait("!!document.querySelector('#diag-network')", 5), 'Settings > Network shows the network helper'); shot('settings-network'); close_dialogs()
    errs = [x for x in e.errors if 'favicon' not in x]; print('desktop JS errors:', errs[:8]); check(not errs, 'desktop: no JS errors')
    # ---------- forced WebGL 1
    e.errors.clear(); load('/?webgl1', 3.0); close_dialogs(); set_prefs(quality='high'); time.sleep(1.5)
    s = stats() or {}; check(s.get('webgl') and s.get('webgl2') is False, f"forced WebGL 1 path (hdr {s.get('hdr')}, instancing {s.get('instancing')})")
    for k in ENGINES:
        set_prefs(engine=k); time.sleep(1.6); fps, s = frames_after(1.0)
        check(s.get('engine') == k and s.get('mode') == 'webgl' and fps > 0.5 and not s.get('lastError'), f'WebGL 1 look {k}: {fps:.0f} fps (software GL)')
        if k in ('particles', 'terrain', 'vu', 'geq'): shot('webgl1-' + k)
    errs = [x for x in e.errors if 'favicon' not in x]; print('webgl1 JS errors:', errs[:8]); check(not errs, 'WebGL 1: no JS errors')
    # ---------- phones (fresh storage: quality Auto)
    for name, w, h, dpr, ua in [('pixel7', 412, 915, 2.625, 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'),
                                ('iphone15', 393, 852, 3, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')]:
        e.errors.clear()
        ev("(() => { localStorage.removeItem('unison.viz.v1'); localStorage.removeItem('wavwiz.viz.webgl1'); return true; })()")
        e.call('Emulation.setUserAgentOverride', userAgent=ua); e.call('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
        e.call('Emulation.setDeviceMetricsOverride', width=w, height=h, deviceScaleFactor=dpr, mobile=True, screenWidth=w, screenHeight=h)
        e.call('Emulation.setCPUThrottlingRate', rate=4)
        load('/', 4.0); close_dialogs(); time.sleep(1.0)
        ok = wait("import('/js/viz.js').then(m => (m.vizStats()?.frames || 0) > 5)", 15)
        s = stats() or {}
        check(ok and s.get('quality') == 'auto' and s.get('autoCeiling') == 'low' and s.get('tier') in ('low', 'min', 'tiny'), f"{name}: Auto picks Low for a phone (ceiling {s.get('autoCeiling')}, now {s.get('tier')} after {s.get('govSteps')} governor steps)")
        res = {}
        for k in ['particles', 'tunnel', 'terrain', 'vu', 'geq']:
            set_prefs(engine=k); time.sleep(9.0 if k == 'particles' else 3.0); fps, s = frames_after(3.0); avg, p95, mx = raf(180)
            res[k] = {'fps': round(fps, 1), 'frameMs': s.get('frameMs'), 'workMs': s.get('workMs'), 'rafAvg': round(avg, 1), 'rafP95': round(p95, 1), 'rafMax': round(mx, 1), 'tier': s.get('tier'), 'steps': s.get('govSteps'), 'canvas': s.get('canvas'), 'particles': s.get('particles')}
            check(fps > 20 and not s.get('lastError'), f"{name} {k}: {fps:.0f} fps, frame {s.get('frameMs')} ms (draw {s.get('workMs')} ms), rAF avg {avg:.1f} / p95 {p95:.1f} ms, tier {s.get('tier')}")
        report[name] = res
        set_prefs(engine='particles'); time.sleep(1.5); shot(name + '-nowplaying')
        e.call('Emulation.setCPUThrottlingRate', rate=1)
        errs = [x for x in e.errors if 'favicon' not in x]; print(name, 'JS errors:', errs[:8]); check(not errs, f'{name}: no JS errors')
finally:
    print('REPORT ' + json.dumps(report))
    e.close()
print('FAILURES:', e.fails) if e.fails else print('ALL OK')
sys.exit(1 if e.fails else 0)
