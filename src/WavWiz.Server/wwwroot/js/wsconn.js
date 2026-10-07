/**
 * 0.0.7: one robust WebSocket helper for every live connection (UI events, phone device, clock, visualizer).
 * - Auth: a one-time ticket from POST /api/v1/auth/ws-ticket goes in ?ticket= (iOS Safari over plain http does not reliably send the
 *   session cookie on the WebSocket handshake; that was the never-clearing red "Reconnecting…" on iPhone in 0.0.6).
 * - Keepalive: a tiny text ping every 15 s; a watchdog closes a socket that has been silent for `silentMs` (half-open Wi-Fi links).
 * - Backoff: 0.5 s, 1 s, 2 s … capped at 10 s with jitter, reset on every successful open; immediate retry when the page comes back
 *   to the foreground, the network comes back or Safari restores the page from its back/forward cache.
 */
export function backoffMs(attempt, rnd = Math.random) { const base = Math.min(10000, 500 * Math.pow(2, Math.max(0, attempt))); return Math.round(base * (0.75 + 0.5 * rnd())); }

export function wsUrl(path, ticket, loc = location) {
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  const sep = path.includes('?') ? '&' : '?';
  return `${proto}://${loc.host}${path}${ticket ? sep + 'ticket=' + encodeURIComponent(ticket) : ''}`;
}

export async function getTicket() {
  try {
    const r = await fetch('/api/v1/auth/ws-ticket', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' });
    if (r.status === 401) return { unauthorized: true };
    if (!r.ok) return {};
    const j = await r.json(); return { ticket: j.ticket };
  } catch { return {}; }
}

/** Opens one socket once (resolves on open, rejects on failure/timeout). */
export async function openOnce(path, { binary = false, timeoutMs = 8000 } = {}) {
  const t = await getTicket();
  const ws = new WebSocket(wsUrl(path, t.ticket));
  if (binary) ws.binaryType = 'arraybuffer';
  await new Promise((res, rej) => {
    const to = setTimeout(() => { try { ws.close(); } catch { /* closing */ } rej(new Error('timed out')); }, timeoutMs);
    ws.onopen = () => { clearTimeout(to); res(); };
    ws.onerror = () => { clearTimeout(to); rej(new Error(t.unauthorized ? 'not signed in' : 'could not connect')); };
  });
  return ws;
}

/** A self-healing connection. Returns { send, close, socket(), stats }. */
export function liveSocket(path, { binary = false, onOpen, onMessage, onClose, onUnauthorized, pingMs = 15000, silentMs = 45000, pingText = '{"type":"ping"}' } = {}) {
  let ws = null, attempt = 0, closed = false, retryTimer = null, pingTimer = null, lastRx = 0, connecting = false;
  const stats = { opens: 0, closes: 0, lastCloseCode: null, lastError: null };
  const schedule = (ms) => { clearTimeout(retryTimer); if (!closed) retryTimer = setTimeout(connect, ms); };
  async function connect() {
    if (closed || connecting || (ws && ws.readyState <= 1)) return;
    connecting = true; clearTimeout(retryTimer);
    const t = await getTicket();
    connecting = false;
    if (closed) return;
    if (t.unauthorized) { stats.lastError = 'not signed in'; onUnauthorized && onUnauthorized(); schedule(backoffMs(attempt++)); return; }
    let s; try { s = new WebSocket(wsUrl(path, t.ticket)); } catch (e) { stats.lastError = e.message; schedule(backoffMs(attempt++)); return; }
    ws = s; if (binary) s.binaryType = 'arraybuffer';
    const openTo = setTimeout(() => { if (s.readyState === 0) { try { s.close(); } catch { /* closing */ } } }, 8000);
    s.onopen = () => { clearTimeout(openTo); attempt = 0; stats.opens++; lastRx = Date.now(); onOpen && onOpen(s); };
    s.onmessage = ev => { lastRx = Date.now(); onMessage && onMessage(ev, s); };
    s.onerror = () => { stats.lastError = 'socket error'; };
    s.onclose = ev => {
      clearTimeout(openTo); stats.closes++; stats.lastCloseCode = ev?.code ?? null;
      if (ws === s) ws = null;
      onClose && onClose(ev);
      if (!closed) schedule(backoffMs(attempt++));
    };
  }
  const kick = () => { if (closed) return; if (!ws || ws.readyState > 1) { attempt = 0; schedule(50); } else if (Date.now() - lastRx > silentMs) { try { ws.close(); } catch { /* closing */ } } };
  pingTimer = setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    if (Date.now() - lastRx > silentMs) { try { ws.close(4000, 'silent'); } catch { /* closing */ } return; }
    if (pingText) { try { ws.send(pingText); } catch { /* closing */ } }
  }, pingMs);
  const vis = () => { if (!document.hidden) kick(); };
  document.addEventListener('visibilitychange', vis); window.addEventListener('online', kick); window.addEventListener('pageshow', kick); window.addEventListener('focus', kick);
  connect();
  return {
    stats, socket: () => ws, kick,
    send(data) { try { if (ws?.readyState === 1) { ws.send(data); return true; } } catch { /* closing */ } return false; },
    close() { closed = true; clearTimeout(retryTimer); clearInterval(pingTimer); document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', kick); window.removeEventListener('pageshow', kick); window.removeEventListener('focus', kick); try { ws?.close(); } catch { /* closing */ } },
  };
}
