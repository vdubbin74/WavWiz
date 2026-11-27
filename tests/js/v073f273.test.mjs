// WavWiz 0.7.3 F273: "Check your network" is step 1 of Getting started. Public = a high-contrast card (role=alert, the network name, 3 steps,
// Open network settings on the server PC only, Check again) and steps 2-6 dimmed + disabled under "Fix your network first · Skip for now";
// Private = a green row; Domain / unknown never dim. The server-PC banner (× hides 7 days) and the once-per-app-start auto-open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(`${js}/${n}.js`, 'utf8');
const css = readFileSync(`${js}/../app.css`, 'utf8');

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

const ITEMS = (net) => [...(net ? [{ id: 'network', title: 'Check your network', done: net.state === 'private', required: net.state === 'public' || net.state === 'private', network: 'Home-WiFi', kind: 'Wi-Fi', settingsUri: 'ms-settings:network-wifi', detail: '', ...net }] : []),
  { id: 'phone-open', title: 'Open it on your phone', done: false, detail: 'Scan the QR code', required: false },
  { id: 'server', done: true, detail: '' }, { id: 'library', done: false, detail: '' }, { id: 'speaker', done: false, detail: '' }, { id: 'test', done: false, detail: '' }, { id: 'calibrate', done: false, detail: '' }];
let CHECK = null; const calls = [];
globalThis.fetch = async (url) => { const u = String(url); calls.push(u);
  const body = u.includes('/checklist') ? { items: ITEMS(CHECK), done: false, dismissed: false, remaining: 3 } : u.includes('/tls/info') ? { host: '192.168.1.57', httpPort: 47800 } : {};
  return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body }; };
globalThis.setInterval = () => 0; globalThis.clearInterval = () => {};   // the 10 s re-check is covered separately
const S = here => ({ auth: { role: 'admin', thisMachine: here }, zones: [], groups: [] });
const text = e => e.textContent.replace(/\s+/g, ' ');

