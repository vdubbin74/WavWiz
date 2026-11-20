// 0.6.9 #19 (t1846-t1849): the Jukebox zone OFF / ON pill "did nothing" - it flipped the zone's speakers, and with none (the Jukebox zone holds
// speakers only while it runs) the loop switched nothing and the pill sprang back. Now: a saved Jukebox-zone setting (off by default), staged
// with songs per guest + vote to skip and applied with Save; zone pills with no speakers are disabled with a tooltip instead of doing nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const js = process.env.JS_DIR || join(here, '../../src/WavWiz.Server/wwwroot/js');
const src = f => readFileSync(join(js, f), 'utf8');
const imp = f => import(pathToFileURL(join(js, f + '.js')).href);

test('#19 jbcfg: off by default (0.7.1 t2040u: no staging any more - every change is saved at once, see v071jukebox)', async () => {
  const m = await imp('jbcfg');
  assert.deepEqual(m.jbSaved({}), { zoneOn: false, perGuest: 3, voteSkip: true }, 'never set = off');
  assert.deepEqual(m.jbSaved({ zoneOn: true, perGuest: 5, voteSkip: false }), { zoneOn: true, perGuest: 5, voteSkip: false });
  assert.equal(m.jbDraft, undefined); assert.equal(m.jbStage, undefined);
});
test('#19 jbcfg: the hint says what ON / OFF does, and asks for a speaker when ON would not be heard', async () => {
  const m = await imp('jbcfg');
  assert.equal(m.jbHint(true, 0), 'On, but no speakers yet. Add a speaker to the Jukebox zone to hear it.');
  assert.match(m.jbHint(true, 2), /^On: guests’ songs play on the Jukebox zone’s speakers/);
  assert.match(m.jbHint(false, 2), /^Off: the Jukebox zone’s speakers stay silent/);
  assert.equal(m.EMPTY_ZONE_TIP, 'Add a speaker to this zone first');
});
test('#19 every OFF / ON pill: no dead press - zone pills with no speakers are disabled with a tooltip; the Jukebox pill uses the saved switch', () => {
  const d = src('devices.js'), t = src('tree42.js');
  assert.match(d, /export function onPill\(label, on, can, toggle, \{ empty = '', viewOnly = 'Your access is view-only\.' \} = \{\}\)/);
  assert.match(d, /if \(can && !empty\) toggle\(\);/); assert.match(d, /if \(can && empty\) \{ b\.disabled = true;/);
  // every zone (group) pill passes `empty` when the zone has no speakers (devices zcard3, tree zone card, tree zone pane)
  const groupPills = (d + t).match(/onPill\(`Zone \$\{g\.name\}`[^\n]+/g);
  assert.equal(groupPills.length, 3); for (const p of groupPills) assert.match(p, /\{ empty: ms\.length \? '' : EMPTY_ZONE_TIP \}/);
  // the Jukebox pills no longer loop over (possibly no) speakers
  assert.doesNotMatch(d + t, /onPill\('Jukebox zone'[^\n]*for \(const z of (ms|jbMs)\)/);
  assert.match(d, /onPill\('Jukebox zone', val\.zoneOn, admin, \(\) => \{ const want = !jbSaved\(jb\)\.zoneOn; jb\.zoneOn = want; paintJb\(\); jbSaver\(\)\.now\(\{ zoneOn: want \}\); \}/, 'panel: saved at once (0.7.1 t2040u)');
  assert.match(t, /api\('\/jukebox\/config', \{ method: 'PUT', body: \{ zoneOn: want \} \}\)/, 'tree quick switch: saved at once');
  assert.match(t, /on = jbSaved\(jb\)\.zoneOn;/);
});
test('#19 Jukebox zone panel (0.7.1 t2040u: saved on each change): settings, live controls, Start Jukebox switch', () => {
  const d = src('devices.js'), k = src('jukebox-kiosk.js');
  assert.match(d, /'Songs per guest'/); assert.match(d, /'Vote to skip'/); assert.match(d, /savedMsg\.textContent = '✓ Saved'/);
  assert.doesNotMatch(d, /'data-act': 'jb-zone-save'|'Unsaved Jukebox zone settings'/, 'no Save button, no unsaved prompt');
  // live controls kept: speaker picks, volume, mute
  assert.match(d, /api\('\/jukebox\/zone', \{ method: 'PUT', body: \{ deviceIds: next \} \}\)/); assert.match(d, /api\('\/jukebox\/zone\/volume'/);
  // Start Jukebox shows the saved switch (off by default) so a silent start is never a surprise
  assert.match(k, /checked: cfg\.zoneOn === true, 'data-act': 'jb-zone-on'/);
});
