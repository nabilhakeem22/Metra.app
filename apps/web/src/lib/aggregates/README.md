# lib/aggregates

Domain invariants that span more than one row and must be enforced **inside a
transaction** (so a concurrent writer can't slip past a read-then-act check).

Each function takes the `withOrgContext` `tx` and either returns a derived value
or throws `ActionError(<code>)` (via `fail`) to short-circuit the mutation. There
is exactly ONE definition of each invariant — actions import from here rather
than re-deriving the rule.

- **membership.ts**
  - `lockOrgMemberships(tx, orgId)` — advisory xact lock (serialize owner writes).
  - `ownerCount(tx)` — owners in the current org context.
  - `ensureNotLastOwner(tx)` — the last-owner invariant (an org keeps ≥1 owner).
