import { createHash, timingSafeEqual } from 'node:crypto';

// Hashing both sides first gives equal-length buffers, which timingSafeEqual requires,
// and means the comparison time does not reveal how much of the token was right.
const digest = (text) => createHash('sha256').update(text).digest();

// With no token configured everything is allowed (convenient for local development).
export function createAuthChecker(expectedToken) {
  if (!expectedToken) return { enabled: false, isAllowed: () => true };

  const expected = digest(expectedToken);
  return {
    enabled: true,
    isAllowed(candidate) {
      return typeof candidate === 'string' && timingSafeEqual(digest(candidate), expected);
    },
  };
}

// "Authorization: Bearer <token>" wins; otherwise "?token=<token>" (browsers cannot
// set headers on a WebSocket, so the page passes it in the URL).
export function extractToken(headers, searchParams) {
  const header = headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length);
  return searchParams.get('token');
}