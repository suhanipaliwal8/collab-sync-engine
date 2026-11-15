import WebSocket from 'ws';
import { performance } from 'node:perf_hooks';
import { summarize } from './stats.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ROOT = { counter: 0, siteId: 'ROOT' };

// Opens a connection and resolves once it has joined (the first message is the "sync").
function open(port, path) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://localhost:${port}${path}`);
    socket.once('error', reject);
    socket.once('message', () => resolve(socket));
  });
}

// One sender "types" `operations` characters (one every intervalMs). We time how long each
// one takes to reach every one of the `receivers`. Sender and receivers live in this process,
// so one monotonic clock times everything: no network delay and no browser rendering are
// included, but the server's work is (including saving to the database, when there is one).
export async function measureBroadcastLatency({
  port,
  receivers = 5,
  operations = 200,
  intervalMs = 5,
  path = '/',
}) {
  const sender = await open(port, path);
  const others = await Promise.all(Array.from({ length: receivers }, () => open(port, path)));

  const sentAt = new Map(); // operation counter -> time it was sent
  const latencies = [];
  const expected = receivers * operations;
  let delivered = 0;

  const allDelivered = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`only ${delivered} of ${expected} deliveries arrived`)),
      30000,
    );
    for (const socket of others) {
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type !== 'op') return;
        latencies.push(performance.now() - sentAt.get(message.op.id.counter));
        if (++delivered === expected) {
          clearTimeout(timer);
          resolve();
        }
      });
    }
  });

  for (let counter = 1; counter <= operations; counter++) {
    const op = {
      type: 'insert',
      id: { counter, siteId: 'bench' },
      parentId: counter === 1 ? ROOT : { counter: counter - 1, siteId: 'bench' },
      value: 'x',
    };
    sentAt.set(counter, performance.now());
    sender.send(JSON.stringify({ type: 'op', op }));
    await sleep(intervalMs);
  }

  await allDelivered;
  for (const socket of [sender, ...others]) socket.close();
  return summarize(latencies);
}