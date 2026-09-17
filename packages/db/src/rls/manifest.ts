/**
 * THE apply order for the RLS SQL, and the only place it is written down.
 *
 * Two consumers read this list and nothing else does: `scripts/apply-rls.ts`,
 * which applies the files in exactly this order, and
 * `rls/functions-order.test.ts`, which reads the `functions/` entries to check
 * that no function is used before it is created.
 *
 * NOTHING HERE IS ALPHABETICAL, and the order is a contract, not a convenience:
 *
 *   functions/*      create the SECURITY DEFINER token functions and the
 *                    child-draft trigger functions;
 *   immutability.sql creates the trigger FACTORIES (`enforce_immutable_when`);
 *   roles.sql        creates `metra_app` and grants execute on the functions
 *                    above, so they must exist first;
 *   policies/*       reference both the functions and the role.
 *
 * Postgres validates a `language sql` body at CREATE time, so a callee must be
 * created before its caller — ACROSS files as well as within one. Reordering
 * this array is a behaviour change.
 *
 * Every `.sql` file under `rls/` must appear here exactly once, and every entry
 * here must exist on disk. `functions-order.test.ts` asserts both, because the
 * failure shape otherwise is silent: a file with no entry is never applied, and
 * the symptom turns up somewhere else entirely.
 */
export const RLS_APPLY_ORDER = [
  'functions/00-org-context.sql',
  'immutability.sql',
  'roles.sql',
  'policies.sql',
] as const;

export type RlsFile = (typeof RLS_APPLY_ORDER)[number];
