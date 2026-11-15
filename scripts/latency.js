import { randomUUID } from 'node:crypto';
import { startSyncServer } from '../src/server/server.js';
import { OperationStore } from '../src/server/operation-store.js';
import { getDatabaseUrl } from '../src/server/config.js';
import { measureBroadcastLatency } from '../src/tools/latency-benchmark.js';

// Usage: npm run bench -- [receivers] [operations]
const receivers = Number(process.argv[2]) || 10;
const operations = Number(process.argv[3]) || 500;
const documentId = `bench-${randomUUID()}`;

const store = new OperationStore({ connectionString: getDatabaseUrl() });
await store.init();
const server = await startSyncServer({ port: 0, documentId, store });

try {
  console.log(`1 sender, ${receivers} receivers, ${operations} operations (each reaches every receiver)…`);
  const summary = await measureBroadcastLatency({ port: server.port, receivers, operations, intervalMs: 5 });
  const ms = (value) => `${value.toFixed(1)} ms`;
  console.log(`deliveries measured: ${summary.count}`);
  console.log(`  mean: ${ms(summary.mean)}`);
  console.log(`  p50 : ${ms(summary.p50)}`);
  console.log(`  p95 : ${ms(summary.p95)}`);
  console.log(`  p99 : ${ms(summary.p99)}`);
  console.log(`  max : ${ms(summary.max)}`);
  console.log('Note: same machine, so no real network delay and no browser rendering are included.');
} finally {
  await server.close();
  await store.pool.query('DELETE FROM operations WHERE document_id = $1', [documentId]);
  await store.close();
}