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

**Tests: 104 passing**

## Try it
Requires Node.js LTS (22+) and Docker Desktop.

    npm install
    npm run db:up      # starts PostgreSQL in Docker (port 5433)
    npm start

Open http://localhost:8080 in two browser windows and type in both. Click
**History** to drag through every version of the document and restore one.
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
    Browser tab (RgaDocument + textarea) ── WebSocket ── Sync server ── DocumentRoom ── PostgreSQL
                                          └─ HTTP: page + /api/history

- **Shared code**: the same `src/crdt/*.js` modules run in the server and the browser.
- **Local-first**: an edit is applied to the local document immediately, then
  sent to the server as an operation.
- **Server = relay with a durable log**: it saves every operation to PostgreSQL
  *before* broadcasting it, sends the full log to newcomers, broadcasts to
  everyone except the sender and ignores duplicates. Conflict resolution
  happens in the CRDT, not on the server.
- **Append-only storage**: table `operations(seq, document_id, op_key, op JSONB,
  created_at)`; `UNIQUE (document_id, op_key)` makes duplicate storage impossible.
- **Ordered processing**: edits and reverts go through one queue, so they never interleave.
- **Text box binding**: `src/client/text-diff.js` diffs old and new text into
  delete/insert operations and keeps the caret in place (also used by the
  server to generate revert operations).

## History and revert
- The operation log *is* the history. **Version N** = the document after the
  first N operations (0 = empty). Viewing version N replays that prefix.
- **Revert never rewrites history** (like `git revert`, not `git reset`): the
  server compares the current text with the target version and adds *new*
  operations (as site `server`) that turn one into the other. They are saved
  and broadcast like any edit, so a revert can itself be reverted.
- Deleted characters are tombstones and cannot be undeleted, so restored text
  is re-inserted as new characters.

| Endpoint / message | Meaning |
|---|---|
| `GET /api/history?limit=50` | `{ count, entries: [...] }` most recent entries |
| `GET /api/history/:version` | `{ version, count, text }` (400 invalid, 404 unknown) |
| WebSocket `{ type: "revert", version }` | revert to a version |
| WebSocket `{ type: "reverted", version, operations }` | answer to the requester |

The history preview is rendered with `textContent` (never `innerHTML`), because
the text was typed by other people.

## Protocol (JSON over WebSocket)
| Direction | Message |
|---|---|
| client → server | `{ "type": "op", "op": <insert or delete> }` |
| client → server | `{ "type": "revert", "version": <int> }` |
| server → client | `{ "type": "sync", "ops": [...] }` sent on connect |
| server → client | `{ "type": "op", "op": <insert or delete> }` an edit (including revert operations) |
| server → client | `{ "type": "reverted", ... }` / `{ "type": "error", "message": "..." }` |

Insert: `{ type: "insert", id, parentId, value }`. Delete: `{ type: "delete", targetId }`.
Incoming messages are validated and sanitized (`src/server/protocol.js`).

## Core concepts
- **Site**: one client's replica of the document (each browser tab is a site).
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

Replicas are compared by full internal state (including tombstones). These
tests are strong evidence of convergence, not a mathematical proof.

## Project structure
    src/crdt/        IDs, Lamport clock, RGA document, history helpers (shared with the browser)
    src/client/      text diff, caret logic, site ID (shared with the browser)
    src/server/      protocol, DocumentRoom, operation store, API, logger, HTTP + WebSocket server
    public/          index.html and client.js (browser glue)
    docker-compose.yml   PostgreSQL for development
    test/            unit, convergence and integration tests

## Testing
Database tests need PostgreSQL running (`npm run db:up`); CI starts one as a
service container. Tests use their own document IDs and clean up after themselves.

    npm test

## Known limitations
- After a disconnect the page must be reloaded (Phase 8).
- Viewing a version replays operations (no snapshots), and the whole log is kept in memory.
- A revert is several operations; a database failure midway could leave it partial (transaction planned).
- Delete operations don't record who deleted; history shows authorship for inserts only.
- Single document ("default"); no authentication or rate limiting yet (Phase 9).

## Roadmap
Offline/reconnect → hardening (auth, limits, latency) → presence.