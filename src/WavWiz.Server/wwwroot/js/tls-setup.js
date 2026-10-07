// Phone set-up page (CSP: no inline scripts). Shows the right steps for this phone and runs the "does this phone trust WavWiz?" check.
const B = document.body, $ = id => document.getElementById(id);
const host = B.dataset.host, http = B.dataset.http, https = B.dataset.https, enabled = B.dataset.enabled === '1';
const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1), android = /Android/.test(ua);
const inApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|GSA\/|; wv\)|Snapchat|Twitter/.test(ua);
const safari = ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

document.querySelector('.dev-ios')?.classList.toggle('show', ios || (!android));
document.querySelector('.dev-android')?.classList.toggle('show', android || (!ios));
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

async function ping(url, ms = 7000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); const j = await r.json(); return j && j.app === 'unison' ? { ok: true, https: j.https } : { ok: false, why: 'unexpected answer' }; }
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
    if (ios) { adv.push('Settings > General > About > Certificate Trust Settings: is "WavWiz Local CA (BETA)" switched ON? This is the step people miss.'); adv.push('Settings (top) > "Profile Downloaded": if it is still there, tap it and install it first.'); }
    else if (android) { adv.push('Settings > Security > Encryption & credentials > Install a certificate > CA certificate: choose the downloaded file.'); }
    adv.push('Make sure you are on the home Wi-Fi (not mobile data) and the same network as the WavWiz PC.');
    adv.push(`The PC's firewall must allow port ${https}. WavWiz's installer opens it for the home network; a "Public" network profile in Windows blocks it (WavWiz > Settings > Diagnostics tells you).`);
    adv.push('If the server\'s address changed, press "Set up HTTPS" again on the PC.');
    adv.push('Phone date/time wrong? An out-of-date clock makes every certificate look invalid.');
    set('bad', 'Not trusted yet', plain.ok ? 'Your phone can reach WavWiz, but the secure connection was refused. That means the certificate is not installed or not trusted yet - or port ' + https + ' is blocked.' : 'Your phone could not reach WavWiz at all (' + host + ').', [ul(adv)]);
  } finally { btn.disabled = false; btn.textContent = 'Check my phone'; }
}
function good(msg) {
  set('ok', 'All set', msg);
  document.querySelectorAll('.steps li').forEach(l => l.classList.add('done'));
  const d = $('done'); if (d) d.hidden = false;
  const a = $('advice'); const p = document.createElement('p'); const link = document.createElement('a'); link.className = 'btn'; link.href = `https://${host}:${https}/`; link.textContent = 'Open WavWiz (secure)'; p.append(link); a.append(p);
}
if (enabled) {
  $('check').addEventListener('click', check);
  if (B.dataset.mode === 'check' || location.protocol === 'https:') check();
}
