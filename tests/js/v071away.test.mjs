// WavWiz 0.7.1 t2073u: Settings > Network. The full-width "Away-from-home access (Tailscale)" button only scrolled to the section right below it
// ("does nothing, it just bumps the page down"). It is now the header of a fold around that section: closed without a Tailscale address, open
// with one, remembered once clicked; deep links and search hits open it. The "WavWiz listens on" summary is shown once (one Home network card).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(js, '..', 'app.css'), 'utf8');
const imp = m => import(pathToFileURL(join(js, m + '.js')).href);
const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const fakeView = st => (S, opts) => { queueMicrotask(() => opts.onState(st)); return { el: document.createElement('div'), reload() {} }; };
const tick = () => new Promise(r => setTimeout(r, 5));
const TS = { tailscale: { addresses: [{ ip: '100.102.134.105', interfaceName: 'Tailscale' }] } }, NOTS = { tailscale: { addresses: [] } };

test('t2073: the header is a real disclosure button for the panel body', async () => {
  installDom(); const { awayPanel } = await imp('remote');
  const p = awayPanel({ auth: {} }, { store: mem(), view: fakeView(NOTS) });
  assert.equal(p.el.id, 'sec-away');
  assert.equal(p.head.tagName, 'BUTTON'); assert.equal(p.head.getAttribute('type'), 'button');
  assert.equal(p.head.getAttribute('aria-controls'), p.body.id);
  assert.match(p.head.textContent, /Away-from-home access \(Tailscale\)/);
  assert.equal(p.head.getAttribute('aria-expanded'), 'false'); assert.equal(p.body.hidden, true);
});

test('t2073: closed without a Tailscale address, open with one (nothing remembered yet)', async () => {
  installDom(); const { awayPanel } = await imp('remote');
  const none = awayPanel({ auth: {} }, { store: mem(), view: fakeView(NOTS) }); await tick();
  assert.equal(none.isOpen(), false); assert.match(none.head.textContent, /Not set up/);
  const ts = awayPanel({ auth: {} }, { store: mem(), view: fakeView(TS) }); await tick();
  assert.equal(ts.isOpen(), true); assert.equal(ts.head.getAttribute('aria-expanded'), 'true'); assert.equal(ts.body.hidden, false);
  assert.match(ts.head.textContent, /100\.102\.134\.105/);
});

test('t2073: a click toggles and is remembered; the remembered state wins over detection', async () => {
  installDom(); const { awayPanel, AWAY_KEY } = await imp('remote');
  const st = mem(); const p = awayPanel({ auth: {} }, { store: st, view: fakeView(TS) }); await tick();
  assert.equal(p.isOpen(), true);
  p.head.click(); assert.equal(p.isOpen(), false); assert.equal(st.m.get(AWAY_KEY), '0');
  const again = awayPanel({ auth: {} }, { store: st, view: fakeView(TS) }); await tick();
  assert.equal(again.isOpen(), false, 'closed by the user stays closed even with Tailscale');
  again.head.click(); assert.equal(st.m.get(AWAY_KEY), '1');
  const open = awayPanel({ auth: {} }, { store: mem({ [AWAY_KEY]: '1' }), view: fakeView(NOTS) }); await tick();
  assert.equal(open.isOpen(), true);
});

test('t2073: a deep link / search hit opens the panel without changing the remembered choice', async () => {
  installDom(); const { awayPanel, AWAY_KEY } = await imp('remote');
  const st = mem({ [AWAY_KEY]: '0' }); const p = awayPanel({ auth: {} }, { store: st, view: fakeView(NOTS) }); await tick();
  assert.equal(p.isOpen(), false); p.el._reveal(); assert.equal(p.isOpen(), true); assert.equal(st.m.get(AWAY_KEY), '0');
  const set = src('settings.js'), ui = src('settingsui.js');
  assert.match(set, /function showSec\(id\) \{ const el = body\.querySelector\('#' \+ id\); if \(!el\) return; el\._reveal\?\.\(\);/);
  assert.match(ui, /hits\[0\]\.el\.closest\('\[data-fold\]'\)\?\._reveal\?\.\(\)/);
});

test('t2073: the old scroll-only button is gone and "listens on" is shown once (one Home network card)', () => {
  const set = src('settings.js');
  assert.doesNotMatch(set, /'Away-from-home access \(Tailscale\)'\)/, 'no separate button');
  assert.doesNotMatch(set, /scrollIntoView\(\{ block: 'start', behavior: 'smooth' \}\)/);
  assert.doesNotMatch(set, /Listening on \$\{listenText/);
  assert.match(set, /panes\.network\.push\(networkCard\(\{ auth: \{ role: admin \? 'admin' : 'view' \} \}, \{ title: 'Home network',/);
  assert.equal((set.match(/networkCard\(/g) || []).length, 1);
  assert.match(set, /panes\.network\.push\(awayPanel\(S, \{ onLoad: \(\) => search\.reindex\(\) \}\)\.el\);/);
});

test('t2073: networkCard takes a title and intro (Settings) and keeps "Network" for Diagnostics', async () => {
  installDom(); const { networkCard } = await imp('diag');
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ bind: '0.0.0.0', status: 'ok', problems: [], fixes: [], adapters: [], listen: { label: 'Home network + Tailscale/VPN', addresses: [{ address: '192.168.1.169' }] } }) });
  const c = networkCard({ auth: { role: 'admin' } }, { title: 'Home network', intro: 'WavWiz listens only on the address chosen at install.' });
  await tick();
  assert.equal(c.querySelector('h3').textContent, 'Home network');
  assert.match(c.textContent, /listens only on the address chosen at install/);
  assert.equal((c.textContent.match(/WavWiz listens on /g) || []).length, 1);
  const d = networkCard({ auth: { role: 'view' } }); await tick();
  assert.equal(d.querySelector('h3').textContent, 'Network');
});

test('t2073: the fold is themed for every layout (not a phone-only rule)', () => {
  assert.match(css, /\.awayhead\{[^}]*width:100%[^}]*\}/);
  assert.match(css, /\.awayhead\[aria-expanded=true\] \.awchev\{transform:rotate\(45deg\)\}/);
  assert.match(css, /\.awayhead:focus-visible\{outline:2px solid var\(--hl\)/);
  assert.match(css, /\.awaybody\[hidden\]\{display:none\}/);
  assert.doesNotMatch(css, /html\.handset [^{]*\.awayhead/);
});

test('t2073: once the panel content is in, Settings search is re-indexed (so "Prefer Tailscale" can be found and opens the fold)', async () => {
  installDom(); const { awayPanel } = await imp('remote');
  let n = 0; awayPanel({ auth: {} }, { store: mem(), view: fakeView(NOTS), onLoad: () => n++ });
  await tick(); await tick();
  assert.equal(n, 1);
});
