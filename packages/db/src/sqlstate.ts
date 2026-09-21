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
 * How far down `cause` to look. The live chain is two levels
 * (DrizzleQueryError -> PostgresError); the rest is headroom for a future
 * wrapper, and a hard stop so a malformed chain cannot spin.
 */
const MAX_CAUSE_DEPTH = 8;

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
 * The error and every `cause` beneath it, outermost first — objects only, each
 * visited at most once so a chain that points back at itself terminates.
 */
function causeChain(error: unknown): Array<Record<string, unknown>> {
  const chain: Array<Record<string, unknown>> = [];
  const visited = new Set<unknown>();
  let node: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (node === null || (typeof node !== 'object' && typeof node !== 'function')) {
      break;
    }
    if (visited.has(node)) break;
    visited.add(node);
    chain.push(node as Record<string, unknown>);
    node = (node as { cause?: unknown }).cause;
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
    const value = node[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
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
    const code = node.code;
    if (typeof code === 'string' && code.length > 0) return node;
  }
  return undefined;
}
