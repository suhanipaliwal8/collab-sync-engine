import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../src/server/room-manager.js';
import { InvalidDocumentIdError, RoomLimitError } from '../../src/server/errors.js';
import { sleep } from '../helpers/wait-for.js';

test('returns the same room for the same document and different rooms for different ones', async () => {
  const manager = new RoomManager();
  const first = await manager.get('notes');
  const again = await manager.get('notes');
  const other = await manager.get('todo');
  assert.equal(first, again);
  assert.notEqual(first, other);
  assert.equal(first.documentId, 'notes');
});

test('simultaneous first requests share a single restore', async () => {
  let loads = 0;
  const store = {
    async loadAll() {
      loads++;
      await sleep(20);
      return [];
    },
    async append() {
      return true;
    },
  };
  const manager = new RoomManager({ store });
  const [a, b] = await Promise.all([manager.get('notes'), manager.get('notes')]);
  assert.equal(a, b);
  assert.equal(loads, 1);
});

test('refuses invalid document ids', async () => {
  const manager = new RoomManager();
  for (const bad of ['', 'a b', '../secret', 'x'.repeat(65), 42, null, undefined]) {
    await assert.rejects(manager.get(bad), InvalidDocumentIdError, `${String(bad)} must be refused`);
  }
});

test('refuses new documents beyond the limit but keeps serving existing ones', async () => {
  const manager = new RoomManager({ maxRooms: 2 });
  await manager.get('a');
  await manager.get('b');
  await assert.rejects(manager.get('c'), RoomLimitError);
  assert.equal((await manager.get('a')).documentId, 'a');
});

test('a failed restore is not cached', async () => {
  let failing = true;
  const store = {
    async loadAll() {
      if (failing) throw new Error('db down');
      return [];
    },
    async append() {
      return true;
    },
  };
  const manager = new RoomManager({ store });
  await assert.rejects(manager.get('notes'), /db down/);
  failing = false;
  assert.equal((await manager.get('notes')).documentId, 'notes');
});