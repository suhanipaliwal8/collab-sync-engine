import { handleHttpRequest as serveStaticFile } from './static-files.js';
import { extractToken } from './auth.js';
import { ClientError } from './errors.js';

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data));
}

// Returns the function that handles every HTTP request: /api/... goes to the history
// endpoints (token-protected when access control is on), everything else to the static
// file allow-list. The document is chosen with ?doc=name (default: the server's default).
export function createHttpHandler({ rooms, auth, defaultDocumentId }) {
  return async function handleRequest(request, response) {
    try {
      const { pathname, searchParams } = new URL(request.url, 'http://localhost');

      if (!pathname.startsWith('/api/')) {
        serveStaticFile(request, response);
        return;
      }

      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }

      if (!auth.isAllowed(extractToken(request.headers, searchParams))) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }

      let room;
      try {
        room = await rooms.get(searchParams.get('doc') ?? defaultDocumentId);
      } catch (error) {
        if (!(error instanceof ClientError)) throw error;
        sendJson(response, error.status, { error: error.message });
        return;
      }

      if (pathname === '/api/history') {
        const requested = Number(searchParams.get('limit') ?? 50);
        const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 500) : 50;
        sendJson(response, 200, { count: room.versionCount, entries: room.recentHistory(limit) });
        return;
      }

      const match = /^\/api\/history\/([^/]+)$/.exec(pathname);
      if (match) {
        if (!/^\d+$/.test(match[1])) {
          sendJson(response, 400, { error: 'Version must be a whole number' });
          return;
        }
        const version = Number(match[1]);
        try {
          sendJson(response, 200, { version, count: room.versionCount, text: room.textAt(version) });
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          sendJson(response, 404, { error: error.message });
        }
        return;
      }

      sendJson(response, 404, { error: 'Not found' });
    } catch {
      sendJson(response, 500, { error: 'Server error' });
    }
  };
}