import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OperationStore } from '../../src/server/operation-store.js';
import { getDatabaseUrl } from '../../src/server/config.js';

const options = { timeout: 10000 };
const store = new OperationStore({ connectionString: getDatabaseUrl() });
await store.init();

// Every test uses its own document id and we delete only those rows afterwards,
// so your real development data is never touched.
const createdDocuments = [];
function newDocumentId() {
  const id = `test-${randomUUID()}`;
  createdDocuments.push(id);
  return id;
}

after(async () => {
  await store.pool.query('DELETE FROM operations WHERE document_id = ANY($1)', [createdDocuments]);
  await store.close();
});

const insertOp = (counter, siteId, value) => ({
  type: 'insert',
  id: { counter, siteId },
  parentId: { counter: 0, siteId: 'ROOT' },
  value,
});

test('append stores an operation and loadAll returns it unchanged', options, async () => {
  const doc = newDocumentId();
  const op = insertOp(1, 'A', 'x');
  assert.equal(await store.append(doc, 'ins:1@A', op), true);
  assert.deepEqual(await store.loadAll(doc), [op]);
});

test('loadAll returns operations in the order they were stored', options, async () => {
  const doc = newDocumentId();
  const ops = [insertOp(3, 'A', 'c'), insertOp(1, 'A', 'a'), insertOp(2, 'A', 'b')];
  for (const op of ops) await store.append(doc, `ins:${op.id.counter}@A`, op);
  assert.deepEqual(await store.loadAll(doc), ops);
});

test('storing the same operation twice keeps a single copy', options, async () => {
  const doc = newDocumentId();
  const op = insertOp(1, 'A', 'x');
  assert.equal(await store.append(doc, 'ins:1@A', op), true);
  assert.equal(await store.append(doc, 'ins:1@A', op), false);
  assert.equal((await store.loadAll(doc)).length, 1);
});

test('documents are isolated from each other', options, async () => {
  const first = newDocumentId();
  const second = newDocumentId();
  await store.append(first, 'ins:1@A', insertOp(1, 'A', 'x'));
  await store.append(second, 'ins:1@B', insertOp(1, 'B', 'y'));
  assert.equal((await store.loadAll(first)).length, 1);
  assert.equal((await store.loadAll(second)).length, 1);
  assert.equal((await store.loadAll(first))[0].value, 'x');
});

test('data survives a brand-new store instance (like a restart)', options, async () => {
  const doc = newDocumentId();
  const op = insertOp(1, 'A', 'x');
  await store.append(doc, 'ins:1@A', op);

  const restarted = new OperationStore({ connectionString: getDatabaseUrl() });
  try {
    assert.deepEqual(await restarted.loadAll(doc), [op]);
  } finally {
    await restarted.close();
  }
});