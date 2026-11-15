import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startSyncServer } from '../../src/server/server.js';
import { OperationStore } from '../../src/server/operation-store.js';
import { getDatabaseUrl } from '../../src/server/config.js';
import { measureBroadcastLatency } from '../../src/tools/latency-benchmark.js';

test('edits reach every client in well under one second (database included)', { timeout: 60000 }, async (t) => {
  const documentId = `test-${randomUUID()}`;
  const store = new OperationStore({ connectionString: getDatabaseUrl() });
  await store.init();
  const server = await startSyncServer({ port: 0, documentId, store });

  try {
    const summary = await measureBroadcastLatency({
      port: server.port,
      receivers: 4,
      operations: 100,
      intervalMs: 5,
    });
    t.diagnostic(
      `latency over ${summary.count} deliveries: p50=${summary.p50.toFixed(1)} ms, ` +
        `p95=${summary.p95.toFixed(1)} ms, max=${summary.max.toFixed(1)} ms`,
    );
    assert.equal(summary.count, 400);
    assert.ok(summary.p95 < 1000, `p95 was ${summary.p95.toFixed(1)} ms (requirement: sub-second)`);
  } finally {
    await server.close();
    await store.pool.query('DELETE FROM operations WHERE document_id = $1', [documentId]);
    await store.close();
  }
});