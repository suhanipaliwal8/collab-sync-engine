# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-15

First complete release.

### Added
- RGA sequence CRDT written from scratch: unique IDs with a Lamport clock, tombstones,
  idempotent operations, causal buffering, cursor anchors
- Real-time sync over WebSockets with a durable, append-only PostgreSQL operation log
  (save, then broadcast, then acknowledge)
- Browser editor that is local-first, with a "Simulate offline" mode
- Offline editing and automatic reconnect: outbox, acknowledgements, exponential backoff
  with jitter, no lost or duplicated operations
- Edit history, time travel and revert by compensating operations
- Presence: who is here and their cursors, anchored to character IDs; heartbeat
- Multiple documents, optional access token, Origin check, rate limiting, integrity validation
- Latency benchmark with percentiles; convergence, end-to-end and chaos tests (192 tests)
- GitHub Actions CI with a PostgreSQL service container and a Docker build check
- Docker setup for the database and for the whole app
- Architecture documentation, convergence argument and architecture decision records

### Not included
- Structured documents (nested lists or spreadsheet grid), a stretch goal
- Snapshots, version vectors, per-user authentication