// Phone set-up page (CSP: no inline scripts). Shows the right steps for this phone and runs the "does this phone trust WavWiz?" check.
const B = document.body, $ = id => document.getElementById(id);
const host = B.dataset.host, http = B.dataset.http, https = B.dataset.https, enabled = B.dataset.enabled === '1';
const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1), android = /Android/.test(ua);
const inApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|GSA\/|; wv\)|Snapchat|Twitter/.test(ua);
const safari = ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

// 0.2.3 fix: the step sections are visible by default (tls.css) so they still show if this script cannot load; here only the OTHER phone's steps are hidden
document.querySelectorAll('.dev-ios').forEach(e => e.classList.toggle('hide', android));
document.querySelectorAll('.dev-android').forEach(e => e.classList.toggle('hide', ios));
document.querySelector('.only-desktop')?.classList.toggle('show', !ios && !android);
if (ios && !safari && enabled) {
  const w = document.createElement('div'); w.className = 'card warn';
  w.innerHTML = '<b></b><p class="small"></p>'; w.firstChild.textContent = 'Open this page in Safari';
  w.lastChild.textContent = inApp ? 'You are inside another app\'s browser. iPhone only lets Safari install the certificate: tap the share/menu button and choose "Open in Safari".' : 'On iPhone only Safari can install the certificate profile. Copy this page\'s address and open it in Safari.';
  document.querySelector('main').insertBefore(w, document.querySelector('main').children[1]);
}

const set = (cls, title, text, extra) => {
  const s = $('status'); if (!s) return; s.className = 'card ' + cls; $('statusTitle').textContent = title; $('statusText').textContent = text;
  const a = $('advice'); a.replaceChildren(); if (extra) for (const n of extra) a.append(n);
};
const li = t => { const e = document.createElement('li'); e.textContent = t; return e; };
const ul = items => { const u = document.createElement('ul'); items.forEach(i => u.append(li(i))); return u; };

// 0.2.4: servers answer app:'wavwiz' (0.2.3 and older said 'unison'); accept both so a cached page and any server version agree
const isOurApp = app => app === 'wavwiz' || app === 'unison';
async function ping(url, ms = 7000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); const j = await r.json(); return j && isOurApp(j.app) ? { ok: true, https: j.https } : { ok: false, why: 'unexpected answer' }; }
  catch (e) { return { ok: false, why: e && e.name === 'AbortError' ? 'timeout' : 'blocked' }; }
  finally { clearTimeout(t); }
}

