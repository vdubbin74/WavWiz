import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../src/WavWiz.Server/wwwroot/js');
const src = f => readFileSync(join(root, f), 'utf8');

test('0.7.0 restore preview tells you to pair again and that zones reattach by computer name', () => {
  const ui = src('settingsui.js'), flow = src('backupflow.js');
  assert.match(ui, /export const BACKUP_KEEP_NOTE/);
  assert.match(ui, /export function backupRestoreNotes/);
  assert.match(ui, /pair each player again/);
  assert.match(ui, /reconnect by computer name/);
  assert.match(ui, /willReattach/);
  assert.match(ui, /needPairing/);
  assert.match(flow, /backupRestoreNotes/);
  assert.doesNotMatch(ui, /paired devices are never in a backup, so you keep the ones on this server/);
  assert.doesNotMatch(flow, /paired devices are never in a backup, so you keep the ones on this server/);
});
