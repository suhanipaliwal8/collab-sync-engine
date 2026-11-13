import { RgaDocument } from '../../src/crdt/rga-document.js';
import { idToString } from '../../src/crdt/id.js';

// A tiny seeded random number generator (mulberry32).
// Same seed => same sequence, so a failing run can be replayed exactly.
export function createRandom(seed) {
  let state = seed | 0;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(random, maxExclusive) {
  return Math.floor(random() * maxExclusive);
}

// Fisher-Yates shuffle: returns a new, shuffled array.
export function shuffle(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(random, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Every ordering of an array (n! results, so keep n small).
export function permutations(items) {
  if (items.length <= 1) return [items];
  const result = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    permutations(rest).forEach((perm) => result.push([item, ...perm]));
  });
  return result;
}

// Full internal state of a document, including tombstones.
export function stateSignature(doc) {
  return doc.nodes
    .map((n) => `${idToString(n.id)}:${n.value}:${n.deleted ? 'x' : 'v'}`)
    .join('|');
}

// Several sites make random edits while messages are delivered late, out of
// order and sometimes twice. At the end every site receives everything.
export function runRandomSimulation({ seed, siteCount, steps }) {
  const random = createRandom(seed);
  const sites = Array.from({ length: siteCount }, (_, i) => ({
    doc: new RgaDocument(`site${i}`),
    inbox: [], // messages sent to this site but not delivered yet
  }));
  const letters = 'abcdefghij';

  function broadcast(op, origin) {
    for (const site of sites) {
      if (site !== origin) site.inbox.push(op);
    }
  }

  for (let step = 0; step < steps; step++) {
    const site = sites[randomInt(random, siteCount)];
    const length = site.doc.getText().length;
    const roll = random();

    if (roll < 0.4 || (roll < 0.55 && length === 0)) {
      const letter = letters[randomInt(random, letters.length)];
      const op = site.doc.localInsert(randomInt(random, length + 1), letter);
      broadcast(op, site);
    } else if (roll < 0.55) {
      broadcast(site.doc.localDelete(randomInt(random, length)), site);
    } else if (site.inbox.length > 0) {
      const [op] = site.inbox.splice(randomInt(random, site.inbox.length), 1);
      site.doc.applyRemote(op);
      if (random() < 0.2) site.inbox.push(op); // simulate a duplicate delivery
    }
  }

  // Finally, deliver everything still in flight, in random order.
  for (const site of sites) {
    shuffle(site.inbox, random).forEach((op) => site.doc.applyRemote(op));
    site.inbox = [];
  }
  return sites.map((site) => site.doc);
}