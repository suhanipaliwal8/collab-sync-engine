# Collab Sync Engine

**The backend behind Google Docs-style live editing, built from first principles in Node.js.**
A hand-written RGA CRDT (no sync or CRDT libraries) lets many people edit one document at the
same time, even offline, and always end up with identical text.

![CI](https://github.com/suhanipaliwal8/collab-sync-engine/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)

![Demo](docs/media/demo.gif)

## Why this project

Most developers *use* sync engines (Firebase, Liveblocks) without knowing how concurrent edits are
merged without conflict. This project implements that part itself, then builds everything around
it that a real system needs: durable history, offline editing, reconnects without loss or
duplication, access control, rate limiting, and measured latency.

## Features

- **Concurrent editing that converges**: a sequence CRDT (RGA) with Lamport-clock IDs, tombstones,
  idempotent operations and causal buffering
- **Offline editing**: edits made without a connection are kept in an outbox and merged on reconnect
- **Reconnect without loss or duplication**: acknowledgements, outbox, backoff with jitter, a
  database-level uniqueness guarantee
- **History and revert**: an append-only PostgreSQL log; view any version, restore it by adding
  compensating operations (history is never rewritten)
- **Live sync**: WebSocket broadcast, measured end to end (see Performance)
- **Presence**: who is online and where their cursor is, anchored to character IDs so cursors
  follow edits; a heartbeat removes dead connections
- **Multiple documents** (`?doc=name`) and **hardening**: validation, integrity checks, token
  check, Origin check, rate limiting, caps
- **Proven**: 192 automated tests including every delivery order, seeded random simulations,
  real-network tests and a chaos test with random disconnects

## Requirements coverage

| # | Requirement | Where and how it is proven |
|---|---|---|
| 1 | Concurrent editing converges | `test/crdt/convergence.test.js`, end-to-end tests |
| 2 | Own conflict resolution (no library) | `src/crdt/rga-document.js`; the only dependencies are `ws` and `pg` |
| 3 | Offline edits merge on reconnect | `src/client/sync-client.js`; tests "offline edits on both sides merge" and the chaos test |
| 4 | Full history and revert to any point | `src/crdt/history.js`, `DocumentRoom.revertTo`, History panel; tests in `test/server/revert.test.js` |
| 5 | Sub-second propagation | `npm run bench` and a test asserting p95 < 1000 ms |
| 6 | Convergence proof by test | all 720 orders of one scenario, duplicates, random simulations, plus [`docs/CONVERGENCE.md`](docs/CONVERGENCE.md) |
| 7 | Disconnect mid-edit without loss or duplication | acks, outbox, `UNIQUE (document_id, op_key)`; the chaos test counts operations exactly |
| + | Stretch: presence | cursor anchors, heartbeat, "Who is here" list |
| + | Stretch: structured documents | **not implemented** (see Future work) |

## Quick start

**Everything in Docker** (needs Docker Desktop):

    npm run app:up         # builds and starts PostgreSQL + the server
    # open http://localhost:8080 in two browser windows
    npm run app:down

**For development** (needs Node.js 22+ and Docker Desktop for the database):

    npm install
    npm run db:up          # PostgreSQL in Docker (port 5433)
    npm start              # http://localhost:8080
    npm test

Try it: open the page in two windows and type in both; set different names to see
"Who is here"; click **Simulate offline**, edit, then **Go online**; open **History** and
restore a version; use `?doc=notes` for another document. Run `npm run demo` to watch two bots
edit concurrently and merge after one of them goes offline. Details: [`docs/DEMO.md`](docs/DEMO.md).

## How it works (short version)

Every character gets a unique ID `{ counter, siteId }`. An edit is an *operation* ("insert x after
character A", "delete character B"). Because operations refer to characters, not positions, they
can arrive late, twice or out of order and still produce the same document everywhere. The server
is a relay with a durable log: it saves each operation to PostgreSQL, then broadcasts it and
acknowledges it. Clients apply edits locally first and re-send anything unacknowledged after a
reconnect.

    Browser: textarea → SyncClient → RgaDocument (local copy) + Outbox + PresenceBook
                           │  WebSocket
    Server:  upgrade checks → RoomManager → DocumentRoom (one per document) → PostgreSQL log

Read more:
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): components, data model, flows, guarantees, failure modes
- [`docs/CONVERGENCE.md`](docs/CONVERGENCE.md): why replicas converge, with its assumptions
- [`docs/adr/`](docs/adr): the six main design decisions and their alternatives

## Performance

`npm run bench -- [receivers] [operations]` starts a server (with the database), connects one
sender and N receivers, and times every delivery with a monotonic clock. Percentiles are
reported because averages hide slow outliers. Measured on my machine (replace with your numbers):

| Receivers | Operations | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| 10 | 500 | _ ms | _ ms | _ ms | _ ms |

Includes the database write; excludes real network delay and browser rendering.

## Security and limits

| Threat | Defence |
|---|---|
| Garbage operations in the permanent log | shape validation; unknown parent/target rejected; id must be newer than its parent |
| Flooding | token bucket per connection (closes with 1008; the outbox re-sends after reconnecting), 1 MiB messages, 50 clients per document, 200 open documents |
| Dead connections | heartbeat ping/pong |
| Unauthorised access | optional `ACCESS_TOKEN` (constant-time comparison) for WebSockets and the history API |
| Another website using a visitor's browser | `Origin` check on upgrade |
| Odd document or display names | strict ID pattern; names sanitized and shown as text |

The token proves knowledge of a shared secret, not identity, and travels in the URL, so real use
needs HTTPS. Per-user login is intentionally out of scope.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket port |
| `LOG_LEVEL` | `debug` (`info` in Docker) | `debug` (every operation), `info`, `warn`, `error` |
| `DATABASE_URL` | local Docker database | PostgreSQL connection string |
| `ACCESS_TOKEN` | none | when set, clients must present it (`?token=` or `Authorization: Bearer`) |

Typed text is never written to the logs, only operation types and IDs.

## API and protocol

HTTP (add `&doc=name`, and the token if enabled):
`GET /api/history?limit=50` returns `{ count, entries }`; `GET /api/history/:version` returns `{ version, count, text }`.

WebSocket `ws://host/?doc=name&token=...`, JSON messages:

| Direction | Message |
|---|---|
| client → server | `{ type: "op", op }` · `{ type: "revert", version }` · `{ type: "presence", name?, cursor? }` |
| server → client | `{ type: "sync", ops }` on every connect · `{ type: "op", op }` · `{ type: "ack", opKey }` |
| server → client | `{ type: "reverted", version, operations }` · `{ type: "error", message, opKey? }` |
| server → client | `{ type: "presence_state", peers }` · `{ type: "presence", peer }` · `{ type: "presence_leave", id }` |

## Testing

    npm test       # 192 tests; database tests need `npm run db:up` (CI starts PostgreSQL itself)

| Layer | Examples |
|---|---|
| Unit | IDs, clock, RGA, outbox, token bucket, protocol, statistics |
| Convergence | all 720 delivery orders, duplicates, seeded random simulations (2, 3, 5 sites) |
| End to end | real server and clients over WebSockets: sync, history, revert, presence, hardening |
| Chaos | random disconnects and offline periods; exactly as many stored operations as created, identical replicas |
| Performance | latency test: p95 under one second including the database write |

Replicas are compared by full internal state including tombstones. The tests are strong evidence of
convergence, not a mathematical proof.

## Project structure

    src/crdt/        IDs, Lamport clock, RGA document, history (shared with the browser)
    src/client/      SyncClient, outbox, presence, backoff, throttle, text diff (shared with the browser)
    src/server/      protocol, rooms, store, API, auth, rate limiter, heartbeat, HTTP + WebSocket server
    src/tools/       latency benchmark and statistics
    scripts/         demo bots and the benchmark command
    public/          the light-themed page and its glue code
    docs/            architecture, convergence argument, decision records, demo guide
    test/            unit, convergence, end-to-end and chaos tests

## Tech stack

Node.js 22 (plain JavaScript, ES modules), WebSockets (`ws`), PostgreSQL 17 (`pg`), Docker and
Docker Compose, GitHub Actions (tests with a PostgreSQL service container, Docker build), the
built-in `node:test` runner. No CRDT, sync, framework or UI libraries.

## Known limitations and future work

- **Structured documents** (nested lists or a spreadsheet grid, a stretch goal) are not implemented.
- Every reconnect receives the whole history; **version vectors** would send only what is missing.
- Viewing a version replays the log; **snapshots** would make it fast. Rooms stay in memory once opened.
- Tombstones are never garbage-collected; list operations are O(n).
- One shared access token (no identity or per-document permissions); needs HTTPS in real use.
- A revert is several operations; a database failure midway could leave it partial (use a transaction).
- Presence is a list; there are no coloured carets inside the text box.
- A paste larger than 5000 characters is delivered over several reconnects (rate limit).
- Single server process; scaling out needs routing by document and a pub/sub layer.

## What I learned

CRDTs and convergence, logical clocks, at-least-once delivery with idempotency, durable logs,
WebSocket protocols, reconnect strategies (backoff with jitter), rate limiting with a token bucket,
cross-site WebSocket hijacking, property-style and chaos testing, latency percentiles, and
documenting decisions with ADRs.

## License

[MIT](LICENSE)