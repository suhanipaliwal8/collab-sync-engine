import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffText,
  applyChangeToDocument,
  adjustCaret,
  utf16ToCodePointIndex,
  codePointToUtf16Index,
} from '../../src/client/text-diff.js';
import { RgaDocument } from '../../src/crdt/rga-document.js';

function documentWith(text) {
  const doc = new RgaDocument('A');
  [...text].forEach((ch, i) => doc.localInsert(i, ch));
  return doc;
}

test('diffText: identical texts produce an empty change', () => {
  assert.deepEqual(diffText('abc', 'abc'), { index: 3, removed: [], inserted: [] });
});

test('diffText: detects an insertion in the middle', () => {
  assert.deepEqual(diffText('CT', 'CAT'), { index: 1, removed: [], inserted: ['A'] });
});

test('diffText: detects a deletion', () => {
  assert.deepEqual(diffText('CAT', 'CT'), { index: 1, removed: ['A'], inserted: [] });
});

test('diffText: detects a replacement', () => {
  assert.deepEqual(diffText('CAT', 'COT'), { index: 1, removed: ['A'], inserted: ['O'] });
});

test('diffText: treats an emoji as a single character', () => {
  assert.deepEqual(diffText('a😀', 'a'), { index: 1, removed: ['😀'], inserted: [] });
});

test('adjustCaret: a caret before the change stays put', () => {
  assert.equal(adjustCaret(1, { index: 3, removed: [], inserted: ['x'] }), 1);
});

test('adjustCaret: a caret after the change shifts by its size', () => {
  assert.equal(adjustCaret(5, { index: 2, removed: [], inserted: ['x', 'y'] }), 7);
});

test('adjustCaret: a caret inside replaced text moves to the end of the new text', () => {
  const change = { index: 2, removed: ['a', 'b', 'c'], inserted: ['z'] };
  assert.equal(adjustCaret(4, change), 3);
});

test('position conversion between UTF-16 units and code points', () => {
  const text = 'a😀b';
  assert.equal(utf16ToCodePointIndex(text, 3), 2); // "a😀" is 3 units but 2 characters
  assert.equal(codePointToUtf16Index(text, 2), 3);
});

test('applyChangeToDocument: an insertion becomes one insert operation', () => {
  const doc = documentWith('CAT');
  const ops = applyChangeToDocument(doc, diffText('CAT', 'CHAT'));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, 'insert');
  assert.equal(doc.getText(), 'CHAT');
});

test('applyChangeToDocument: a replacement becomes a delete plus an insert', () => {
  const doc = documentWith('CAT');
  const ops = applyChangeToDocument(doc, diffText('CAT', 'COT'));
  assert.deepEqual(ops.map((op) => op.type), ['delete', 'insert']);
  assert.equal(doc.getText(), 'COT');
});

test('applyChangeToDocument: replacing a whole word works', () => {
  const doc = documentWith('hello');
  const ops = applyChangeToDocument(doc, diffText('hello', 'hi'));
  assert.equal(ops.length, 5); // 4 deletes + 1 insert
  assert.equal(doc.getText(), 'hi');
});