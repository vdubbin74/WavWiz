// 0.7.3 t2248u: Docker / iPhone sign-in reload loop. Pair or Administrator succeeded, the page did location.reload(), and the iPhone came back to
// the sign-in page every time. Root cause: the session cookie was SameSite=Strict, and iPhone Safari withholds a Strict cookie from a page that was
// opened by a cross-site navigation (the Camera's QR code, a link from Messages / Mail, a Home Screen icon) - on that page's own fetches and on its
// reload - so /auth/state never saw the new session. On Docker the phones open the plain-http QR link directly (no secure set-up hop), so it hit
// there first. Fix: Lax session cookie (cross-site writes are still refused by the Origin check), and after a sign-in a same-origin navigation
// (no reload) without the used ?pair= code, with a one-time marker so a browser that still drops the cookie sees why instead of looping.
// Also F274 W5 gap: the calibration QR code opens the secure set-up page like every other phone QR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = f => readFileSync(join(js, f), 'utf8');
const cs = f => readFileSync(new URL('../../src/WavWiz.Server/' + f, import.meta.url), 'utf8');
const imp = f => import(pathToFileURL(join(js, f)).href);

// A tiny model of the phone: a cookie jar the browser may refuse to use for this page (what iPhone Safari did with the Strict cookie).
function phone({ keepsCookie }) {
  const P = { cookie: null, loads: 0, url: { pathname: '/', search: '?pair=123456', hash: '' } };
  P.server = { state: () => ({ authenticated: keepsCookie && P.cookie === 'tok' }), pair: () => { P.cookie = 'tok'; } };
  P.loc = { get pathname() { return P.url.pathname; }, get search() { return P.url.search; }, get hash() { return P.url.hash; },
    reload() { P.loads++; }, replace(u) { P.loads++; const i = u.indexOf('?'); P.url = { pathname: i < 0 ? u : u.slice(0, i), search: i < 0 ? '' : u.slice(i), hash: '' }; } };
  return P;
}

test('repro: the old flow (pair -> location.reload) lands on the sign-in page again and again when the cookie is not used', () => {
  const P = phone({ keepsCookie: false });
  let screens = [];
  for (let i = 0; i < 3; i++) { P.server.pair(); P.loc.reload(); screens.push(P.server.state().authenticated ? 'app' : 'sign-in'); }
  assert.deepEqual(screens, ['sign-in', 'sign-in', 'sign-in'], 'the reload loop the iPhone showed');
  assert.equal(P.url.search, '?pair=123456', 'and the used pairing code stays prefilled');
});

test('new flow: one same-origin navigation, the used ?pair= is dropped, and a lost sign-in is explained once', async () => {
  const S = await imp('signin.js');
  const bad = phone({ keepsCookie: false }); bad.server.pair(); S.finishSignIn(bad.loc);
  assert.equal(bad.loads, 1); assert.equal(bad.url.search, '?signedin=1');
  const msg = S.lostSignInMessage(bad.loc, bad.server.state().authenticated);
  assert.equal(msg, S.SIGNIN_LOST); assert.match(msg, /did not keep the sign-in/); assert.match(msg, /Block All Cookies/);
  assert.equal(S.withoutMark(bad.loc), '/', 'boot strips the marker, so the next reload is a plain one');
  const ok = phone({ keepsCookie: true }); ok.server.pair(); S.finishSignIn(ok.loc);
  assert.equal(S.lostSignInMessage(ok.loc, ok.server.state().authenticated), '', 'signed in: no message');
  assert.equal(S.afterSignInUrl({ pathname: '/', search: '?pair=123456&wr=dev-1234' }), '/?wr=dev-1234&signedin=1', 'the Home Screen id stays');
  assert.equal(S.lostSignInMessage({ search: '' }, false), '', 'a normal visit to the sign-in page shows nothing');
});

