import { LamportClock } from './lamport-clock.js';
import { ROOT_ID, compareIds, idsEqual, idToString } from './id.js';

export class RgaDocument {
  constructor(siteId) {
    this.siteId = siteId;
    this.clock = new LamportClock(siteId);
    this.nodes = [];         // every character (including deleted ones), in document order
    this.index = new Map();  // idString -> node, for fast lookup
    this.pending = [];       // remote operations waiting for something they depend on
  }

  // ---------- Local edits (made by the user at this site) ----------

  localInsert(visibleIndex, value) {
    const parentId =
      visibleIndex === 0 ? ROOT_ID : this._visibleNodeAt(visibleIndex - 1).id;
    const op = { type: 'insert', id: this.clock.tick(), parentId, value };
    this._tryApply(op);
    return op;
  }

  localDelete(visibleIndex) {
    const op = { type: 'delete', targetId: this._visibleNodeAt(visibleIndex).id };
    this._tryApply(op);
    return op;
  }

  // ---------- Remote edits (received from another site) ----------

  applyRemote(op) {
    if (op.type === 'insert') this.clock.receive(op.id.counter);
    if (!this._tryApply(op)) {
      this.pending.push(op); // a dependency is missing; wait
      return;
    }
    this._drainPending();
  }

  // ---------- Reading ----------

  getText() {
    return this.nodes
      .filter((node) => !node.deleted)
      .map((node) => node.value)
      .join('');
  }

  // ---------- Internals ----------

  // Returns true if applied (or already applied), false if a dependency is missing.
  _tryApply(op) {
    if (op.type === 'insert') return this._integrateInsert(op);
    if (op.type === 'delete') return this._integrateDelete(op);
    throw new Error(`Unknown operation type: ${op.type}`);
  }

  _integrateInsert(op) {
    const key = idToString(op.id);
    if (this.index.has(key)) return true; // duplicate: already applied, do nothing

    let position;
    if (idsEqual(op.parentId, ROOT_ID)) {
      position = 0;
    } else {
      const parent = this.index.get(idToString(op.parentId));
      if (!parent) return false; // parent hasn't arrived yet
      position = this.nodes.indexOf(parent) + 1;
    }

    // The RGA rule: skip over nodes with a bigger id; they take priority.
    while (
      position < this.nodes.length &&
      compareIds(this.nodes[position].id, op.id) > 0
    ) {
      position++;
    }

    const node = { id: op.id, value: op.value, deleted: false };
    this.nodes.splice(position, 0, node);
    this.index.set(key, node);
    return true;
  }

  _integrateDelete(op) {
    const node = this.index.get(idToString(op.targetId));
    if (!node) return false; // the character hasn't arrived yet
    node.deleted = true;     // tombstone; safe to repeat
    return true;
  }

  // After something new is applied, retry waiting operations until nothing more can apply.
  _drainPending() {
    let progress = true;
    while (progress) {
      progress = false;
      this.pending = this.pending.filter((op) => {
        if (this._tryApply(op)) {
          progress = true;
          return false; // applied, remove from pending
        }
        return true;    // still waiting
      });
    }
  }

  _visibleNodeAt(visibleIndex) {
    const node = this.nodes.filter((n) => !n.deleted)[visibleIndex];
    if (!node) throw new RangeError(`No visible character at index ${visibleIndex}`);
    return node;
  }
}