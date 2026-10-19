// Unified action result + error codes (A4). Pure — no server-only deps, so it is
// importable from client mappers and unit tests. UI localizes each code via
// resolveActionError -> t(`errors.${code}`), and a result's field errors via
// describeFieldError.
import type { CommonActionCode } from './action-codes/common';
import type { DocumentActionCode } from './action-codes/documents';
import type { EngagementActionCode } from './action-codes/engagements';
import type { ExecutionActionCode } from './action-codes/execution';
import type { MarketBookActionCode } from './action-codes/market-book';
import type { FieldErrors, MessageParams } from './field-errors';

/** Every error code an action can return; each code lives in exactly one group file. */
export type ActionCode =
  | CommonActionCode
  | DocumentActionCode
  | EngagementActionCode
  | ExecutionActionCode
  | MarketBookActionCode;

/**
 * A code `err` / `fail` may produce: never the literal 'check_fields', which only
 * `fieldsFailed` / `failFields` build (they carry the fields). Non-distributive
 * on purpose, so passing an `ActionCode` variable through still compiles.
 */
type PlainActionCode<C extends ActionCode> = [C] extends ['check_fields'] ? never : C;

export interface ActionResult {
  ok: boolean;
  error?: ActionCode;
  /** Only with `error === 'check_fields'`: what is wrong under each field. */
  fields?: FieldErrors;
  /** The ICU values for the message of `error`. */
  params?: MessageParams;
  /** Only with `error === 'generic'`: the code that finds its log line. */
  reference?: string;
  link?: string;
  already?: boolean;
}

export function ok(extra?: { link?: string; already?: boolean }): ActionResult {
  return { ok: true, ...extra };
}

export function err<C extends ActionCode>(
  code: C & PlainActionCode<C>,
  params?: MessageParams,
): ActionResult {
  return params ? { ok: false, error: code, params } : { ok: false, error: code };
}

/** What a thrown ActionError carries besides its code. */
export interface ActionErrorDetail {
  fields?: FieldErrors;
  params?: MessageParams;
}

/** Throw inside a mutate core to short-circuit with a coded failure. */
export class ActionError extends Error {
  constructor(
    public code: ActionCode,
    public detail?: ActionErrorDetail,
  ) {
    super(code);
    this.name = 'ActionError';
  }
}

export function fail<C extends ActionCode>(
  code: C & PlainActionCode<C>,
  params?: MessageParams,
): never {
  throw new ActionError(code, params ? { params } : undefined);
}
