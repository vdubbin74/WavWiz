#!/usr/bin/env python3
"""WavWiz 0.1.1 UI smoke (headless Chrome against a real server): Playlist slide-down panel (arrow, Library > Playlist, per-device memory, Now Playing
grows), Settings > Network AirPlay & Spotify Connect card (toggle + "Requires Spotify Premium."), Visualizer page Mood control (Calm default, switch saves),
Diagnostics rows, no JS errors."""
import argparse, json, sys, time
sys.path.insert(0, __import__('os').path.dirname(__file__))
from harness import Env
ap = argparse.ArgumentParser(); ap.add_argument('--dll', required=True); ap.add_argument('--dotnet', default='dotnet'); ap.add_argument('--out', default='/tmp/ui-shots-011'); ap.add_argument('--cdp-port', type=int, default=9334)
a = ap.parse_args()
e = Env(a.dll, a.dotnet, a.out, True, a.cdp_port)
ev, wait, check, shot, size, load = e.ev, e.wait, e.check, e.shot, e.size, e.load
close_dialogs = lambda: ev("(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); return true; })()")
try:
    e.start_server(); e.start_chrome()
    e.api('/stream/play', {'kind': 'tracks', 'ids': e.ids}, jar=e.jar)
    size(1440, 900); load('/', 3.0); ev("document.querySelector('dialog[open] button')?.click()"); time.sleep(1)
    check(wait("!!document.querySelector('.listpanel .listcol')", 6), 'item 1: Playlist has a collapse arrow')
    h0 = ev("document.querySelector('.nowcol').getBoundingClientRect().height")
    ev("document.querySelector('.listpanel .listcol').click()"); time.sleep(0.8)
    check(ev("document.getElementById('desk').classList.contains('listcollapsed') && localStorage.getItem('wavwiz.listcollapsed') === '1'"), 'item 1: arrow slides the Playlist down and saves it')
    h1 = ev("document.querySelector('.nowcol').getBoundingClientRect().height"); lh = ev("document.querySelector('.listpanel').getBoundingClientRect().height")
    check(h1 > h0 + 100 and lh < 60, f'item 1: Now Playing grows ({h0:.0f} -> {h1:.0f} px), Playlist strip {lh:.0f} px')
    shot('playlist-collapsed.png')
    load('/', 2.5); check(ev("document.getElementById('desk').classList.contains('listcollapsed')"), 'item 1: collapsed state survives a reload (per device)')
    def menu(top, label):
        return ev(f"""(() => {{ const t = [...document.querySelectorAll('button.mtop')].find(b => b.textContent.trim() === {json.dumps(top)}); if (!t) return 'no top';
          t.click(); const it = [...t.parentElement.querySelectorAll('.mpanel button')].find(b => b.textContent.trim() === {json.dumps(label)});
          if (!it) return 'no item'; it.click(); return 'ok'; }})()""")
    r = menu('Library', 'Playlist'); time.sleep(0.8)
    check(r == 'ok' and ev("!document.getElementById('desk').classList.contains('listcollapsed') && !document.querySelector('dialog[open]')"), f'item 1: Library > Playlist slides it back up, no page ({r})')
    r = menu('Library', 'Playlist'); time.sleep(0.8)
    check(ev("document.getElementById('desk').classList.contains('listcollapsed')"), 'item 1: ...and down again')
    menu('Library', 'Playlist'); time.sleep(0.5)
    # items 2/3: Settings > Network card
    close_dialogs(); e.go('settings:network'); time.sleep(1.5)
    txt = ev("document.querySelector('#sec-airplay')?.innerText || ''")
    check('WavWiz – Whole House' in txt and 'AirPlay' in txt, 'item 2: Settings shows the AirPlay speaker name')
    check(ev("!!document.querySelector('#spotify-enabled') && document.querySelector('#spotify-enabled').checked === false"), 'item 3: Spotify Connect toggle, off by default')
    check(ev("document.querySelector('#spotify-enabled')?.closest('label')?.innerText.includes('Requires Spotify Premium.')"), 'item 3: "Requires Spotify Premium." next to the toggle')
    ev("document.querySelector('#spotify-enabled').click()"); time.sleep(1.0)
    st = e.api('/receivers', jar=e.jar); check(st['spotify']['enabled'] is True, 'item 3: the toggle turns Spotify Connect on')
    ev("document.querySelector('#spotify-enabled').click()"); time.sleep(1.0)
    st = e.api('/receivers', jar=e.jar); check(st['spotify']['enabled'] is False, 'item 3: ...and off')
    shot('settings-network.png'); close_dialogs()
    # item 4: Mood
    e.go('visualizer'); time.sleep(2.0)
    check(ev("[...document.querySelectorAll('.vizmood button')].map(b => b.textContent).join(',') === 'Calm,Balanced,Energetic'"), 'item 4: Mood control with Calm / Balanced / Energetic')
    check(ev("document.querySelector('.vizmood button[data-mood=calm]')?.getAttribute('aria-checked') === 'true'"), 'item 4: Calm is the default')
    ev("document.querySelector('.vizmood button[data-mood=energetic]').click()"); time.sleep(0.4)
    check(ev("JSON.parse(localStorage.getItem('wavwiz.viz.react.v1')).mood === 'energetic'"), 'item 4: choosing a mood saves it')
    ev("document.querySelector('.vizmood button[data-mood=calm]').click()"); time.sleep(0.3)
    check(ev("document.querySelectorAll('.vizctl, .card.vizctl').length >= 1 && /Sensitivity/.test(document.body.innerText)"), 'item 4: per-look controls and Sensitivity are still there')
    shot('viz-mood.png'); close_dialogs()
    d = e.api('/diagnostics', jar=e.jar); ids = [c.get('id') for c in (d.get('checks') if isinstance(d, dict) else d) or []]
    check('airplay' in ids and 'spotify' in ids, f'Diagnostics has AirPlay and Spotify rows')
    errs = [x for x in e.errors if 'favicon' not in x]
    print('JS errors:', errs[:8]); check(not errs, 'no JS errors')
finally:
    e.close()
print('FAILURES:', e.fails) if e.fails else print('ALL OK')
sys.exit(1 if e.fails else 0)
