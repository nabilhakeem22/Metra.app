// Unified action result + error codes (A4). Pure — no server-only deps, so it is
// importable from client mappers and unit tests. UI localizes each code via
// resolveActionError -> t(`errors.${code}`).
export type ActionCode =
  | 'forbidden'
  | 'invalid'
  | 'generic'
  | 'name_required'
  | 'last_owner'
  | 'owner_immutable'
  | 'self'
  | 'already_member'
  | 'pending_exists'
  | 'declined'
  | 'otp_send_failed'
  | 'otp_verify_failed'
  | 'immutable'
  | 'code_required'
  | 'code_taken'
  | 'invalid_percentage'
  | 'import_empty'
  | 'import_too_large'
  | 'client_required'
  | 'invalid_dates';

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
