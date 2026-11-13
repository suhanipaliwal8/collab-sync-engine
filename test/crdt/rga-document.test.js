import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RgaDocument } from '../../src/crdt/rga-document.js';
import { ROOT_ID } from '../../src/crdt/id.js';

// Helper: two sites that already share the text "CAT".
function twoSitesWithCat() {
  const a = new RgaDocument('A');
  const b = new RgaDocument('B');
  const ops = [a.localInsert(0, 'C'), a.localInsert(1, 'A'), a.localInsert(2, 'T')];
  ops.forEach((op) => b.applyRemote(op));
  return { a, b };
}

test('an empty document has empty text', () => {
  assert.equal(new RgaDocument('A').getText(), '');
});

test('local inserts build text in order', () => {
  const doc = new RgaDocument('A');
  doc.localInsert(0, 'C');
  doc.localInsert(1, 'A');
  doc.localInsert(2, 'T');
  assert.equal(doc.getText(), 'CAT');
});

test('local insert in the middle', () => {
  const doc = new RgaDocument('A');
  doc.localInsert(0, 'C');
  doc.localInsert(1, 'T');
  doc.localInsert(1, 'A');
  assert.equal(doc.getText(), 'CAT');
});

test('local delete hides the character', () => {
  const doc = new RgaDocument('A');
  doc.localInsert(0, 'C');
  doc.localInsert(1, 'A');
  doc.localInsert(2, 'T');
  doc.localDelete(1);
  assert.equal(doc.getText(), 'CT');
});

test('delete keeps a tombstone instead of removing the node', () => {
  const doc = new RgaDocument('A');
  doc.localInsert(0, 'C');
  doc.localInsert(1, 'A');
  doc.localDelete(1);
  assert.equal(doc.nodes.length, 2);
  assert.equal(doc.getText(), 'C');
});

test('a remote site applying the same ops gets the same text', () => {
  const { b } = twoSitesWithCat();
  assert.equal(b.getText(), 'CAT');
});

test('concurrent inserts at the same position converge', () => {
  const a = new RgaDocument('A');
  const b = new RgaDocument('B');
  const opA = a.localInsert(0, 'x');
  const opB = b.localInsert(0, 'y');
  a.applyRemote(opB);
  b.applyRemote(opA);
  assert.equal(a.getText(), b.getText());
  assert.equal(a.getText(), 'yx'); // 1@B beats 1@A, so y goes first
});

test('concurrent insert and delete converge', () => {
  const { a, b } = twoSitesWithCat();
  const deleteT = a.localDelete(2);    // A deletes "T"
  const insertH = b.localInsert(1, 'H'); // B inserts "H" after "C"
  a.applyRemote(insertH);
  b.applyRemote(deleteT);
  assert.equal(a.getText(), 'CHA');
  assert.equal(b.getText(), 'CHA');
});

test('applying the same operation twice changes nothing', () => {
  const a = new RgaDocument('A');
  const b = new RgaDocument('B');
  const op = a.localInsert(0, 'x');
  b.applyRemote(op);
  b.applyRemote(op);
  assert.equal(b.getText(), 'x');
  assert.equal(b.nodes.length, 1);
});

test('an insert arriving before its parent waits, then applies', () => {
  const a = new RgaDocument('A');
  const b = new RgaDocument('B');
  const first = a.localInsert(0, 'H');
  const second = a.localInsert(1, 'I');
  b.applyRemote(second); // parent "H" not here yet
  assert.equal(b.getText(), '');
  assert.equal(b.pending.length, 1);
  b.applyRemote(first);
  assert.equal(b.getText(), 'HI');
  assert.equal(b.pending.length, 0);
});

test('a delete arriving before its insert waits, then applies', () => {
  const a = new RgaDocument('A');
  const b = new RgaDocument('B');
  const insertOp = a.localInsert(0, 'x');
  const deleteOp = a.localDelete(0);
  b.applyRemote(deleteOp); // target not here yet
  assert.equal(b.pending.length, 1);
  b.applyRemote(insertOp);
  assert.equal(b.getText(), '');
  assert.equal(b.pending.length, 0);
  assert.equal(b.nodes.length, 1); // tombstone remains
});

test('deleting at an index that does not exist throws', () => {
  const doc = new RgaDocument('A');
  assert.throws(() => doc.localDelete(0), RangeError);
});

test('receiving a remote op moves the local clock forward', () => {
  const doc = new RgaDocument('B');
  doc.applyRemote({
    type: 'insert',
    id: { counter: 10, siteId: 'A' },
    parentId: ROOT_ID,
    value: 'x',
  });
  const op = doc.localInsert(1, 'y');
  assert.equal(op.id.counter, 11);
});