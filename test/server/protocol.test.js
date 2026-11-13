import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMessage } from '../../src/server/protocol.js';

const ROOT = { counter: 0, siteId: 'ROOT' };
const validInsert = {
  type: 'op',
  op: { type: 'insert', id: { counter: 1, siteId: 'A' }, parentId: ROOT, value: 'x' },
};
const validDelete = {
  type: 'op',
  op: { type: 'delete', targetId: { counter: 1, siteId: 'A' } },
};

test('accepts a valid insert message', () => {
  assert.deepEqual(parseClientMessage(JSON.stringify(validInsert)), validInsert);
});

test('accepts a valid delete message', () => {
  assert.deepEqual(parseClientMessage(JSON.stringify(validDelete)), validDelete);
});

test('rejects text that is not JSON', () => {
  assert.throws(() => parseClientMessage('{{'), /not valid JSON/);
});

test('rejects an unknown message type', () => {
  assert.throws(() => parseClientMessage(JSON.stringify({ type: 'nope' })), /Unknown message type/);
});

test('rejects an insert whose value is not exactly one character', () => {
  const bad = { type: 'op', op: { ...validInsert.op, value: 'xy' } };
  assert.throws(() => parseClientMessage(JSON.stringify(bad)), /Invalid operation/);
});

test('rejects an insert using the reserved counter 0', () => {
  const bad = { type: 'op', op: { ...validInsert.op, id: { counter: 0, siteId: 'A' } } };
  assert.throws(() => parseClientMessage(JSON.stringify(bad)), /Invalid operation/);
});

test('strips unexpected extra fields', () => {
  const dirty = {
    type: 'op',
    extra: 1,
    op: { ...validInsert.op, evil: true, id: { counter: 1, siteId: 'A', admin: true } },
  };
  assert.deepEqual(parseClientMessage(JSON.stringify(dirty)), validInsert);
});