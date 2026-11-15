# 1. Use an RGA CRDT instead of Operational Transformation

Status: accepted

## Context
Several clients edit one document, some offline. Merging must not need a central referee, and
the project requires implementing the conflict resolution ourselves (no CRDT library).

## Decision
Implement RGA (Replicated Growable Array): every character has a unique ID from a Lamport clock,
inserts say "after character X", deletes leave tombstones, operations are idempotent and wait for
their dependencies.

## Alternatives considered
Operational Transformation: positions are rewritten by transform functions and need a carefully
ordered central server; correct transform functions are notoriously hard to get right and to test.

## Consequences
+ Operations commute, so offline merging is just exchanging operations.
+ Convergence can be tested exhaustively and by random simulation.
- Every character carries metadata and tombstones are never collected.
- List operations are O(n) in this implementation.
- Deleted text cannot be "undeleted" (see ADR 3).