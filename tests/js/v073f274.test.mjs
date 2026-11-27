// WavWiz 0.7.3 F274: phone secure-setup clarity. "Make your phone secure" is an optional sub-step under Getting started's
// "Open it on your phone" (done only when a phone reported Secure ✓), the http-first QR, the reworked phone page script and no bare "HTTPS is off".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(`${js}/${n}.js`, 'utf8');
const css = readFileSync(`${js}/../tls.css`, 'utf8');
// ---- a tiny DOM (enough for h(), querySelector(All) with simple compound selectors, classList, text)
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.className = ''; this.nodeType = 1; this.ls = {}; this.disabled = false; this.parentNode = null; this.style = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; } hasAttribute(k) { return k in this.attrs; } removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(k, f) { (this.ls[k] ??= []).push(f); } click() { (this.ls.click || []).forEach(f => f({ target: this })); }
  append(...k) { for (const c of k) { if (c && typeof c === 'object') c.parentNode = this; this.children.push(c); } } remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); }
  replaceChildren(...k) { this.children = []; this.append(...k); }
  get classList() { const el = this; return { contains: c => el.className.split(/\s+/).includes(c), add: c => { if (!this.contains?.(c)) el.className = (el.className + ' ' + c).trim(); }, toggle() {} }; }
  get textContent() { return this.children.map(c => c.nodeType === 3 ? c.data : c.textContent).join(''); } set textContent(v) { this.children = [{ nodeType: 3, data: String(v) }]; }
  get isConnected() { return true; }
  all() { const out = []; for (const c of this.children) if (c && c.nodeType === 1) { out.push(c, ...c.all()); } return out; }
  matches(sel) { return sel.split(',').some(s => match(this, s.trim())); }
  querySelectorAll(sel) { return this.all().filter(e => e.matches(sel)); } querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function match(e, s) {
  const re = /([a-z]+)|\.([\w-]+)|\[([\w-]+)(?:="?([^"\]]*)"?)?\]/gi; let m, ok = true, any = false;
  while ((m = re.exec(s))) { any = true; if (m[1]) ok &&= e.tagName === m[1].toUpperCase(); else if (m[2]) ok &&= e.className.split(/\s+/).includes(m[2]); else ok &&= m[3] in e.attrs && (m[4] === undefined || e.attrs[m[3]] === m[4]); }
  return any && ok;
}
globalThis.document = { createElement: t => new El(t), createTextNode: d => ({ nodeType: 3, data: d }), body: new El('body'), querySelector: () => null, addEventListener() {} };
globalThis.Element ??= El; globalThis.window ??= globalThis; globalThis.addEventListener ??= () => {}; globalThis.dispatchEvent ??= () => {};
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; };
globalThis.localStorage = store(); globalThis.sessionStorage = store();
globalThis.location = { origin: 'http://192.168.1.57:47800', hostname: '192.168.1.57', search: '', hash: '' };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/129', clipboard: { writeText: async () => {} } }, configurable: true });


const text = e => e.textContent.replace(/\s+/g, ' ');
let ITEMS = [];
globalThis.fetch = async (url) => { const u = String(url);
  const body = u.includes('/checklist') ? { items: ITEMS, done: false, dismissed: false, remaining: 2 } : u.includes('/tls/info') ? { host: '192.168.1.57', httpPort: 47800 } : {};
  return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body }; };
globalThis.setInterval = () => 0; globalThis.clearInterval = () => {};
const S = { auth: { role: 'admin', thisMachine: true }, zones: [], groups: [] };
const base = (phoneOpen, phone) => [{ id: 'phone-open', title: 'Open it on your phone', done: phoneOpen, detail: '', required: false }, { id: 'server', done: true, detail: '' },
  { id: 'library', done: false, detail: '' }, { id: 'speaker', done: false, detail: '' }, { id: 'test', done: false, detail: '' }, { id: 'calibrate', done: false, detail: '' },
  { id: 'phone', title: 'Make your phone secure (optional)', required: false, detail: 'x', ...phone }];

