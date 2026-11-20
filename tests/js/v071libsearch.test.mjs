// 0.7.1 t2046u-t2048u: tapping an artist or an album in Library search results redrew the same results (phone, desktop wide and narrow).
// draw() checked the search before the page stack, so the page a tap pushed was never shown. Runs the real Library view on the tiny DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom, ev } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const doc = installDom(); doc.defaultView = globalThis;
globalThis.matchMedia ??= q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.getComputedStyle ??= () => ({ overflowY: 'visible', getPropertyValue: () => '' });
globalThis.requestAnimationFrame ??= f => setTimeout(f, 0);
globalThis.cancelAnimationFrame ??= t => clearTimeout(t);
globalThis.CSS ??= { escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c) };
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} };
globalThis.innerWidth ??= 1440; globalThis.innerHeight ??= 900;
const imp = f => import(pathToFileURL(join(js, f)).href);
const wait = ms => new Promise(r => setTimeout(r, ms));

const FIND = { artists: [{ name: 'Eminem', albums: 2, tracks: 20, artTrackIds: [] }, { name: 'Eminem (Ft. Jay-Z)', albums: 1, tracks: 1, artTrackIds: [] }],
  albums: [{ album: 'Curtain Call: The Hits', artist: 'Eminem', year: 2005, tracks: 17, artTrackId: 1 }, { album: 'Pyscho', artist: 'Someone Else', year: 2001, tracks: 9, artTrackId: 2 }], tracks: [] };
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url).replace('/api/v1', ''); calls.push((init.method || 'GET') + ' ' + u);
  let body = '[]';
  if (u.startsWith('/library/find')) body = JSON.stringify(FIND);
  else if (u.startsWith('/library/albums')) body = JSON.stringify(u.includes('artist=Eminem') ? [{ album: 'The Eminem Show', artist: 'Eminem', year: 2002, tracks: 20, artTrackId: 3 }] : []);
  else if (u.startsWith('/library/tracks') || u.includes('/tracks')) body = JSON.stringify([{ id: 11, title: 'Lose Yourself', artist: 'Eminem', album: 'Curtain Call: The Hits', durationMs: 1000, trackNo: 1 }]);
  else if (u.startsWith('/favorites')) body = JSON.stringify(u.includes('items') ? { albums: [], tracks: [] } : { albums: [], tracks: [] });
  else if (u.startsWith('/remote')) body = '[]';
  return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
};
const click = el => el.dispatchEvent(ev('click', { target: el }));

async function view(opts) {
  const { libraryView } = await imp('library.js');
  const S = { auth: { role: 'admin' }, now: null, zones: [], libTab: 'albums', libTabC: 'artists' };
  const v = libraryView(S, opts); v.el.getClientRects = () => [{ width: 300, height: 600 }]; doc.body.append(v.el); await v.reload(); await wait(30);
  const search = v.el.querySelector('input[type="search"]');
  const find = async q => { search.value = q; search.dispatchEvent(ev('input', { target: search })); await wait(320); };
  const rows = () => [...v.el.querySelectorAll('.libcontent li.item')];
  const row = t => rows().find(r => r.querySelector('.t1')?.textContent === t);
  const has = t => v.el.querySelector('.libcontent').textContent.includes(t);
  const title = () => v.el.querySelector('.crumbs b')?.textContent || null;
  const backBtn = () => [...v.el.querySelectorAll('.crumbs button')].find(b => /Back/.test(b.textContent));
  return { v, find, rows, row, has, title, backBtn };
}

