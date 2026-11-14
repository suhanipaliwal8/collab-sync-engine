import WebSocket from 'ws';

// Connects to the server and returns helpers to send and receive JSON messages.
// Acknowledgements are kept apart from other messages: use next() for the
// messages and nextAck() for acknowledgements.
export function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://localhost:${port}`);
    const queues = { messages: [], acks: [] }; // arrived, but nobody asked yet
    const waiting = { messages: [], acks: [] }; // callers waiting for the next one

    function deliver(kind, message) {
      const waiter = waiting[kind].shift();
      if (waiter) waiter(message);
      else queues[kind].push(message);
    }

    function take(kind) {
      return new Promise((done) => {
        if (queues[kind].length > 0) done(queues[kind].shift());
        else waiting[kind].push(done);
      });
    }

    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      deliver(message.type === 'ack' ? 'acks' : 'messages', message);
    });

    socket.on('error', reject);

    socket.on('open', () =>
      resolve({
        socket,
        send: (message) => socket.send(JSON.stringify(message)),
        next: () => take('messages'),
        nextAck: () => take('acks'),
      }),
    );
  });
}