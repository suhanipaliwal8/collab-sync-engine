import { createId } from './id.js';

export class LamportClock {
  constructor(siteId) {
    this.siteId = siteId;
    this.counter = 0;
  }

  // Call before creating a new local operation. Returns a fresh unique ID.
  tick() {
    this.counter += 1;
    return createId(this.counter, this.siteId);
  }

  // Call when a remote operation arrives, so our next ID is bigger than anything we've seen.
  receive(remoteCounter) {
    this.counter = Math.max(this.counter, remoteCounter);
  }
}