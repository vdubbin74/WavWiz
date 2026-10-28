import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// 0.5.0 F89: the queue's UP NEXT row badge follows the server's real next (shuffle), not the list neighbour
const src = readFileSync(`${process.env.JS_DIR}/listtable.js`, 'utf8');
const body = src.slice(src.indexOf('export function queueNextIndex'));
const queueNextIndex = new Function(`${body.replace('export ', '')}; return queueNextIndex;`)();
const Q = Array.from({ length: 6 }, (_, i) => ({ id: 't' + i }));
test('shuffle: badge uses server nextIndex, not index+1', () => assert.equal(queueNextIndex({ index: 1, shuffle: true, nextIndex: 4 }, Q), 4));
test('nothing next from server -> no badge', () => assert.equal(queueNextIndex({ index: 5, nextIndex: -1 }, Q), -1));
test('out-of-range nextIndex -> no badge', () => assert.equal(queueNextIndex({ index: 1, nextIndex: 9 }, Q), -1));
test('older server without nextIndex -> list neighbour', () => assert.equal(queueNextIndex({ index: 1 }, Q), 2));
test('badge in listtable draw uses the helper', () => assert.match(src, /nextIdx = queueNextIndex\(V\.now, V\.queue\)/));
