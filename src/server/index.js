import { networkInterfaces } from 'node:os';
import { startSyncServer } from './server.js';
import { OperationStore } from './operation-store.js';
import { createLogger } from './logger.js';
import { getDatabaseUrl } from './config.js';

// LOG_LEVEL can be debug, info, warn or error. Debug also shows every operation.
const logger = createLogger({ level: process.env.LOG_LEVEL ?? 'debug' });
const port = Number(process.env.PORT) || 8080;

const store = new OperationStore({ connectionString: getDatabaseUrl(), logger });
try {
  await store.init();
} catch (error) {
  logger.error(error.message);
  process.exit(1);
}
logger.info('connected to PostgreSQL');

const server = await startSyncServer({ port, store, logger });

logger.info(`Open on this computer: http://localhost:${server.port}`);
for (const address of lanAddresses()) {
  logger.info(`Other devices on the same Wi-Fi: http://${address}:${server.port}`);
}

// Ctrl+C: stop cleanly instead of cutting connections mid-write.
async function shutdown() {
  logger.info('shutting down…');
  await server.close();
  await store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net && net.family === 'IPv4' && !net.internal)
    .map((net) => net.address);
}