import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket } from '../../src/server/token-bucket.js';

function clock() {
  let time = 0;
  return { now: () => time, advance: (ms) => { time += ms; } };
}

test('starts full and allows a burst up to its capacity', () => {
  const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 1, now: clock().now });
  assert.deepEqual([1, 2, 3, 4].map(() => bucket.take()), [true, true, true, false]);
});

test('refills over time', () => {
  const time = clock();
  const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 2, now: time.now });
  bucket.take();
  bucket.take();
  assert.equal(bucket.take(), false);
  time.advance(1000); // two tokens come back
  assert.deepEqual([1, 2, 3].map(() => bucket.take()), [true, true, false]);
});

test('never holds more than its capacity', () => {
  const time = clock();
  const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 10, now: time.now });
  time.advance(60 * 60 * 1000); // an hour of silence
  assert.deepEqual([1, 2, 3, 4].map(() => bucket.take()), [true, true, true, false]);
});

test('fractions of a token accumulate', () => {
  const time = clock();
  const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1, now: time.now });
  assert.equal(bucket.take(), true);
  time.advance(500);
  assert.equal(bucket.take(), false); // only half a token so far
  time.advance(500);
  assert.equal(bucket.take(), true);
});

test('a request for more tokens than available is refused and consumes nothing', () => {
  const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 1, now: clock().now });
  assert.equal(bucket.take(5), false);
  assert.equal(bucket.take(3), true);
});