import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startSyncServer } from '../../src/server/server.js';

const options = { timeout: 5000 };

// Sends a GET with the path exactly as given, so no library tidies it up.
function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: 'localhost', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves the editor page at /', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    const res = await rawGet(server.port, '/');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(res.body.includes('<textarea'));
  } finally {
    await server.close();
  }
});

test('serves every browser module as JavaScript', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    const paths = [
      '/client.js',
      '/client/text-diff.js',
      '/client/site-id.js',
      '/crdt/id.js',
      '/crdt/lamport-clock.js',
      '/crdt/rga-document.js',
    ];
    for (const path of paths) {
      const res = await rawGet(server.port, path);
      assert.equal(res.status, 200, `${path} should be served`);
      assert.match(res.headers['content-type'], /javascript/);
    }
    const rga = await rawGet(server.port, '/crdt/rga-document.js');
    assert.ok(rga.body.includes('class RgaDocument'));
  } finally {
    await server.close();
  }
});

test('returns 404 for unknown paths', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    assert.equal((await rawGet(server.port, '/nope')).status, 404);
  } finally {
    await server.close();
  }
});

test('cannot be tricked into serving files outside the allow-list', options, async () => {
  const server = await startSyncServer({ port: 0 });
  try {
    for (const path of ['/../package.json', '/crdt/../../package.json', '/%2e%2e/package.json']) {
      const res = await rawGet(server.port, path);
      assert.equal(res.status, 404, `${path} must not be served`);
      assert.ok(!res.body.includes('"name"'));
    }
  } finally {
    await server.close();
  }
});