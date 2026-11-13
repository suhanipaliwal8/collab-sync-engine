// The invisible "start of document" marker. Counter 0 is never produced by a clock.
export const ROOT_ID = { counter: 0, siteId: 'ROOT' };

export function createId(counter, siteId) {
  return { counter, siteId };
}

// Returns negative if a < b, positive if a > b, 0 if equal.
// Higher counter wins; if counters tie, compare siteId as a tie-breaker.
export function compareIds(a, b) {
  if (a.counter !== b.counter) return a.counter - b.counter;
  if (a.siteId < b.siteId) return -1;
  if (a.siteId > b.siteId) return 1;
  return 0;
}

export function idsEqual(a, b) {
  return compareIds(a, b) === 0;
}

// Handy as a Map key and for debugging, e.g. "3@alice"
export function idToString(id) {
  return `${id.counter}@${id.siteId}`;
}