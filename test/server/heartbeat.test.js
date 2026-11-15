import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHeartbeat } from '../../src/server/heartbeat.js';
import { sleep } from '../helpers/wait-for.js';

function fakeSocket({ answersPings }) {
  return {
    isAlive: true,
    terminated: false,
    ping() {
      if (answersPings) this.isAlive = true; // a real pong arrives asynchronously
    },
    terminate() {
      this.terminated = true;
    },
  };
}

test('a connection that answers pings stays connected', async () => {
  const healthy = fakeSocket({ answersPings: true });
  const stop = startHeartbeat({ clients: new Set([healthy]) }, 10);
  await sleep(80);
  stop();
  assert.equal(healthy.terminated, false);
});

test('a connection that stops answering is terminated within two rounds', async () => {
  const silent = fakeSocket({ answersPings: false });
  const stop = startHeartbeat({ clients: new Set([silent]) }, 10);
  await sleep(80);
  stop();
  assert.equal(silent.terminated, true);
});