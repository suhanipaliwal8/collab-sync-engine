import { startSyncServer } from './server.js';

const port = Number(process.env.PORT) || 8080;
const server = await startSyncServer({ port });
console.log(`Open http://localhost:${server.port} in two browser tabs`);