// The one-time codes of the client home, as the browser and the server both
// speak of them. PURE and CLIENT-SAFE: the purposes a code is asked for, what
// the client may type, and what a code request and a code-checked act answer.
// The server's half (making the code, the token functions) is ./codes.ts and
// ./code-acts.ts; nothing here knows a code's hash or the address it went to.
import { latinDigits } from '@/lib/format/latin-digits';
import type { PortalFailure } from '@/lib/share/portal-act-failure';

/**
 * The acts a code is asked for in this build: "I paid" on a payment request
 * of the execution contract and on a design-fee instalment, and signing the
 * execution contract. A change-order decision joins when its act is built
 * (plan H7.1); the database already knows all four.
 */
export type CodePurpose = 'claim_request' | 'claim_design_payment' | 'sign_contract';

export const CODE_PURPOSES: readonly CodePurpose[] = ['claim_request', 'claim_design_payment', 'sign_contract'];

/**
 * What the client is doing with a code, as the code panel words it: saying a
 * payment was made, or signing. Total over the purposes, so a new act names
 * its words here before the panel can speak of it.
 */
export const CODE_PURPOSE_ACT: Readonly<Record<CodePurpose, 'payment' | 'signature'>> = {
  claim_request: 'payment',
  claim_design_payment: 'payment',
  sign_contract: 'signature',
};

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

/**
 * The limit a refused code request or act met, so the panel names it (H5
 * functional F4) and the log says which fired (reliability R6). The
 * database's own (ISSUE_LIMITS): 60 s between codes for one act, 5 codes and
 * 15 wrong tries an hour on it, 10 codes a day on this client's page, 25 a
 * day for the studio, 80 a day for the service. The app's: the link's
 * 30-a-minute brake. The act's: 10 payment claims on one contract in an hour.
 */
export type CodeLimit =
  | 'target_spacing'
  | 'target_hour'
  | 'target_tries'
  | 'delivery_day'
  | 'studio_day'
  | 'platform_day'
  | 'link_minute'
  | 'claims_hour';

/** The limits app_home_code_issue_by_token names. */
export const ISSUE_LIMITS: readonly CodeLimit[] = [
  'target_spacing',
  'target_hour',
  'target_tries',
  'delivery_day',
  'studio_day',
  'platform_day',
];

/** A refused code request, in the words the code panel has for each. */
export type CodeRequestRefusal = 'no_channel' | 'not_available' | 'busy' | 'token_invalid' | 'token_expired';

/** A request or an act refused for a limit: the exact wait, and which limit. */
export type CodeTooMany = { ok: false; error: 'too_many'; retryAfterSeconds: number; limit: CodeLimit };

/** The link's brake (lib/share/portal-rate-limit.ts) is per minute: ask again after one. */
export const LINK_BRAKE_REFUSAL: CodeTooMany = { ok: false, error: 'too_many', retryAfterSeconds: 60, limit: 'link_minute' };

/**
 * What asking for a code came to. `ok`: the code is on its way to `hint` (the
 * masked address; the address itself never reaches the browser), and a new
 * one may be asked for after `resendAfterSeconds`. `too_many` carries the
 * exact wait and its limit. `send_failed`: the code did not leave, and a new
 * one may be asked for after `resendAfterSeconds` (null when nothing was
 * made). The browser never holds a code's id: the act names its target.
 */
export type CodeRequestAnswer =
  | { ok: true; hint: string; resendAfterSeconds: number }
  | CodeTooMany
  | { ok: false; error: 'send_failed'; resendAfterSeconds: number | null }
  | { ok: false; error: CodeRequestRefusal }
  | ({ ok: false } & PortalFailure);

/** A code-checked act refused, every answer of the database's act wrappers but a wrong code and a limit. */
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
  | 'contract_inactive';

/**
 * What a code-checked act came to. `already`: the act IS done (an earlier
 * answer was lost, or another tab did it), so the code was not used.
 * `code_wrong` carries the tries the code has left; without them the code was
 * not six digits and nothing was counted. `too_many` (the link's brake, or the
 * contract's claims in the hour) left the code unused, with the wait.
 */
export type CodeAnswer =
  | { ok: true; already: boolean }
  | { ok: false; error: 'code_wrong'; attemptsLeft?: number }
  | CodeTooMany
  | { ok: false; error: CodeActRefusal }
  | ({ ok: false } & PortalFailure);

/** What signing the contract came to: a code-checked act's answers, or no name to sign with (nothing sent). */
export type SignContractAnswer = CodeAnswer | { ok: false; error: 'name_required' };
