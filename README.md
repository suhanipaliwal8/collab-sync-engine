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

**Tests: 84 passing**

## Try it
Requires Node.js LTS (22+) and Docker Desktop.

    npm install
    npm run db:up      # starts PostgreSQL in Docker (port 5433)
    npm start

Open http://localhost:8080 in two browser windows and type in both. The
terminal prints a URL for other devices on the same Wi-Fi (e.g. your phone).
Stop and restart the server: the document is still there.

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
                                                  └─ same port also serves the page over HTTP

- **Shared code**: the exact same `src/crdt/*.js` modules run in the server and
  in the browser.
- **Local-first**: an edit is applied to the local document immediately, then
  sent to the server as an operation.
- **Server = relay with a durable log**: it saves every operation to PostgreSQL
  *before* broadcasting it, sends the full history to newcomers, broadcasts to
  everyone except the sender and ignores duplicates. Conflict resolution
  happens in the CRDT, not on the server.
- **Append-only storage**: table `operations(seq, document_id, op_key, op JSONB,
  created_at)`. `seq` is arrival order (used for history/revert);
  `UNIQUE (document_id, op_key)` makes duplicate storage impossible.
- **Ordered processing**: the room handles one operation at a time, so storage
  order matches arrival order.
- **Text box binding**: a textarea only reports its new full text, so
  `src/client/text-diff.js` diffs old and new text into delete/insert
  operations, and keeps the caret in place when remote edits arrive.
- **Static files** are served from an allow-list of exact URLs.
- `DocumentRoom` knows nothing about sockets or SQL (it receives a store and a
  logger), and browser logic lives in pure, unit-tested functions.

## Protocol (JSON over WebSocket)
| Direction | Message |
|---|---|
| client → server | `{ "type": "op", "op": <insert or delete> }` |
| server → client | `{ "type": "sync", "ops": [...] }` sent on connect |
| server → client | `{ "type": "op", "op": <insert or delete> }` another client's edit |
| server → client | `{ "type": "error", "message": "..." }` invalid input or save failure |

Insert: `{ type: "insert", id, parentId, value }`. Delete: `{ type: "delete", targetId }`.
Incoming messages are validated and sanitized (`src/server/protocol.js`).

## Core concepts
- **Site**: one client's replica of the document (each browser tab is a site).
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
duplicates.
1. **Exhaustive**: 6 operations (3 concurrent) delivered in all 720 orders.
2. **Duplicates**: every operation delivered twice in shuffled order.
3. **Randomized simulation**: 2, 3 and 5 sites make random edits while messages
   arrive late, out of order or duplicated. Runs are seeded, so any failure
   can be reproduced from its seed.
4. **Over a real network**: two clients edit through the WebSocket server and
   end with identical text.

Replicas are compared by full internal state (including tombstones). These
tests are strong evidence of convergence, not a mathematical proof.

## Project structure
    src/crdt/        IDs, Lamport clock, RGA document (shared with the browser)
    src/client/      text diff, caret logic, site ID (shared with the browser)
    src/server/      protocol, DocumentRoom, operation store, logger, HTTP + WebSocket server
    public/          index.html and client.js (browser glue)
    docker-compose.yml   PostgreSQL for development
    test/            unit, convergence and integration tests
    test/helpers/    seeded random, simulation, WebSocket test client

## Testing
Database tests need PostgreSQL running (`npm run db:up`); CI starts one as a
service container. Tests use their own document IDs and clean up after
themselves, so your development data is not touched.

    npm test

## Opening it from a phone
Use the Wi-Fi URL printed at startup. Plain `http://` pages are not "secure
contexts", so browser code must avoid APIs such as `crypto.randomUUID()`;
site IDs use `crypto.getRandomValues` instead.

## Known limitations
- After a disconnect the page must be reloaded (Phase 8).
- The whole log is kept in memory and re-sent to each newcomer (no snapshots).
- Single document ("default"); no authentication or rate limiting yet (Phase 9).

## Roadmap
History and revert → offline/reconnect → hardening → presence.