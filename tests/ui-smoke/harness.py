"""Shared headless-Chrome + real-server harness for the UI tests (dev tool; needs google-chrome, ffmpeg, python websocket-client, a built wavwiz-server.dll)."""
import json, os, subprocess, sys, tempfile, time, urllib.request, http.cookiejar, shutil, base64
import websocket


class Env:
    def __init__(self, dll, dotnet='dotnet', out='/tmp/ui-shots', seed=True, cdp_port=9333):
        self.dll, self.dotnet, self.out, self.cdp_port = dll, dotnet, out, cdp_port
        os.makedirs(out, exist_ok=True)
        self.tmp = tempfile.mkdtemp(prefix='wavwiz-ui-'); self.music = os.path.join(self.tmp, 'music'); os.makedirs(self.music)
        self.errors, self.fails, self.n, self.jar, self.chrome, self.ws, self.srv = [], [], 0, http.cookiejar.CookieJar(), None, None, None
        self.port = 47900 + os.getpid() % 90; self.base = f'http://127.0.0.1:{self.port}'; self.seed = seed

    # ---- server
    def start_server(self):
        if self.seed:
            subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=orange:s=300x300:d=1', '-frames:v', '1', os.path.join(self.tmp, 'cover.png')])
            for i, (ar, al, t, f, g) in enumerate([('Demo Artist', 'Night Drive', 'Coastline', 330, 'Electronic'), ('Demo Artist', 'Night Drive', 'Afterglow', 440, 'Electronic'), ('Sample Band', 'Field Notes', 'Lanterns', 220, 'Rock')]):
                subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'sine=f={f}:d=30', '-i', os.path.join(self.tmp, 'cover.png'), '-map', '0:a', '-map', '1:v', '-c:v', 'mjpeg', '-id3v2_version', '3',
                                       '-metadata', f'artist={ar}', '-metadata', f'album={al}', '-metadata', f'title={t}', '-metadata', f'genre={g}', '-metadata', 'date=2001', '-metadata', f'track={i + 1}',
                                       os.path.join(self.music, f'{i + 1:02d}-{t}.mp3')])
        d = os.path.join(self.tmp, 'data'); os.makedirs(d); p = self.port
        open(os.path.join(d, 'server.json'), 'w').write(json.dumps({'bindAddress': '127.0.0.1', 'httpPort': p, 'httpsPort': p + 100, 'audioPort': p + 200, 'clockPort': p + 300, 'discoveryPort': p + 400, 'discovery': False, 'ffmpegPath': shutil.which('ffmpeg'), **({'webRoot': os.environ['WAVWIZ_WEBROOT']} if os.environ.get('WAVWIZ_WEBROOT') else {})}))
        self.srv = subprocess.Popen([self.dotnet, self.dll, '--data-dir', d, '--bind', '127.0.0.1'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try: self.api('/auth/state'); break
            except Exception: time.sleep(0.3)
        self.api('/auth/setup', {'password': 'smoke-test-pw-1'}, jar=self.jar)
        if self.seed:
            self.api('/library/roots', {'path': self.music}, jar=self.jar); time.sleep(3)
            self.api('/radio', {'name': 'Test FM', 'url': 'http://127.0.0.1:1/x', 'genre': 'Test'}, jar=self.jar)
            self.ids = [t['id'] for t in self.api('/library/search?q=Daft', jar=self.jar)]
            self.all_ids = self.ids + [t['id'] for t in self.api('/library/search?q=Lanterns', jar=self.jar)]
            self.api('/queue/add', {'kind': 'tracks', 'ids': self.all_ids}, jar=self.jar)
        self.cookie = [c for c in self.jar if c.name == 'unison_session'][0]

    def api(self, path, body=None, method=None, jar=None):
        req = urllib.request.Request(self.base + '/api/v1' + path, data=json.dumps(body).encode() if body is not None else None, method=method or ('POST' if body is not None else 'GET'), headers={'Content-Type': 'application/json', 'Origin': self.base})
        op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar if jar is not None else self.jar))
        with op.open(req, timeout=15) as r: return json.loads(r.read() or b'null')

    # ---- chrome
    def start_chrome(self, extra=()):
        self.chrome = subprocess.Popen(['/usr/bin/google-chrome', '--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
                                        f'--remote-debugging-port={self.cdp_port}', '--remote-allow-origins=*', '--user-data-dir=' + os.path.join(self.tmp, 'chrome'), *extra, 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try: tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{self.cdp_port}/json')); break
            except Exception: time.sleep(0.3)
        self.ws = websocket.create_connection([t for t in tabs if t['type'] == 'page'][0]['webSocketDebuggerUrl'], timeout=60)
        for d in ('Runtime', 'Log', 'Page', 'Network'): self.call(d + '.enable')
        self.call('Network.setCookie', name='unison_session', value=self.cookie.value, url=self.base, httpOnly=True)

    def call(self, m, **p):
        self.n += 1; self.ws.send(json.dumps({'id': self.n, 'method': m, 'params': p}))
        while True:
            r = json.loads(self.ws.recv())
            if r.get('method') == 'Runtime.exceptionThrown': self.errors.append(r['params']['exceptionDetails'].get('exception', {}).get('description') or r['params']['exceptionDetails']['text'])
            if r.get('method') == 'Runtime.consoleAPICalled' and r['params']['type'] == 'error': self.errors.append('console.error: ' + ' '.join(str(x.get('value', x.get('description'))) for x in r['params']['args'])[:300])
            if r.get('method') == 'Log.entryAdded' and r['params']['entry']['level'] == 'error' and 'favicon' not in r['params']['entry'].get('url', ''): self.errors.append('log: ' + r['params']['entry']['text'][:200] + ' ' + r['params']['entry'].get('url', ''))
            if r.get('id') == self.n: return r.get('result')

    def ev(self, expr):
        r = self.call('Runtime.evaluate', expression=expr, returnByValue=True, awaitPromise=True)
        if 'exceptionDetails' in r: self.fails.append('eval failed: ' + expr[:90] + ' -> ' + str(r['exceptionDetails'].get('exception', {}).get('description', ''))[:200]); return None
        return r['result'].get('value')

    def wait(self, expr, secs=8):
        end = time.time() + secs
        while time.time() < end:
            if self.ev(expr): return True
            time.sleep(0.25)
        return False

    def check(self, ok, what):
        if not ok: self.fails.append(what)
        print(('  ok   ' if ok else '  FAIL ') + what); sys.stdout.flush()
        return ok

    def shot(self, name):
        open(os.path.join(self.out, name), 'wb').write(base64.b64decode(self.call('Page.captureScreenshot', format='png')['data']))

    def size(self, w, h, mobile=False, dpr=1): self.call('Emulation.setDeviceMetricsOverride', width=w, height=h, deviceScaleFactor=dpr, mobile=mobile)
    def load(self, path='/', wait=1.5): self.call('Page.navigate', url=self.base + path); time.sleep(wait)
    def go(self, k): return self.ev(f"import('/js/main.js').then(m => {{ m.go('{k}', true); return true; }})")

    def close(self):
        for p in (self.chrome, self.srv):
            if p:
                p.terminate()
                try: p.wait(5)
                except Exception: p.kill()
        shutil.rmtree(self.tmp, ignore_errors=True)
