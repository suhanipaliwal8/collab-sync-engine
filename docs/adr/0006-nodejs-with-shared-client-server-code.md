# 6. Use Node.js and share the CRDT code between server and browser

Status: accepted

## Context
The project needs many concurrent WebSocket connections, and the same merge logic must run on both
sides to guarantee identical behaviour.

## Decision
Use Node.js with plain JavaScript (ES modules). The `src/crdt` and parts of `src/client` run unchanged
in the server, the browser and the tests. Dependencies are limited to `ws` and `pg`.

## Alternatives considered
Python (Django Channels or FastAPI): familiar, but the merge logic would have to be written twice.

## Consequences
+ One tested algorithm; end-to-end tests run the real client inside Node.
+ The event loop suits many idle connections.
- A new language and ecosystem to learn.
- Single-threaded: slow handlers would block everyone, so handlers stay short.