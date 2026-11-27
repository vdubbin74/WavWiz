// 0.7.3 t2241u: on iPhone (Safari and the Home Screen app) Settings > Export settings sent the app page to the .wavwizbackup file, so iOS showed a
// full-screen "….wavwizbackup / Open in…" viewer with no way back. A real phone now fetches the file and shares it (Save to Files) or saves it from
// a Blob URL in a new tab; the app page never navigates. PC browsers keep Save As / the plain download.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = f => readFileSync(join(js, f), 'utf8');
const doc = installDom(); doc.defaultView = globalThis;
const imp = f => import(pathToFileURL(join(js, f)).href);
class F { constructor(parts, name, o) { this.parts = parts; this.name = name; this.type = o?.type; } }
const fakeUrl = () => { const made = [], revoked = []; return { made, revoked, createObjectURL: b => { made.push(b); return 'blob:wavwiz/1'; }, revokeObjectURL: u => revoked.push(u) }; };
const clicks = () => { const seen = []; const orig = doc.createElement.bind(doc); doc.createElement = t => { const e = orig(t); if (String(t).toLowerCase() === 'a') e.click = () => seen.push({ href: e.getAttribute('href'), download: e.getAttribute('download'), target: e.getAttribute('target'), inPage: !!e.parentNode }); return e; }; return { seen, done: () => { doc.createElement = orig; } }; };

test('exportMode: a real phone shares or saves a Blob; a PC keeps Save As, or the plain download without it', async () => {
  const { exportMode } = await imp('settingsui.js');
  const share = { navigator: { share() {}, canShare() { return true; } }, File: F };
  assert.equal(exportMode(share, true), 'share');
  assert.equal(exportMode({ navigator: {}, File: F }, true), 'blob');
  assert.equal(exportMode({ ...share, showSaveFilePicker() {} }, true), 'share');   // a phone never uses the PC paths
  assert.equal(exportMode({ showSaveFilePicker() {}, ...share }, false), 'picker');
  assert.equal(exportMode(share, false), 'link');   // desktop without Save As: unchanged plain download
  assert.equal(exportMode({}, false), 'link');
});

test('saveBlob: an <a download> on a Blob URL in a new tab, removed after the click; the page itself never navigates', async () => {
  const { saveBlob } = await imp('settingsui.js');
  const U = fakeUrl(), c = clicks();
  try { saveBlob({ size: 17000 }, 'WavWiz-2026-11-26.wavwizbackup', doc, U); } finally { c.done(); }
  assert.deepEqual(c.seen, [{ href: 'blob:wavwiz/1', download: 'WavWiz-2026-11-26.wavwizbackup', target: '_blank', inPage: true }]);
  assert.equal(doc.querySelectorAll('a').length, 0);
  assert.equal(U.made.length, 1);
});

test('shareFile: shares a File named like the backup (Save to Files); canShare false or a share error falls back to saveBlob; Cancel is silent', async () => {
  const { shareFile } = await imp('settingsui.js');
  const shared = [], U = fakeUrl();
  const w = (canShare, share) => ({ File: F, document: doc, URL: U, navigator: { canShare: o => { assert.ok(o.files[0] instanceof F); return canShare; }, share } });
  assert.equal(await shareFile({ size: 1 }, 'WavWiz-2026-11-26.wavwizbackup', w(true, async o => { shared.push(o); })), 'shared');
  assert.equal(shared[0].files[0].name, 'WavWiz-2026-11-26.wavwizbackup'); assert.equal(shared[0].files[0].type, 'application/octet-stream');
  const c = clicks();
  try {
    assert.equal(await shareFile({ size: 1 }, 'a.wavwizbackup', w(false, async () => { throw new Error('never'); })), 'blob');
    assert.equal(await shareFile({ size: 1 }, 'b.wavwizbackup', w(true, async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; })), 'cancel');
    assert.equal(await shareFile({ size: 1 }, 'c.wavwizbackup', w(true, async () => { throw new TypeError('no'); })), 'blob');
  } finally { c.done(); }
  assert.deepEqual(c.seen.map(x => x.download), ['a.wavwizbackup', 'c.wavwizbackup']);
});

test('exportBackup wiring: phones fetch then share / save (never the /api link); PCs keep Save As and the old plain download; Import stays a file picker', () => {
  const s = src('settingsui.js'), body = s.slice(s.indexOf('export async function exportBackup('), s.indexOf('export function backupCard('));
  assert.match(body, /exportMode\(window, typeof document !== 'undefined' && !!document\.documentElement\?\.classList\?\.contains\('handset'\)\)/);
  assert.match(body, /if \(mode === 'share' \|\| mode === 'blob'\) \{[^]*?fetch\('\/api\/v1\/backup'[^]*?if \(mode === 'share'\) await shareFile\(blob, name\); else saveBlob\(blob, name\);/);
  assert.match(body, /if \(mode === 'link'\) \{\n    const a = h\('a', \{ href: '\/api\/v1\/backup', download: name \}\)/);
  assert.equal((body.match(/href: '\/api\/v1\/backup'/g) || []).length, 1);
  assert.match(body, /window\.showSaveFilePicker\(\{ suggestedName: name/);
  assert.doesNotMatch(s, /location\.(href|assign)|window\.open\(/);
  assert.match(s, /h\('input', \{ type: 'file', accept: '\.wavwizbackup', hidden: true \}\)/);   // Import reads a picked file in the page
  assert.match(src('backupflow.js'), /export function exportSettings\(S\) \{\n  if \(adminOnlyToast\(S\)\) return;\n  return exportBackup\(\);/);   // File > Export settings goes the same way
});
