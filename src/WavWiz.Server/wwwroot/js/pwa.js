// WavWiz 0.3.4 H1: registers the service worker (sw.js), versioned by the server's app version so an upgrade always installs a fresh one.
export const swUrl = v => '/sw.js?v=' + encodeURIComponent(String(v || 'dev'));
export async function registerSw(nav = globalThis.navigator, fetchFn = (...a) => fetch(...a)) {
  if (!nav?.serviceWorker || !globalThis.isSecureContext) return null;   // service workers need https (or localhost); plain-LAN http simply skips this
  try {
    const st = await (await fetchFn('/api/v1/auth/state', { cache: 'no-store' })).json();
    return await nav.serviceWorker.register(swUrl(st.appVersion), { scope: '/', updateViaCache: 'none' });
  } catch { return null; }
}
if (typeof window !== 'undefined' && !window.chrome?.webview) addEventListener('load', () => { registerSw(); }, { once: true });