test('F274: the page helpers - device label, Tailscale host, 2 s auto-continue, Home Screen note', async () => {
  const c = await imp('tls-setup-core');
  assert.equal(c.deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1'), 'iPhone');
  assert.equal(c.deviceName('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1'), 'iPad');
  assert.equal(c.deviceName('Mozilla/5.0 (Linux; Android 15; Pixel 8) Chrome/129.0 Mobile Safari/537.36'), 'Android phone');
  assert.equal(c.deviceName('Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome/129.0 Safari/537.36'), 'Android tablet');
  assert.equal(c.deviceName(''), 'Phone');
  assert.equal(c.isTailscaleHost('100.101.1.2'), true); assert.equal(c.isTailscaleHost('100.12.1.2'), false); assert.equal(c.isTailscaleHost('192.168.1.5'), false);
  assert.equal(c.AUTO_CONTINUE_MS, 2000);
  assert.match(c.a2hsNote(false, false), /regular \(not secure\) address/); assert.match(c.a2hsNote(true, false), /Open WavWiz \(secure\) first/); assert.match(c.a2hsNote(true, true), /secure address/);
});

test('F274: tls-setup.js - silent check on load, recheck on return, report Secure ✓ (text/plain, no preflight), 2 s auto-continue, calm not-yet card', () => {
  const t = src('tls-setup');
  assert.match(t, /else check\(true\);/, 'silent check on load');
  assert.match(t, /document\.addEventListener\('visibilitychange', \(\) => \{ if \(document\.visibilityState === 'visible' && !trusted\) check\(false\); \}\);/);
  assert.match(t, /fetch\(`https:\/\/\$\{via\}:\$\{https\}\/api\/v1\/tls\/trusted`, \{ method: 'POST', mode: 'no-cors', headers: \{ 'Content-Type': 'text\/plain' \}, body: JSON\.stringify\(\{ device: deviceName\(ua\) \}\) \}\)/);
  assert.match(t, /setTimeout\(\(\) => location\.replace\(secureHome\(\)\), AUTO_CONTINUE_MS\)/);
  assert.match(t, /if \(quiet && plain\.ok\) \{ set\('info', 'Make this phone secure', NOT_YET_TEXT/);
  assert.match(t, /set\('ok', '\\u\{1F512\} Secure connection \\u2713', 'This phone trusts WavWiz\. The microphone features work\.'\)/);
  assert.match(t, /Using mobile data\? Switch to your home Wi-Fi\./);
  // #11g regression: an https page alone still proves nothing - only another address on the certificate counts
  assert.match(t, /for \(const a of alts\) \{ const r = await ping\(`https:\/\/\$\{a\}:\$\{https\}\/api\/v1\/ping/); assert.match(t, /maybe\(\); return;/);
  assert.doesNotMatch(t, /Set up HTTPS/);
  assert.match(css, /\.card\.info\{border-color:#2f6fb5/); assert.match(css, /\.steps li\.callout\{border:2px solid #ffb300/);
});

test('F274: Getting started - "Make your phone secure" sits under "Open it on your phone" once a phone opened WavWiz; done only with a report', async () => {
  const { gettingStartedBody } = await imp('diag');
  ITEMS = base(false, { done: false });
  let b = await gettingStartedBody(S, () => {});
  assert.equal(b.querySelector('.gs-secure'), null, 'not before a phone opened WavWiz');
  assert.doesNotMatch(text(b), /Make your phone secure/, 'and not repeated under More (optional)');
  ITEMS = base(true, { done: false, devices: [] });
  b = await gettingStartedBody(S, () => {});
  const sec = b.querySelector('.gs-secure'); assert.ok(sec);
  assert.ok(b.querySelectorAll('.gs-step')[0].querySelector('.gs-secure'), 'inside the phone step');
  assert.match(text(sec), /Make your phone secure \(optional, about 2 minutes\)/);
  assert.match(text(sec), /Only needed to use your phone’s microphone: calibrating speakers, Announce and Check with phone\. Everything else already works\./);
  assert.equal(sec.querySelector('img.addspk-qr').getAttribute('src'), '/tls/qr.svg?to=secure');
  assert.equal(sec.querySelector('[data-act="secure-setup"]').getAttribute('href'), '/tls/setup?next=app');
  ITEMS = base(true, { done: true, devices: [{ name: 'iPhone', lastSeen: '2026-11-26T18:00:00Z' }, { name: 'Android phone', lastSeen: '2026-11-20T12:00:00Z' }] });
  b = await gettingStartedBody(S, () => {});
  assert.match(text(b.querySelector('[data-secure-list]')), /^iPhone: Secure ✓ \(.+\) · Android phone: Secure ✓ \(.+\)$/);
  const ss = await imp('securestep');
  assert.equal(ss.trustedLabel([{ name: 'iPhone', lastSeen: '2026-11-26T18:00:00Z' }], 'en-US'), 'iPhone: Secure ✓ (Nov 26)');
  const onPhone = ss.secureStep({ devices: [] }, { onPhone: true });
  assert.equal(onPhone.querySelector('img'), null); assert.equal(onPhone.querySelector('a[data-act="secure-setup"]').getAttribute('href'), '/tls/setup?next=app');
});

test('F274: every "HTTPS is off" message says what still works and has one button; Remote HTTPS is hidden unless used', () => {
  const st = src('settings');
  assert.match(st, /st\.tls\.remote && st\.tls\.remote\.mode !== 'off' \? remoteTls\(st\.tls\.remote\) : null/);
  assert.match(st, /st\.tls\.remote && st\.tls\.remote\.mode === 'off' \? h\('div', \{ class: 'small' \}, h\('b', null, 'Secure remote access \(Tailscale\)'\), remoteTls/);
  assert.match(st, /'Off\. Music works\. Phones need it only for the microphone\.'/); assert.match(st, /'Set up secure connection'/);
  assert.match(st, /Phones with a secure connection: /); assert.match(st, /src: SECURE_QR/);
  assert.doesNotMatch(st, /more reliable sound on HTTPS/, 'no claim without a code basis');
  const ann = src('announce');
  assert.match(ann, /INSECURE_TITLE = 'Your phone\\'s microphone needs a secure connection'/); assert.match(ann, /INSECURE_BODY = 'One-time setup, about 2 minutes\. Music and controls keep working without it\.'/);
  assert.match(ann, /href: SECURE_SETUP \}, 'Set up secure connection'\)/); assert.match(ann, /'Switch to secure address'/);
  assert.match(src('zonecheck'), /INSECURE_TITLE = 'Your phone\\'s microphone needs a secure connection'/);
  assert.match(src('calerrors'), /INSECURE: \(\) => \(\{ title: 'Your phone\\'s microphone needs a secure connection', why: 'One-time setup, about 2 minutes\. Music and controls keep working without it\./);
  assert.match(src('calibrate'), /'Your phone needs a secure connection to use its microphone \(one-time, about 2 minutes\)\. '/);
  // copy lint (acceptance 7): no user-facing "HTTPS is off" / "not switched on" / "Set up HTTPS" in the web app
  const bad = [];
  for (const f of readdirSync(js).filter(n => n.endsWith('.js'))) { const s = readFileSync(`${js}/${f}`, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).map(l => l.replace(/\s\/\/ .*$/, '')).join('\n'); /* code and strings, not comments */ for (const re of [/HTTPS is off/, /not switched on/i, /'Set up HTTPS'/, /HTTPS is not set up/]) if (re.test(s)) bad.push(f + ' ' + re); }
  assert.deepEqual(bad, []);
});
