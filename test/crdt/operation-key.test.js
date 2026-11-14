import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationKey } from '../../src/crdt/operation-key.js';

test('an insert is identified by its own id', () => {
  const op = { type: 'insert', id: { counter: 3, siteId: 'A' }, parentId: { counter: 0, siteId: 'ROOT' }, value: 'x' };
  assert.equal(operationKey(op), 'ins:3@A');
});

test('a delete is identified by the character it removes', () => {
  assert.equal(operationKey({ type: 'delete', targetId: { counter: 3, siteId: 'A' } }), 'del:3@A');
});