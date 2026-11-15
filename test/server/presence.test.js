import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSyncServer } from '../../src/server/server.js';
import { connect } from '../helpers/ws-client.js';
import { sleep, waitFor } from '../helpers/wait-for.js';

const options = { timeout: 8000 };
const cursor = (counter) => ({
  start: { counter, siteId: 'alice' },
  end: { counter, siteId: 'alice' },
});

test('presence reaches clients of the same document only', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    const alice = await connect(server.port, { path: '/?doc=notes' }); // gets id c1
    const bob = await connect(server.port, { path: '/?doc=notes' });
    const carol = await connect(server.port, { path: '/?doc=todo' });
    await alice.next();
    await bob.next();
    await carol.next();

    alice.send({ type: 'presence', name: 'Alice', cursor: cursor(1) });

    assert.deepEqual(await bob.next(), {
      type: 'presence',
      peer: { id: 'c1', name: 'Alice', cursor: cursor(1) },
    });

    await sleep(50);
    assert.equal((await server.rooms.get('notes')).presence.size, 1);
    assert.equal((await server.rooms.get('todo')).presence.size, 0);
  } finally {
    await server.close();
  }
});

test('a late joiner learns who is here, and a departure is announced', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    const alice = await connect(server.port);
    await alice.next();
    alice.send({ type: 'presence', name: 'Alice', cursor: cursor(1) });
    await waitFor(() => server.room.presence.size === 1, 'the server to receive presence');

    const bob = await connect(server.port);
    assert.equal((await bob.next()).type, 'sync');
    const state = await bob.next();
    assert.equal(state.type, 'presence_state');
    assert.equal(state.peers.length, 1);
    assert.equal(state.peers[0].name, 'Alice');

    alice.socket.close();
    assert.deepEqual(await bob.next(), { type: 'presence_leave', id: 'c1' });
  } finally {
    await server.close();
  }
});

test('a healthy connection survives many heartbeats', options, async () => {
  const server = await startSyncServer({ port: 0, heartbeatMs: 30 });
  try {
    const alice = await connect(server.port);
    await alice.next();
    await sleep(250); // many rounds; the ws library answers pings automatically
    assert.equal(alice.socket.readyState, 1); // still open

    alice.send({ type: 'presence', name: 'Alice' });
    await waitFor(() => server.room.presence.size === 1, 'presence after the heartbeats');
  } finally {
    await server.close();
  }
});

test('invalid presence gets an error and the connection stays usable', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    const alice = await connect(server.port);
    await alice.next();

    alice.send({ type: 'presence', cursor: { start: 'nope', end: 1 } });
    const reply = await alice.next();
    assert.equal(reply.type, 'error');
    assert.match(reply.message, /Invalid presence/);

    alice.send({ type: 'presence', name: 'Alice' });
    await waitFor(() => server.room.presence.size === 1, 'valid presence afterwards');
  } finally {
    await server.close();
  }
});