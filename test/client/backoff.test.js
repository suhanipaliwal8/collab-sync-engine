import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconnectDelay } from '../../src/client/backoff.js';

const noJitter = () => 1; // always the full delay

test('the delay doubles with each attempt up to a cap', () => {
  const delays = [0, 1, 2, 3, 4, 5, 6].map((attempt) => reconnectDelay(attempt, noJitter));
  assert.deepEqual(delays, [500, 1000, 2000, 4000, 8000, 8000, 8000]);
});

test('jitter keeps the delay between 50% and 100% of the ceiling', () => {
  assert.equal(reconnectDelay(2, () => 0), 1000);
  assert.equal(reconnectDelay(2, () => 1), 2000);
});

test('a huge attempt number does not break the cap', () => {
  assert.equal(reconnectDelay(5000, noJitter), 8000);
});