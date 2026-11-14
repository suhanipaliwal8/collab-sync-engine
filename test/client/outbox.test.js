import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Outbox } from '../../src/client/outbox.js';
import { operationKey } from '../../src/crdt/operation-key.js';

const insert = (counter, value) => ({
  type: 'insert',
  id: { counter, siteId: 'A' },
  parentId: { counter: 0, siteId: 'ROOT' },
  value,
});

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

test('keeps operations in order and hands out a copy', () => {
  const outbox = new Outbox();
  outbox.add(insert(1, 'a'));
  outbox.add(insert(2, 'b'));
  const copy = outbox.pending();
  copy.pop();
  assert.equal(outbox.size, 2);
  assert.deepEqual(outbox.pending().map((op) => op.value), ['a', 'b']);
});

test('ignores an operation that is already queued', () => {
  const outbox = new Outbox();
  outbox.add(insert(1, 'a'));
  outbox.add(insert(1, 'a'));
  assert.equal(outbox.size, 1);
});

test('acknowledge removes only the matching operation', () => {
  const outbox = new Outbox();
  outbox.add(insert(1, 'a'));
  outbox.add(insert(2, 'b'));
  outbox.acknowledge('ins:1@A');
  outbox.acknowledge('ins:99@A'); // unknown key: nothing happens
  assert.deepEqual(outbox.pending().map(operationKey), ['ins:2@A']);
});

test('is mirrored to storage and a new Outbox loads it back', () => {
  const storage = fakeStorage();
  const first = new Outbox(storage);
  first.add(insert(1, 'a'));
  first.add(insert(2, 'b'));

  const second = new Outbox(storage);
  assert.deepEqual(second.pending(), [insert(1, 'a'), insert(2, 'b')]);

  second.acknowledge('ins:1@A');
  assert.deepEqual(new Outbox(storage).pending(), [insert(2, 'b')]);
});

test('ignores corrupted storage content', () => {
  assert.equal(new Outbox(fakeStorage({ 'collab-outbox': 'not json' })).size, 0);
  assert.equal(new Outbox(fakeStorage({ 'collab-outbox': '{"a":1}' })).size, 0);

  const mixed = JSON.stringify([1, 'x', { type: 'insert' }, insert(5, 'ok')]);
  const outbox = new Outbox(fakeStorage({ 'collab-outbox': mixed }));
  assert.deepEqual(outbox.pending(), [insert(5, 'ok')]);
});