async function check() {
  const btn = $('check'); btn.disabled = true; btn.textContent = 'Checking...';
  set('', 'Checking...', 'Asking WavWiz over the secure address. This takes a few seconds.');
  try {
    if (location.protocol === 'https:') { good('You opened this page over HTTPS and your phone accepted the certificate.'); return; }
    // 1. plain network reachability (we are on http, so this one must work)
    const plain = await ping(`http://${host}:${http}/api/v1/ping?t=${Date.now()}`);
    // 2. the secure address; the browser refuses the connection if it does not trust the certificate
    const sec = await ping(`https://${host}:${https}/api/v1/ping?t=${Date.now()}`);
    if (sec.ok) { good('Your phone trusts the WavWiz certificate.'); return; }
    const adv = [];
    if (ios) { adv.push('Settings > General > About > Certificate Trust Settings: is "WavWiz Local CA (BETA)" switched ON? This is the step people miss.'); adv.push('Settings (top) > "Profile Downloaded": if it is still there, tap it and install it first.'); adv.push('Set this phone up before? WavWiz may have a new certificate: install the new profile below and switch it on. The old profile can be removed in Settings > General > VPN & Device Management.'); }
    else if (android) { adv.push('Settings > Security > Encryption & credentials > Install a certificate > CA certificate: choose the downloaded file.'); }
    adv.push('Make sure you are on the home Wi-Fi (not mobile data) and the same network as the WavWiz PC.');
    adv.push(`The PC's firewall must allow port ${https}. WavWiz's installer opens it for the home network; a "Public" network profile in Windows blocks it (WavWiz > Settings > Diagnostics tells you).`);
    adv.push('If the server\'s address changed, press "Set up HTTPS" again on the PC.');
    adv.push('Phone date/time wrong? An out-of-date clock makes every certificate look invalid.');
    // 0.2.3 fix: not trusted -> put the download button for THIS phone right here and point at the install steps below
    const steps = [...document.querySelectorAll('.dev:not(#a2hs-ios):not(#a2hs-android)')].filter(d => !d.classList.contains('hide'));
    const dl = document.createElement('p');
    for (const d of steps) { const b = d.querySelector('a.btn[href^="/tls/root-ca"]'); if (b) { const c = b.cloneNode(true); c.style.marginRight = '8px'; dl.append(c); } }
    steps.forEach(d => d.classList.add('focus'));
    set('bad', 'Not trusted yet', plain.ok ? 'Your phone can reach WavWiz, but the secure connection was refused. That means the certificate is not installed or not trusted yet - or port ' + https + ' is blocked.' : 'Your phone could not reach WavWiz at all (' + host + ').', [dl, ul(adv)]);
    if (B.dataset.mode === 'check' && steps[0]) { const n = document.createElement('p'); n.className = 'small'; n.textContent = 'Follow the install steps below, then tap Check my phone again.'; $('advice').append(n); }
  } finally { btn.disabled = false; btn.textContent = 'Check my phone'; }
}
// 0.2.2 T9: arrived from the Calibrate speakers QR code (?cal=CODE[&pair=CODE]): once the phone trusts WavWiz, go straight on to the secure
// calibration page (the music pauses there automatically). Only these two short codes are passed on.
const calQ = (() => { const q = new URLSearchParams(location.search), cal = q.get('cal') || '', pair = q.get('pair') || ''; if (!/^[A-Za-z0-9]{6}$/.test(cal)) return ''; return 'cal=' + cal + (/^[0-9]{6}$/.test(pair) ? '&pair=' + pair : ''); })();
const pairQ = (() => { const p = new URLSearchParams(location.search).get('pair') || ''; return !calQ && /^[0-9]{6}$/.test(p) ? p : ''; })();   // 0.3.7 L28: Pair a player QR
const secureHome = () => pairQ ? `https://${host}:${https}/?pair=${pairQ}` : calQ ? `https://${host}:${https}/calmic.html?` + calQ.replace(/&pair=\d+/, '') : `https://${host}:${https}/`;   // 0.2.5: calibration goes to the mic-only page
if (calQ) { const t = $('statusTitle'); if (t) t.textContent = 'Getting your phone ready to calibrate'; }
function good(msg) {
  set('ok', 'All set', msg);
  if (calQ) { $('statusText').textContent = msg + ' Opening the calibration page...'; setTimeout(() => location.replace(secureHome()), 900); }
  document.querySelectorAll('.steps li').forEach(l => l.classList.add('done'));
  document.querySelectorAll('.dev.focus').forEach(d => d.classList.remove('focus'));
  const d = $('done'); if (d) d.hidden = false;
  const a = $('advice'); const p = document.createElement('p'); const link = document.createElement('a'); link.className = 'btn'; link.href = secureHome(); link.textContent = calQ ? 'Open the calibration page' : 'Open WavWiz (secure)'; p.append(link); a.append(p);
}
if (enabled) {
  $('check').addEventListener('click', check);
  if (B.dataset.mode === 'check' || location.protocol === 'https:' || calQ) check();
}

// 0.3.7 L28: Add to Home Screen. Chrome / Android offers a real install prompt (beforeinstallprompt) -> the "Install WavWiz" button; iPhone has only the Share steps shown above.
// Already running as an installed app (display-mode: standalone / navigator.standalone): the steps are hidden - nothing to add.
{
  const standalone = matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) document.querySelectorAll('#a2hs-ios,#a2hs-android').forEach(x => { x.hidden = true; });
  let deferred = null; const ib = $('a2hsInstall');
  addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); deferred = ev; if (ib) ib.hidden = false; });
  ib?.addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); try { await deferred.userChoice; } catch { /* dismissed */ } deferred = null; ib.hidden = true; });
  addEventListener('appinstalled', () => { document.querySelectorAll('#a2hs-ios,#a2hs-android').forEach(x => { x.hidden = true; }); });
}
