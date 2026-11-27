// 0.7.3 t2242u: toasts follow the theme. The toast box was a fixed charcoal (#2b3239) while its text took the theme's ink, so a light theme
// (Daylight, a peach custom theme) showed dark text on charcoal. Now the box is --panel2 with --ink text (WCAG AA in every theme, errors too),
// and Back up now says where the backup went (on the server PC).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const css = readFileSync(join(js, '..', 'app.css'), 'utf8');
const imp = f => import(pathToFileURL(join(js, f)).href);
const rule = sel => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, s]) => s.trim() === sel).map(([, , b]) => b).join(';');

test('the toast box takes the theme panel and ink (no fixed charcoal); errors keep the red edge with the same readable text', () => {
  const t = rule('.toast');
  assert.match(t, /background:var\(--panel2\)/); assert.match(t, /color:var\(--ink\)/);
  assert.doesNotMatch(css, /\.toast\{[^}]*#2b3239/);
  assert.match(rule('.toast.bad'), /border-left-color:var\(--red\)/); assert.match(rule('.toast.bad'), /color:var\(--ink\)/);
  assert.match(css, /html\[data-scheme=light\] \.toast\{box-shadow:/);
});

test('toast text meets WCAG AA (4.5:1) on the toast box in every preset theme and in light / peach / dark custom themes', async () => {
  const { PRESETS, derive, contrast } = await imp('theme.js');
  const custom = { peach: { accent: '#E2683C', accent2: '#2F8F83', hl: '#7A4FD0', bg: '#F7DCCB', ink: '#2A1D17' }, paper: { accent: '#C0392B', accent2: '#1F6F8B', hl: '#6C3FD1', bg: '#FFFFFF', ink: '#111111' }, coal: { accent: '#FF7A00', accent2: '#00B3A4', hl: '#FFD000', bg: '#000000', ink: '#F2F2F2' } };
  for (const [k, t] of Object.entries({ ...PRESETS, ...custom })) {
    const v = derive({ ...t, preset: k }), r = contrast(v['--ink'], v['--panel2']);
    assert.ok(r >= 4.5, `${k}: ink ${v['--ink']} on ${v['--panel2']} = ${r.toFixed(2)}`);
    assert.ok(contrast(v['--dim'], v['--panel2']) >= 4.5, `${k}: dim text in a toast`);   // undo toasts' secondary text
  }
  const day = derive({ ...PRESETS.daylight, preset: 'daylight' });
  assert.ok(contrast(day['--ink'], '#2b3239') < 2, 'the old charcoal really was unreadable in Daylight');   // why this changed
});

test('Back up now says where the backup went, in plain words', async () => {
  const doc = installDom(); doc.defaultView = globalThis;
  const { backedUpText } = await imp('backupflow.js');
  assert.equal(backedUpText('11/26/2026, 10:21:09 PM', 'PCBOXV2'), 'Backup saved on the server PC (PCBOXV2), 11/26/2026, 10:21:09 PM. The last 10 are kept there; restore one from File > Restore backup.');
  assert.equal(backedUpText('11/26/2026, 10:21:09 PM', null), 'Backup saved on the server PC, 11/26/2026, 10:21:09 PM. The last 10 are kept there; restore one from File > Restore backup.');   // a phone does not get the PC name
  assert.match(readFileSync(join(js, 'backupflow.js'), 'utf8'), /toast\(backedUpText\(when\(b\.createdAt\), S\?\.auth\?\.machineName\)\)/);
});
