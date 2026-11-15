# Demo guide

## Run it
```bash
npm run db:up
npm start                      # terminal 1
# open http://localhost:8080/?doc=demo in two browser windows
npm run demo                   # terminal 2: two bots type, one goes offline and comes back
```

## A two-minute script for a recording

| Time | Show | Say |
|---|---|---|
| 0:00 | Two windows side by side on `?doc=demo`, names set | "Two users editing the same document; there is no database lock or central referee." |
| 0:15 | Type in both at once | "Concurrent edits merge. A hand-written CRDT guarantees both windows end identical." |
| 0:35 | Move cursors; type before the other cursor | "Cursors are anchored to character IDs, so they follow edits." |
| 0:50 | Click **Simulate offline** in one window, type in both, **Go online** | "Offline edits are kept in an outbox and merged on reconnect: nothing overwritten, nothing lost." |
| 1:15 | Open **History**, drag the slider, restore a version | "Every edit is an operation in an append-only log, so any version can be replayed. A revert adds new operations instead of rewriting history." |
| 1:35 | Run `npm run demo` | "Two bots, one goes offline and returns; the terminal prints converged: true." |
| 1:50 | Show `npm test` output (192 tests) and `npm run bench` | "Convergence is tested over all 720 delivery orders, random simulations and chaos tests; median sync latency is X ms." |

## Recording the GIF or video (Windows)
- **ScreenToGif** (free): record the browser region, trim, export as GIF under about 10 MB.
- or the **Xbox Game Bar** (Win + G) for a video, then upload it to YouTube (unlisted) and link it.
- Save the GIF as `docs/media/demo.gif` and the screenshot as `docs/media/screenshot.png`, then the README shows them.

## Checklist before recording
- [ ] `npm test` is green and `npm run bench` numbers are in the README
- [ ] Browser zoom 110 to 125 percent so the text is readable
- [ ] Two windows side by side, different display names
- [ ] No secrets in the address bar (do not show a real `?token=`)