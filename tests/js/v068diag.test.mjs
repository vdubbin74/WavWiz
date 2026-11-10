// 0.6.8-#7: Diagnostics - device-side checks target the connected server, the status line agrees with the rows, themed badges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const www = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const src = readFileSync(new URL('js/diag.js', www), 'utf8');
// load the two pure helpers without the DOM-bound imports
const body = src.slice(src.indexOf('export async function clientChecks'), src.indexOf('export function diagnosticsView')).replace(/export /g, '');
const { clientChecks, statusSummary } = new Function(body + '; return { clientChecks, statusSummary };')();
test('0.6.8-#7 device-side checks hit the server the page came from (PCBOXV2), never localhost', async () => {
  const urls = [];
  const loc = { hostname: '192.168.1.20', host: '192.168.1.20:47900', protocol: 'http:' };
  const fetchFn = async u => { urls.push(u); if (u.startsWith('https:')) throw new Error('untrusted'); return { json: async () => ({ app: 'wavwiz' }) }; };
  const rows = await clientChecks({ connected: true }, { name: 'PCBOXV2', httpsPort: 47901 }, { loc, fetchFn, now: () => 0 });
  assert.ok(urls.every(u => u.includes('192.168.1.20') && !/localhost|127\.0\.0\.1/.test(u)), urls.join());
  assert.match(rows[0].detail, /PCBOXV2 at 192\.168\.1\.20:47900/);
  assert.equal(rows.find(r => r.id === 'c-web').status, 'ok');
  assert.equal(rows.find(r => r.id === 'c-https').status, 'warn');
});
test('0.6.8-#7 status line never says fine next to a failing row', () => {
  assert.equal(statusSummary([], [{ status: 'ok' }]).text, 'Everything looks fine.');
  assert.match(statusSummary([], [{ status: 'ok' }, { status: 'fail' }, { status: 'warn' }]).text, /^1 problem and 1 warning/);
  assert.equal(statusSummary(['x'], [{ status: 'ok' }]), null);
  assert.doesNotMatch(src, /#e5483f|#ffb300/);
});
