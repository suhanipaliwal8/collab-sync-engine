import { RgaDocument } from '../crdt/rga-document.js';
import { idToString } from '../crdt/id.js';

// One shared document. Knows nothing about WebSockets: a "client" is any
// object with a send(message) method. That keeps it easy to test.
export class DocumentRoom {
  constructor(documentId) {
    this.documentId = documentId;
    this.doc = new RgaDocument('server'); // the server's own replica
    this.log = [];                        // every operation, in arrival order
    this.seen = new Set();                // keys of operations already accepted
    this.clients = new Set();
  }

  join(client) {
    this.clients.add(client);
    client.send({ type: 'sync', ops: [...this.log] }); // full history for the newcomer
  }

  leave(client) {
    this.clients.delete(client);
  }

  // Returns true if the operation was new, false if it was a duplicate.
  receive(sender, op) {
    const key = operationKey(op);
    if (this.seen.has(key)) return false; // duplicate: ignore, don't re-broadcast

    this.seen.add(key);
    this.log.push(op);
    this.doc.applyRemote(op);

    for (const client of this.clients) {
      if (client !== sender) client.send({ type: 'op', op });
    }
    return true;
  }
}

function operationKey(op) {
  return op.type === 'insert'
    ? `ins:${idToString(op.id)}`
    : `del:${idToString(op.targetId)}`;
}