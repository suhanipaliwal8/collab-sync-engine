import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSyncServer } from '../../src/server/server.js';
import { connect } from '../helpers/ws-client.js';
import { RgaDocument } from '../../src/crdt/rga-document.js';

// The { timeout } option fails a test instead of letting it hang forever.
const options = { timeout: 5000 };

test('a new client receives an empty sync message', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    const alice = await connect(server.port);
    assert.deepEqual(await alice.next(), { type: 'sync', ops: [] });
  } finally {
    await server.close();
  }
});

test('an operation sent by one client reaches another', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    const alice = await connect(server.port);
    const bob = await connect(server.port);
    await alice.next(); // sync
    await bob.next();   // sync

    const op = {
      type: 'insert',
      id: { counter: 1, siteId: 'alice' },
      parentId: { counter: 0, siteId: 'ROOT' },
      value: 'x',
    };
    alice.send({ type: 'op', op });
    assert.deepEqual(await bob.next(), { type: 'op', op });
  } finally {
    await server.close();
  }
});

test('two live clients converge over a real network connection', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    const alice = await connect(server.port);
    const bob = await connect(server.port);
    await alice.next();
    await bob.next();

    const aliceDoc = new RgaDocument('alice');
    const bobDoc = new RgaDocument('bob');

    // Alice types "hi"; each edit is applied locally, then sent.
    for (const [index, letter] of [...'hi'].entries()) {
      alice.send({ type: 'op', op: aliceDoc.localInsert(index, letter) });
    }
    for (let i = 0; i < 2; i++) bobDoc.applyRemote((await bob.next()).op);

    // Bob appends "!".
    bob.send({ type: 'op', op: bobDoc.localInsert(2, '!') });
    aliceDoc.applyRemote((await alice.next()).op);

    assert.equal(aliceDoc.getText(), 'hi!');
    assert.equal(bobDoc.getText(), 'hi!');
    assert.equal(server.room.doc.getText(), 'hi!');
  } finally {
    await server.close();
  }
});

test('a client that connects later receives the history', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    const alice = await connect(server.port);
    const bob = await connect(server.port);
    await alice.next();
    await bob.next();

    const op = {
      type: 'insert',
      id: { counter: 1, siteId: 'alice' },
      parentId: { counter: 0, siteId: 'ROOT' },
      value: 'x',
    };
    alice.send({ type: 'op', op });
    await bob.next(); // once Bob has it, the server has certainly stored it

    const carol = await connect(server.port);
    assert.deepEqual(await carol.next(), { type: 'sync', ops: [op] });
  } finally {
    await server.close();
  }
});

test('invalid input gets an error message and the connection stays usable', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    const alice = await connect(server.port);
    await alice.next();

    alice.socket.send('this is not json');
    const reply = await alice.next();
    assert.equal(reply.type, 'error');

    alice.send({ type: 'nope' });
    assert.equal((await alice.next()).type, 'error');
  } finally {
    await server.close();
  }
});