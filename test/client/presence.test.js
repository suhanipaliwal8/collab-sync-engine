import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PresenceBook, lineAndColumn, peerColor } from '../../src/client/presence.js';
import { RgaDocument } from '../../src/crdt/rga-document.js';

const peer = (id, name, cursor = null) => ({ id, name, cursor });

function typed(siteId, text) {
  const doc = new RgaDocument(siteId);
  const ops = [...text].map((ch, i) => doc.localInsert(i, ch));
  return { doc, ops };
}

test('PresenceBook tracks, replaces, removes and clears peers', () => {
  const book = new PresenceBook();
  book.set(peer('c1', 'Alice'));
  book.set(peer('c2', 'Bob'));
  assert.equal(book.peers.size, 2);

  book.set(peer('c1', 'Alice B.')); // an update replaces the old entry
  assert.equal(book.peers.get('c1').name, 'Alice B.');

  book.remove('c2');
  assert.deepEqual([...book.peers.keys()], ['c1']);

  book.replaceAll([peer('c9', 'Zed')]);
  assert.deepEqual([...book.peers.keys()], ['c9']);

  book.clear();
  assert.equal(book.peers.size, 0);
});

test('resolve turns cursor anchors into positions in the current document', () => {
  const { doc } = typed('A', 'cat');
  const anchor = doc.anchorAt(2);
  const book = new PresenceBook();
  book.set(peer('c1', 'Alice', { start: anchor, end: anchor }));
  assert.deepEqual(book.resolve(doc), [{ id: 'c1', name: 'Alice', start: 2, end: 2 }]);
});

test('a cursor whose character has not arrived yet is null, then resolves once it does', () => {
  const { doc: alice, ops } = typed('A', 'ab');
  const anchor = alice.anchorAt(2);
  const book = new PresenceBook();
  book.set(peer('c1', 'Alice', { start: anchor, end: anchor }));

  const bob = new RgaDocument('B'); // has not received anything yet
  assert.equal(book.resolve(bob)[0].start, null);

  ops.forEach((op) => bob.applyRemote(op));
  assert.equal(book.resolve(bob)[0].start, 2);
});

test('a cursor follows edits made before it, without a new presence message', () => {
  const { doc } = typed('A', 'cat');
  const anchor = doc.anchorAt(2);
  const book = new PresenceBook();
  book.set(peer('c1', 'Alice', { start: anchor, end: anchor }));

  doc.localInsert(0, 'X');
  assert.equal(book.resolve(doc)[0].start, 3);
});

test('a peer without a cursor resolves to null positions', () => {
  const book = new PresenceBook();
  book.set(peer('c1', 'Alice'));
  assert.deepEqual(book.resolve(new RgaDocument('B')), [
    { id: 'c1', name: 'Alice', start: null, end: null },
  ]);
});

test('lineAndColumn: the start of the text is line 1, column 1', () => {
  assert.deepEqual(lineAndColumn('hello', 0), { line: 1, column: 1 });
});

test('lineAndColumn: columns count within a line and restart after a newline', () => {
  assert.deepEqual(lineAndColumn('ab\ncd', 2), { line: 1, column: 3 });
  assert.deepEqual(lineAndColumn('ab\ncd', 4), { line: 2, column: 2 });
});

test('lineAndColumn: a position past the end is treated as the end', () => {
  assert.deepEqual(lineAndColumn('ab', 99), { line: 1, column: 3 });
});

test('peerColor is stable, hsl-shaped and differs between neighbouring ids', () => {
  assert.equal(peerColor('c1'), peerColor('c1'));
  assert.match(peerColor('c1'), /^hsl\(\d+ 70% 45%\)$/);
  assert.notEqual(peerColor('c1'), peerColor('c2'));
});