// 0.0.8: never leave a blank page. A classic (non-module) script: if the app has not drawn anything 8 s after load (a module failed to load,
// the WebView's engine choked, an old cached file), show a readable message with "Reload" and "Sign in again" instead of an empty gray/dark window.
(function () {
  function show() {
    var app = document.getElementById('app'); if (!app) return;
    for (var i = 0; i < app.children.length; i++) if (app.children[i].tagName !== 'NOSCRIPT') return;
    app.innerHTML = '';
    var box = document.createElement('div'); box.className = 'card auth bootfail';
    var h = document.createElement('h2'); h.textContent = 'WavWiz is still starting'; box.appendChild(h);
    var p = document.createElement('p'); p.className = 'dim'; p.textContent = 'The page did not finish loading. Reload it; if that does not help, sign in again (Player or Administrator).'; box.appendChild(p);
    var r = document.createElement('button'); r.className = 'btn primary'; r.textContent = 'Reload'; r.onclick = function () { location.reload(); }; box.appendChild(r);
    var s = document.createElement('button'); s.className = 'btn'; s.textContent = 'Sign in again'; s.style.marginLeft = '8px';
    s.onclick = function () { fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(function () { location.reload(); }, function () { location.reload(); }); };
    box.appendChild(s); app.appendChild(box);
  }
  window.addEventListener('load', function () { setTimeout(show, 8000); });
  document.addEventListener('DOMContentLoaded', function () {
    var m = document.querySelector('script[type=module]'); if (m) m.addEventListener('error', function () { setTimeout(show, 50); });
  });
})();
