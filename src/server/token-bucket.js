// A bucket that holds up to `capacity` tokens and refills at `refillPerSecond`.
// Each action takes tokens; an empty bucket means "too fast". Bursts up to the capacity
// are fine, but the sustained rate is capped at the refill rate.
export class TokenBucket {
  constructor({ capacity, refillPerSecond, now = () => performance.now() }) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.now = now; // injectable so tests can control time
    this.tokens = capacity;
    this.lastRefill = now();
  }

  // Returns true and removes the tokens if enough are available; otherwise returns false
  // and removes nothing.
  take(count = 1) {
    this._refill();
    if (this.tokens < count) return false;
    this.tokens -= count;
    return true;
  }

  _refill() {
    const current = this.now();
    const elapsedSeconds = Math.max(0, (current - this.lastRefill) / 1000);
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefill = current;
  }
}