import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RgaDocument } from '../../src/crdt/rga-document.js';
import {
  createRandom,
  shuffle,
  permutations,
  stateSignature,
  runRandomSimulation,
} from '../helpers/simulation.js';

// 3 sites, 6 operations: three shared setup ops, then three concurrent edits.
function buildScenario() {
  const a = new RgaDocument('A');
  const b = new RgaDocument('B');
  const c = new RgaDocument('C');

  const setup = [a.localInsert(0, 'C'), a.localInsert(1, 'A'), a.localInsert(2, 'T')];
  setup.forEach((op) => {
    b.applyRemote(op);
    c.applyRemote(op);
  });

  // Concurrent: nobody has seen anybody else's edit below.
  return [
    ...setup,
    a.localDelete(2),      // A deletes "T"
    b.localInsert(1, 'H'), // B inserts "H" after "C"
    c.localInsert(3, 'S'), // C inserts "S" after "T"
  ];
}

function assertSimulationsConverge({ siteCount, steps, seeds }) {
  let nonEmpty = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const docs = runRandomSimulation({ seed, siteCount, steps });
    const expected = stateSignature(docs[0]);
    if (docs[0].getText().length > 0) nonEmpty++;

    docs.forEach((doc, i) => {
      assert.equal(doc.pending.length, 0, `seed ${seed}: site ${i} still has pending ops`);
      assert.equal(stateSignature(doc), expected, `seed ${seed}: site ${i} diverged`);
    });
  }
  // Guard against a useless test where every document is empty.
  assert.ok(nonEmpty > seeds / 2, 'simulations were too trivial');
}

test('every delivery order of the same operations gives the same state', () => {
  const orders = permutations(buildScenario());
  assert.equal(orders.length, 720);

  const signatures = new Set();
  const texts = new Set();
  for (const order of orders) {
    const replica = new RgaDocument('observer');
    order.forEach((op) => replica.applyRemote(op));
    assert.equal(replica.pending.length, 0);
    signatures.add(stateSignature(replica));
    texts.add(replica.getText());
  }

  assert.equal(signatures.size, 1, 'replicas ended in different internal states');
  assert.deepEqual([...texts], ['CHAS']);
});

test('duplicated deliveries do not change the final state', () => {
  const ops = buildScenario();
  const reference = new RgaDocument('reference');
  ops.forEach((op) => reference.applyRemote(op));

  const random = createRandom(42);
  for (let round = 0; round < 50; round++) {
    const messy = shuffle([...ops, ...ops], random); // each operation twice
    const replica = new RgaDocument('observer');
    messy.forEach((op) => replica.applyRemote(op));
    assert.equal(stateSignature(replica), stateSignature(reference));
  }
});

test('offline edits on two sites merge without overwriting each other', () => {
  const a = new RgaDocument('A');
  const b = new RgaDocument('B');
  const opsA = [...'hello'].map((ch, i) => a.localInsert(i, ch));
  const opsB = [...'world'].map((ch, i) => b.localInsert(i, ch));

  opsB.forEach((op) => a.applyRemote(op));
  opsA.forEach((op) => b.applyRemote(op));

  assert.equal(a.getText(), 'worldhello');
  assert.equal(b.getText(), 'worldhello');
});

test('random simulations converge with 2 sites (200 seeds)', () => {
  assertSimulationsConverge({ siteCount: 2, steps: 60, seeds: 200 });
});

test('random simulations converge with 3 sites (200 seeds)', () => {
  assertSimulationsConverge({ siteCount: 3, steps: 80, seeds: 200 });
});

test('random simulations converge with 5 sites (100 seeds, longer runs)', () => {
  assertSimulationsConverge({ siteCount: 5, steps: 150, seeds: 100 });
});