test('F273: the card colors pass AA (>= 4.5:1) and are fixed (theme-independent) in app.css', async () => {
  const n = await imp('netstep');
  for (const [k, c] of Object.entries(n.NET_COLORS)) assert.ok(n.contrast(c.bg, c.fg) >= 4.5, `${k} ${n.contrast(c.bg, c.fg).toFixed(2)}`);
  assert.ok(n.contrast('#1a1000', '#ffd27a') >= 4.5, 'primary button');
  assert.match(css, /\.netcard\.pub\{background:#ffb020!important;color:#1a1000!important/);
  assert.match(css, /\.netcard\.dom\{background:#cfe3ff!important;color:#0a1830!important/);
  assert.match(css, /\.netrow\.bad\{background:#ffd2cc!important;color:#4a0800!important/);
  assert.match(css, /\.net-later\{opacity:\.45;pointer-events:none/);
  assert.ok(n.contrast('#ffb020', '#1a1000') >= 4.5, 'banner');
});

test('F273: Getting started on Public: network step first, high-contrast card, steps 2-6 dimmed + disabled; Skip un-dims and keeps a red row', async () => {
  const { gettingStartedBody } = await imp('diag'); const n = await imp('netstep'); n._resetAlert(); sessionStorage.clear();
  CHECK = { state: 'public' };
  const b = await gettingStartedBody(S(true), () => {});
  const steps = b.querySelectorAll('.gs-step');
  assert.equal(steps[0].getAttribute('data-step'), 'network'); assert.match(text(steps[0]), /^1Check your network/);
  const card = b.querySelector('.netcard.pub'); assert.ok(card); assert.equal(card.getAttribute('role'), 'alert');
  assert.match(text(card), /Your network “Home-WiFi” is set to Public, so phones and other devices can’t find WavWiz\./);
  assert.equal(card.querySelectorAll('li').length, 3); assert.match(text(card), /Click your network \(“Home-WiFi”\)\./); assert.match(text(card), /Network profile type/);
  const open = card.querySelector('button[data-act="net-open"]'); assert.ok(open?.className.includes('primary')); assert.equal(text(open), 'Open network settings');
  assert.ok(card.querySelector('button[data-act="net-check"]'));
  const wait = b.querySelector('.net-wait'); assert.ok(wait); assert.match(text(wait), /Fix your network first · Skip for now/);
  const later = wait.querySelector('.net-later'); assert.equal(later.querySelectorAll('.gs-step').length, 5);
  assert.ok(later.querySelectorAll('button').every(x => x.disabled), 'every button in steps 2-6 is disabled');
  assert.match(text(later), /^2Open it on your phone/); assert.ok(later.querySelector('img.addspk-qr')); assert.match(text(later), /http:\/\/192\.168\.1\.57:47800\//);
  // the card announces once: a re-check render is not role=alert again
  assert.equal(n.netCard({ state: 'public', network: 'Home-WiFi' }, { thisMachine: true }).getAttribute('role'), null);
  // Skip for now
  wait.querySelector('button[data-act="net-skip"]').click(); assert.equal(sessionStorage.getItem(n.SKIP_KEY), '1');
  const b2 = await gettingStartedBody(S(true), () => {});
  assert.equal(b2.querySelector('.net-wait'), null); assert.ok(b2.querySelector('.netrow.bad')); assert.match(text(b2.querySelector('.netrow.bad')), /Network is Public: phones won’t connect\./);
  assert.ok(b2.querySelector('button[data-act="net-fix"]')); assert.equal(b2.querySelector('.netcard.pub'), null);
  sessionStorage.clear();
});

test('F273: Private = green row, nothing dimmed; Domain / unknown never dim; Ethernet wording; no network step off Windows', async () => {
  const { gettingStartedBody } = await imp('diag'); const n = await imp('netstep');
  CHECK = { state: 'private' }; let b = await gettingStartedBody(S(true), () => {});
  assert.match(text(b.querySelector('.netrow.ok')), /✓ Your network “Home-WiFi” is Private\. Phones can connect\./); assert.equal(b.querySelector('.net-wait'), null);
  assert.match(text(b.querySelectorAll('.gs-step')[1]), /^2Open it on your phone/);
  CHECK = { state: 'domain' }; b = await gettingStartedBody(S(true), () => {});
  assert.ok(b.querySelector('.netcard.dom')); assert.equal(b.querySelector('.net-wait'), null); assert.equal(b.querySelector('[data-act="net-open"]'), null);
  assert.match(text(b), /work \(domain\) network, so phones may not find WavWiz\. Ask whoever manages this PC\./);
  CHECK = { state: 'unknown' }; b = await gettingStartedBody(S(true), () => {});
  assert.match(text(b.querySelector('.netrow')), /Couldn’t check your network type/); assert.equal(b.querySelector('.net-wait'), null);
  CHECK = null; b = await gettingStartedBody(S(true), () => {});
  assert.match(text(b.querySelectorAll('.gs-step')[0]), /^1Open it on your phone/, 'Linux/Docker: the list starts at Open it on your phone');
  n._resetAlert(); assert.match(text(n.netCard({ state: 'public', network: 'Home', kind: 'Ethernet' }, { thisMachine: true })), /Click Ethernet\./);
});

test('F273: Open network settings only on the server PC; a phone gets "fix it on the PC"; the Player gets an allowlisted message', async () => {
  const n = await imp('netstep'); n._resetAlert();
  const phone = n.netCard({ state: 'public', network: 'Home-WiFi', kind: 'Wi-Fi' }, { thisMachine: false });
  assert.equal(phone.querySelector('[data-act="net-open"]'), null); assert.match(text(phone), /Fix this on the PC that runs WavWiz: Settings > Network & internet > your network > Private\./);
  assert.ok(phone.querySelector('[data-act="net-check"]'));
  const posted = []; const w = { chrome: { webview: { postMessage: m => posted.push(m) } } };
  assert.equal(n.openNetSettings('ms-settings:network-wifi', w), 'player'); assert.deepEqual(posted.at(-1), { open: 'ms-settings:network-wifi' });
  n.openNetSettings('ms-settings:privacy-webcam', w); assert.deepEqual(posted.at(-1), { open: 'ms-settings:network-status' }, 'anything else falls back to the status page');
  n.openNetSettings('https://evil.example', w); assert.deepEqual(posted.at(-1), { open: 'ms-settings:network-status' });
  assert.deepEqual(n.NET_URIS, ['ms-settings:network-wifi', 'ms-settings:network-ethernet', 'ms-settings:network-status']);
  assert.equal(n.netUri('Wi-Fi'), n.NET_URIS[0]); assert.equal(n.netUri('Ethernet'), n.NET_URIS[1]); assert.equal(n.netUri('Other'), n.NET_URIS[2]);
});

test('F273: the banner shows only on the server PC with Public; × hides it 7 days; clears when Private; auto-open once per app start', async () => {
  const n = await imp('netstep'); localStorage.clear(); sessionStorage.clear();
  const now = 1_000_000_000_000;
  assert.equal(n.showBanner({ thisMachine: true }, { state: 'public' }, now), true);
  assert.equal(n.showBanner({ thisMachine: false }, { state: 'public' }, now), false, 'never on phones');
  assert.equal(n.showBanner({ thisMachine: true }, { state: 'private' }, now), false, 'gone once Private');
  assert.equal(n.showBanner({ thisMachine: true }, { state: 'domain' }, now), false);
  const bn = n.netBanner({}); assert.match(text(bn), /Phones and other PCs can’t reach WavWiz: Windows has this network set to Public\./);
  assert.ok(bn.querySelector('[data-act="net-banner-fix"]')); n.hideBanner(now);
  assert.equal(n.showBanner({ thisMachine: true }, { state: 'public' }, now + 6 * 86400_000), false); assert.equal(n.showBanner({ thisMachine: true }, { state: 'public' }, now + 7 * 86400_000 + 1), true);
  const c = { dismissed: false, items: [{ id: 'network', state: 'public' }] };
  assert.equal(n.shouldAutoOpenPublic(c, { thisMachine: true }, false), true); n.markAutoOpened();
  assert.equal(n.shouldAutoOpenPublic(c, { thisMachine: true }, false), false, 'once per app start (sessionStorage)');
  sessionStorage.clear();
  assert.equal(n.shouldAutoOpenPublic(c, { thisMachine: false }, false), false); assert.equal(n.shouldAutoOpenPublic(c, { thisMachine: true }, true), false, "Don't open this by itself again");
  assert.equal(n.shouldAutoOpenPublic({ ...c, dismissed: true }, { thisMachine: true }, false), false);
  assert.equal(n.shouldAutoOpenPublic({ dismissed: false, items: [{ id: 'network', state: 'private' }] }, { thisMachine: true }, false), false);
  assert.equal(n.RECHECK_MS, 10000); assert.equal(n.BANNER_HIDE_MS, 7 * 24 * 3600_000);
});

test('F273: wiring - main.js banner (server PC), red status link, auto-open; diag.js 10 s re-check and Check again with ?fresh=true', () => {
  const m = src('main'), d = src('diag');
  assert.match(m, /app\.replaceChildren\(bar, netHost, desk, statusbar, nowc\.mini, tabs\)/);
  assert.match(m, /if \(S\.auth\?\.thisMachine\) \{ drawNetBanner\(\); setInterval\(drawNetBanner, BANNER_POLL_MS\); window\.addEventListener\('focus'/);
  assert.match(m, /'⚠ Network is Public'/); assert.match(m, /shouldAutoOpenPublic\(c, S\.auth, checklistDismissedLocal\(\)\)\) \{ markAutoOpened\(\); openSetup\(\); return; \}/);
  assert.match(d, /timer = setInterval\(async \(\) => \{/); assert.match(d, /api\('\/checklist\?fresh=true'\)/); assert.match(d, /}, RECHECK_MS\);/);
  assert.match(d, /api\('\/checklist' \+ \(fresh \? '\?fresh=true' : ''\)\)/);
  assert.doesNotMatch(src('netstep'), /firewall\s*add|netsh|Set-NetConnectionProfile/i, 'Phase 2 skipped: nothing changes a rule or the network type');
});
