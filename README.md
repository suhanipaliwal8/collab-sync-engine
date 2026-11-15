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
- Phase 9: multiple documents, access token, limits, latency measurement ✅

**Tests: 154 passing**

## Try it
Requires Node.js LTS (22+) and Docker Desktop.

    npm install
    npm run db:up      # starts PostgreSQL in Docker (port 5433)
    npm start

Open http://localhost:8080 in two browser windows and type in both.
- **Documents**: `?doc=notes`, `?doc=todo` ... each is fully isolated.
- **History**: drag through every version of the document and restore one.
- **Simulate offline**: keep typing while offline, then **Go online**: both
  sides merge and nothing is lost. Stopping the server works too.

The terminal prints a URL for other devices on the same Wi-Fi (e.g. your phone).

    npm run db:down    # stop the database (data is kept in a Docker volume)
    npm run bench      # measure broadcast latency (see below)

## Configuration
| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket port |
| `LOG_LEVEL` | `debug` | `debug` (every operation), `info`, `warn`, `error` |
| `DATABASE_URL` | local Docker database | PostgreSQL connection string |
| `ACCESS_TOKEN` | *(none)* | when set, WebSocket clients and `/api/...` must present it (`?token=` or `Authorization: Bearer`) |

The typed text is never written to the logs, only operation types and IDs.

## Architecture
    Browser: textarea ─► SyncClient ─┬─ RgaDocument (local copy, always editable)
                                     ├─ Outbox (unacknowledged edits, kept in sessionStorage)
                                     └─ auto-reconnecting WebSocket
                                              │
       Sync server ── RoomManager ── DocumentRoom (one per document) ── PostgreSQL (append-only log)
       (HTTP: page + /api/history on the same port)

- **Shared code**: the same `src/crdt/*.js` modules run in the server and the browser.
- **Local-first**: an edit is applied to the local document immediately, then sent.
- **Server = relay with a durable log**: it saves every operation to PostgreSQL
  *before* broadcasting or acknowledging it and ignores duplicates. Conflict
  resolution happens in the CRDT, not on the server.
- **Append-only storage**: table `operations(seq, document_id, op_key, op JSONB,
  created_at)`; `UNIQUE (document_id, op_key)` makes duplicate storage impossible.
- **Ordered processing**: within a document, edits and reverts go through one queue.
- **Rooms**: created on first use and restored from the database; concurrent first
  requests share one restore. Document IDs match `[A-Za-z0-9_-]{1,64}`.

## Security and limits
| Threat | Defence |
|---|---|
| Garbage operations in the permanent log | the room refuses operations whose parent/target character does not exist (the error carries the `opKey` so the client drops it) |
| Flooding | token bucket per connection (burst 5000, then 500 ops/s; exceeding it closes the connection with code 1008 and the client's outbox re-sends after reconnecting), 1 MiB message cap, 50 clients per document, 200 open documents |
| Unauthorised access | optional shared token, compared in constant time; the page itself stays public |
| Another website using a visitor's browser (cross-site WebSocket hijacking) | `Origin` must match the host when present |
| Odd document names | strict ID pattern |

The token proves knowledge of a shared secret, not identity, and travels in the
URL (browsers cannot set WebSocket headers), so real use needs HTTPS. Per-user
login (JWT/OAuth) is intentionally out of scope.

## Latency
`npm run bench -- [receivers] [operations]` starts a server (with the database),
connects one sender and N receivers, and times every delivery with a monotonic
clock. Percentiles are reported because averages hide slow outliers. A test
asserts p95 < 1000 ms including the database write. Not included: real network
delay and browser rendering.

Results on my machine: *(paste your own `npm run bench` numbers here)*

## Offline editing and reconnect
- Every local operation waits in the **outbox** until the server sends an
  **ack**, which it does only after saving it.
- After any (re)connect the server sends the full history (`sync`). The client
  merges it, treats outbox operations found in it as delivered, and re-sends the
  rest in order. At-least-once delivery plus duplicate detection gives an
  exactly-once effect.
- Reconnects use exponential backoff (0.5 s up to 8 s) with random jitter.
- The outbox is mirrored to `sessionStorage` (one per document), so unsent edits survive a reload.

## History and revert
- The operation log *is* the history. **Version N** = the document after the
  first N operations. Revert never rewrites history: the server adds *new*
  operations (as site `server`) that turn the current text into the old one.

| Endpoint / message | Meaning |
|---|---|
| `GET /api/history?limit=50&doc=name` | `{ count, entries: [...] }` most recent entries |
| `GET /api/history/:version?doc=name` | `{ version, count, text }` (400 invalid, 404 unknown) |
| WebSocket `{ type: "revert", version }` | revert to a version (needs a connection) |

## Protocol (JSON over WebSocket, `ws://host/?doc=name&token=...`)
| Direction | Message |
|---|---|
| client → server | `{ "type": "op", "op": <insert or delete> }` |
| client → server | `{ "type": "revert", "version": <int> }` |
| server → client | `{ "type": "sync", "ops": [...] }` sent on every connect |
| server → client | `{ "type": "op", "op": ... }` an edit by someone else (or a revert operation) |
| server → client | `{ "type": "ack", "opKey": "ins:3@u-ab12" }` the operation is saved |
| server → client | `{ "type": "reverted", ... }` / `{ "type": "error", "message": "...", "opKey"? }` |

Insert: `{ type: "insert", id, parentId, value }`. Delete: `{ type: "delete", targetId }`.

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
   exactly as many operations as were created and every replica must be identical.

Replicas are compared by full internal state (including tombstones). These
tests are strong evidence of convergence, not a mathematical proof.

## Project structure
    src/crdt/        IDs, Lamport clock, RGA document, history, operation keys (shared with the browser)
    src/client/      SyncClient, outbox, backoff, text diff, site ID (shared with the browser)
    src/server/      protocol, rooms, store, API, auth, rate limiter, logger, HTTP + WebSocket server
    src/tools/       latency benchmark and statistics
    scripts/         command-line tools (npm run bench)
    public/          index.html and client.js (thin browser glue)
    docker-compose.yml   PostgreSQL for development
    test/            unit, convergence, end-to-end, chaos and hardening tests

## Testing
Database tests need PostgreSQL running (`npm run db:up`); CI starts one as a
service container. Tests use their own document IDs and clean up after themselves.

    npm test

## Known limitations
- On every reconnect the server sends the whole history; version vectors
  ("here is what I have, send only the rest") would make this efficient.
- Viewing a version replays operations (no snapshots); rooms stay in memory once opened.
- A paste larger than 5000 characters is delivered over several reconnects (rate limit).
- The access token is one shared secret in the URL: no user identity, needs HTTPS in real use.
- Reverting needs a connection; a revert could be partial if the database fails midway.
- Delete operations don't record who deleted.

## Roadmap
Presence (who is online and where their cursor is) → structured documents → final polish.