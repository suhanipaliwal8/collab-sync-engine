const BASE_MS = 500;
const MAX_MS = 8000;

// How long to wait before reconnect attempt number `attempt` (0, 1, 2, ...).
// Exponential growth with a cap, plus "jitter": a random 50-100% of the delay, so many
// clients that lost the server together don't all retry at the same instant.
export function reconnectDelay(attempt, random = Math.random) {
  const ceiling = Math.min(MAX_MS, BASE_MS * 2 ** attempt);
  return Math.round(ceiling * (0.5 + random() * 0.5));
}