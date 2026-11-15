# Why replicas converge (an informal argument)

**Claim (strong eventual consistency).** Take a set `S` of operations in which every operation's
dependencies are also in `S` (an insert depends on its parent, a delete on its target). Any replica
that has applied all of `S` ends with the same document, whatever order it received them in
(as long as dependencies come first), even if some arrive more than once.

## Assumptions, and where they are enforced

| # | Assumption | Enforced by |
|---|---|---|
| A1 | Every character ID is unique | `siteId` is random per page load; the counter strictly increases per site |
| A2 | A character's ID is greater than its parent's ID | Lamport clock (`receive` moves the clock forward); the server rejects violations |
| A3 | An operation is applied only after its dependencies | `pending` buffer in `RgaDocument`; the server rejects unknown parents/targets |

## The argument

1. **A tree.** The inserts in `S` form a tree: each insert is a child of its parent, rooted at the
   start of the document. A2 means there are no cycles.
2. **A canonical order.** Define the *canonical order* as a depth-first, pre-order walk of that
   tree where each node's children are visited in **descending ID order**. It depends only on `S`.
3. **Invariant.** After applying any set of inserts (dependencies first), a replica's list equals the
   canonical order of the tree built from those inserts.

   *Proof by induction on insertions.* Inserting `n` with parent `p`: the rule places `n` right after
   `p`, skipping nodes whose ID is greater than `n`'s. In the canonical order, what follows `p` is its
   children with IDs greater than `n`, each followed by its whole subtree. By A2 every node in such a
   subtree has an ID greater than its subtree root's, so greater than `n`'s: the loop skips exactly
   those. The next node is either a child of `p` with a smaller ID (where `n` belongs, just before it),
   or the first node after `p`'s whole subtree, which is a later sibling of `p` or of an ancestor `a`
   of `p`. A later sibling has an ID smaller than that of `a`'s earlier siblings, and `id(a) <= id(p) < id(n)`
   by A2, so the loop stops there. Either way `n` lands exactly where the canonical order puts it. ∎
4. **Deletes.** A delete only sets a flag on an existing node. Setting a flag is idempotent and
   commutes with inserts and with other deletes. The visible text is the canonical order with
   flagged nodes removed, and the set of flags depends only on `S`.
5. **Duplicates** are ignored (an insert is identified by its ID, a delete by its target).

Therefore the final state is a function of `S` alone: all replicas that have seen `S` agree.

## What the tests add

| Test | What it checks |
|---|---|
| every delivery order (720) | the same 6 operations, in every order, give one state (step 3 in practice) |
| duplicates | each operation delivered twice in shuffled order |
| random simulations (500 runs) | 2, 3 and 5 sites, random edits, late, reordered and duplicated messages |
| network and chaos tests | the real client and server with disconnects, offline periods, resends |

Replicas are compared by *full internal state including tombstones*, which is stricter than comparing text.

## Limits of this argument

- It is informal and not machine-checked. The tests are evidence, not a proof.
- It argues about the algorithm; a bug in the code could still exist, which is why the tests exist.
- It assumes A1 to A3. Violating A2 or A3 could break convergence, so the server enforces them.
- It says nothing about *intention*: concurrent edits are merged, not "resolved" the way a person might prefer.