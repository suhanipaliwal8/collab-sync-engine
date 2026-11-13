# Collab Sync Engine

![CI](https://github.com/suhanipaliwal8/collab-sync-engine/actions/workflows/ci.yml/badge.svg)

A real-time collaborative text-editing backend (Google Docs-style) built
from first principles in Node.js, with a hand-written CRDT. No pre-built
sync or CRDT libraries.

## Goals
- Multiple clients edit the same document concurrently and converge
- Offline edits merge correctly on reconnect
- Full edit history with revert to any point
- Live broadcast over WebSockets (sub-second)
- Formal convergence tests

## Status
- Phase 0: project setup ✅
- Phase 1: unique IDs + Lamport clock ✅
- Phase 2: RGA insert/delete + CI ✅
- Phase 3: convergence tests ✅

**Tests: 32 passing**

## Core concepts
- **Site**: one client's replica of the document.
- **Character ID**: `{ counter, siteId }`, unique and totally ordered, so edits
  target characters instead of shifting positions.
- **Lamport clock**: a logical counter (not wall-clock time) that guarantees an
  operation created after seeing another has a larger ID.
- **RGA (Replicated Growable Array)**: a sequence CRDT. Each insert says "put
  this character after character X". Concurrent inserts after the same parent
  are ordered by ID (bigger ID first), so every site picks the same order.
- **Tombstones**: deleted characters are hidden, not removed, so later
  operations can still refer to them.
- **Idempotency**: applying the same operation twice changes nothing.
- **Causal buffering**: an operation whose dependency hasn't arrived waits in a
  pending list and is applied later.

## How convergence is tested
Convergence means: any two sites that have received the same set of
operations end in the same state, whatever the delivery order and even with
duplicates. We check it three ways:
1. **Exhaustive**: 6 operations (3 concurrent) delivered in all 720 orders.
2. **Duplicates**: every operation delivered twice in shuffled order.
3. **Randomized simulation**: 2, 3 and 5 sites make random edits while messages
   arrive late, out of order or duplicated. Runs are seeded, so any failure
   can be reproduced from its seed.

Replicas are compared by full internal state (including tombstones), not just
visible text. These tests are strong evidence of convergence, not a
mathematical proof.

## Project structure
    src/crdt/id.js              character IDs and ordering
    src/crdt/lamport-clock.js   logical clock
    src/crdt/rga-document.js    the RGA document
    test/crdt/                  unit and convergence tests
    test/helpers/               seeded random + simulation helpers

## Getting started
Requires a recent Node.js LTS (22+).

    npm test

## Roadmap
WebSocket server → browser client → PostgreSQL history (Docker) → revert →
offline/reconnect → presence.