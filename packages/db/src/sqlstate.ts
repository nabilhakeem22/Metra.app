/**
 * Read a Postgres error's fields no matter how deeply the ORM has wrapped it.
 *
 * postgres.js builds its `PostgresError` by copying every field of the server's
 * ErrorResponse onto the thrown object — `code` (the SQLSTATE), `constraint_name`,
 * `table_name`, `detail` — so for years `error.code` was the whole story. It is
 * not any more. From drizzle-orm 0.44 every error raised by a query the ORM
 * executed is re-thrown as a `DrizzleQueryError` whose `message` is the generated
 * SQL and whose `cause` is the driver's original error. The SQLSTATE moved one
 * level down, silently: a top-level `error.code` read compiles, passes every unit
 * test written against a hand-built `{ code: '23505' }`, and then answers
 * `undefined` against a real database.
 *
 * What Metra reads off these errors decides whether an immutability refusal
 * (MT100) is a sentence or a 500, whether a 23505 race is the one the caller
 * named, and — through `isAmbiguousDbOutcome` — whether the cockpit may DROP a
 * held idempotency key on the money path. So the read has to be indifferent to
 * where the field sits.
 *
 * Both shapes are live at once and neither is going away:
 *  - WRAPPED — anything executed through a drizzle query builder or `tx.execute`;
 *  - BARE — anything postgres.js raises on its own, which includes the errors
 *    raised by `BEGIN`/`COMMIT` inside a drizzle transaction (the driver issues
 *    those, not the ORM), every `sql.unsafe` in the isolation gate, and the
 *    driver's own connection failures (`CONNECTION_CLOSED` and friends).
 *
 * Pure and dependency-free: no imports, so the error boundary of the money path
 * stays unit-testable without a database and without loading a driver.
 */

/**
 * How many errors to look at. The live chain is two levels
 * (DrizzleQueryError -> PostgresError); the rest is headroom for a future
 * wrapper or a small `AggregateError`, and a hard stop so a malformed graph
 * cannot spin.
 */
const MAX_ERROR_NODES = 8;

/**
 * The fields a caller may ask for by name.
 *
 * `detail` is DELIBERATELY ABSENT and must stay absent. For a 23505 the server
 * puts the colliding row in it — `Key (org_id, email)=(…, someone@example.com)
 * already exists.` — so a helper that hands it out is one `console.error` away
 * from writing tenant data into the Worker log. Widen this union only for a
 * field that describes the SHAPE of a failure.
 */
export type PostgresErrorField = 'code' | 'constraint_name';

/**
 * The error and every error beneath it, nearest first — objects only, each
 * visited at most once so a graph that points back at itself terminates.
 *
 * `cause` AND `errors[]`. An error chain is not always a chain: Node raises an
 * `AggregateError` when a connection attempt fails against several addresses
 * (happy-eyeballs resolves one host to A and AAAA, and both are refused), and
 * `Promise.any` does the same. The SQLSTATE or driver code is then on
 * `errors[0]` and nothing is on `cause`, so a `cause`-only walk answers
 * undefined — which on this codebase's money path means an ambiguous connection
 * failure reads as a definite one and the cockpit drops a held idempotency key.
 *
 * Breadth-first, so "the outermost level that carries the field" still means the
 * nearest one, and bounded by node count rather than depth so a wide
 * `AggregateError` costs the same as a deep chain.
 */
/**
 * One property off one object, or undefined if reading it THREW.
 *
 * Every read in this module goes through here. A property on a thrown value can
 * be an accessor, and an accessor can throw — a proxy, a class whose getter
 * dereferences state the failure has already torn down, a hostile object off the
 * wire. Every caller here runs INSIDE somebody's `catch`, so an exception raised
 * while classifying a failure does not become a second failure: it escapes the
 * catch that was handling the first one, and `mutateInOrg` returns a rejected
 * promise instead of a coded `ActionResult`. The error boundary must not be able
 * to throw.
 */
function readProperty(source: unknown, field: string): unknown {
  try {
    return (source as Record<string, unknown>)[field];
  } catch {
    return undefined;
  }
}

