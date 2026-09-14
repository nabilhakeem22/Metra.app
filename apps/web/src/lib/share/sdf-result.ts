/**
 * One reading of the status codes the token SECURITY DEFINER functions return.
 *
 * PURE and CLIENT-SAFE: no imports, no `server-only`, no db.
 *
 * Five near-identical switch statements mapped these codes, and they differed on
 * the one code whose meaning is genuinely different per surface. On a DOCUMENT
 * (proposal / contract / variation) a second response is a FAILURE — the client
 * already decided, and pretending otherwise would hide that their second click
 * changed nothing. On an advisory SIGNAL (the delivery portal) a second submit is
 * an idempotent SUCCESS — the signal is already recorded, nothing is wrong, and a
 * double-tap on a phone must not read as an error.
 *
 * Both mappers end at `token_invalid`, so a code a portal has never seen — one a
 * newer SDF starts returning before the app that reads it ships — degrades to
 * "this link does not work" rather than to a blank screen.
 */

/** Every coded outcome a tokenised surface can show a client. Deliberately one
 *  union across all five surfaces: a portal handles the members it can reach and
 *  falls through to token_invalid for the rest. */
export type TokenResponseError =
  | 'token_invalid'
  | 'token_expired'
  | 'already_responded'
  | 'not_active'
  | 'wrong_state'
  | 'contract_inactive';

export interface DocumentSdfResult {
  ok: boolean;
  error?: TokenResponseError;
}

export interface SignalSdfResult {
  ok: boolean;
  /** Present only when the signal already existed — the action is a safe no-op. */
  code?: 'already';
  error?: TokenResponseError;
}

/** A response to a DOCUMENT: accept/reject/acknowledge/approve. `already` is a
 *  failure here, because the client's decision has already been recorded. */
export function mapDocumentSdfCode(code: string | undefined): DocumentSdfResult {
  if (code === 'ok') return { ok: true };
  return { ok: false, error: failureForSdfCode(code) };
}

/** An advisory SIGNAL on the delivery portal. `already` is an idempotent success,
 *  so a double submit shows the client the same confirmation as the first. */
export function mapSignalSdfCode(code: string | undefined): SignalSdfResult {
  if (code === 'ok') return { ok: true };
  if (code === 'already') return { ok: true, code: 'already' };
  return { ok: false, error: failureForSdfCode(code) };
}

/** A switch, not a lookup object: a lookup would answer `'constructor'` with a
 *  function rather than with `undefined`. */
function failureForSdfCode(code: string | undefined): TokenResponseError {
  switch (code) {
    case 'expired':
      return 'token_expired';
    case 'already':
      return 'already_responded';
    case 'not_active':
      return 'not_active';
    case 'wrong_state':
      return 'wrong_state';
    case 'contract_inactive':
      return 'contract_inactive';
    default:
      return 'token_invalid';
  }
}