test('main.js: Pair, Administrator, the server-PC sign-in and first-run setup continue with finishSignIn (no bare reload); boot shows the lost-sign-in text', () => {
  const m = src('main.js');
  assert.match(m, /await api\('\/auth\/pair', \{ method: 'POST', body: \{ code: code\.value, name: name\.value \} \}\); finishSignIn\(\);/);
  assert.match(m, /await api\('\/auth\/login', \{ method: 'POST', body: \{ password: pw\.value \} \}\); finishSignIn\(\);/);
  assert.match(m, /await api\('\/auth\/login', \{ method: 'POST', body: \{ password \} \}\); finishSignIn\(\); \}/);
  assert.match(m, /setupDone\(\); finishSignIn\(\);/);
  assert.doesNotMatch(m, /auth\/(pair|login)', \{ method: 'POST', body: [^}]*\} \}\); location\.reload\(\)/);
  assert.match(m, /const lost = lostSignInMessage\(location, S\.auth\.authenticated\);/);
  assert.match(m, /history\.replaceState\(history\.state, '', withoutMark\(location\)\)/);
  assert.match(m, /if \(!S\.auth\.authenticated\) return renderLogin\(undefined, lost\);/);
  assert.match(m, /const msg = h\('p', \{ class: 'err', role: 'alert' \}, lost\); lost = '';/);
});

test('server: Lax session cookie (HttpOnly, Secure on https); cross-site writes still need a same-host Origin; no forwarded-header trust', () => {
  const c = cs('Api/Common.cs');
  assert.match(c, /new CookieOptions \{ HttpOnly = true, SameSite = SameSiteMode\.Lax, Path = "\/", Secure = c\.Request\.IsHttps, MaxAge = TimeSpan\.FromDays\(days\) \}/);
  assert.doesNotMatch(c, /SameSiteMode\.(None|Strict)/);
  const w = cs('Host/WavWizServer.cs');
  assert.match(w, /if \(viaCookie && \(!HttpMethods\.IsGet\(c\.Request\.Method\) && !HttpMethods\.IsHead\(c\.Request\.Method\) \|\| c\.WebSockets\.IsWebSocketRequest\)\)/);
  assert.match(w, /string\.Equals\(ou\.Authority, c\.Request\.Host\.Value, StringComparison\.OrdinalIgnoreCase\)/);
  assert.match(w, /if \(!AuthService\.IsPrivateSource\(c\.Connection\.RemoteIpAddress, cfg\.ExtraAllowedSubnets\)\) \{ c\.Response\.StatusCode = 403; return; \}/, 'LAN-only stays');
  assert.doesNotMatch(w, /UseForwardedHeaders|X-Forwarded-For/, 'a proxy header can never make a source look local');
});

test('F274 W5: the calibration QR (and the typed /c/ link with HTTPS on) open the secure set-up page with the calibration hand-off', () => {
  const p = cs('Api/CalPhoneApi.cs');
  assert.match(p, /QrSvg\(\$"http:\/\/\{PhoneApi\.PhoneHost\(c, s\)\}:\{s\.Cfg\.HttpPort\}\{PhoneApi\.SecurePath\("cal", l\.Token\)\}"\)/);
  assert.doesNotMatch(p, /QrSvg\(\$"[^"]*\/c\/\{l\.Token\}"\)/, 'not the old /c/ short link');
  assert.match(p, /s\.Ca\.Enabled \? \$"http:\/\/\{host\}:\{s\.Cfg\.HttpPort\}\{PhoneApi\.SecurePath\("cal", l\.Token\)\}" : \$"http:\/\/\{host\}:\{s\.Cfg\.HttpPort\}\{MicPage\}\?\{q\}"/);
  assert.doesNotMatch(p, /\/tls\/check\?\{q\}/);
  assert.match(cs('Api/PhoneApi.cs'), /next == "cal" && cal is not null && CalCode\.IsMatch\(cal\) \? "\/tls\/setup\?next=cal&cal=" \+ cal : "\/tls\/setup\?next=app"/);
  // the set-up page keeps the hand-off: after trust it continues to the https mic page
  assert.match(src('tls-setup.js'), /calQ \? `https:\/\/\$\{host\}:\$\{https\}\/calmic\.html\?` \+ calQ/);
});