function causeChain(error: unknown): Array<Record<string, unknown>> {
  const chain: Array<Record<string, unknown>> = [];
  const visited = new Set<unknown>();
  const pending: unknown[] = [error];
  while (pending.length > 0 && chain.length < MAX_ERROR_NODES) {
    const node = pending.shift();
    if (node === null || (typeof node !== 'object' && typeof node !== 'function')) {
      continue;
    }
    if (visited.has(node)) continue;
    visited.add(node);
    chain.push(node as Record<string, unknown>);
    const cause = readProperty(node, 'cause');
    const errors = readProperty(node, 'errors');
    if (cause !== undefined && cause !== null) pending.push(cause);
    if (Array.isArray(errors)) {
      // Bounded: an aggregate of ten thousand is not a reason to build a queue
      // of ten thousand when at most MAX_ERROR_NODES will ever be read.
      for (const nested of errors.slice(0, MAX_ERROR_NODES)) pending.push(nested);
    }
  }
  return chain;
}

/**
 * The value of `field` at the OUTERMOST level that carries it as a non-empty
 * string, or undefined.
 *
 * Per-field rather than "find the driver error and read it there" on purpose:
 * `constraint_name` has to be readable off a hand-built `{ constraint_name: … }`
 * that carries no SQLSTATE at all, which is how every unit test around
 * `isUniqueViolationOf` is written.
 */
export function pgFieldOf(
  error: unknown,
  field: PostgresErrorField,
): string | undefined {
  for (const node of causeChain(error)) {
    const value = stringFieldOf(node, field);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** One named field off ONE object, with the string discipline in one place. */
function stringFieldOf(
  source: Record<string, unknown>,
  field: PostgresErrorField,
): string | undefined {
  const value = readProperty(source, field);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The SQLSTATE a thrown database error carries — `23505`, `MT100`, class `08`,
 * or one of postgres.js's own connection codes — wherever the ORM put it.
 */
export function sqlstateOf(error: unknown): string | undefined {
  return pgFieldOf(error, 'code');
}

/**
 * The object in the chain that the DRIVER threw: the outermost one carrying a
 * SQLSTATE. Undefined when nothing in the chain does.
 *
 * For reading SEVERAL fields off one error, this is what to use instead of
 * repeated `pgFieldOf` calls, because the fields must describe the SAME failure.
 * A `DrizzleQueryError` inherits `name` from `Error` and sets its `message` to
 * `Failed query: <sql>\nparams: <the bound parameters>` — so a per-field walk
 * would take `constraint_name` from the driver error and `message` from the
 * wrapper, and the wrapper's message carries the parameter VALUES. Returning the
 * one object lets the caller's whitelist stay a whitelist.
 */
export function driverErrorOf(error: unknown): Record<string, unknown> | undefined {
  for (const node of causeChain(error)) {
    if (stringFieldOf(node, 'code') !== undefined) return node;
  }
  return undefined;
}

/** A SQLSTATE and the constraint the SAME error named, read together. */
export interface DriverRefusal {
  readonly code: string;
  /** Undefined when the server attributed the error to no constraint. */
  readonly constraintName: string | undefined;
}

/**
 * The SQLSTATE and constraint name OFF ONE OBJECT — the only honest way to ask
 * "was this 23505 raised by THIS constraint?".
 *
 * Two independent `pgFieldOf` walks can answer from two DIFFERENT levels of the
 * chain, because each stops at the outermost node that carries its own field. A
 * wrapper that carries a `code` over a cause that carries a `constraint_name` —
 * a retry layer, a driver that annotates, a future ORM — would let the pair
 * agree when neither error did, and the caller would answer "a contract already
 * exists" to a collision on something else entirely. Returning the pair from
 * one node makes that unexpressible rather than merely unlikely.
 */
export function driverRefusalOf(error: unknown): DriverRefusal | undefined {
  for (const node of causeChain(error)) {
    const code = stringFieldOf(node, 'code');
    if (code !== undefined) {
      return { code, constraintName: stringFieldOf(node, 'constraint_name') };
    }
  }
  return undefined;
}
