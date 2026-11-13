import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT_ID, createId, compareIds, idsEqual, idToString } from '../../src/crdt/id.js';

test('higher counter is greater', () => {
  assert.ok(compareIds(createId(2, 'A'), createId(1, 'B')) > 0);
});

test('same counter: siteId breaks the tie, in both directions', () => {
  assert.ok(compareIds(createId(1, 'A'), createId(1, 'B')) < 0);
  assert.ok(compareIds(createId(1, 'B'), createId(1, 'A')) > 0);
});

test('identical ids are equal', () => {
  assert.ok(idsEqual(createId(4, 'A'), createId(4, 'A')));
});

test('idToString formats counter@siteId', () => {
  assert.equal(idToString(createId(3, 'A')), '3@A');
});

test('ROOT_ID is smaller than any real id', () => {
  assert.ok(compareIds(ROOT_ID, createId(1, 'A')) < 0);
});