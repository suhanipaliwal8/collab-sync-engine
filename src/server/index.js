import { startSyncServer } from './server.js';

const port = Number(process.env.PORT) || 8080;
const server = await startSyncServer({ port });
console.log(`Sync server listening on ws://localhost:${server.port}`);