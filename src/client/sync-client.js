import { RgaDocument } from '../crdt/rga-document.js';
import { operationKey } from '../crdt/operation-key.js';
import { applyChangeToDocument } from './text-diff.js';
import { Outbox } from './outbox.js';
import { reconnectDelay } from './backoff.js';
import { PresenceBook } from './presence.js';

const OPEN = 1; // WebSocket readyState "open" (same in browsers and in the ws library)

// Keeps a local document in sync with the server, through disconnects:
//  - edits always apply locally first and wait in the outbox until the server acknowledges them
//  - after every (re)connect the server's history is merged in and unacknowledged edits are re-sent
//  - reconnection happens automatically, with backoff
// Everything environment-specific (socket, storage, timing) is passed in, so it is testable.
export class SyncClient {
  constructor({
    siteId,
    createSocket,
    storage = null,
    storageKey = 'collab-outbox',
    onChange = () => {},
    onStatus = () => {},
    onNotice = () => {},
    onPresence = () => {},
    delay = reconnectDelay,
  }) {
    this.doc = new RgaDocument(siteId);
    this.createSocket = createSocket;
    this.outbox = new Outbox(storage, storageKey);
    this.onChange = onChange; // the document text changed
    this.onStatus = onStatus; // { status, unsent } changed
    this.onNotice = onNotice; // 'reverted' and 'error' messages from the server
    this.delay = delay;
    this.onPresence = onPresence;        // the list of other people changed
    this.presence = new PresenceBook();  // who else is here (never saved)
    this.myPresence = null;              // our own name/cursor, re-sent after every reconnect

    this.status = 'offline'; // 'connecting' | 'online' | 'offline'
    this.hasSynced = false;  // true once we have received the history at least once
    this.paused = false;     // true while the user chose to stay offline
    this.socket = null;
    this.timer = null;
    this.attempt = 0;

    // Edits saved by an earlier page load: show them now, send them after the first sync.
    for (const op of this.outbox.pending()) this.doc.applyRemote(op);
  }

  get text() {
    return this.doc.getText();
  }

  get unsentCount() {
    return this.outbox.size;
  }

    // The other people in the document, with their cursors resolved to current positions.
  get peers() {
    return this.presence.resolve(this.doc);
  }

  connect() {
    if (this.paused || this.socket) return;
    this._setStatus('connecting');

    const socket = this.createSocket();
    this.socket = socket;

    socket.onmessage = (event) => {
      if (this.socket !== socket) return; // ignore anything from a socket we gave up on
      this._handleMessage(JSON.parse(String(event.data)));
    };
    socket.onerror = () => {}; // a close event always follows an error
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this._scheduleReconnect();
    };
  }

  // The user (or a test) chooses to stay offline. Editing keeps working locally.
  goOffline() {
    this._forgetPeers();
    this.paused = true;
    clearTimeout(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) socket.close();
    this._setStatus('offline');
  }

  goOnline() {
    this.paused = false;
    this.attempt = 0;
    this.connect();
  }

  // `change` comes from diffText(oldText, newText). Returns the operations it produced.
  edit(change) {
    const ops = applyChangeToDocument(this.doc, change);
    for (const op of ops) {
      this.outbox.add(op); // safe until the server acknowledges it
      this._send({ type: 'op', op }); // does nothing while offline; the outbox covers it
    }
    this._emitStatus();
    return ops;
  }

  // Returns false when offline (reverting needs the server).
  revert(version) {
    return this._send({ type: 'revert', version });
  }

  // Tell the others who we are and where our cursor is. `start` and `end` are positions in the
  // visible text; they are sent as anchors (character ids) so they survive concurrent edits.
  // Presence is ephemeral: if we are offline nothing is queued, but the latest value is
  // re-sent after the next sync.
  updatePresence({ name = null, start = null, end = null } = {}) {
    const message = { type: 'presence' };
    if (name) message.name = name;
    if (start !== null) {
      message.cursor = { start: this.doc.anchorAt(start), end: this.doc.anchorAt(end ?? start) };
    }
    this.myPresence = { ...this.myPresence, ...message };
    this._send(message);
  }

  _forgetPeers() {
    this.presence.clear(); // while disconnected we cannot know who is still there
    this.onPresence();
  }

  _handleMessage(message) {
    if (message.type === 'sync') {
      for (const op of message.ops) this.doc.applyRemote(op); // duplicates are harmless
      const stored = new Set(message.ops.map(operationKey));

      // Whatever the server already has needs no re-sending.
      for (const op of this.outbox.pending()) {
        if (stored.has(operationKey(op))) this.outbox.acknowledge(operationKey(op));
      }

      this.hasSynced = true;
      this.attempt = 0;
      this._setStatus('online');
      for (const op of this.outbox.pending()) this._send({ type: 'op', op }); // the rest, in order
      if (this.myPresence) this._send(this.myPresence); // announce ourselves again
      this.onChange();
    } else if (message.type === 'op') {
      this.doc.applyRemote(message.op);
      this.onChange();
    } else if (message.type === 'ack') {
      this.outbox.acknowledge(message.opKey);
      this._emitStatus();
    } else if (message.type === 'presence_state') {
      this.presence.replaceAll(message.peers);
      this.onPresence();
    } else if (message.type === 'presence') {
      this.presence.set(message.peer);
      this.onPresence();
    } else if (message.type === 'presence_leave') {
      this.presence.remove(message.id);
      this.onPresence();
    } else {
      if (message.type === 'error' && message.opKey) {
        // The server will never accept this operation: stop retrying it.
        this.outbox.acknowledge(message.opKey);
        this._emitStatus();
      }
      this.onNotice(message); // 'reverted' and 'error'
    }
  }

  _send(message) {
    if (this.status !== 'online' || !this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  _scheduleReconnect() {
    this._forgetPeers();
    this._setStatus('offline');
    if (this.paused) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, this.delay(this.attempt++));
  }

  _setStatus(status) {
    this.status = status;
    this._emitStatus();
  }

  _emitStatus() {
    this.onStatus({ status: this.status, unsent: this.outbox.size });
  }
}