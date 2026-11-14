import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentRoom } from '../../src/server/document-room.js';
import { createLogger } from '../../src/server/logger.js';
import { ROOT_ID } from '../../src/crdt/id.js';

function fakeClient(id) {
  const client = {
    id,
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

// A stand-in for the database that records what it is asked to do.
function fakeStore(savedOps = []) {
  return {
    appended: [],
    async append(documentId, key, op) {
      this.appended.push({ documentId, key, op });
      return true;
    },
    async loadAll() {
      return savedOps;
    },
  };
}

test('joining sends the current log as a sync message', () => {
  const room = new DocumentRoom('doc');
  const alice = fakeClient();
  room.join(alice);
  assert.deepEqual(alice.messages, [{ type: 'sync', ops: [] }]);
});

test('a late joiner receives earlier operations in its sync message', async () => {
  const room = new DocumentRoom('doc');
  const alice = fakeClient();
  const bob = fakeClient();
  room.join(alice);
  const op = insert(1, 'alice', ROOT_ID, 'h');
  await room.receive(alice, op);
  room.join(bob);
  assert.deepEqual(bob.messages[0], { type: 'sync', ops: [op] });
});

test('an operation is broadcast to others but not echoed to its sender', async () => {
  const room = new DocumentRoom('doc');
  const alice = fakeClient();
  const bob = fakeClient();
  room.join(alice);
  room.join(bob);
  const op = insert(1, 'alice', ROOT_ID, 'h');
  await room.receive(alice, op);
  assert.deepEqual(bob.messages[1], { type: 'op', op });
  assert.equal(alice.messages.length, 1); // only her initial sync
});

test('duplicate operations are ignored and not re-broadcast', async () => {
  const room = new DocumentRoom('doc');
  const alice = fakeClient();
  const bob = fakeClient();
  room.join(alice);
  room.join(bob);
  const op = insert(1, 'alice', ROOT_ID, 'h');
  assert.equal(await room.receive(alice, op), true);
  assert.equal(await room.receive(alice, op), false);
  assert.equal(bob.messages.length, 2); // sync + one op
  assert.equal(room.log.length, 1);
});

test('a client that left receives nothing more', async () => {
  const room = new DocumentRoom('doc');
  const alice = fakeClient();
  const bob = fakeClient();
  room.join(alice);
  room.join(bob);
  room.leave(bob);
  await room.receive(alice, insert(1, 'alice', ROOT_ID, 'h'));
  assert.equal(bob.messages.length, 1); // only the initial sync
});

test("the server's own replica follows the operations", async () => {
  const room = new DocumentRoom('doc');
  const alice = fakeClient();
  room.join(alice);
  await room.receive(alice, insert(1, 'alice', ROOT_ID, 'h'));
  await room.receive(alice, insert(2, 'alice', { counter: 1, siteId: 'alice' }, 'i'));
  assert.equal(room.doc.getText(), 'hi');
});

test('logs joins and operations, but never the typed text', async () => {
  const lines = [];
  const logger = createLogger({ level: 'debug', write: (line) => lines.push(line) });
  const room = new DocumentRoom('doc', { logger });
  const alice = fakeClient('c1');
  const bob = fakeClient('c2');
  room.join(alice);
  room.join(bob);
  await room.receive(alice, insert(1, 'alice', ROOT_ID, '§'));

  const output = lines.join('\n');
  assert.ok(output.includes('c1 joined'));
  assert.ok(output.includes('insert 1@alice'));
  assert.ok(output.includes('sent to 1 other client'));
  assert.ok(!output.includes('§'));
});

test('logs a duplicate as ignored', async () => {
  const lines = [];
  const logger = createLogger({ level: 'debug', write: (line) => lines.push(line) });
  const room = new DocumentRoom('doc', { logger });
  const alice = fakeClient('c1');
  const op = insert(1, 'alice', ROOT_ID, 'h');
  await room.receive(alice, op);
  await room.receive(alice, op);
  assert.ok(lines.some((line) => line.includes('duplicate ignored')));
});

test('saves each new operation to the store, and duplicates only once', async () => {
  const store = fakeStore();
  const room = new DocumentRoom('doc', { store });
  const alice = fakeClient();
  const op = insert(1, 'alice', ROOT_ID, 'h');
  await room.receive(alice, op);
  await room.receive(alice, op);
  assert.equal(store.appended.length, 1);
  assert.equal(store.appended[0].key, 'ins:1@alice');
  assert.equal(store.appended[0].documentId, 'doc');
});

test('restore loads saved operations into the log and the replica', async () => {
  const saved = [
    insert(1, 'alice', ROOT_ID, 'h'),
    insert(2, 'alice', { counter: 1, siteId: 'alice' }, 'i'),
  ];
  const room = new DocumentRoom('doc', { store: fakeStore(saved) });
  assert.equal(await room.restore(), 2);
  assert.equal(room.doc.getText(), 'hi');

  const bob = fakeClient();
  room.join(bob);
  assert.equal(bob.messages[0].ops.length, 2);
});

test('a failing store rejects the operation, broadcasts nothing, and a retry works', async () => {
  let failing = true;
  const store = {
    async append() {
      if (failing) throw new Error('db down');
      return true;
    },
    async loadAll() {
      return [];
    },
  };
  const room = new DocumentRoom('doc', { store });
  const alice = fakeClient();
  const bob = fakeClient();
  room.join(alice);
  room.join(bob);
  const op = insert(1, 'alice', ROOT_ID, 'h');

  await assert.rejects(room.receive(alice, op), /db down/);
  assert.equal(room.log.length, 0);
  assert.equal(bob.messages.length, 1); // only the sync

  failing = false;
  assert.equal(await room.receive(alice, op), true);
  assert.equal(bob.messages.length, 2);
});

test('operations are processed one at a time, in arrival order', async () => {
  const order = [];
  const store = {
    async append(documentId, key) {
      if (key === 'ins:1@alice') await new Promise((resolve) => setTimeout(resolve, 30)); // slow first save
      order.push(key);
      return true;
    },
    async loadAll() {
      return [];
    },
  };
  const room = new DocumentRoom('doc', { store });
  const alice = fakeClient();
  const first = insert(1, 'alice', ROOT_ID, 'a');
  const second = insert(2, 'alice', { counter: 1, siteId: 'alice' }, 'b');

  await Promise.all([room.receive(alice, first), room.receive(alice, second)]);

  assert.deepEqual(order, ['ins:1@alice', 'ins:2@alice']);
  assert.deepEqual(room.log, [first, second]);
});