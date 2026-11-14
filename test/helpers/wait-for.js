export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits until condition() is true, or fails the test with a clear message.
export async function waitFor(condition, description = 'condition', timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${description}`);
    await sleep(10);
  }
}