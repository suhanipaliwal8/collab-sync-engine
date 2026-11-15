# 2. Store operations in an append-only PostgreSQL log; acknowledge after saving

Status: accepted

## Context
Edits must survive restarts, clients must know when an edit is safe, and reconnects must not
create duplicates.

## Decision
Store each operation as an immutable row (`seq`, `document_id`, `op_key` UNIQUE per document, JSONB).
The server saves first, then broadcasts and acknowledges. Clients keep unacknowledged operations
in an outbox and re-send them after reconnecting.

## Alternatives considered
In-memory only (lost on restart); periodic snapshots (loses recent edits, no history); a cache or
message broker as the source of truth (more moving parts).

## Consequences
+ History comes for free; duplicates are impossible at the database level.
+ At-least-once delivery plus idempotency gives an exactly-once effect.
- Each edit costs a database write before it is broadcast (measured: see the latency benchmark).
- Whole history is replayed on every join (snapshots and version vectors are future work).