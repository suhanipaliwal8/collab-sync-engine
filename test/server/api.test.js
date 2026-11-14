import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSyncServer } from '../../src/server/server.js';
import { RgaDocument } from '../../src/crdt/rga-document.js';

const options = { timeout: 5000 };

async function getJson(port, path) {
  const response = await fetch(`http://localhost:${port}${path}`);
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    body: await response.json(),
  };
}

// A server whose document already contains "hi" (2 operations).
async function serverWithHi() {
  const server = await startSyncServer({ port: 0 });
  const author = new RgaDocument('alice');
  for (const [i, ch] of [...'hi'].entries()) {
    await server.room.receive(null, author.localInsert(i, ch));
  }
  return server;
}

test('GET /api/history returns the count and the recent entries', options, async () => {
  const server = await serverWithHi();
  try {
    const res = await getJson(server.port, '/api/history');
    assert.equal(res.status, 200);
    assert.match(res.type, /application\/json/);
    assert.equal(res.body.count, 2);
    assert.equal(res.body.entries.length, 2);
    assert.equal(res.body.entries[0].version, 1);

    const limited = await getJson(server.port, '/api/history?limit=1');
    assert.equal(limited.body.entries.length, 1);
    assert.equal(limited.body.entries[0].version, 2);
  } finally {
    await server.close();
  }
});

test('GET /api/history/:version returns the text at that version', options, async () => {
  const server = await serverWithHi();
  try {
    assert.equal((await getJson(server.port, '/api/history/0')).body.text, '');
    assert.equal((await getJson(server.port, '/api/history/1')).body.text, 'h');
    const last = await getJson(server.port, '/api/history/2');
    assert.equal(last.body.text, 'hi');
    assert.equal(last.body.count, 2);
  } finally {
    await server.close();
  }
});

test('a version beyond the history gets a 404', options, async () => {
  const server = await serverWithHi();
  try {
    const res = await getJson(server.port, '/api/history/99');
    assert.equal(res.status, 404);
    assert.match(res.body.error, /Unknown version/);
  } finally {
    await server.close();
  }
});

test('a version that is not a whole number gets a 400', options, async () => {
  const server = await serverWithHi();
  try {
    assert.equal((await getJson(server.port, '/api/history/abc')).status, 400);
    assert.equal((await getJson(server.port, '/api/history/-1')).status, 400);
  } finally {
    await server.close();
  }
});