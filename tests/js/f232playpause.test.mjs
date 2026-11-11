// F232: Devices qb42 title + idle follow play/pause via patchLive42 (not stuck until full rebuild).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = readFileSync(`${js}/devices.js`, 'utf8');

test('F232 LIVE42 includes .qb42-t; patchLive42 copies idle + aria-label', () => {
  assert.match(src, /LIVE42 = \[[^\]]*'\.qb42-t'/);
  assert.match(src, /classList\.toggle\('idle'/);
  assert.match(src, /setAttribute\('aria-label'/);
  assert.match(src, /section\.qb42\[data-leader-id\]/);
});

test('F232 patchLive42 play↔pause updates title, idle, aria without rebuild', async () => {
  const doc = installDom();
  globalThis.CSS ??= {}; globalThis.CSS.escape ??= s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  // minidom has no outerHTML; patchLive42 uses it to skip unchanged nodes
  const { Element } = globalThis;
  if (!Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML')) {
    Object.defineProperty(Element.prototype, 'outerHTML', {
      configurable: true,
      get() {
        const attrs = [...this._a.entries()].map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`).join('');
        const inner = this.childNodes.map(c => c.nodeType === 3 ? c.data : c.outerHTML).join('');
        const t = this.tagName.toLowerCase();
        return `<${t}${attrs}>${inner}</${t}>`;
      },
    });
  }
  const { patchLive42 } = await import(pathToFileURL(`${js}/devices.js`).href);
  const mk = (state, idle) => {
    const sec = doc.createElement('section');
    sec.className = 'qb42 solo' + (idle ? ' idle' : '');
    sec.dataset.leaderId = '10';
    sec.setAttribute('aria-label', `Queue: Basement · ${state.toUpperCase()}`);
    const head = doc.createElement('div'); head.className = 'qb42-head';
    const title = doc.createElement('div'); title.className = 'qb42-t qb42-pick';
    const name = doc.createElement('b'); name.className = 'qb42-name'; name.textContent = 'Queue: Basement';
    const st = doc.createElement('span'); st.className = 'qb42-st' + (state !== 'playing' ? ' dim' : ''); st.textContent = ` · ${state.toUpperCase()}`;
    title.append(name, st);
    const now = doc.createElement('div'); now.className = 'zl-now';
    const ico = doc.createElement('span'); ico.className = 'zl-ico'; ico.textContent = state === 'playing' ? '▶' : '❚❚';
    now.append(ico);
    const vol = doc.createElement('div'); vol.className = 'dvol qb42-vol'; vol.textContent = '50%';
    head.append(title, now, vol); sec.append(head);
    const wrap = doc.createElement('div'); wrap.className = 'tcol42'; wrap.append(sec); return wrap;
  };
  const cur = mk('playing', false);
  doc.body.append(cur);
  const r1 = patchLive42(cur, mk('paused', false));
  assert.equal(r1, 1);
  assert.match(cur.querySelector('.qb42-st').textContent, /PAUSED/);
  assert.equal(cur.querySelector('.zl-ico').textContent, '❚❚');
  assert.equal(cur.querySelector('section.qb42').getAttribute('aria-label'), 'Queue: Basement · PAUSED');
  assert.equal(cur.querySelector('section.qb42').classList.contains('idle'), false);
  const r2 = patchLive42(cur, mk('playing', false));
  assert.equal(r2, 1);
  assert.match(cur.querySelector('.qb42-st').textContent, /PLAYING/);
  assert.equal(cur.querySelector('.zl-ico').textContent, '▶');
  assert.equal(cur.querySelector('section.qb42').getAttribute('aria-label'), 'Queue: Basement · PLAYING');
  // leftover paused@0 → idle title.
  // 0.7.0 item 5c: DIG-R1 made idle part of the fold structure (foldSig42), so going idle REBUILDS the box (fresh listeners) instead of patching it
  const r3 = patchLive42(cur, mk('idle', true));
  assert.equal(r3, 0, 'idle changes the structure: the caller rebuilds');
  assert.equal(cur.querySelector('section.qb42').classList.contains('idle'), false, 'nothing half-patched before the rebuild');
});
