import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentRoom } from '../../src/server/document-room.js';
import { createLogger } from '../../src/server/logger.js';
import { ROOT_ID } from '../../src/crdt/id.js';
import { RgaDocument } from '../../src/crdt/rga-document.js';

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

// ---------- History and revert ----------

// Types "cat", then changes it to "car" (5 operations in total).
function catThenCar() {
  const author = new RgaDocument('alice');
  const ops = [...'cat'].map((ch, i) => author.localInsert(i, ch));
  ops.push(author.localDelete(2)); // delete "t"
  ops.push(author.localInsert(2, 'r'));
  return ops;
}

async function feed(room, ops, sender = fakeClient('c1')) {
  for (const op of ops) await room.receive(sender, op);
}

test('versionCount counts accepted operations, not duplicates', async () => {
  const room = new DocumentRoom('doc');
  const ops = catThenCar();
  await feed(room, ops);
  await room.receive(fakeClient('c1'), ops[0]); // duplicate
  assert.equal(room.versionCount, 5);
});

test('textAt returns the text after any number of operations', async () => {
  const room = new DocumentRoom('doc');
  await feed(room, catThenCar());
  assert.equal(room.textAt(0), '');
  assert.equal(room.textAt(1), 'c');
  assert.equal(room.textAt(3), 'cat');
  assert.equal(room.textAt(4), 'ca');
  assert.equal(room.textAt(5), 'car');
});

test('textAt throws a RangeError for unknown versions', async () => {
  const room = new DocumentRoom('doc');
  await feed(room, catThenCar());
  assert.throws(() => room.textAt(6), RangeError);
  assert.throws(() => room.textAt(-1), RangeError);
  assert.throws(() => room.textAt(1.5), RangeError);
});

test('recentHistory returns the latest entries, oldest first', async () => {
  const room = new DocumentRoom('doc');
  await feed(room, catThenCar());
  assert.deepEqual(room.recentHistory(2), [
    { version: 4, type: 'delete', target: '3@alice' },
    { version: 5, type: 'insert', id: '4@alice', siteId: 'alice', value: 'r' },
  ]);
});

test('revertTo restores the old text with new operations and keeps the history', async () => {
  const room = new DocumentRoom('doc');
  const bob = fakeClient('c2');
  room.join(bob);
  await feed(room, catThenCar());

  const result = await room.revertTo(3);

  assert.equal(result.operations, 2); // delete "r", insert "t"
  assert.equal(room.doc.getText(), 'cat');
  assert.equal(room.versionCount, 7);
  assert.equal(room.textAt(5), 'car'); // the old history is untouched
  assert.equal(room.textAt(7), 'cat');
  assert.equal(bob.messages.length, 1 + 5 + 2); // sync + 5 edits + 2 revert operations
});

test('reverting to the current version adds no operations', async () => {
  const room = new DocumentRoom('doc');
  await feed(room, catThenCar());
  const result = await room.revertTo(5);
  assert.equal(result.operations, 0);
  assert.equal(room.versionCount, 5);
});

test('a failing store during a revert leaves the document unchanged', async () => {
  let failing = false;
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
  await feed(room, catThenCar());

  failing = true;
  await assert.rejects(room.revertTo(3), /db down/);
  assert.equal(room.versionCount, 5);
  assert.equal(room.doc.getText(), 'car');
});