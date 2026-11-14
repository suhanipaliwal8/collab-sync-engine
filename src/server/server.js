import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { DocumentRoom } from './document-room.js';
import { parseClientMessage } from './protocol.js';
import { handleHttpRequest } from './static-files.js';

const MAX_MESSAGE_BYTES = 1024 * 1024; // refuse messages bigger than 1 MiB

// Starts the server and resolves once it is listening.
// Use port 0 to let the OS choose a free port (handy for tests).
export function startSyncServer({ port = 8080 } = {}) {
  const room = new DocumentRoom('default');

  // One port serves both plain HTTP (the web page) and WebSocket (live edits).
  const httpServer = createServer(handleHttpRequest);
  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });

  wss.on('connection', (socket) => {
    // The room only knows "something with a send() method", not sockets.
    const client = {
      send(message) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      },
    };

    room.join(client);

    socket.on('message', (data) => {
      try {
        const message = parseClientMessage(data.toString());
        room.receive(client, message.op);
      } catch (error) {
        client.send({ type: 'error', message: error.message });
      }
    });

    socket.on('close', () => room.leave(client));

    // Without this handler, one bad connection could crash the whole server.
    socket.on('error', (error) => console.error('Socket error:', error.message));
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