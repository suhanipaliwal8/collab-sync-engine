import { RgaDocument } from '../crdt/rga-document.js';
import { idToString } from '../crdt/id.js';
import { silentLogger } from './logger.js';

// One shared document. Knows nothing about WebSockets: a "client" is any
// object with a send(message) method. The optional store saves operations.
export class DocumentRoom {
  constructor(documentId, { store = null, logger = silentLogger } = {}) {
    this.documentId = documentId;
    this.store = store;
    this.logger = logger;
    this.doc = new RgaDocument('server'); // the server's own replica
    this.log = [];                        // every operation, in arrival order
    this.seen = new Set();                // keys of operations already accepted
    this.clients = new Set();
    this.queue = Promise.resolve();       // operations are processed one at a time
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
    this.logger.info(
      `${label(client)} joined "${this.documentId}" (${this.clients.size} online, ` +
        `sent ${this.log.length} operation(s))`,
    );
  }

  leave(client) {
    if (this.clients.delete(client)) {
      this.logger.info(`${label(client)} left "${this.documentId}" (${this.clients.size} online)`);
    }
  }

  // Resolves to true if the operation was new, false if it was a duplicate.
  // Rejects if saving failed (nothing is broadcast in that case).
  receive(sender, op) {
    const run = this.queue.then(() => this._process(sender, op));
    this.queue = run.catch(() => {}); // one failure must not block later operations
    return run;
  }

  async _process(sender, op) {
    const key = operationKey(op);
    const description = describeOperation(op);

    if (this.seen.has(key)) {
      this.logger.debug(`duplicate ignored: ${description} from ${label(sender)}`);
      return false;
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
}

function label(client) {
  return client.id ?? 'a client';
}

function operationKey(op) {
  return op.type === 'insert'
    ? `ins:${idToString(op.id)}`
    : `del:${idToString(op.targetId)}`;
}

// Deliberately shows IDs only, never the typed character.
function describeOperation(op) {
  return op.type === 'insert'
    ? `insert ${idToString(op.id)} after ${idToString(op.parentId)}`
    : `delete ${idToString(op.targetId)}`;
}