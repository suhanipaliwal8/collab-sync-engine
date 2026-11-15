import { test } from 'node:test';
import assert from 'node:assert/strict';
import { throttle } from '../../src/client/throttle.js';

// A fake clock with timers we can advance by hand.
function fakeTime() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, due: now + ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].fn();
      }
      now = target;
    },
  };
}

test('the first call runs immediately', () => {
  const time = fakeTime();
  const calls = [];
  const run = throttle((value) => calls.push(value), 100, time);
  run('a');
  assert.deepEqual(calls, ['a']);
});

test('rapid calls collapse into the first and the last', () => {
  const time = fakeTime();
  const calls = [];
  const run = throttle((value) => calls.push(value), 100, time);
  run('a');
  time.advance(10);
  run('b');
  time.advance(10);
  run('c');
  assert.deepEqual(calls, ['a']); // b and c are waiting
  time.advance(100);
  assert.deepEqual(calls, ['a', 'c']); // only the latest survives
});

test('calls spaced further apart than the limit all run', () => {
  const time = fakeTime();
  const calls = [];
  const run = throttle((value) => calls.push(value), 100, time);
  run('a');
  time.advance(150);
  run('b');
  time.advance(150);
  run('c');
  assert.deepEqual(calls, ['a', 'b', 'c']);
});