# Collab Sync Engine

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
Phase 0: project setup ✅

## Getting started
Requires Node.js 20+.

    npm test

## Roadmap
See the phase plan in `docs/` (coming soon).