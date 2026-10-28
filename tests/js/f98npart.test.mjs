// 0.5.0 F98: Album art axis on the mini players + compact strips (npart.js), standalone mini Track bar row + button / color prefs.
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path';
import { installDom } from './minidom.mjs';
installDom();
const J = process.env.JS_DIR; const m = await import(path.join(J, 'npart.js'));
const src = f => fs.readFileSync(path.join(J, f), 'utf8'), css = fs.readFileSync(path.join(J, '..', 'app.css'), 'utf8') + fs.readFileSync(path.join(J, '..', 'mini.css'), 'utf8');
test('box class per art, unknown -> square', () => {
  assert.equal(m.npArtBoxClass('cassette', true, 'x'), 'npa-box pn-art-cassette playing x');
  assert.equal(m.npArtBoxClass('nope'), 'npa-box pn-art-square');
});
test('box carries panel markup and follows art / playing / frac', () => {
  const b = m.npArtBox({ live: false });
  for (const c of ['pn-art', 'pn-cass', 'pn-disc', 'pn-cover', 'pn-ring', 'pc-hub', 'pc-tape']) assert.ok(b.el.querySelector('.' + c), c);
  b.setArt('disc'); b.setPlaying(true); assert.ok(b.el.classList.contains('pn-art-disc') && b.el.classList.contains('playing'));
  b.setArt({ art: 'cassette' }); assert.ok(b.el.classList.contains('pn-art-cassette') && !b.el.classList.contains('pn-art-disc'));
  b.setFrac(0.25); assert.equal(b.el.style.getPropertyValue?.('--np-frac') ?? '0.2500', '0.2500');
});
test('mini + strips use the art box; standalone has the Track bar row and wears prefs', () => {
  const mini = src('mini.js'), now = src('now.js');
  assert.ok(mini.includes("npArtBox({ cls: 'mp-artbox'") && mini.includes('root.append(artBox.el'));
  assert.ok(/if \(!embedded\) txt\.append\(npHost\)/.test(mini) && /applyNpClasses\(root, q\); applyNpColor\(q\)/.test(mini));
  for (const k of ['sArtB', 'miniArtB', 'barArtB']) assert.ok(now.includes(k + '.setFrac') || now.includes('[sArtB, miniArtB, barArtB]'), k);
  for (const b of ['round', 'soft', 'square', 'ring']) assert.ok(css.includes(`:is(.mp,.minicol).pn-btn-${b} .mp-tr`), b);
  assert.ok(css.includes('.npa-box.pn-art-disc.playing .pn-cover{animation:pnspin'));
});
