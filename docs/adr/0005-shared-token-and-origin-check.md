# 5. Protect the server with an optional shared token and an Origin check

Status: accepted

## Context
The server accepts connections from browsers. It needs basic protection without building a user system.

## Decision
An optional `ACCESS_TOKEN` (constant-time comparison) protects WebSocket upgrades and the history
API; the `Origin` header must match the host; plus validation, integrity checks, rate limiting and caps.

## Alternatives considered
JWT/OAuth with accounts and permissions: out of scope for this project's learning goals.

## Consequences
+ Simple, testable, no extra services.
- One shared secret: no identity, no per-document permissions.
- The token travels in the URL because browsers cannot set WebSocket headers; real use needs HTTPS.