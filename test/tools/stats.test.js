import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, summarize } from '../../src/tools/stats.js';

test('percentile uses the nearest-rank method', () => {
  const sorted = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  assert.equal(percentile(sorted, 50), 50);
  assert.equal(percentile(sorted, 95), 95);
  assert.equal(percentile(sorted, 99), 99);
  assert.equal(percentile(sorted, 100), 100);
  assert.equal(percentile(sorted, 0), 1);
});

test('summarize handles unsorted input', () => {
  assert.deepEqual(summarize([5, 1, 3, 2, 4]), {
    count: 5, min: 1, mean: 3, p50: 3, p95: 5, p99: 5, max: 5,
  });
});

test('summarize of nothing is just a zero count', () => {
  assert.deepEqual(summarize([]), { count: 0 });
});