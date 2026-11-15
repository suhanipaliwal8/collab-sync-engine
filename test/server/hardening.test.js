import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startSyncServer } from '../../src/server/server.js';
import { connect } from '../helpers/ws-client.js';
import { waitFor } from '../helpers/wait-for.js';

const options = { timeout: 8000 };
const ROOT = { counter: 0, siteId: 'ROOT' };

const insertOp = (counter, siteId, parentId, value = 'x') => ({
  type: 'insert',
  id: { counter, siteId },
  parentId,
  value,
});

test('documents are isolated from each other', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    const inNotes = await connect(server.port, { path: '/?doc=notes' });
    const inTodo = await connect(server.port, { path: '/?doc=todo' });
    const alsoInNotes = await connect(server.port, { path: '/?doc=notes' });
    await inNotes.next();
    await inTodo.next();
    await alsoInNotes.next();

    inNotes.send({ type: 'op', op: insertOp(1, 'a', ROOT) });
    assert.equal((await alsoInNotes.next()).type, 'op'); // same document: delivered

    const notes = await server.rooms.get('notes');
    const todo = await server.rooms.get('todo');
    assert.equal(notes.versionCount, 1);
    assert.equal(todo.versionCount, 0);
    assert.equal(server.room.versionCount, 0); // the default document is untouched too

    const res = await fetch(`http://localhost:${server.port}/api/history?doc=notes`);
    assert.equal((await res.json()).count, 1);
  } finally {
    await server.close();
  }
});

test('an invalid document id is refused', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    await assert.rejects(connect(server.port, { path: '/?doc=../etc' }), /400/);
    const res = await fetch(`http://localhost:${server.port}/api/history?doc=a%20b`);
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});

test('with an access token, only clients that present it can connect', options, async () => {
  const server = await startSyncServer({ port: 0, authToken: 's3cret' });
  try {
    await assert.rejects(connect(server.port), /401/);
    await assert.rejects(connect(server.port, { path: '/?token=wrong' }), /401/);
    const allowed = await connect(server.port, { path: '/?token=s3cret' });
    assert.equal((await allowed.next()).type, 'sync');
  } finally {
    await server.close();
  }
});

test('the history API needs the token too, but the page stays public', options, async () => {
  const server = await startSyncServer({ port: 0, authToken: 's3cret' });
  const base = `http://localhost:${server.port}`;
  try {
    assert.equal((await fetch(`${base}/api/history`)).status, 401);
    assert.equal((await fetch(`${base}/api/history`, { headers: { Authorization: 'Bearer s3cret' } })).status, 200);
    assert.equal((await fetch(`${base}/api/history?token=s3cret`)).status, 200);
    assert.equal((await fetch(`${base}/`)).status, 200);
  } finally {
    await server.close();
  }
});

test('a WebSocket from another website is refused', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    await assert.rejects(connect(server.port, { headers: { Origin: 'http://evil.example' } }), /403/);
    const sameSite = await connect(server.port, {
      headers: { Origin: `http://localhost:${server.port}` },
    });
    assert.equal((await sameSite.next()).type, 'sync');
  } finally {
    await server.close();
  }
});

test('a full document refuses more clients, other documents are unaffected', options, async () => {
  const server = await startSyncServer({ port: 0, maxClientsPerRoom: 1 });
  try {
    const first = await connect(server.port);
    await first.next();
    await assert.rejects(connect(server.port), /503/);
    const elsewhere = await connect(server.port, { path: '/?doc=other' });
    assert.equal((await elsewhere.next()).type, 'sync');
  } finally {
    await server.close();
  }
});

test('a client that floods the server is disconnected', options, async () => {
  const server = await startSyncServer({ port: 0, rateLimit: { capacity: 3, refillPerSecond: 0.001 } });
  try {
    const alice = await connect(server.port);
    await alice.next();
    const closed = once(alice.socket, 'close');

    for (let i = 1; i <= 6; i++) {
      const parent = i === 1 ? ROOT : { counter: i - 1, siteId: 'a' };
      alice.send({ type: 'op', op: insertOp(i, 'a', parent) });
    }

    const [code] = await closed;
    assert.equal(code, 1008);
    await waitFor(() => server.room.versionCount === 3, 'the three allowed operations to be saved');
  } finally {
    await server.close();
  }
});

test('an operation that refers to an unknown character is rejected and not stored', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    const alice = await connect(server.port);
    await alice.next();

    alice.send({ type: 'op', op: insertOp(5, 'a', { counter: 4, siteId: 'a' }) }); // parent never existed
    const reply = await alice.next();

    assert.equal(reply.type, 'error');
    assert.equal(reply.opKey, 'ins:5@a');
    assert.match(reply.message, /does not have/);
    assert.equal(server.room.versionCount, 0);
  } finally {
    await server.close();
  }
});