import { readFile } from 'node:fs/promises';

// import.meta.url is the ES-module way to ask "where is this file?".
const projectRoot = new URL('../../', import.meta.url);

const JS = 'text/javascript; charset=utf-8';

// An allow-list: only these exact URLs are served. The URL from the browser is
// never used to build a file path, which rules out "../../secret" attacks.
const routes = {
  '/': { file: 'public/index.html', type: 'text/html; charset=utf-8' },
  '/client.js': { file: 'public/client.js', type: JS },
  '/client/text-diff.js': { file: 'src/client/text-diff.js', type: JS },
  '/crdt/id.js': { file: 'src/crdt/id.js', type: JS },
  '/crdt/lamport-clock.js': { file: 'src/crdt/lamport-clock.js', type: JS },
  '/crdt/rga-document.js': { file: 'src/crdt/rga-document.js', type: JS },
};

function reply(response, status, type, body) {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  response.end(body);
}

export async function handleHttpRequest(request, response) {
  if (request.method !== 'GET') {
    reply(response, 405, 'text/plain', 'Method not allowed');
    return;
  }

  try {
    // The URL parser also resolves "/../" segments before we look at the path.
    const { pathname } = new URL(request.url, 'http://localhost');
    if (!Object.hasOwn(routes, pathname)) {
      reply(response, 404, 'text/plain', 'Not found');
      return;
    }
    const route = routes[pathname];
    const body = await readFile(new URL(route.file, projectRoot));
    reply(response, 200, route.type, body);
  } catch {
    reply(response, 500, 'text/plain', 'Server error');
  }
}