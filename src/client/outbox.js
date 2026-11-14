import { operationKey } from '../crdt/operation-key.js';

function looksLikeOperation(op) {
  return Boolean(
    op &&
      typeof op === 'object' &&
      ((op.type === 'insert' && op.id && op.parentId) || (op.type === 'delete' && op.targetId)),
  );
}

// Operations created locally that the server has not acknowledged yet.
// Optionally mirrored into a Storage-like object (getItem/setItem, e.g. sessionStorage)
// so they survive a page reload.
export class Outbox {
  constructor(storage = null, storageKey = 'collab-outbox') {
    this.storage = storage;
    this.storageKey = storageKey;
    this.ops = this._load();
  }

  get size() {
    return this.ops.length;
  }

  add(op) {
    const key = operationKey(op);
    if (this.ops.some((existing) => operationKey(existing) === key)) return;
    this.ops.push(op);
    this._save();
  }

  // Called when the server confirms (or already had) an operation.
  acknowledge(key) {
    const before = this.ops.length;
    this.ops = this.ops.filter((op) => operationKey(op) !== key);
    if (this.ops.length !== before) this._save();
  }

  pending() {
    return [...this.ops];
  }

  _load() {
    if (!this.storage) return [];
    try {
      const saved = JSON.parse(this.storage.getItem(this.storageKey) ?? '[]');
      return Array.isArray(saved) ? saved.filter(looksLikeOperation) : [];
    } catch {
      return []; // unreadable data is ignored, never trusted
    }
  }

  _save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.ops));
    } catch {
      // storage full or unavailable: the outbox still works in memory
    }
  }
}