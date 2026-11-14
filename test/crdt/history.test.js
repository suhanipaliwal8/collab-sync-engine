import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RgaDocument } from '../../src/crdt/rga-document.js';
import { buildDocument, textAtVersion } from '../../src/crdt/history.js';
import { createRandom, randomInt } from '../helpers/simulation.js';

// One author edits at random; we note the text after every single operation.
function recordSession(seed, steps) {
  const random = createRandom(seed);
  const author = new RgaDocument('alice');
  const ops = [];
  const textAfter = ['']; // textAfter[v] = text after v operations

  for (let i = 0; i < steps; i++) {
    const length = author.getText().length;
    const op =
      length > 0 && random() < 0.3
        ? author.localDelete(randomInt(random, length))
        : author.localInsert(randomInt(random, length + 1), 'abcdef'[randomInt(random, 6)]);
    ops.push(op);
    textAfter.push(author.getText());
  }
  return { ops, textAfter };
}

test('buildDocument replays operations in order', () => {
  const author = new RgaDocument('alice');
  const ops = [author.localInsert(0, 'h'), author.localInsert(1, 'i')];
  assert.equal(buildDocument(ops).getText(), 'hi');
});

test('time travel matches what the author saw after every single operation', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { ops, textAfter } = recordSession(seed, 60);
    for (let version = 0; version <= ops.length; version++) {
      assert.equal(
        textAtVersion(ops, version),
        textAfter[version],
        `seed ${seed}, version ${version}`,
      );
    }
  }
});

test('rejects versions outside the history', () => {
  const author = new RgaDocument('alice');
  const ops = [author.localInsert(0, 'x')];
  for (const bad of [-1, 1.5, 99, '1', NaN]) {
    assert.throws(() => textAtVersion(ops, bad), RangeError);
  }
});