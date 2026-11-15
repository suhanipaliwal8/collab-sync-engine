// What the browser needs to show other people's presence. No DOM here, so it is testable.

// The peers we currently know about. Cursors are stored as anchors (character ids) and only
// turned into text positions when asked, so they follow other people's edits.
export class PresenceBook {
  constructor() {
    this.peers = new Map(); // id -> { id, name, cursor }
  }

  replaceAll(peers) {
    this.peers = new Map(peers.map((peer) => [peer.id, peer]));
  }

  set(peer) {
    this.peers.set(peer.id, peer);
  }

  remove(id) {
    this.peers.delete(id);
  }

  clear() {
    this.peers.clear();
  }

  // Peers with their cursors resolved against the current document. start/end are null when
  // the peer has no cursor yet, or we don't have the cursor's character yet.
  resolve(doc) {
    return [...this.peers.values()].map((peer) => ({
      id: peer.id,
      name: peer.name,
      start: peer.cursor ? doc.indexOfAnchor(peer.cursor.start) : null,
      end: peer.cursor ? doc.indexOfAnchor(peer.cursor.end) : null,
    }));
  }
}

// 1-based line and column of a position (counted in whole characters). Positions past the
// end of the text are treated as the end.
export function lineAndColumn(text, index) {
  let line = 1;
  let column = 1;
  for (const char of Array.from(text).slice(0, index)) {
    if (char === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

// A stable colour per peer, so someone keeps the same colour as long as they are connected.
export function peerColor(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return `hsl(${hash % 360} 70% 45%)`;
}