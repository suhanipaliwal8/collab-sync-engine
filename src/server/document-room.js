import { RgaDocument } from '../crdt/rga-document.js';
import { buildDocument, textAtVersion } from '../crdt/history.js';
import { ROOT_ID, compareIds, idToString, idsEqual } from '../crdt/id.js';
import { InvalidOperationError } from './errors.js';
import { diffText, applyChangeToDocument } from '../client/text-diff.js';
import { silentLogger } from './logger.js';
import { operationKey } from '../crdt/operation-key.js';

// One shared document. Knows nothing about WebSockets: a "client" is any
// object with a send(message) method. The optional store saves operations.
export class DocumentRoom {
  constructor(documentId, { store = null, logger = silentLogger } = {}) {
    this.documentId = documentId;
    this.store = store;
    this.logger = logger;
    this.doc = new RgaDocument('server'); // the server's own replica
    this.log = [];                        // every operation, in arrival order = the history
    this.seen = new Set();                // keys of operations already accepted
    this.clients = new Set();
    this.presence = new Map(); // client -> { id, name, cursor }  (in memory only, never saved)
    this.queue = Promise.resolve();       // operations are processed one at a time
  }

  // Number of operations in the history. Version N = state after N operations.
  get versionCount() {
    return this.log.length;
  }

  // Loads saved history. Call once, before accepting clients.
  async restore() {
    if (!this.store) return 0;
    const ops = await this.store.loadAll(this.documentId);
    for (const op of ops) {
      this.seen.add(operationKey(op));
      this.log.push(op);
      this.doc.applyRemote(op);
    }
    this.logger.info(`restored ${ops.length} operation(s) for document "${this.documentId}"`);
    return ops.length;
  }

  join(client) {
    this.clients.add(client);
    client.send({ type: 'sync', ops: [...this.log] }); // full history for the newcomer
    const peers = [...this.presence.values()];
    if (peers.length > 0) client.send({ type: 'presence_state', peers }); // who is already here
    this.logger.info(
      `${label(client)} joined "${this.documentId}" (${this.clients.size} online, ` +
        `sent ${this.log.length} operation(s))`,
    );
  }

  leave(client) {
    if (!this.clients.delete(client)) return;
    this.logger.info(`${label(client)} left "${this.documentId}" (${this.clients.size} online)`);

    if (this.presence.delete(client)) {
      for (const other of this.clients) other.send({ type: 'presence_leave', id: client.id });
    }
  }

  // ---------- Presence: who is here and where their cursor is ----------
  // Ephemeral: relayed to the others, never saved, no acknowledgement. `name` and `cursor`
  // may be null, meaning "keep what we had".
  updatePresence(client, { name = null, cursor = null }) {
    if (!this.clients.has(client)) return; // ignore anyone who is not in the room

    const previous = this.presence.get(client) ?? {
      id: client.id,
      name: `Guest ${client.id}`,
      cursor: null,
    };
    const peer = { id: client.id, name: name ?? previous.name, cursor: cursor ?? previous.cursor };
    this.presence.set(client, peer);

    for (const other of this.clients) {
      if (other !== client) other.send({ type: 'presence', peer });
    }
  }

  // ---------- History ----------

  // The document text after the first `version` operations. Throws RangeError if unknown.
  textAt(version) {
    return textAtVersion(this.log, version);
  }

  // The most recent `limit` history entries, oldest first.
  recentHistory(limit = 50) {
    const start = Math.max(0, this.log.length - limit);
    return this.log.slice(start).map((op, index) => historyEntry(op, start + index + 1));
  }

  // Restores the text of an earlier version by adding NEW operations (history is never
  // rewritten). Resolves to { operations: <how many were added> }.
  revertTo(version) {
    return this._enqueue(() => this._revert(version));
  }

  async _revert(version) {
    const target = textAtVersion(this.log, version); // throws RangeError for unknown versions

    // Generate the operations on a private copy, so a failure can't leave the live replica half-changed.
    const scratch = buildDocument(this.log, 'server');
    const change = diffText(scratch.getText(), target);
    const ops = applyChangeToDocument(scratch, change);

    for (const op of ops) await this._process(null, op); // save + broadcast to everyone

    this.logger.info(
      `reverted "${this.documentId}" to version ${version} (${ops.length} new operation(s))`,
    );
    return { operations: ops.length };
  }

  // ---------- Edits ----------

  // Resolves to true if the operation was new, false if it was a duplicate.
  // Rejects if saving failed (nothing is broadcast in that case).
  receive(sender, op) {
    return this._enqueue(() => this._process(sender, op));
  }

  // Runs jobs strictly one after another, in the order they were requested.
  _enqueue(job) {
    const run = this.queue.then(job);
    this.queue = run.catch(() => {}); // one failure must not block later jobs
    return run;
  }

  async _process(sender, op) {
    const key = operationKey(op);
    const description = describeOperation(op);

    if (this.seen.has(key)) {
      this.logger.debug(`duplicate ignored: ${description} from ${label(sender)}`);
      return false;
    }

    if (!this._hasDependencies(op)) {
      this.logger.warn(`rejected ${description} from ${label(sender)}: refers to an unknown character`);
      throw new InvalidOperationError('Operation refers to a character this document does not have');
    }
  
      // The convergence argument (docs/CONVERGENCE.md) assumes a character is always newer than
    // its parent. Honest clients guarantee it through the Lamport clock; we enforce it here so a
    // forged operation cannot break the assumption.
    if (op.type === 'insert' && compareIds(op.id, op.parentId) <= 0) {
      this.logger.warn(`rejected ${description} from ${label(sender)}: id is not newer than its parent`);
      throw new InvalidOperationError('Operation id must be newer than its parent');
    }

    if (this.store) await this.store.append(this.documentId, key, op); // saved before anyone sees it

    this.seen.add(key);
    this.log.push(op);
    this.doc.applyRemote(op);

    let recipients = 0;
    for (const client of this.clients) {
      if (client !== sender) {
        client.send({ type: 'op', op });
        recipients++;
      }
    }
    this.logger.debug(`${description} from ${label(sender)} → sent to ${recipients} other client(s)`);
    return true;
  }

  // Honest clients only build on characters the server already has. Anything else is
  // refused instead of being stored forever as an operation that can never apply.
  _hasDependencies(op) {
    if (op.type === 'delete') return this.doc.hasNode(op.targetId);
    return idsEqual(op.parentId, ROOT_ID) || this.doc.hasNode(op.parentId);
  }
}



function label(client) {
  if (!client) return 'the server';
  return client.id ?? 'a client';
}

// Deliberately shows IDs only, never the typed character (this is for logs).
function describeOperation(op) {
  return op.type === 'insert'
    ? `insert ${idToString(op.id)} after ${idToString(op.parentId)}`
    : `delete ${idToString(op.targetId)}`;
}

// What the history API shows for one operation.
function historyEntry(op, version) {
  return op.type === 'insert'
    ? { version, type: 'insert', id: idToString(op.id), siteId: op.id.siteId, value: op.value }
    : { version, type: 'delete', target: idToString(op.targetId) };
}