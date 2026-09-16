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
 * only the `code` property postgres.js copies off the server's error response.
 */

/** Postgres unique/exclusion violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Metra's own reserved SQLSTATE, raised by `enforce_immutable_when`
 * (`rls/immutability.sql`) when an UPDATE touches a column of a LOCKED row.
 * Raised today by proposals, contracts and variations.
 */
const IMMUTABILITY_VIOLATION = 'MT100';

function sqlStateOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * SQLSTATE 23505 — a unique or exclusion constraint refused the write. A REAL
 * refusal, unlike db-failure's ambiguous class, so a caller that knows which
 * constraint it raced may name it (`contract_exists`, `code_taken`, …).
 */
export function isUniqueViolation(error: unknown): boolean {
  return sqlStateOf(error) === UNIQUE_VIOLATION;
}

/**
 * SQLSTATE MT100 — `enforce_immutable_when` refused an update to a locked row.
 * The row was open when the caller read it and locked by the time it wrote, so
 * this is the LOST side of a normal race (a draft save against a send), not a
 * defect.
 */
export function isImmutabilityViolation(error: unknown): boolean {
  return sqlStateOf(error) === IMMUTABILITY_VIOLATION;
}
