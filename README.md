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
- Phase 4: WebSocket server with live broadcast ✅
- Phase 5: browser editor ✅ (+ phone fix)
- Phase 6: PostgreSQL persistence, Docker, logging ✅
- Phase 7: edit history, time travel and revert ✅
- Phase 8: offline editing, reconnect, acknowledgements ✅

**Tests: 124 passing**

## Try it
Requires Node.js LTS (22+) and Docker Desktop.

    npm install
    npm run db:up      # starts PostgreSQL in Docker (port 5433)
    npm start

Open http://localhost:8080 in two browser windows and type in both.
- **History**: drag through every version and restore one.
- **Simulate offline**: keep typing while offline, then **Go online**: both
  sides merge and nothing is lost. Stopping the server works too; clients
  reconnect by themselves.

The terminal prints a URL for other devices on the same Wi-Fi (e.g. your phone).

    npm run db:down    # stop the database (data is kept in a Docker volume)

## Configuration
| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket port |
| `LOG_LEVEL` | `debug` | `debug` (every operation), `info`, `warn`, `error` |
| `DATABASE_URL` | local Docker database | PostgreSQL connection string |

The typed text is never written to the logs, only operation types and IDs.

## Architecture
    Browser: textarea ─► SyncClient ─┬─ RgaDocument (local copy, always editable)
                                     ├─ Outbox (unacknowledged edits, kept in sessionStorage)
                                     └─ auto-reconnecting WebSocket
                                              │
                          Sync server ── DocumentRoom ── PostgreSQL (append-only log)
                          (HTTP: page + /api/history on the same port)

- **Shared code**: the same `src/crdt/*.js` modules run in the server and the browser.
- **Local-first**: an edit is applied to the local document immediately, then sent.
- **Server = relay with a durable log**: it saves every operation to PostgreSQL
  *before* broadcasting it or acknowledging it, sends the full history to newcomers
  and ignores duplicates. Conflict resolution happens in the CRDT, not on the server.
- **Append-only storage**: table `operations(seq, document_id, op_key, op JSONB,
  created_at)`; `UNIQUE (document_id, op_key)` makes duplicate storage impossible.
- **Ordered processing**: edits and reverts go through one queue, so they never interleave.

## Offline editing and reconnect
- Every local operation waits in the **outbox** until the server sends an
  **ack** (`{ type: "ack", opKey }`), which it does only after saving it.
- After any (re)connect the server sends the full history (`sync`). The client
  merges it, treats outbox operations found in it as delivered, and re-sends the
  rest in order. Delivery is at-least-once; the server's duplicate detection
  makes the result exactly-once.
- Reconnects use exponential backoff (0.5 s up to 8 s) with random jitter.
- The outbox is mirrored to `sessionStorage`, so unsent edits survive a reload.
- Merging offline edits needs no special algorithm: CRDT operations commute and
  are idempotent, so reconnecting is just exchanging what the other side lacks.
- `SyncClient` receives its socket factory, storage and retry delay as inputs,
  so the real client is tested against the real server inside Node.

## History and revert
- The operation log *is* the history. **Version N** = the document after the
  first N operations (0 = empty). Viewing version N replays that prefix.
- **Revert never rewrites history** (like `git revert`, not `git reset`): the
  server adds *new* operations (as site `server`) that turn the current text into
  the old one, so a revert can itself be reverted.

| Endpoint / message | Meaning |
|---|---|
| `GET /api/history?limit=50` | `{ count, entries: [...] }` most recent entries |
| `GET /api/history/:version` | `{ version, count, text }` (400 invalid, 404 unknown) |
| WebSocket `{ type: "revert", version }` | revert to a version (needs a connection) |

## Protocol (JSON over WebSocket)
| Direction | Message |
|---|---|
| client → server | `{ "type": "op", "op": <insert or delete> }` |
| client → server | `{ "type": "revert", "version": <int> }` |
| server → client | `{ "type": "sync", "ops": [...] }` sent on every connect |
| server → client | `{ "type": "op", "op": ... }` an edit by someone else (or a revert operation) |
| server → client | `{ "type": "ack", "opKey": "ins:3@u-ab12" }` the operation is saved |
| server → client | `{ "type": "reverted", ... }` / `{ "type": "error", "message": "..." }` |

Insert: `{ type: "insert", id, parentId, value }`. Delete: `{ type: "delete", targetId }`.
Incoming messages are validated and sanitized (`src/server/protocol.js`).

## Core concepts
- **Site**: one client's replica of the document (each page load is a new site).
- **Character ID**: `{ counter, siteId }`, unique and totally ordered.
- **Lamport clock**: a logical counter guaranteeing an operation created after
  seeing another has a larger ID.
- **RGA (Replicated Growable Array)**: a sequence CRDT. Each insert says "put
  this character after character X"; concurrent inserts after the same parent
  are ordered by ID (bigger first), so every site picks the same order.
- **Tombstones**: deleted characters are hidden, not removed.
- **Idempotency**: applying the same operation twice changes nothing.
- **Causal buffering**: an operation whose dependency hasn't arrived waits.

## How convergence is tested
Convergence means: any two sites that have received the same set of
operations end in the same state, whatever the delivery order and even with
duplicates.
1. **Exhaustive**: 6 operations (3 concurrent) delivered in all 720 orders.
2. **Duplicates**: every operation delivered twice in shuffled order.
3. **Randomized simulation**: 2, 3 and 5 sites, seeded and reproducible.
4. **Over a real network**: two clients edit through the WebSocket server.
5. **Chaos test**: two real clients type while the server keeps dropping
   connections and clients go offline and online; the server must end with
   exactly as many operations as were created (none lost, none duplicated)
   and every replica must be identical.

Replicas are compared by full internal state (including tombstones). These
tests are strong evidence of convergence, not a mathematical proof.

## Project structure
    src/crdt/        IDs, Lamport clock, RGA document, history, operation keys (shared with the browser)
    src/client/      SyncClient, outbox, backoff, text diff, site ID (shared with the browser)
    src/server/      protocol, DocumentRoom, operation store, API, logger, HTTP + WebSocket server
    public/          index.html and client.js (thin browser glue)
    docker-compose.yml   PostgreSQL for development
    test/            unit, convergence, end-to-end and chaos tests

## Testing
Database tests need PostgreSQL running (`npm run db:up`); CI starts one as a
service container. Tests use their own document IDs and clean up after themselves.

    npm test

## Known limitations
- On every reconnect the server sends the whole history. Version vectors
  ("here is what I have, send only the rest") would make this efficient.
- Viewing a version replays operations (no snapshots), and the whole log is kept in memory.
- Reverting needs a connection.
- A revert is several operations; a database failure midway could leave it partial.
- Delete operations don't record who deleted.
- Single document ("default"); no authentication or rate limiting yet (Phase 9).

## Roadmap
Hardening (auth, limits, latency measurement) → presence.