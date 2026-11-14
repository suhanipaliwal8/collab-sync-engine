import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { DocumentRoom } from './document-room.js';
import { parseClientMessage } from './protocol.js';
import { handleHttpRequest } from './static-files.js';
import { silentLogger } from './logger.js';

const MAX_MESSAGE_BYTES = 1024 * 1024; // refuse messages bigger than 1 MiB

// "::ffff:192.168.1.5" is just IPv4 written in IPv6 style; show it plainly.
function cleanAddress(address) {
  return (address ?? 'unknown').replace(/^::ffff:/, '');
}

// Starts the server and resolves once it is listening.
// Use port 0 to let the OS choose a free port (handy for tests).
export async function startSyncServer({
  port = 8080,
  documentId = 'default',
  store = null,
  logger = silentLogger,
} = {}) {
  const room = new DocumentRoom(documentId, { store, logger });
  await room.restore(); // load saved history before accepting anyone

  // One port serves both plain HTTP (the web page) and WebSocket (live edits).
  const httpServer = createServer((request, response) => {
    response.on('finish', () => {
      const from = cleanAddress(request.socket.remoteAddress);
      logger.debug(`http ${request.method} ${request.url} → ${response.statusCode} (${from})`);
    });
    handleHttpRequest(request, response);
  });
  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });

  let nextClientNumber = 1;

  wss.on('connection', (socket, request) => {
    // The room only knows "something with a send() method", not sockets.
    const client = {
      id: `c${nextClientNumber++}`,
      send(message) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      },
    };

    logger.info(`${client.id} connected from ${cleanAddress(request.socket.remoteAddress)}`);
    room.join(client);

    socket.on('message', async (data) => {
      let message;
      try {
        message = parseClientMessage(data.toString());
      } catch (error) {
        logger.warn(`${client.id} sent an invalid message: ${error.message}`);
        client.send({ type: 'error', message: error.message });
        return;
      }

      try {
        await room.receive(client, message.op);
      } catch (error) {
        // Details go to our log; the client only gets a generic message.
        logger.error(`${client.id}: could not process operation: ${error.message}`);
        client.send({ type: 'error', message: 'The server could not save that operation' });
      }
    });

    socket.on('close', () => room.leave(client));

    // Without this handler, one bad connection could crash the whole server.
    socket.on('error', (error) => logger.error(`${client.id} socket error: ${error.message}`));
  });

  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      resolve({
        room,
        port: httpServer.address().port,
        close() {
          for (const socket of wss.clients) socket.terminate();
          httpServer.closeAllConnections();
          return new Promise((done) => httpServer.close(done));
        },
      });
    });
  });
}