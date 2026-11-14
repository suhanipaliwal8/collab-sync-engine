import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startSyncServer } from '../../src/server/server.js';
import { SyncClient } from '../../src/client/sync-client.js';
import { Outbox } from '../../src/client/outbox.js';
import { diffText } from '../../src/client/text-diff.js';
import { createRandom, randomInt } from '../helpers/simulation.js';
import { waitFor, sleep } from '../helpers/wait-for.js';

const options = { timeout: 15000 };

function fakeStorage() {
  const data = {};
  return { getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = value; } };
}

// Starts a server and gives the test a way to create clients that are cleaned up afterwards.
async function withServer(run) {
  const server = await startSyncServer({ port: 0 });
  const clients = [];
  const make = (siteId, { storage = null } = {}) => {
    const client = new SyncClient({
      siteId,
      createSocket: () => new WebSocket(`ws://localhost:${server.port}`),
      storage,
      delay: () => 10, // reconnect quickly in tests
    });
    clients.push(client);
    return client;
  };
  try {
    await run({ server, make });
  } finally {
    clients.forEach((client) => client.goOffline());
    await server.close();
  }
}

// Sets the client's whole text, the way the textarea would report it.
function setText(client, newText) {
  return client.edit(diffText(client.text, newText));
}

const online = (...clients) => clients.every((client) => client.status === 'online');

test('a new client syncs and becomes online', options, () =>
  withServer(async ({ make }) => {
    const alice = make('alice');
    alice.connect();
    await waitFor(() => online(alice), 'alice online');
    assert.equal(alice.hasSynced, true);
    assert.equal(alice.text, '');
  }));

test('an online edit reaches another client and is acknowledged', options, () =>
  withServer(async ({ make }) => {
    const alice = make('alice');
    const bob = make('bob');
    alice.connect();
    bob.connect();
    await waitFor(() => online(alice, bob), 'both online');

    setText(alice, 'hi');
    await waitFor(() => bob.text === 'hi', 'bob sees "hi"');
    await waitFor(() => alice.unsentCount === 0, 'alice edits acknowledged');
  }));

test('edits made offline are delivered after reconnecting', options, () =>
  withServer(async ({ server, make }) => {
    const alice = make('alice');
    const bob = make('bob');
    alice.connect();
    bob.connect();
    await waitFor(() => online(alice, bob), 'both online');

    alice.goOffline();
    setText(alice, 'x');
    assert.equal(alice.text, 'x');       // she can see her own edit
    assert.equal(alice.unsentCount, 1);  // but it is waiting in the outbox
    await sleep(50);
    assert.equal(bob.text, '');          // and Bob hasn't received it

    alice.goOnline();
    await waitFor(() => bob.text === 'x', 'bob receives the offline edit');
    await waitFor(() => alice.unsentCount === 0, 'outbox emptied');
    assert.equal(server.room.versionCount, 1);
  }));

test('offline edits on both sides merge without overwriting each other', options, () =>
  withServer(async ({ server, make }) => {
    const alice = make('alice');
    const bob = make('bob');
    alice.connect();
    bob.connect();
    await waitFor(() => online(alice, bob), 'both online');

    alice.goOffline();
    bob.goOffline();
    setText(alice, 'hello');
    setText(bob, 'world');
    alice.goOnline();
    bob.goOnline();

    await waitFor(
      () =>
        alice.text === 'worldhello' &&
        bob.text === 'worldhello' &&
        alice.unsentCount === 0 &&
        bob.unsentCount === 0,
      'both clients to merge',
    );
    assert.equal(server.room.versionCount, 10); // all 10 characters stored, none lost
  }));

test('a client reconnects by itself after the server drops it, losing and duplicating nothing', options, () =>
  withServer(async ({ server, make }) => {
    const alice = make('alice');
    const bob = make('bob');
    alice.connect();
    bob.connect();
    await waitFor(() => online(alice, bob), 'both online');

    setText(alice, 'a');
    server.dropClients();
    setText(alice, 'ab'); // typed while the connection is dying: may never reach the server

    await waitFor(() => bob.text === 'ab', 'bob to receive both edits after reconnecting');
    await waitFor(() => online(alice) && alice.unsentCount === 0, 'alice online with an empty outbox');
    assert.equal(server.room.versionCount, 2);
  }));

test('an operation the server already has is not duplicated (reload before the ack)', options, () =>
  withServer(async ({ server, make }) => {
    const first = make('alice');
    first.connect();
    await waitFor(() => online(first), 'first tab online');
    const [op] = setText(first, 'x');
    await waitFor(() => server.room.versionCount === 1, 'server to save the edit');

    // A new page load whose saved outbox still contains that operation (the ack never arrived).
    const storage = fakeStorage();
    new Outbox(storage).add(op);
    const reloaded = make('alice-2', { storage });
    assert.equal(reloaded.unsentCount, 1);

    reloaded.connect();
    await waitFor(() => online(reloaded) && reloaded.text === 'x', 'reloaded tab to sync');
    assert.equal(reloaded.unsentCount, 0);
    assert.equal(server.room.versionCount, 1);
  }));

test('unsent edits survive a page reload through the outbox storage', options, () =>
  withServer(async ({ make }) => {
    const storage = fakeStorage();
    const lostTab = new SyncClient({
      siteId: 'old-tab',
      createSocket: () => {
        throw new Error('this tab never connects');
      },
      storage,
    });
    setText(lostTab, 'z'); // saved in storage, never sent

    const bob = make('bob');
    bob.connect();
    await waitFor(() => online(bob), 'bob online');

    const reloaded = make('new-tab', { storage });
    assert.equal(reloaded.text, 'z'); // visible immediately from the saved outbox
    reloaded.connect();

    await waitFor(() => bob.text === 'z', 'bob to receive the saved edit');
    await waitFor(() => reloaded.unsentCount === 0, 'outbox emptied');
  }));

test('random disconnects while two clients type never lose or duplicate an edit', { timeout: 60000 }, async () => {
  for (const seed of [1, 2, 3]) {
    await withServer(async ({ server, make }) => {
      const random = createRandom(seed);
      const clients = [make('alice'), make('bob')];
      clients.forEach((client) => client.connect());
      await waitFor(() => online(...clients), 'both online');

      let totalOperations = 0;
      for (let step = 0; step < 40; step++) {
        const client = clients[randomInt(random, 2)];
        const roll = random();

        if (roll < 0.55) {
          const text = client.text;
          const chars = Array.from(text);
          if (chars.length > 0 && random() < 0.3) {
            chars.splice(randomInt(random, chars.length), 1);
          } else {
            chars.splice(randomInt(random, chars.length + 1), 0, 'abcdef'[randomInt(random, 6)]);
          }
          totalOperations += setText(client, chars.join('')).length;
        } else if (roll < 0.7) {
          server.dropClients(); // network failure for everyone
        } else if (roll < 0.8) {
          client.goOffline();
        } else if (roll < 0.9) {
          client.goOnline();
        }
        await sleep(randomInt(random, 8));
      }

      clients.forEach((client) => client.goOnline());
      await waitFor(
        () =>
          online(...clients) &&
          clients.every((client) => client.unsentCount === 0) &&
          clients[0].text === clients[1].text &&
          clients[0].text === server.room.doc.getText(),
        `seed ${seed} to settle`,
      );
      assert.equal(server.room.versionCount, totalOperations, `seed ${seed}: operations lost or duplicated`);
    });
  }
});