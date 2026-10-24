// 0.4.6 F44: the phone keeps ONE speaker identity across launches (3 reloads, WebKit 390, emulated standalone + Safari) and the delay saved for it
// on the server is unchanged by a launch.
import { webkit } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const br = await webkit.launch();
for (const mode of ['standalone', 'safari']) {
  const c = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([m]) => { if (m === 'standalone') Object.defineProperty(navigator, 'standalone', { get: () => true }); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); }, [mode]);
  const p = await c.newPage(); const ids = [], delays = [];
  for (let i = 0; i < 3; i++) { await p.goto(B + '/'); await p.waitForTimeout(1500);
    const r = await p.evaluate(async () => { const m = await import('/js/room.js'); const id = m.roomId(); const z = await (await fetch('/api/zones')).json().catch(() => null); const me = (z?.zones || z || []).find?.(x => x.playerId === id || x.player?.id === id); return { id, delay: me ? me.latencyMs : null }; });
    ids.push(r.id); delays.push(r.delay); }
  ok(`[${mode}] the speaker id is the same on all 3 launches`, ids.every(x => x && x === ids[0]), JSON.stringify(ids));
  ok(`[${mode}] the saved delay is the same on all 3 launches`, delays.every(x => x === delays[0]), JSON.stringify(delays));
  await c.close(); }
await br.close(); console.log(`f44reload: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
