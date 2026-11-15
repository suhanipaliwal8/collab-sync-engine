# 4. Presence is ephemeral and cursors are anchored to character IDs

Status: accepted

## Context
Users want to see who is online and where their cursors are, without polluting the document history.

## Decision
Presence travels on the same WebSocket but is never saved, never acknowledged and has no outbox.
The latest value wins and it disappears when a connection closes (a heartbeat detects dead
connections). A cursor is the ID of the character before it, resolved against each replica.

## Alternatives considered
Cursor positions as numeric indexes (wrong after concurrent edits); storing presence in the database
(pointless durability, extra load).

## Consequences
+ Cursors follow concurrent edits with no extra messages.
+ Presence cannot grow the history or the database.
- Presence is best-effort and may be briefly stale.
- The page lists peers instead of drawing carets inside the textarea.