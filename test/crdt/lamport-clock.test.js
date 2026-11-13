import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LamportClock } from '../../src/crdt/lamport-clock.js';
import { compareIds, idsEqual } from '../../src/crdt/id.js';

test('tick increments the counter and stamps the siteId', () => {
  const clock = new LamportClock('A');
  assert.deepEqual(clock.tick(), { counter: 1, siteId: 'A' });
  assert.deepEqual(clock.tick(), { counter: 2, siteId: 'A' });
});

test('receive jumps the clock forward when the remote is ahead', () => {
  const clock = new LamportClock('A');
  clock.receive(10);
  assert.equal(clock.tick().counter, 11);
});

test('receive never moves the clock backwards', () => {
  const clock = new LamportClock('A');
  clock.tick();
  clock.tick();
  clock.receive(1);
  assert.equal(clock.tick().counter, 3);
});

test('two sites can never produce the same id', () => {
  const a = new LamportClock('A');
  const b = new LamportClock('B');
  assert.equal(idsEqual(a.tick(), b.tick()), false); // both counter 1, different siteId
});

test('causality: an op made after seeing another gets a bigger id', () => {
  const a = new LamportClock('A');
  const b = new LamportClock('B');
  const idFromA = a.tick();
  b.receive(idFromA.counter);
  const idFromB = b.tick();
  assert.ok(compareIds(idFromB, idFromA) > 0);
});