import 'server-only';
import { sqlstateOf } from '@metra/db/sqlstate';
import { isConstraintRefusalOf, isImmutabilityViolation } from './db-conflict';
import { isAmbiguousDbOutcome } from './db-failure';
import { fieldsFailed, type FieldError } from './field-errors';
import { DbWriteUncertainError } from '@/lib/db/client';
import { ActionError, type ActionCode, type ActionResult } from './result';
import { unexpectedFailure } from './unexpected';

/**
 * What a NAMED constraint's refusal means to the person: a form-level code, or
 * an error under one field. Matched on SQLSTATE 23505 / 23514 / 23503 AND the
 * constraint name, both read off one error node (`isConstraintRefusalOf`).
 *
 * Per-mutation on purpose: 23505 means "a contract already exists" at
 * contracts/generate and something else entirely at team/invite, so the wrapper
 * cannot know the sentence, only the caller can. And the CONSTRAINT is named, not
 * just the SQLSTATE, because a mutation is several statements: a bare code would
 * answer "a contract already exists" to a collision on the contract NUMBER, and
 * remove the one log line that recorded a broken allocator.
 */
export type ConstraintRefusal =
  | { readonly constraint: string; readonly code: ActionCode }
  | { readonly constraint: string; readonly field: string; readonly error: FieldError };

export interface MutationFailureOptions {
  readonly refusals?: readonly ConstraintRefusal[];
  /** The code an MT100 from THIS mutation means; default `immutable`. */
  readonly immutableCode?: ActionCode;
}

/** Deadlock: Postgres aborted one of two transactions waiting on each other. */
const DEADLOCK_DETECTED = '40P01';

function refusalAnswer(refusal: ConstraintRefusal): ActionResult {
  if ('field' in refusal) return fieldsFailed({ [refusal.field]: refusal.error });
  return { ok: false, error: refusal.code };
}

/**
 * The answer to a caught mutation failure. THE ORDER IS THE CONTRACT.
 *
 * 1. `ActionError`: a coded refusal the mutation raised itself outranks any
 *    SQLSTATE reading, and carries its own fields / params.
 * 2. AMBIGUOUS: a write deadline (DbWriteUncertainError) or a lock timeout /
 *    cancelled statement / dropped connection (isAmbiguousDbOutcome). The
 *    attempt being retried may be the very thing holding that lock and is still
 *    free to commit, so it is `uncertain` and the cockpit HOLDS its idempotency
 *    key. It must stay ahead of every refusal below.
 * 3. A deadlock is `busy`: this transaction was rolled back, but its partner may
 *    be the abandoned first attempt of the same act, so `busy` is NOT a definite
 *    refusal either (retry-policy.ts) and a held key stays held.
 * 4. A refusal the caller named by constraint: its code, or its field error.
 * 5. MT100: the row was locked under us; the caller's code or `immutable`.
 * 6. The tail: logged with a reference (a WHITELIST of the failure, never the
 *    object), answered `generic` with the same reference.
 *
 * Steps 1 to 5 are NOT logged: they are expected outcomes the product has a
 * sentence for, and a false defect line in the log is half of what this removes.
 */
export function mutationFailure(e: unknown, opts: MutationFailureOptions): ActionResult {
  if (e instanceof ActionError) return { ok: false, error: e.code, ...e.detail };
  if (e instanceof DbWriteUncertainError || isAmbiguousDbOutcome(e)) {
    return { ok: false, error: 'uncertain' };
  }
  if (sqlstateOf(e) === DEADLOCK_DETECTED) return { ok: false, error: 'busy' };
  const refusal = opts.refusals?.find((named) => isConstraintRefusalOf(e, named.constraint));
  if (refusal) return refusalAnswer(refusal);
  if (isImmutabilityViolation(e)) {
    return { ok: false, error: opts.immutableCode ?? 'immutable' };
  }
  return unexpectedFailure('mutateInOrg failed', e);
}
