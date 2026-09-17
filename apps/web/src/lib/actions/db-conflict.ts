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
 * The constraint a Postgres error names, or null.
 *
 * postgres.js copies every field of the server's ErrorResponse onto the thrown
 * error, `constraint_name` among them (snake_case, as the wire protocol spells
 * it). It is absent for an error the server did not attribute to a constraint,
 * and it is not something an attacker chooses: the server writes it.
 */
export function constraintNameOf(error: unknown): string | null {
  const name = (error as { constraint_name?: unknown } | null)?.constraint_name;
  return typeof name === 'string' && name.length > 0 ? name : null;
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
 */
export function isUniqueViolationOf(error: unknown, constraint: string): boolean {
  return isUniqueViolation(error) && constraintNameOf(error) === constraint;
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
