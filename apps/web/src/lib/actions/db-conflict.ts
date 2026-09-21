/**
 * Is this thrown DB error a REFUSAL the caller can name?
 *
 * The sibling of `db-failure.ts`, and deliberately its opposite. That module
 * classifies AMBIGUOUS outcomes — a statement whose twin may still be about to
 * commit — which must never be re-labelled a refusal. These two SQLSTATEs are
 * the other kind: the write definitely did not happen, and it did not happen for
 * a reason the caller often knows the name of. A `mutateInOrg` that says which
 * code its own race means turns "something went wrong" into a sentence, and
 * stops an expected race writing a false defect line into the Worker log.
 *
 * Pure and dependency-free so it is unit-testable without a database: both read
 * the error's SQLSTATE through `sqlstateOf`, which finds it whether postgres.js
 * threw it directly or drizzle wrapped it in a `DrizzleQueryError` first.
 */
import { driverRefusalOf, sqlstateOf } from '@metra/db/sqlstate';

/** Postgres unique/exclusion violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Metra's own reserved SQLSTATE, raised by `enforce_immutable_when`
 * (`rls/immutability.sql`) when an UPDATE touches a column of a LOCKED row.
 * Raised today by proposals, contracts and variations.
 */
const IMMUTABILITY_VIOLATION = 'MT100';

/**
 * SQLSTATE 23505 — a unique or exclusion constraint refused the write. A REAL
 * refusal, unlike db-failure's ambiguous class, so a caller that knows which
 * constraint it raced may name it (`contract_exists`, `code_taken`, …).
 */
export function isUniqueViolation(error: unknown): boolean {
  return sqlstateOf(error) === UNIQUE_VIOLATION;
}

/**
 * SQLSTATE 23505 raised by ONE named constraint — the only 23505 a caller may
 * translate into its own sentence.
 *
 * `isUniqueViolation` alone is not enough for that job. A mutation is usually
 * several statements in one transaction, and "the 23505 I expected" and "a 23505
 * I did not expect" are indistinguishable by SQLSTATE: `generateContractCore`
 * races on (org_id, source_proposal_id), but the same transaction also inserts
 * a contract NUMBER under its own unique index. Naming the constraint is what
 * keeps an unexpected collision in the unclassified tail, where it is logged,
 * instead of being answered "a contract already exists".
 *
 * BOTH READS COME OFF ONE OBJECT (`driverRefusalOf`). Asking twice — once for
 * the code, once for the name — lets the two answers come from two different
 * levels of the `cause` chain, and a pair that never described the same error
 * is precisely the false "a contract already exists" this function exists to
 * prevent. postgres.js writes `constraint_name` itself (snake_case, as the wire
 * protocol spells it); it is not something a caller or an attacker chooses.
 */
export function isUniqueViolationOf(error: unknown, constraint: string): boolean {
  const refusal = driverRefusalOf(error);
  return refusal?.code === UNIQUE_VIOLATION && refusal.constraintName === constraint;
}

/**
 * SQLSTATE MT100 — `enforce_immutable_when` refused an update to a locked row.
 * The row was open when the caller read it and locked by the time it wrote, so
 * this is the LOST side of a normal race (a draft save against a send), not a
 * defect.
 */
export function isImmutabilityViolation(error: unknown): boolean {
  return sqlstateOf(error) === IMMUTABILITY_VIOLATION;
}
