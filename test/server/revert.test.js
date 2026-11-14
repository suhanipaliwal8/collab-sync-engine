import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSyncServer } from '../../src/server/server.js';
import { connect } from '../helpers/ws-client.js';
import { RgaDocument } from '../../src/crdt/rga-document.js';

const options = { timeout: 5000 };

// Reads messages until one of the given type arrives, applying any operations on the way.
async function receiveUntil(client, doc, stopType) {
  for (;;) {
    const message = await client.next();
    if (message.type === 'op') doc.applyRemote(message.op);
    else if (message.type === stopType) return message;
  }
}

// Alice sends an operation she created locally; Bob receives and applies it.
async function sendAndDeliver(alice, bob, bobDoc, op) {
  alice.send({ type: 'op', op });
  bobDoc.applyRemote((await bob.next()).op);
}

async function setup() {
  const server = await startSyncServer({ port: 0 });
  const alice = await connect(server.port);
  const bob = await connect(server.port);
  await alice.next(); // sync
  await bob.next();   // sync
  return { server, alice, bob, aliceDoc: new RgaDocument('alice'), bobDoc: new RgaDocument('bob') };
}

test('a revert broadcasts new operations and everyone returns to the old text', options, async () => {
  const { server, alice, bob, aliceDoc, bobDoc } = await setup();
  try {
    for (const [i, ch] of [...'cat'].entries()) {
      await sendAndDeliver(alice, bob, bobDoc, aliceDoc.localInsert(i, ch));
    }
    await sendAndDeliver(alice, bob, bobDoc, aliceDoc.localDelete(2));
    await sendAndDeliver(alice, bob, bobDoc, aliceDoc.localInsert(2, 'r'));
    assert.equal(bobDoc.getText(), 'car');

    alice.send({ type: 'revert', version: 3 });
    const ack = await receiveUntil(alice, aliceDoc, 'reverted');
    assert.equal(ack.operations, 2);
    for (let i = 0; i < 2; i++) bobDoc.applyRemote((await bob.next()).op);

    assert.equal(aliceDoc.getText(), 'cat');
    assert.equal(bobDoc.getText(), 'cat');
    assert.equal(server.room.versionCount, 7);   // history grew, nothing was rewritten
    assert.equal(server.room.textAt(5), 'car');  // the old state is still viewable
  } finally {
    await server.close();
  }
});

test('reverting to an unknown version returns an error', options, async () => {
  const { server, alice } = await setup();
  try {
    alice.send({ type: 'revert', version: 99 });
    const reply = await alice.next();
    assert.equal(reply.type, 'error');
    assert.match(reply.message, /version/i);
  } finally {
    await server.close();
  }
});

test('reverting to the current version changes nothing', options, async () => {
  const { server, alice, bob, aliceDoc, bobDoc } = await setup();
  try {
    await sendAndDeliver(alice, bob, bobDoc, aliceDoc.localInsert(0, 'x'));
    alice.send({ type: 'revert', version: 1 });
    const ack = await receiveUntil(alice, aliceDoc, 'reverted');
    assert.equal(ack.operations, 0);
    assert.equal(server.room.versionCount, 1);
  } finally {
    await server.close();
  }
});