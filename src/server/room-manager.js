import { DocumentRoom } from './document-room.js';
import { InvalidDocumentIdError, RoomLimitError } from './errors.js';
import { silentLogger } from './logger.js';

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidDocumentId(id) {
  return typeof id === 'string' && DOCUMENT_ID_PATTERN.test(id);
}

// Creates a room the first time a document is used and restores its history from the store.
export class RoomManager {
  constructor({ store = null, logger = silentLogger, maxRooms = 200 } = {}) {
    this.store = store;
    this.logger = logger;
    this.maxRooms = maxRooms;
    this.rooms = new Map(); // documentId -> Promise of a restored DocumentRoom
  }

  get size() {
    return this.rooms.size;
  }

  // We keep the PROMISE, so two simultaneous first requests share a single restore.
  get(documentId) {
    if (!isValidDocumentId(documentId)) return Promise.reject(new InvalidDocumentIdError());

    const existing = this.rooms.get(documentId);
    if (existing) return existing;
    if (this.rooms.size >= this.maxRooms) return Promise.reject(new RoomLimitError());

    const room = new DocumentRoom(documentId, { store: this.store, logger: this.logger });
    const ready = room.restore().then(() => room);
    this.rooms.set(documentId, ready);
    ready.catch(() => this.rooms.delete(documentId)); // a failed restore can be retried later
    return ready;
  }
}