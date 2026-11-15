import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { RoomManager } from './room-manager.js';
import { parseClientMessage } from './protocol.js';
import { createHttpHandler } from './api.js';
import { createAuthChecker, extractToken } from './auth.js';
import { TokenBucket } from './token-bucket.js';
import { startHeartbeat } from './heartbeat.js';
import { ClientError, InvalidOperationError } from './errors.js';
import { operationKey } from '../crdt/operation-key.js';
import { silentLogger } from './logger.js';

const MAX_MESSAGE_BYTES = 1024 * 1024; // refuse messages bigger than 1 MiB

// Per connection: a burst of up to 5000 operations (a big paste), then 500 per second.
const DEFAULT_RATE_LIMIT = { capacity: 5000, refillPerSecond: 500 };

const STATUS_TEXT = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

// "::ffff:192.168.1.5" is just IPv4 written in IPv6 style; show it plainly.
function cleanAddress(address) {
  return (address ?? 'unknown').replace(/^::ffff:/, '');
}

// Browsers always send an Origin header on WebSocket connections. If it names a different
// site than the one we are serving, some other website is trying to use the visitor's
// browser to talk to us ("cross-site WebSocket hijacking"). Tools like curl or Node's ws
// send no Origin and are allowed.
function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function rejectUpgrade(socket, status) {
  const reason = STATUS_TEXT[status] ?? 'Error';
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

// Starts the server and resolves once it is listening.
// Use port 0 to let the OS choose a free port (handy for tests).
export async function startSyncServer({
  port = 8080,
  documentId = 'default', // the document used when a client does not name one
  store = null,
  logger = silentLogger,
  authToken = null, // when set, clients must present it
  maxClientsPerRoom = 50,
  maxRooms = 200,
  rateLimit = DEFAULT_RATE_LIMIT,
  heartbeatMs = 30000, // how often connections are checked for life
} = {}) {
  const rooms = new RoomManager({ store, logger, maxRooms });
  const room = await rooms.get(documentId); // the default document is loaded before we accept anyone
  const auth = createAuthChecker(authToken);

  const handleRequest = createHttpHandler({ rooms, auth, defaultDocumentId: documentId });
  const httpServer = createServer((request, response) => {
    response.on('finish', () => {
      const from = cleanAddress(request.socket.remoteAddress);
      logger.debug(`http ${request.method} ${request.url} → ${response.statusCode} (${from})`);
    });
    handleRequest(request, response);
  });

  // noServer: we decide ourselves whether to accept each upgrade request.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const stopHeartbeat = startHeartbeat(wss, heartbeatMs); // drops connections that stopped answering

  httpServer.on('upgrade', async (request, socket, head) => {
    socket.on('error', () => {}); // the peer may vanish while we are deciding
    try {
      const url = new URL(request.url, 'http://localhost');

      if (!isSameOrigin(request)) {
        logger.warn(`refused a WebSocket from another origin: ${request.headers.origin}`);
        rejectUpgrade(socket, 403);
        return;
      }
      if (!auth.isAllowed(extractToken(request.headers, url.searchParams))) {
        logger.warn(`refused a WebSocket without a valid token (${cleanAddress(request.socket.remoteAddress)})`);
        rejectUpgrade(socket, 401);
        return;
      }

      const targetRoom = await rooms.get(url.searchParams.get('doc') ?? documentId);
      if (targetRoom.clients.size >= maxClientsPerRoom) {
        logger.warn(`refused a client: document "${targetRoom.documentId}" is full`);
        rejectUpgrade(socket, 503);
        return;
      }
      if (socket.destroyed) return; // the client gave up while we were loading the document

      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request, targetRoom));
    } catch (error) {
      if (error instanceof ClientError) {
        rejectUpgrade(socket, error.status);
      } else {
        logger.error(`upgrade failed: ${error.message}`);
        rejectUpgrade(socket, 500);
      }
    }
  });

  let nextClientNumber = 1;

  wss.on('connection', (socket, request, targetRoom) => {
    // The room only knows "something with a send() method", not sockets.
    const client = {
      id: `c${nextClientNumber++}`,
      send(message) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      },
    };
    const bucket = new TokenBucket(rateLimit); // every connection gets its own bucket
    socket.isAlive = true; // see heartbeat.js
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    logger.info(`${client.id} connected from ${cleanAddress(request.socket.remoteAddress)}`);
    targetRoom.join(client);

    socket.on('message', async (data) => {
      if (socket.readyState !== WebSocket.OPEN) return; // already being closed

      if (!bucket.take()) {
        logger.warn(`${client.id} is sending too fast: disconnecting it`);
        socket.close(1008, 'Rate limit exceeded'); // its outbox re-sends after it reconnects
        return;
      }

      let message;
      try {
        message = parseClientMessage(data.toString());
      } catch (error) {
        logger.warn(`${client.id} sent an invalid message: ${error.message}`);
        client.send({ type: 'error', message: error.message });
        return;
      }
      if (message.type === 'presence') {
        // Presence is ephemeral: relayed to the others, never saved, no acknowledgement.
        targetRoom.updatePresence(client, message);
        return;
      }

      try {
        if (message.type === 'revert') {
          logger.info(`${client.id} asked to revert to version ${message.version}`);
          const result = await targetRoom.revertTo(message.version);
          client.send({ type: 'reverted', version: message.version, operations: result.operations });
        } else {
          await targetRoom.receive(client, message.op); // resolves once saved (or already saved)
          client.send({ type: 'ack', opKey: operationKey(message.op) });
        }
      } catch (error) {
        if (error instanceof InvalidOperationError) {
          // opKey lets the client stop retrying an operation that can never be accepted.
          client.send({ type: 'error', message: error.message, opKey: operationKey(message.op) });
        } else if (error instanceof ClientError || error instanceof RangeError) {
          client.send({ type: 'error', message: error.message }); // safe to show
        } else {
          // Details go to our log; the client only gets a generic message.
          logger.error(`${client.id}: could not process ${message.type}: ${error.message}`);
          client.send({ type: 'error', message: 'The server could not complete that request' });
        }
      }
    });

    socket.on('close', () => targetRoom.leave(client));

    // Without this handler, one bad connection could crash the whole server.
    socket.on('error', (error) => logger.error(`${client.id} socket error: ${error.message}`));
  });

  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      resolve({
        room, // the default document's room
        rooms,
        port: httpServer.address().port,
        // Abruptly disconnects every client (used by tests to simulate network failures).
        dropClients() {
          for (const socket of wss.clients) socket.terminate();
        },
        close() {
          stopHeartbeat();
          for (const socket of wss.clients) socket.terminate();
          httpServer.closeAllConnections();
          return new Promise((done) => httpServer.close(done));
        },
      });
    });
  });
}