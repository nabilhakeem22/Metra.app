// The one-time codes of the client home, as the browser and the server both
// speak of them. PURE and CLIENT-SAFE: the purposes a code is asked for, what
// the client may type, and what a code request and a code-checked act answer.
// The server's half (making the code, the token functions) is ./codes.ts and
// ./code-acts.ts; nothing here knows a code's hash or the address it went to.
import { latinDigits } from '@/lib/format/latin-digits';
import type { PortalFailure } from '@/lib/share/portal-act-failure';

/**
 * The acts a code is asked for in this build: "I paid" on a payment request
 * of the execution contract, and on a design-fee instalment. Signing and a
 * change-order decision join when their acts are built (plan H6.2, H7.1); the
 * database already knows all four.
 */
export type CodePurpose = 'claim_request' | 'claim_design_payment';

export const CODE_PURPOSES: readonly CodePurpose[] = ['claim_request', 'claim_design_payment'];

/** A code is six digits. */
export const CODE_LENGTH = 6;

const SIX_DIGITS = /^\d{6}$/;

/**
 * What the code box holds after a keystroke or a paste: Latin digits only
 * (Arabic-Indic ones folded, as the proposal builder's number boxes do), at
 * most six. Spaces and anything else typed between them are dropped.
 */
export function codeBoxValue(typed: string): string {
  return latinDigits(typed).replace(/\D/g, '').slice(0, CODE_LENGTH);
}

/** The code a client sent, or null when it is not six digits (a direct call can send anything). */
export function typedCode(sent: unknown): string | null {
  if (typeof sent !== 'string') return null;
  const digits = latinDigits(sent).replace(/\s/g, '');
  return SIX_DIGITS.test(digits) ? digits : null;
}

/** A refused code request, in the words the code panel has for each. */
export type CodeRequestRefusal =
  | 'no_channel'
  | 'not_available'
  | 'busy'
  | 'send_failed'
  | 'token_invalid'
  | 'token_expired';

/**
 * What asking for a code came to. `ok`: the code is on its way to `hint` (the
 * masked address; the address itself never reaches the browser), and a new
 * one may be asked for after `resendAfterSeconds`. `too_many` carries the
 * exact wait.
 */
export type CodeRequestAnswer =
  | { ok: true; challengeId: string; hint: string; resendAfterSeconds: number }
  | { ok: false; error: 'too_many'; retryAfterSeconds: number }
  | { ok: false; error: CodeRequestRefusal }
  | ({ ok: false } & PortalFailure);

/** A code-checked act refused, every answer of the database's act wrappers but a wrong code. */
export type CodeActRefusal =
  | 'code_unknown'
  | 'code_expired'
  | 'code_used'
  | 'code_locked'
  | 'wrong_target'
  | 'token_invalid'
  | 'token_expired'
  | 'not_active'
  | 'wrong_state'
  | 'busy'
  | 'signing_closed'
  | 'link_expired'
  | 'contract_inactive'
  | 'too_many';

/**
 * What a code-checked act came to. `already`: the act IS done (an earlier
 * answer was lost, or another tab did it), so the code was not used.
 * `code_wrong` carries the tries the code has left; without them the code was
 * not six digits and nothing was counted.
 */
export type CodeAnswer =
  | { ok: true; already: boolean }
  | { ok: false; error: 'code_wrong'; attemptsLeft?: number }
  | { ok: false; error: CodeActRefusal }
  | ({ ok: false } & PortalFailure);
