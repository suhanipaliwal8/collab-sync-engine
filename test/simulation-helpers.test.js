import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRandom, permutations } from './helpers/simulation.js';

test('the same seed produces the same random sequence', () => {
  const first = createRandom(7);
  const second = createRandom(7);
  for (let i = 0; i < 20; i++) assert.equal(first(), second());
});

test('different seeds produce different sequences', () => {
  assert.notEqual(createRandom(1)(), createRandom(2)());
});

test('permutations returns n! distinct orders', () => {
  const orders = permutations([1, 2, 3, 4]);
  assert.equal(orders.length, 24);
  assert.equal(new Set(orders.map((o) => o.join(','))).size, 24);
});