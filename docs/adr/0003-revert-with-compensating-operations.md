# 3. Revert by adding new operations, never by rewriting history

Status: accepted

## Context
Users must be able to restore any earlier version, while other clients already hold later operations.

## Decision
Reverting to version N compares the text at version N with the current text and appends new
insert and delete operations (authored by the server) that turn one into the other.

## Alternatives considered
Truncating the log (destroys history and breaks clients that already applied later operations).

## Consequences
+ The audit trail stays intact and a revert can itself be reverted (like `git revert`).
+ Works with all connected clients without special handling.
- Restored text gets new character IDs (tombstones cannot be undone).
- A database failure midway could leave a revert partial (a transaction is a possible improvement).