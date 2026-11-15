import WebSocket from 'ws';
import { SyncClient } from '../src/client/sync-client.js';

// Two bots type into the same document so you can watch the system work in a browser:
//   1. npm run db:up && npm start
//   2. open http://localhost:8080/?doc=demo in a browser
//   3. npm run demo
// The document keeps its history: running the demo again appends to the same document.
// For a clean document pass another name:  npm run demo -- my-fresh-doc
const documentId = process.argv[2] || 'demo';
const port = Number(process.env.PORT) || 8080;
const token = process.env.ACCESS_TOKEN;
const TYPING_DELAY_MS = 60;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(condition, description) {
  const deadline = Date.now() + 15000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}. Is the server running?`);
    await sleep(25);
  }
}

function makeBot(label) {
  const siteId = `bot-${label.toLowerCase()}-${Math.random().toString(16).slice(2, 6)}`;
  const bot = new SyncClient({
    siteId,
    createSocket: () => {
      const query = new URLSearchParams({ doc: documentId });
      if (token) query.set('token', token);
      return new WebSocket(`ws://localhost:${port}/?${query}`);
    },
  });
  bot.label = `${label} (bot)`;
  return bot;
}

// Types one line, one character at a time. The first character goes at the end of the
// document; every following character goes right after the previous one THIS bot typed,
// like a person typing in their own spot. That keeps the two bots' lines from being mixed
// letter by letter (see "Known limitations" in the README).
async function typeLine(bot, line) {
  let lastId = null;
  for (const char of line) {
    const index = lastId ? bot.doc.indexOfAnchor(lastId) : Array.from(bot.text).length;
    const [op] = bot.edit({ index, removed: [], inserted: [char] });
    lastId = op.id;
    bot.updatePresence({ name: bot.label, start: index + 1 });
    await sleep(TYPING_DELAY_MS);
  }
}

const log = (message) => console.log(`[demo] ${message}`);

const alice = makeBot('Alice');
const bob = makeBot('Bob');
alice.connect();
bob.connect();
await waitUntil(() => alice.status === 'online' && bob.status === 'online', 'both bots to connect');
log(`watching document "${documentId}": open http://localhost:${port}/?doc=${documentId}`);

log('1/3 Alice and Bob type at the same time (concurrent edits)');
await Promise.all([
  typeLine(alice, 'Alice: hello from the first replica.\n'),
  typeLine(bob, 'Bob: hi! I am typing at the same moment.\n'),
]);

log('2/3 Bob loses his connection and keeps typing offline; Alice carries on');
bob.goOffline();
await Promise.all([
  typeLine(bob, 'Bob (offline): this was typed with no connection.\n'),
  typeLine(alice, 'Alice: Bob is offline, but I keep writing.\n'),
]);
await sleep(1500);

log('3/3 Bob comes back online: his offline edits merge, nothing is lost');
bob.goOnline();
await waitUntil(
  () =>
    alice.status === 'online' &&
    bob.status === 'online' &&
    alice.unsentCount === 0 &&
    bob.unsentCount === 0 &&
    alice.text === bob.text,
  'both replicas to converge',
);

log(`converged: ${alice.text === bob.text}`);
console.log('\n--- final document ---');
console.log(alice.text);
console.log('----------------------');

alice.goOffline();
bob.goOffline();
setTimeout(() => process.exit(0), 200);