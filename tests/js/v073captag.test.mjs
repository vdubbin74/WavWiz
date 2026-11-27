// 0.7.3 t2249u: the speaker / zone volume-limit tag is "CAP 50%" (was "CAPPED 50%"), still with the lock icon, and says it in full
// ("Volume capped at 50%") in its tooltip and aria-label. One builder (cardTags3 / zoneTags3 + tagEls3) feeds Devices, zone rows,
// unassigned speakers and the expanded tree, so there is no second copy of the text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
globalThis.Element ??= class {};
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');

test('speaker + zone tags: "CAP n%", lock icon, full label', async () => {
  const d = await imp('devices');
  const sp = d.cardTags3({ id: 'a', name: 'Kitchen', enabled: true, connected: true, volLocked: true, volCap: 50, outputs: [] }).find(t => t.k === 'capped');
  assert.equal(sp.text, 'CAP 50%'); assert.equal(sp.label, 'Volume capped at 50%'); assert.equal(sp.lock, true);
  const zs = [{ id: 'a', name: 'A', volLocked: true, volCap: 50, outputs: [] }, { id: 'b', name: 'B', outputs: [] }];
  const zt = d.zoneTags3(zs, { deviceIds: ['a', 'b'] }).find(t => t.k === 'capped');
  assert.equal(zt.text, 'CAP 75%'); assert.equal(zt.label, 'Volume capped at 75%'); assert.equal(zt.lock, true);
  assert.equal(d.cardTags3({ id: 'c', enabled: true, connected: true, volLocked: true, volCap: 33.6, outputs: [] }).find(t => t.k === 'capped').text, 'CAP 34%');
});

test('no "CAPPED" tag text left; tagEls3 puts the full label in title + aria-label and keeps the lock icon', () => {
  const s = src('devices.js');
  assert.doesNotMatch(s, /text: `CAPPED/);
  assert.match(s, /title: t\.label \? `\$\{t\.label\} - \$\{tip\}` : tip/);
  assert.match(s, /'aria-label': `\$\{t\.label \|\| t\.text\}: \$\{tip\}`/);
  assert.match(s, /title: t\.label \|\| t\.title, 'aria-label': t\.label \|\| undefined/);
  assert.match(s, /t\.lock \? icon\('lock'\) : null, t\.text\)/);
  for (const f of ['tree42.js', 'mixer.js', 'devices.js']) assert.doesNotMatch(src(f), /'CAPPED|"CAPPED|`CAPPED/, f);
});
