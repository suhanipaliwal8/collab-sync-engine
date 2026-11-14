import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startSyncServer } from '../../src/server/server.js';
import { OperationStore } from '../../src/server/operation-store.js';
import { getDatabaseUrl } from '../../src/server/config.js';
import { connect } from '../helpers/ws-client.js';

test('a document survives a server restart', { timeout: 15000 }, async () => {
  const documentId = `test-${randomUUID()}`;
  const ops = [
    { type: 'insert', id: { counter: 1, siteId: 'alice' }, parentId: { counter: 0, siteId: 'ROOT' }, value: 'h' },
    { type: 'insert', id: { counter: 2, siteId: 'alice' }, parentId: { counter: 1, siteId: 'alice' }, value: 'i' },
  ];

  const stores = [];
  const servers = [];

  // Each call is like starting the program fresh: new store, new server.
  async function startFreshServer() {
    const store = new OperationStore({ connectionString: getDatabaseUrl() });
    await store.init();
    stores.push(store);
    const server = await startSyncServer({ port: 0, documentId, store });
    servers.push(server);
    return server;
  }

  try {
    // First run: Alice types "hi"; Bob receiving it proves the server saved it.
    const server1 = await startFreshServer();
    const alice = await connect(server1.port);
    const bob = await connect(server1.port);
    await alice.next();
    await bob.next();
    for (const op of ops) alice.send({ type: 'op', op });
    await bob.next();
    await bob.next();
    await server1.close(); // "the server is stopped"

    // Second run: same database, nothing else carried over.
    const server2 = await startFreshServer();
    const carol = await connect(server2.port);
    assert.deepEqual(await carol.next(), { type: 'sync', ops });
    assert.equal(server2.room.doc.getText(), 'hi');
  } finally {
    // Always release everything, even if an assertion failed above.
    for (const server of servers) await server.close();
    if (stores.length > 0) {
      await stores[0].pool.query('DELETE FROM operations WHERE document_id = $1', [documentId]);
    }
    for (const store of stores) await store.close();
  }
});