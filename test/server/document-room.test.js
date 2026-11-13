import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentRoom } from '../../src/server/document-room.js';
import { ROOT_ID } from '../../src/crdt/id.js';

function fakeClient() {
  const client = {
    messages: [],
    send(message) {
      client.messages.push(message);
    },
  };
  return client;
}

const insert = (counter, siteId, parentId, value) => ({
  type: 'insert',
  id: { counter, siteId },
  parentId,
  value,
});

test('joining sends the current log as a sync message', () => {
  const room = new DocumentRoom('doc');
  const alice = fakeClient();
  room.join(alice);
  assert.deepEqual(alice.messages, [{ type: 'sync', ops: [] }]);
});

test('a late joiner receives earlier operations in its sync message', () => {
  const room = new DocumentRoom('doc');
  const alice = fakeClient();
  const bob = fakeClient();
  room.join(alice);
  const op = insert(1, 'alice', ROOT_ID, 'h');
  room.receive(alice, op);
  room.join(bob);
  assert.deepEqual(bob.messages[0], { type: 'sync', ops: [op] });
});

test('an operation is broadcast to others but not echoed to its sender', () => {
  const room = new DocumentRoom('doc');
  const alice = fakeClient();
  const bob = fakeClient();
  room.join(alice);
  room.join(bob);
  const op = insert(1, 'alice', ROOT_ID, 'h');
  room.receive(alice, op);
  assert.deepEqual(bob.messages[1], { type: 'op', op });
  assert.equal(alice.messages.length, 1); // only her initial sync
});

test('duplicate operations are ignored and not re-broadcast', () => {
  const room = new DocumentRoom('doc');
  const alice = fakeClient();
  const bob = fakeClient();
  room.join(alice);
  room.join(bob);
  const op = insert(1, 'alice', ROOT_ID, 'h');
  assert.equal(room.receive(alice, op), true);
  assert.equal(room.receive(alice, op), false);
  assert.equal(bob.messages.length, 2); // sync + one op
  assert.equal(room.log.length, 1);
});

test('a client that left receives nothing more', () => {
  const room = new DocumentRoom('doc');
  const alice = fakeClient();
  const bob = fakeClient();
  room.join(alice);
  room.join(bob);
  room.leave(bob);
  room.receive(alice, insert(1, 'alice', ROOT_ID, 'h'));
  assert.equal(bob.messages.length, 1); // only the initial sync
});

test("the server's own replica follows the operations", () => {
  const room = new DocumentRoom('doc');
  const alice = fakeClient();
  room.join(alice);
  room.receive(alice, insert(1, 'alice', ROOT_ID, 'h'));
  room.receive(alice, insert(2, 'alice', { counter: 1, siteId: 'alice' }, 'i'));
  assert.equal(room.doc.getText(), 'hi');
});