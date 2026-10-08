// Unified action result + error codes (A4). Pure — no server-only deps, so it is
// importable from client mappers and unit tests. UI localizes each code via
// resolveActionError -> t(`errors.${code}`).
import type { CommonActionCode } from './action-codes/common';
import type { DocumentActionCode } from './action-codes/documents';
import type { EngagementActionCode } from './action-codes/engagements';

/** Every error code an action can return; each code lives in exactly one group file. */
export type ActionCode = CommonActionCode | DocumentActionCode | EngagementActionCode;

export interface ActionResult {
  ok: boolean;
  error?: ActionCode;
  link?: string;
  already?: boolean;
}

export function ok(extra?: { link?: string; already?: boolean }): ActionResult {
  return { ok: true, ...extra };
}

export function err(code: ActionCode): ActionResult {
  return { ok: false, error: code };
}

/** Throw inside a mutate core to short-circuit with a coded failure. */
export class ActionError extends Error {
  constructor(public code: ActionCode) {
    super(code);
    this.name = 'ActionError';
  }
}

export function fail(code: ActionCode): never {
  throw new ActionError(code);
}