for (const [name, opts] of [['phone', { phone: true }], ['desktop side panel (narrow)', { compact: true }], ['desktop wide (Expanded)', {}]]) {
  test(`t2046u-t2048u ${name}: a search result artist / album opens its page; Back returns to the results; ♡ and ⋯ do not open it`, async () => {
    const L = await view(opts);
    if (name.includes('wide')) L.v.setExpanded(true), await wait(30);
    await L.find('Eminem Feat Dr. Dre');
    assert.ok(L.row('Eminem'), 'results: the artist'); assert.ok(L.row('Curtain Call: The Hits'), 'results: the album');
    assert.equal(L.title(), null, 'the results page has no Back');
    // tap an artist -> its albums
    click(L.row('Eminem')); await wait(40);
    assert.equal(L.title(), 'Eminem', 'the artist page is shown'); assert.ok(L.has('The Eminem Show'), 'its albums'); assert.ok(!L.has('Curtain Call: The Hits'), 'not the results');
    click(L.backBtn()); await wait(40);
    assert.ok(L.row('Curtain Call: The Hits'), 'Back = the same results'); assert.equal(L.title(), null);
    // tap an album row further down (a different artist's album too) -> its songs
    click(L.row('Pyscho')); await wait(40);
    assert.equal(L.title(), 'Pyscho', 'the album page is shown');
    click(L.backBtn()); await wait(40);
    click(L.row('Curtain Call: The Hits')); await wait(40);
    assert.equal(L.title(), 'Curtain Call: The Hits'); assert.ok(L.has('Lose Yourself'), 'its songs'); assert.ok(!L.has('Pyscho'), 'not the results');
    click(L.backBtn()); await wait(40);
    // the heart and the ⋯ on an album row do their own thing and never open the album
    const al = L.row('Curtain Call: The Hits'); const heart = al.querySelector('button');
    if (heart) { click(heart); await wait(30); assert.equal(L.title(), null, '♡ does not open the album'); assert.ok(L.row('Curtain Call: The Hits')); }
    // a new search drops the pages opened from the old one; clearing the search goes back to the library
    click(L.row('Eminem')); await wait(40); await L.find('Pysch'); assert.equal(L.title(), null, 'a new search shows its results');
    await L.find(''); assert.equal(L.title(), null, 'cleared: the library, no stale page');
    L.v.el.remove();
  });
}

// 0.7.1 t2049u: on an iPhone the keyboard stayed up over the search results (no way to reach the last rows or close it).
test('t2049u phone (html.handset): Search key / Enter, touching the results and opening a result close the keyboard; a keyboard-high spacer while it is open', async () => {
  const html = doc.documentElement; html.classList.add('handset');
  globalThis.innerHeight = 900; globalThis.visualViewport = { height: 560, offsetTop: 0, addEventListener() {} };
  try {
    const L = await view({ phone: true });
    const search = L.v.el.querySelector('input[type="search"]'), form = search.parentNode, pad = L.v.el.querySelector('.lib-kbpad');
    assert.equal(form.tagName.toLowerCase(), 'form', 'inside a form, so iOS shows a Search key'); assert.equal(search.getAttribute('enterkeyhint'), 'search');
    assert.ok(pad && pad.hidden, 'no spacer while the keyboard is closed');
    const open = () => { search.focus(); search.dispatchEvent(ev('focus', { target: search, bubbles: false })); };
    open(); assert.equal(pad.hidden, false); assert.equal(pad.style.height, '340px', 'spacer = the keyboard inset (innerHeight - visualViewport)');
    // Search key: runs the search at once (no debounce) and closes the keyboard
    search.value = 'Eminem';
    const notPrevented = form.dispatchEvent(ev('submit', { target: form })); await wait(40);
    assert.equal(notPrevented, false, 'no page reload (submit prevented)'); assert.notEqual(doc.activeElement, search, 'blurred = keyboard closed'); assert.ok(pad.hidden, 'spacer gone');
    assert.ok(L.row('Eminem'), 'results shown at once');
    // touching / starting to scroll the results closes it
    open(); L.v.el.querySelector('.libscroll').dispatchEvent(ev('touchstart', { target: L.row('Curtain Call: The Hits') }));
    assert.notEqual(doc.activeElement, search, 'touching the results blurs the search');
    // tapping a result: blurred before the page opens
    open(); click(L.row('Eminem')); await wait(40);
    assert.notEqual(doc.activeElement, search); assert.equal(L.title(), 'Eminem', 'and the artist opens');
    L.v.el.remove();
  } finally { html.classList.remove('handset'); delete globalThis.visualViewport; }
});
test('t2049u desktop narrow / wide (no html.handset): no keyboard spacer and touching the list does not steal focus; Enter still searches', async () => {
  globalThis.visualViewport = { height: 560, offsetTop: 0, addEventListener() {} };
  try {
    for (const opts of [{ compact: true }, {}]) {
      const L = await view(opts);
      const search = L.v.el.querySelector('input[type="search"]'), pad = L.v.el.querySelector('.lib-kbpad');
      search.focus(); search.dispatchEvent(ev('focus', { target: search, bubbles: false }));
      assert.ok(pad.hidden, 'no phone-only spacer on a PC');
      L.v.el.querySelector('.libscroll').dispatchEvent(ev('touchstart', { target: L.v.el }));
      assert.equal(doc.activeElement, search, 'a touch-screen PC keeps the search focused');
      search.value = 'Eminem'; search.parentNode.dispatchEvent(ev('submit', { target: search.parentNode })); await wait(40);
      assert.ok(L.row('Eminem'), 'Enter searches at once');
      L.v.el.remove();
    }
  } finally { delete globalThis.visualViewport; }
});
