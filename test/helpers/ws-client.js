import WebSocket from 'ws';

// Connects to the server and returns helpers to send and receive JSON messages.
export function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://localhost:${port}`);
    const received = []; // messages that arrived but nobody asked for yet
    const waiting = [];  // callers waiting for the next message

    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      const waiter = waiting.shift();
      if (waiter) waiter(message);
      else received.push(message);
    });

    socket.on('error', reject);

    socket.on('open', () =>
      resolve({
        socket,
        send: (message) => socket.send(JSON.stringify(message)),
        // Resolves with the next message (immediately if one is already queued).
        next: () =>
          new Promise((done) => {
            if (received.length > 0) done(received.shift());
            else waiting.push(done);
          }),
      }),
    );
  });
}